from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import requests
from dotenv import load_dotenv

from backend.heuristics import (
    analyze_transactions,
    calculate_live_confidence,
    detect_live_behavioral_clusters,
    detect_live_deposit_addresses,
    detect_live_hot_wallets,
    rank_live_vasp_candidates,
)

load_dotenv()

app = FastAPI(title="CryptoTrace AI")

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

# Conservative defaults keep the Render demo responsive and within API limits.
MAX_HOPS = 3
MAX_ADDRESSES = 10
PAGE_SIZE = 50
PUBLICAML_URL = "https://intelapi.publicaml.org/v1/enrich"


def get_publicaml_intelligence(addresses):
    if not addresses:
        return []

    payload = {
        "addresses": [
            {"wallet_address": address, "chain": "ETH"}
            for address in addresses
        ],
        "include": [
            "aml_score",
            "category",
            "counterparties",
            "source_of_funds",
        ],
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
    return (
        isinstance(address, str)
        and address.lower().startswith("0x")
        and len(address) == 42
    )


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

    # Etherscan returns status 0 for an empty account result.
    if (
        result == "No transactions found"
        or "no transactions found" in message.lower()
    ):
        return []

    raise RuntimeError(
        f"Etherscan API error: {message}: {result}"
    )


def get_live_transactions(wallet, chain_id="1"):
    params = {
        "chainid": chain_id,
        "module": "account",
        "action": "txlist",
        "address": wallet,
        "startblock": 0,
        "endblock": 999999999,
        "page": 1,
        "offset": PAGE_SIZE,
        "sort": "desc",
    }

    result = etherscan_request(params)
    transactions = []

    for tx in result:
        if not tx.get("to"):
            continue
        try:
            amount = int(tx.get("value", 0)) / 10**18
        except (TypeError, ValueError):
            amount = 0

        transactions.append({
            "tx_hash": tx.get("hash", ""),
            "from": tx.get("from", ""),
            "to": tx.get("to", ""),
            "amount": amount,
            "chain": "Ethereum",
            "type": "native",
            "block": tx.get("blockNumber"),
            "timestamp": tx.get("timeStamp"),
        })

    return transactions


def get_live_token_transfers(wallet, chain_id="1"):
    params = {
        "chainid": chain_id,
        "module": "account",
        "action": "tokentx",
        "address": wallet,
        "startblock": 0,
        "endblock": 999999999,
        "page": 1,
        "offset": PAGE_SIZE,
        "sort": "desc",
    }

    result = etherscan_request(params)
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
            "tx_hash": tx.get("hash", ""),
            "from": tx.get("from", ""),
            "to": tx.get("to", ""),
            "amount": raw_value / (10 ** decimals),
            "chain": "Ethereum",
            "type": "erc20",
            "token": tx.get("tokenSymbol", "ERC20"),
            "contract": tx.get("contractAddress", ""),
            "block": tx.get("blockNumber"),
            "timestamp": tx.get("timeStamp"),
        })

    return transfers


def get_live_wallet_activity(wallet, chain_id="1"):
    """Fetch both native and ERC20 activity while retaining partial results."""
    native_transactions = []
    token_transfers = []
    errors = []

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

    combined = native_transactions + token_transfers
    unique = {}
    for tx in combined:
        key = (
            tx.get("tx_hash", ""),
            str(tx.get("from", "")).lower(),
            str(tx.get("to", "")).lower(),
            tx.get("type", ""),
        )
        unique[key] = tx

    return list(unique.values()), errors


def _rank_trace_candidates(activity, wallet_key):
    """Rank outgoing EVM destinations using only evidence already observed."""
    ranked = {}
    for tx in activity:
        sender = str(tx.get("from", "")).lower()
        destination = tx.get("to")
        if sender != wallet_key or not is_evm_address(destination):
            continue
        key = destination.lower()
        entry = ranked.setdefault(key, {"address": destination, "count": 0, "volume": 0.0})
        entry["count"] += 1
        try:
            entry["volume"] += float(tx.get("amount") or 0)
        except (TypeError, ValueError):
            pass

    # Larger observed flow and repeated interaction get priority.
    return sorted(
        ranked.values(),
        key=lambda item: (item["count"], item["volume"]),
        reverse=True,
    )


