from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import heapq
import json
import os
import time
import requests
from dotenv import load_dotenv

from backend.heuristics import (
    analyze_transactions,
    build_evidence_report,
    calculate_live_confidence,
    classify_live_addresses,
    detect_live_behavioral_clusters,
    detect_live_deposit_addresses,
    detect_live_hot_wallets,
    detect_trail_breaks,
    rank_live_vasp_candidates,
    evaluation_summary,
)

load_dotenv()

app = FastAPI(title="CryptoTrace AI", version="2.0-investigator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY")
ETHERSCAN_URL = "https://api.etherscan.io/v2/api"
MAX_HOPS = 3
MAX_ADDRESSES = 10
PAGE_SIZE = 50
PUBLICAML_URL = "https://intelapi.publicaml.org/v1/enrich"
CACHE_TTL = 120
_ACTIVITY_CACHE = {}


def _cache_get(key):
    item = _ACTIVITY_CACHE.get(key)
    if not item:
        return None
    if time.time() - item["time"] > CACHE_TTL:
        _ACTIVITY_CACHE.pop(key, None)
        return None
    return item["value"]


def _cache_put(key, value):
    _ACTIVITY_CACHE[key] = {"time": time.time(), "value": value}


def get_publicaml_intelligence(addresses):
    if not addresses:
        return []
    payload = {
        "addresses": [{"wallet_address": address, "chain": "ETH"} for address in addresses],
        "include": ["aml_score", "category", "counterparties", "source_of_funds"],
        "top_n": 5,
    }
    response = requests.post(PUBLICAML_URL, json=payload, timeout=10)
    response.raise_for_status()
    data = response.json()
    return data.get("entities", [])


def load_json(filename):
    path = os.path.join(BASE_DIR, "data", filename)
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def is_evm_address(address):
    return isinstance(address, str) and address.lower().startswith("0x") and len(address) == 42


def etherscan_request(params):
    if not ETHERSCAN_API_KEY:
        raise RuntimeError("ETHERSCAN_API_KEY is not configured")
    request_params = dict(params)
    request_params["apikey"] = ETHERSCAN_API_KEY
    response = requests.get(ETHERSCAN_URL, params=request_params, timeout=15)
    response.raise_for_status()
    data = response.json()
    result = data.get("result", "")
    message = str(data.get("message", ""))
    if data.get("status") == "1":
        return result if isinstance(result, list) else []
    if result == "No transactions found" or "no transactions found" in message.lower():
        return []
    raise RuntimeError(f"Etherscan API error: {message}: {result}")


def get_live_transactions(wallet, chain_id="1"):
    result = etherscan_request({
        "chainid": chain_id, "module": "account", "action": "txlist", "address": wallet,
        "startblock": 0, "endblock": 999999999, "page": 1, "offset": PAGE_SIZE, "sort": "desc",
    })
    transactions = []
    for tx in result:
        if not tx.get("to"):
            continue
        try:
            amount = int(tx.get("value", 0)) / 10**18
        except (TypeError, ValueError):
            amount = 0
        transactions.append({
            "tx_hash": tx.get("hash", ""), "from": tx.get("from", ""), "to": tx.get("to", ""),
            "amount": amount, "chain": "Ethereum", "type": "native",
            "block": tx.get("blockNumber"), "timestamp": tx.get("timeStamp"),
        })
    return transactions


def get_live_token_transfers(wallet, chain_id="1"):
    result = etherscan_request({
        "chainid": chain_id, "module": "account", "action": "tokentx", "address": wallet,
        "startblock": 0, "endblock": 999999999, "page": 1, "offset": PAGE_SIZE, "sort": "desc",
    })
    transfers = []
    for tx in result:
        if not tx.get("to"):
            continue
        try:
            decimals = int(tx.get("tokenDecimal", 18))
        except (TypeError, ValueError):
            decimals = 18
        try:
            raw_value = int(tx.get("value", 0))
        except (TypeError, ValueError):
            raw_value = 0
        transfers.append({
            "tx_hash": tx.get("hash", ""), "from": tx.get("from", ""), "to": tx.get("to", ""),
            "amount": raw_value / (10 ** decimals), "chain": "Ethereum", "type": "erc20",
            "token": tx.get("tokenSymbol", "ERC20"), "contract": tx.get("contractAddress", ""),
            "block": tx.get("blockNumber"), "timestamp": tx.get("timeStamp"),
        })
    return transfers


