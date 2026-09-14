"""Optional public label intelligence layer.

This module does NOT replace blockchain tracing or the existing VASP engine.
It periodically syncs the public ImMike/crypto-wallet-address-labels repository,
normalizes EVM address labels into an in-memory index, and supplies additional
label evidence to the live investigation path.

The repository is treated as public intelligence, not ground truth. Labels can
be stale/incomplete, so existing behavioral and blockchain evidence remains the
primary investigation path.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
import zipfile
from collections import defaultdict
from typing import Any

import requests

REPO_NAME = "ImMike/crypto-wallet-address-labels"
REPO_URL = f"https://github.com/{REPO_NAME}"
ARCHIVE_URL = f"https://github.com/{REPO_NAME}/archive/refs/heads/main.zip"
CACHE_DIR = os.path.join("/tmp", "cryptotrace-label-intelligence")
ARCHIVE_PATH = os.path.join(CACHE_DIR, "repo-main.zip")
INDEX_PATH = os.path.join(CACHE_DIR, "evm-label-index.json")
META_PATH = os.path.join(CACHE_DIR, "meta.json")
SYNC_TTL = 6 * 60 * 60
REQUEST_TIMEOUT = 45
MAX_FILE_BYTES = 40 * 1024 * 1024
EVM_RE = re.compile(r"0x[a-fA-F0-9]{40}")

_LOCK = threading.Lock()
_INDEX: dict[str, list[dict[str, Any]]] = {}
_META: dict[str, Any] = {
    "status": "NOT_INITIALIZED",
    "repo": REPO_URL,
    "records_indexed": 0,
    "files_scanned": 0,
    "last_sync": None,
    "error": None,
}
_LOADED = False


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _flatten_strings(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Flatten JSON-like data into searchable key/value strings."""
    pairs: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_path = f"{prefix}.{key}" if prefix else str(key)
            pairs.extend(_flatten_strings(item, key_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            pairs.extend(_flatten_strings(item, f"{prefix}[{index}]"))
    elif value is not None:
        pairs.append((prefix, str(value)))
    return pairs


def _extract_addresses(record: Any) -> list[str]:
    addresses: set[str] = set()
    for _, value in _flatten_strings(record):
        addresses.update(match.lower() for match in EVM_RE.findall(value))
    return sorted(addresses)


def _record_text(record: Any, path: str) -> str:
    parts = [path]
    for key, value in _flatten_strings(record):
        parts.append(key)
        parts.append(value)
    return " ".join(parts).lower()


def _best_label(record: Any, path: str) -> str:
    preferred_keys = (
        "label", "entity", "name", "exchange", "company", "organization",
        "project", "protocol", "tag", "account", "owner", "cluster",
    )
    if isinstance(record, dict):
        lowered = {str(k).lower(): v for k, v in record.items()}
        for key in preferred_keys:
            value = lowered.get(key)
            if isinstance(value, str) and value.strip() and not EVM_RE.fullmatch(value.strip()):
                return value.strip()
        # Some datasets use nested labels or a single useful text field.
        for key, value in lowered.items():
            if any(token in key for token in ("label", "entity", "name", "exchange", "tag")):
                if isinstance(value, str) and value.strip():
                    return value.strip()
    # Last resort: use the dataset folder/file as a descriptive label.
    parent = os.path.basename(os.path.dirname(path)) or "Public label dataset"
    return parent.replace("-", " ").replace("_", " ").strip().title()


def _classify(record: Any, path: str, label: str) -> str:
    field_text = _record_text(record, "")
    path_text = path.lower()
    # Classification uses dataset metadata/fields, not a hardcoded address list.
    # Explicit record metadata takes priority over broad dataset-folder names.
    if any(term in field_text for term in ("phishing", "scam", "fraud", "malicious", "rugpull", "rug pull")):
        return "scam_or_malicious"
    if any(term in field_text for term in ("sanction", "ofac")):
        return "sanctioned"
    if any(term in field_text for term in ("mixer", "tornado cash")):
        return "mixer"
    if "bridge" in field_text:
        return "bridge"
    if any(term in field_text for term in ("dex", "defi", "protocol", "swap")):
        return "defi_or_dex"
    if any(term in field_text for term in ("exchange", "cex", "centralized_exchange", "centralized exchange", "custodian", "hot wallet", "deposit wallet")):
        return "exchange"
    if any(term in field_text for term in ("contract", "token")):
        return "contract_or_token"
    if any(term in field_text for term in ("wallet app", "metamask", "phantom", "trust wallet")):
        return "wallet_software"

    # If the row has no useful category field, use the dataset folder as a
    # fallback hint. This is intentionally conservative for mixed datasets.
    if "phishing" in path_text or "scam" in path_text:
        return "scam_or_malicious"
    if "exchange" in path_text and "dex" not in path_text:
        return "exchange"
    if any(term in path_text for term in ("defi", "dex")):
        return "defi_or_dex"
    if "contract" in path_text or "token" in path_text:
        return "contract_or_token"
    if "sanction" in path_text:
        return "sanctioned"
    return "other"


def _add_record(index: dict[str, list[dict[str, Any]]], record: Any, path: str, source_file: str) -> int:
    addresses = _extract_addresses(record)
    if not addresses:
        return 0
    label = _best_label(record, path)
    category = _classify(record, path, label)
    entry_base = {
        "label": label,
        "category": category,
        "source": source_file,
        "repository": REPO_URL,
    }
    added = 0
    for address in addresses:
        entry = {"address": address, **entry_base}
        bucket = index.setdefault(address, [])
        signature = (label.lower(), category, source_file)
        if not any((x.get("label", "").lower(), x.get("category"), x.get("source")) == signature for x in bucket):
            bucket.append(entry)
            added += 1
    return added


def _parse_bytes(index: dict[str, list[dict[str, Any]]], path: str, raw: bytes) -> int:
    if len(raw) > MAX_FILE_BYTES:
        return 0
    lower = path.lower()
    text = raw.decode("utf-8-sig", errors="ignore")
    added = 0

    if lower.endswith(".json"):
        try:
            data = json.loads(text)
        except Exception:
            return 0
        if isinstance(data, list):
            for record in data:
                added += _add_record(index, record, path, path)
        elif isinstance(data, dict):
            # Support both {address: label} maps and normal record objects.
            if all(isinstance(v, (str, int, float)) for v in data.values()) and any(EVM_RE.fullmatch(str(k)) for k in data):
                for address, label in data.items():
                    if EVM_RE.fullmatch(str(address)):
                        record = {"address": address, "label": label}
                        added += _add_record(index, record, path, path)
            else:
                added += _add_record(index, data, path, path)
        return added

    if lower.endswith(".csv") or lower.endswith(".tsv"):
        delimiter = "\t" if lower.endswith(".tsv") else ","
        try:
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            for row in reader:
                added += _add_record(index, row, path, path)
        except Exception:
            return added
        return added

    if lower.endswith((".txt", ".md")):
        # Only parse lines that actually contain EVM addresses; this keeps README text
        # from becoming false attribution evidence.
        for line in text.splitlines():
            addresses = EVM_RE.findall(line)
            if not addresses:
                continue
            record = {"address": addresses[0], "label": line[:300]}
            added += _add_record(index, record, path, path)
    return added


def _save_index(index: dict[str, list[dict[str, Any]]], meta: dict[str, Any]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(INDEX_PATH, "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, separators=(",", ":"))
    with open(META_PATH, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, separators=(",", ":"))


def _load_cached() -> bool:
    global _INDEX, _META, _LOADED
    if not os.path.exists(INDEX_PATH):
        return False
    try:
        with open(INDEX_PATH, "r", encoding="utf-8") as handle:
            _INDEX = json.load(handle)
        if os.path.exists(META_PATH):
            with open(META_PATH, "r", encoding="utf-8") as handle:
                _META.update(json.load(handle))
        _LOADED = True
        return True
    except Exception:
        return False


def _needs_sync() -> bool:
    last_sync = _META.get("last_sync")
    if not last_sync:
        return True
    try:
        return time.time() - float(last_sync) >= SYNC_TTL
    except (TypeError, ValueError):
        return True


def sync_label_repository(force: bool = False) -> dict[str, Any]:
    """Refresh the public label index. Failure never breaks live investigation."""
    global _INDEX, _META, _LOADED
    with _LOCK:
        if _LOADED is False:
            _load_cached()
        if not force and not _needs_sync() and _LOADED:
            return dict(_META)

        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            response = requests.get(ARCHIVE_URL, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            with open(ARCHIVE_PATH, "wb") as handle:
                handle.write(response.content)

            new_index: dict[str, list[dict[str, Any]]] = {}
            files_scanned = 0
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                for info in archive.infolist():
                    if info.is_dir() or "/datasets/" not in info.filename:
                        continue
                    # Avoid parsing huge non-data files.
                    if info.file_size > MAX_FILE_BYTES:
                        continue
                    basename = info.filename.rsplit("/", 1)[-1]
                    if not basename.lower().endswith((".json", ".csv", ".tsv", ".txt", ".md")):
                        continue
                    raw = archive.read(info)
                    files_scanned += 1
                    _parse_bytes(new_index, info.filename, raw)

            _INDEX = new_index
            _LOADED = True
            _META = {
                "status": "READY",
                "repo": REPO_URL,
                "records_indexed": len(_INDEX),
                "files_scanned": files_scanned,
                "last_sync": time.time(),
                "error": None,
            }
            _save_index(_INDEX, _META)
            return dict(_META)
        except Exception as error:
            # Keep old cached intelligence if it exists. The rest of the investigation
            # continues even when GitHub is temporarily unavailable.
            _LOADED = _LOADED or _load_cached()
            _META = dict(_META)
            _META.update({"status": "STALE" if _LOADED and _INDEX else "UNAVAILABLE", "error": str(error)})
            return dict(_META)


def ensure_ready() -> dict[str, Any]:
    if not _LOADED:
        _load_cached()
    if _needs_sync():
        return sync_label_repository()
    return dict(_META)


def lookup_addresses(addresses: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Return labels for the requested EVM addresses only."""
    ensure_ready()
    results: dict[str, list[dict[str, Any]]] = {}
    for address in addresses:
        key = _norm(address)
        if not key.startswith("0x"):
            continue
        labels = _INDEX.get(key, [])
        if labels:
            results[key] = labels[:20]
    return results


def build_vasp_matches(label_matches: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Convert exchange/custodian labels into the existing VASP evidence contract."""
    matches: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for address, labels in label_matches.items():
        for label in labels:
            if label.get("category") != "exchange":
                continue
            entity = str(label.get("label") or "").strip()
            if not entity:
                continue
            key = (_norm(address), entity.lower())
            if key in seen:
                continue
            seen.add(key)
            matches.append({
                "address": address,
                "entity": entity,
                "category": "centralized_exchange",
                "aml_score": None,
                "source": "public_label_repository",
                "source_dataset": label.get("source"),
            })
    return matches


def public_intelligence_summary(label_matches: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    labels = []
    for address, entries in label_matches.items():
        for entry in entries:
            labels.append({"address": address, **entry})
    return {
        "status": _META.get("status", "UNAVAILABLE"),
        "repository": REPO_URL,
        "last_sync": _META.get("last_sync"),
        "records_indexed": _META.get("records_indexed", 0),
        "files_scanned": _META.get("files_scanned", 0),
        "matched_addresses": len(label_matches),
        "matched_labels": labels[:100],
        "error": _META.get("error"),
    }