def trace_wallet(start_wallet, max_hops=MAX_HOPS, max_addresses=MAX_ADDRESSES, chain_id="1"):
    """Bounded BFS trace with destination ranking and explicit partial-data metadata."""
    visited = set()
    queued = set()
    traced_transactions = []
    lookup_errors = []
    queue = [(start_wallet, 0)]

    while queue and len(visited) < max_addresses:
        wallet, hop = queue.pop(0)
        if not is_evm_address(wallet):
            continue

        wallet_key = wallet.lower()
        if wallet_key in visited or hop > max_hops:
            continue

        visited.add(wallet_key)
        activity, errors = get_live_wallet_activity(wallet, chain_id)
        for error in errors:
            lookup_errors.append({"wallet": wallet, "error": error})

        print(f"[TRACE] {wallet} -> {len(activity)} transactions")
        traced_transactions.extend(activity)

        if hop >= max_hops:
            continue

        for candidate in _rank_trace_candidates(activity, wallet_key)[:3]:
            destination = candidate["address"]
            destination_key = destination.lower()
            if (
                destination_key not in visited
                and destination_key not in queued
                and len(visited) + len(queue) < max_addresses
            ):
                queued.add(destination_key)
                queue.append((destination, hop + 1))

    unique_transactions = {}
    for tx in traced_transactions:
        key = (
            tx.get("tx_hash", ""),
            str(tx.get("from", "")).lower(),
            str(tx.get("to", "")).lower(),
            tx.get("type", ""),
        )
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
        outgoing = [
            tx for tx in transactions
            if tx["from"].lower() == wallet.lower()
        ]

        for tx in outgoing:
            traced_transactions.append(tx)
            destination = tx["to"]
            if destination.lower() not in visited:
                queue.append((destination, hop + 1))

    return traced_transactions, visited