def get_live_wallet_activity(wallet, chain_id="1"):
    """Fetch native + ERC20 activity with a short TTL cache and partial-failure tolerance."""
    cache_key = f"activity:{chain_id}:{wallet.lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    native_transactions, token_transfers, errors = [], [], []
    try:
        native_transactions = get_live_transactions(wallet, chain_id)
    except Exception as error:
        errors.append(f"Native transactions: {error}")
        print(f"[LIVE] Native lookup failed for {wallet}: {error}")
    try:
        token_transfers = get_live_token_transfers(wallet, chain_id)
    except Exception as error:
        errors.append(f"ERC20 transfers: {error}")
        print(f"[LIVE] ERC20 lookup failed for {wallet}: {error}")

    unique = {}
    for tx in native_transactions + token_transfers:
        key = (tx.get("tx_hash", ""), str(tx.get("from", "")).lower(), str(tx.get("to", "")).lower(), tx.get("type", ""))
        unique[key] = tx
    result = (list(unique.values()), errors)
    _cache_put(cache_key, result)
    return result


def get_live_internal_transactions(wallet, chain_id="1"):
    """Optional internal-transfer lookup, used for the root wallet to expose contract/native flows."""
    result = etherscan_request({
        "chainid": chain_id, "module": "account", "action": "txlistinternal", "address": wallet,
        "startblock": 0, "endblock": 999999999, "page": 1, "offset": PAGE_SIZE, "sort": "desc",
    })
    transfers = []
    for tx in result:
        if not tx.get("to"):
            continue
        try:
            amount = int(tx.get("value", 0)) / 10**18
        except (TypeError, ValueError):
            amount = 0
        transfers.append({
            "tx_hash": tx.get("hash", ""), "from": tx.get("from", ""), "to": tx.get("to", ""),
            "amount": amount, "chain": "Ethereum", "type": "internal",
            "block": tx.get("blockNumber"), "timestamp": tx.get("timeStamp"),
        })
    return transfers


def _rank_trace_candidates(activity, wallet_key):
    """Prioritize investigative destinations by repetition, value and transfer recency."""
    ranked = {}
    now = int(time.time())
    for tx in activity:
        if str(tx.get("from", "")).lower() != wallet_key:
            continue
        destination = tx.get("to")
        if not is_evm_address(destination):
            continue
        key = destination.lower()
        entry = ranked.setdefault(key, {"address": destination, "count": 0, "volume": 0.0, "recent": 0})
        entry["count"] += 1
        try:
            entry["volume"] += float(tx.get("amount") or 0)
        except (TypeError, ValueError):
            pass
        try:
            ts = int(tx.get("timestamp"))
            entry["recent"] = max(entry["recent"], max(0, 1_000_000_000 - (now - ts)))
        except (TypeError, ValueError):
            pass
    for entry in ranked.values():
        entry["priority"] = round((min(entry["count"], 5) * 0.45) + (min(entry["volume"], 1000) / 1000 * 0.35) + (min(entry["recent"], 1_000_000_000) / 1_000_000_000 * 0.20), 6)
    return sorted(ranked.values(), key=lambda item: (item["priority"], item["count"], item["volume"]), reverse=True)


def trace_wallet(start_wallet, max_hops=MAX_HOPS, max_addresses=MAX_ADDRESSES, chain_id="1"):
    """Bounded best-first graph walk; keeps the trace explainable and Render-safe."""
    visited = set()
    queued = set()
    traced_transactions = []
    lookup_errors = []
    queue = []
    sequence = 0
    heapq.heappush(queue, (-1.0, sequence, start_wallet, 0))
    queued.add(start_wallet.lower())

    while queue and len(visited) < max_addresses:
        _, _, wallet, hop = heapq.heappop(queue)
        wallet_key = wallet.lower()
        queued.discard(wallet_key)
        if wallet_key in visited or hop > max_hops or not is_evm_address(wallet):
            continue
        visited.add(wallet_key)
        activity, errors = get_live_wallet_activity(wallet, chain_id)
        lookup_errors.extend({"wallet": wallet, "error": error} for error in errors)
        print(f"[TRACE] hop={hop} {wallet} -> {len(activity)} transactions")
        traced_transactions.extend(activity)

        if hop == 0:
            try:
                internal = get_live_internal_transactions(wallet, chain_id)
                traced_transactions.extend(internal)
            except Exception as error:
                lookup_errors.append({"wallet": wallet, "error": f"Internal transactions: {error}"})

        if hop >= max_hops:
            continue
        for candidate in _rank_trace_candidates(activity, wallet_key)[:4]:
            destination = candidate["address"]
            destination_key = destination.lower()
            if destination_key in visited or destination_key in queued:
                continue
            if len(visited) + len(queue) >= max_addresses:
                break
            sequence += 1
            heapq.heappush(queue, (-candidate["priority"], sequence, destination, hop + 1))
            queued.add(destination_key)

    unique_transactions = {}
    for tx in traced_transactions:
        key = (tx.get("tx_hash", ""), str(tx.get("from", "")).lower(), str(tx.get("to", "")).lower(), tx.get("type", ""))
        unique_transactions[key] = tx
    return list(unique_transactions.values()), visited, lookup_errors


# -------------------- DEMO PATH: DO NOT CHANGE --------------------
def trace_demo_wallet(start_wallet, transactions, max_hops=6):
    visited = set()
    traced_transactions = []
    queue = [(start_wallet, 0)]
    while queue:
        wallet, hop = queue.pop(0)
        wallet_key = wallet.lower()
        if wallet_key in visited:
            continue
        if hop > max_hops:
            continue
        visited.add(wallet_key)
        outgoing = [tx for tx in transactions if tx["from"].lower() == wallet.lower()]
        for tx in outgoing:
            traced_transactions.append(tx)
            destination = tx["to"]
            if destination.lower() not in visited:
                queue.append((destination, hop + 1))
    return traced_transactions, visited


@app.get("/")
def home():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/health")
def health():
    return {"status": "ok", "service": "CryptoTrace AI", "version": app.version, "etherscan_configured": bool(ETHERSCAN_API_KEY), "cache_entries": len(_ACTIVITY_CACHE)}


@app.get("/evaluation")
def evaluation():
    """Expose an honest evaluation harness status; no metrics are fabricated."""
    path = os.path.join(BASE_DIR, "data", "evaluation_cases.json")
    cases = load_json("evaluation_cases.json") if os.path.exists(path) else []
    return evaluation_summary(cases)