@app.get("/")
def home():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


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

    # -------------------- LIVE PATH --------------------
    if not is_evm_address(wallet):
        return {
            "wallet": wallet,
            "source": "INVALID WALLET ADDRESS",
            "trace_status": "ERROR",
            "transactions": [],
            "transaction_count": 0,
            "address_count": 0,
            "cluster_count": 0,
            "intelligence": {
                "candidate_vasp": "INCONCLUSIVE",
                "confidence": 0,
                "findings": [{
                    "name": "Invalid Ethereum wallet address",
                    "status": "warning",
                    "points": 0,
                }],
                "deposit_candidates": [],
                "hot_wallets": [],
                "cluster_size": 0,
                "mixer_detected": False,
                "bridge_detected": False,
            },
        }

    try:
        transactions, addresses, trace_errors = trace_wallet(
            wallet,
            max_hops=MAX_HOPS,
            max_addresses=MAX_ADDRESSES,
            chain_id="1",
        )

        # Live behavior analysis is completely separate from demo registry data.
        live_clusters = detect_live_behavioral_clusters(transactions, wallet)
        live_deposits = detect_live_deposit_addresses(transactions, wallet)
        live_hot_wallets = detect_live_hot_wallets(transactions, live_deposits)

        intelligence_results = []
        intelligence_error = None
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
            aml_score = entity.get("aml_score", 0)

            if not label or not address:
                continue

            if category in ["cex", "exchange", "centralized_exchange", "custodian"]:
                external_vasp_matches.append({
                    "address": address,
                    "entity": label,
                    "category": category,
                    "aml_score": aml_score,
                })

        ranked_vasp_candidates = rank_live_vasp_candidates(
            addresses,
            external_vasp_matches,
            live_deposits,
            live_hot_wallets,
        )

        # No demo VASP registry is used for live attribution.
        intelligence = analyze_transactions(transactions, [])
        intelligence["candidate_vasp"] = "INCONCLUSIVE"
        intelligence["candidate_type"] = "unknown"
        intelligence["matched_addresses"] = []
        intelligence["deposit_candidates"] = [
            item["address"] for item in live_deposits["candidates"]
        ]
        intelligence["hot_wallets"] = [
            item["address"] for item in live_hot_wallets["candidates"]
        ]
        intelligence["cluster_size"] = sum(
            cluster["size"] for cluster in live_clusters["clusters"]
        )

        # Replace demo-oriented live findings with observations from the live graph.
        live_findings = []
        if transactions:
            live_findings.append({
                "name": "Live transaction activity observed",
                "status": "positive",
                "points": 0,
            })
        if live_clusters["count"]:
            live_findings.append({
                "name": f"{live_clusters['count']} behavioral cluster(s) detected",
                "status": "positive",
                "points": 0,
            })
        if live_deposits["count"]:
            live_findings.append({
                "name": f"{live_deposits['count']} deposit-like address(es) detected",
                "status": "positive",
                "points": 0,
            })
        if live_hot_wallets["count"]:
            live_findings.append({
                "name": f"{live_hot_wallets['count']} consolidation wallet candidate(s) detected",
                "status": "positive",
                "points": 0,
            })
        if trace_errors:
            live_findings.append({
                "name": "Some downstream wallet lookups were unavailable; result is partial",
                "status": "warning",
                "points": 0,
            })
        if intelligence_results:
            live_findings.append({
                "name": "External address intelligence returned supporting data",
                "status": "positive",
                "points": 0,
            })
        intelligence["findings"] = live_findings

        if ranked_vasp_candidates:
            best = ranked_vasp_candidates[0]
            # Require the labelled address to actually be in the observed graph.
            if best["address"] in {str(a).lower() for a in addresses}:
                intelligence["candidate_vasp"] = best["vasp"]
                intelligence["candidate_type"] = best["category"]
                intelligence["matched_addresses"] = [best["address"]]
                intelligence["external_vasp"] = best["vasp"]
                intelligence["external_vasp_address"] = best["address"]
                intelligence["external_vasp_category"] = best["category"]
                intelligence["external_aml_score"] = best["aml_score"]
                intelligence["findings"].append({
                    "name": "External VASP/service label matched traced infrastructure",
                    "status": "positive",
                    "points": 0,
                })

        live_confidence = calculate_live_confidence(
            transactions=transactions,
            addresses=addresses,
            external_vasp_matches=external_vasp_matches,
            intelligence=intelligence,
            behavioral_clusters=live_clusters,
            deposit_analysis=live_deposits,
            hot_analysis=live_hot_wallets,
        )

        intelligence["confidence"] = live_confidence["confidence"]
        intelligence["evidence_breakdown"] = live_confidence["evidence_breakdown"]
        intelligence["score_explanation"] = live_confidence["score_explanation"]
        intelligence["risk_penalty"] = live_confidence["risk_penalty"]

        if intelligence_error:
            intelligence["findings"].append({
                "name": "External intelligence unavailable; blockchain evidence retained",
                "status": "warning",
                "points": 0,
            })

        trace_status = "COMPLETE" if not trace_errors else "PARTIAL"

        return {
            "wallet": wallet,
            "source": "LIVE BLOCKCHAIN + PUBLIC INTELLIGENCE",
            "trace_status": trace_status,
            "trace_errors": trace_errors,
            "external_intelligence": intelligence_results,
            "behavioral_clusters": live_clusters,
            "deposit_analysis": live_deposits,
            "hot_wallet_analysis": live_hot_wallets,
            "vasp_candidates": ranked_vasp_candidates,
            "transactions": transactions,
            "transaction_count": len(transactions),
            "address_count": len(addresses),
            "cluster_count": live_clusters["count"],
            "intelligence": intelligence,
        }

    except Exception as error:
        print(f"[INVESTIGATION ERROR] {error}")
        return {
            "wallet": wallet,
            "source": "LIVE BLOCKCHAIN ERROR",
            "trace_status": "ERROR",
            "transactions": [],
            "transaction_count": 0,
            "address_count": 0,
            "cluster_count": 0,
            "intelligence": {
                "candidate_vasp": "INCONCLUSIVE",
                "confidence": 0,
                "findings": [{
                    "name": "Live blockchain lookup failed",
                    "status": "warning",
                    "points": 0,
                }],
                "deposit_candidates": [],
                "hot_wallets": [],
                "cluster_size": 0,
                "mixer_detected": False,
                "bridge_detected": False,
                "error": str(error),
            },
        }


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