@app.get("/investigate/{wallet}")
def investigate(wallet: str):
    # -------------------- DEMO PATH: EXACTLY PRESERVED --------------------
    if wallet.upper() in ["0XABC", "0XMIXABC"]:
        transactions = load_json("transactions.json")
        vasp_data = load_json("vasp_data.json")
        traced_transactions, addresses = trace_demo_wallet(wallet, transactions)
        intelligence = analyze_transactions(traced_transactions, vasp_data)
        return {
            "wallet": wallet,
            "source": "DEMO DATA",
            "transactions": traced_transactions,
            "transaction_count": len(traced_transactions),
            "address_count": len(addresses),
            "cluster_count": 1 if intelligence["cluster_size"] else 0,
            "intelligence": intelligence,
        }

    if not is_evm_address(wallet):
        return {
            "wallet": wallet, "source": "INVALID WALLET ADDRESS", "trace_status": "ERROR",
            "transactions": [], "transaction_count": 0, "address_count": 0, "cluster_count": 0,
            "intelligence": {"candidate_vasp": "INCONCLUSIVE", "confidence": 0, "findings": [{"name": "Invalid Ethereum wallet address", "status": "warning", "points": 0}], "deposit_candidates": [], "hot_wallets": [], "cluster_size": 0, "mixer_detected": False, "bridge_detected": False},
        }

    try:
        started = time.perf_counter()
        transactions, addresses, trace_errors = trace_wallet(wallet)
        live_clusters = detect_live_behavioral_clusters(transactions, wallet)
        live_deposits = detect_live_deposit_addresses(transactions, wallet)
        live_hot_wallets = detect_live_hot_wallets(transactions, live_deposits)
        trail_breaks = detect_trail_breaks(transactions)

        intelligence_results, intelligence_error = [], None
        try:
            intelligence_results = get_publicaml_intelligence(list(addresses))
        except Exception as error:
            intelligence_error = str(error)
            print(f"[LIVE] PublicAML lookup failed: {error}")

        external_vasp_matches = []
        for entity in intelligence_results:
            label = entity.get("label")
            category = entity.get("category")
            address = entity.get("wallet_address")
            if not label or not address:
                continue
            category_norm = str(category or "").lower()
            if category_norm in ["cex", "exchange", "centralized_exchange", "custodian"]:
                external_vasp_matches.append({"address": address, "entity": label, "category": category, "aml_score": entity.get("aml_score", 0)})
            if "mixer" in category_norm:
                trail_breaks.append({"type": "mixer", "address": address, "severity": "high", "reason": "external intelligence classifies an observed address as mixer-like"})
            if "bridge" in category_norm:
                trail_breaks.append({"type": "bridge", "address": address, "severity": "medium", "reason": "external intelligence classifies an observed address as bridge-like"})

        ranked_vasp_candidates = rank_live_vasp_candidates(addresses, external_vasp_matches, live_deposits, live_hot_wallets, transactions)
        intelligence = analyze_transactions(transactions, [])
        intelligence["candidate_vasp"] = ranked_vasp_candidates[0]["vasp"] if ranked_vasp_candidates else "INCONCLUSIVE"
        intelligence["candidate_type"] = ranked_vasp_candidates[0].get("category", "unknown") if ranked_vasp_candidates else "unknown"
        intelligence["matched_addresses"] = ranked_vasp_candidates[0].get("addresses", []) if ranked_vasp_candidates else []
        intelligence["deposit_candidates"] = [x["address"] for x in live_deposits["candidates"]]
        intelligence["hot_wallets"] = [x["address"] for x in live_hot_wallets["candidates"]]
        intelligence["cluster_size"] = sum(x["size"] for x in live_clusters["clusters"])
        intelligence["mixer_detected"] = any(x.get("type") == "mixer" for x in trail_breaks)
        intelligence["bridge_detected"] = any(x.get("type") == "bridge" for x in trail_breaks)

        live_findings = []
        if transactions:
            live_findings.append({"name": f"{len(transactions)} live transaction edge(s) observed", "status": "positive", "points": 0})
        if live_clusters["count"]:
            live_findings.append({"name": f"{live_clusters['count']} behavioral cluster(s) detected from relationship signals", "status": "positive", "points": 0})
        if live_deposits["count"]:
            live_findings.append({"name": f"{live_deposits['count']} deposit-like address(es) detected", "status": "positive", "points": 0})
        if live_hot_wallets["count"]:
            live_findings.append({"name": f"{live_hot_wallets['count']} hot-wallet candidate(s) detected from consolidation behavior", "status": "positive", "points": 0})
        if ranked_vasp_candidates:
            live_findings.append({"name": f"Top VASP candidate supported by {len(ranked_vasp_candidates[0]['evidence'])} evidence item(s)", "status": "positive", "points": 0})
        for trail in trail_breaks[:5]:
            live_findings.append({"name": trail.get("reason", f"{trail.get('type', 'trail').title()} trail break detected"), "status": "warning", "points": 0})
        if trace_errors:
            live_findings.append({"name": f"{len(trace_errors)} downstream lookup(s) were incomplete", "status": "warning", "points": 0})
        if intelligence_error:
            live_findings.append({"name": "External intelligence unavailable; blockchain evidence retained", "status": "warning", "points": 0})
        intelligence["findings"] = live_findings

        live_confidence = calculate_live_confidence(
            transactions, addresses, external_vasp_matches, intelligence,
            behavioral_clusters=live_clusters, deposit_analysis=live_deposits,
            hot_analysis=live_hot_wallets, vasp_candidates=ranked_vasp_candidates,
            trace_errors=trace_errors,
        )
        intelligence.update(live_confidence)

        node_classification = classify_live_addresses(transactions, wallet, live_deposits, live_hot_wallets, ranked_vasp_candidates)
        evidence_report = build_evidence_report(
            transactions, wallet, intelligence, live_clusters, live_deposits,
            live_hot_wallets, ranked_vasp_candidates, trace_errors, intelligence_results,
        )
        evidence_report["trail_breaks"] = trail_breaks
        evidence_report["node_classification"] = node_classification
        evidence_report["performance"] = {"investigation_seconds": round(time.perf_counter() - started, 3), "cache_ttl_seconds": CACHE_TTL}

        return {
            "wallet": wallet,
            "source": "LIVE BLOCKCHAIN + PUBLIC INTELLIGENCE",
            "trace_status": "COMPLETE" if not trace_errors else "PARTIAL",
            "trace_errors": trace_errors,
            "external_intelligence": intelligence_results,
            "behavioral_clusters": live_clusters,
            "deposit_analysis": live_deposits,
            "hot_wallet_analysis": live_hot_wallets,
            "vasp_candidates": ranked_vasp_candidates,
            "trail_breaks": trail_breaks,
            "node_classification": node_classification,
            "investigation_report": evidence_report,
            "transactions": transactions,
            "transaction_count": len(transactions),
            "address_count": len(addresses),
            "cluster_count": live_clusters["count"],
            "intelligence": intelligence,
        }
    except Exception as error:
        print(f"[INVESTIGATION ERROR] {error}")
        return {
            "wallet": wallet, "source": "LIVE BLOCKCHAIN ERROR", "trace_status": "ERROR",
            "transactions": [], "transaction_count": 0, "address_count": 0, "cluster_count": 0,
            "intelligence": {"candidate_vasp": "INCONCLUSIVE", "confidence": 0, "findings": [{"name": "Live blockchain lookup failed", "status": "warning", "points": 0}], "deposit_candidates": [], "hot_wallets": [], "cluster_size": 0, "mixer_detected": False, "bridge_detected": False, "error": str(error)},
        }


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
