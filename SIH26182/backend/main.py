from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import requests
from dotenv import load_dotenv

from backend.heuristics import (analyze_transactions,calculate_live_confidence,detect_live_behavioral_clusters)

load_dotenv()

app = FastAPI(title="CryptoTrace AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

ETHERSCAN_API_KEY = os.getenv(
    "ETHERSCAN_API_KEY"
)

ETHERSCAN_URL = "https://api.etherscan.io/v2/api"

MAX_HOPS = 2
MAX_ADDRESSES = 8
PAGE_SIZE = 50

PUBLICAML_URL = "https://intelapi.publicaml.org/v1/enrich"

def get_publicaml_intelligence(addresses):
    if not addresses:
        return []

    payload = {
        "addresses": [
            {
                "wallet_address": address,
                "chain": "ETH"
            }
            for address in addresses
        ],
        "include": [
            "aml_score",
            "category",
            "counterparties",
            "source_of_funds"
        ],
        "top_n": 5
    }

    response = requests.post(
        PUBLICAML_URL,
        json=payload,
        timeout=10
    )

    response.raise_for_status()

    data = response.json()

    return data.get(
        "entities",
        []
    )


def load_json(filename):
    path = os.path.join(BASE_DIR, "data", filename)

    with open(path, "r") as file:
        return json.load(file)


def is_evm_address(address):
    return (
        isinstance(address, str)
        and address.startswith("0x")
        and len(address) == 42
    )


def etherscan_request(params):
    if not ETHERSCAN_API_KEY:
        raise Exception(
            "ETHERSCAN_API_KEY is not configured"
        )

    params["apikey"] = ETHERSCAN_API_KEY

    response = requests.get(
        ETHERSCAN_URL,
        params=params,
        timeout=15
    )

    response.raise_for_status()

    data = response.json()

    if data.get("status") == "1":
        return data.get("result", [])

    message = str(
        data.get("message", "")
    ).lower()

    result = data.get(
        "result",
        ""
    )

    # Etherscan uses status 0 for an
    # empty transaction result.
    if (
        "no transactions found"
        in message
        or
        result == "No transactions found"
    ):
        return []

    raise Exception(
        f"Etherscan API error: "
        f"{data.get('message', '')}: "
        f"{result}"
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
        "offset": 50,
        "sort": "desc"
    }

    result = etherscan_request(params)

    transactions = []

    if not isinstance(result, list):
        return transactions

    for tx in result:

        if not tx.get("to"):
            continue

        transactions.append({
            "tx_hash": tx["hash"],
            "from": tx["from"],
            "to": tx["to"],
            "amount": int(tx["value"]) / 10**18,
            "chain": "Ethereum",
            "type": "native",
            "block": tx["blockNumber"],
            "timestamp": tx["timeStamp"]
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
        "offset": 50,
        "sort": "desc"
    }

    result = etherscan_request(params)

    transfers = []

    if not isinstance(result, list):
        return transfers

    for tx in result:

        if not tx.get("to"):
            continue

        decimals = int(
            tx.get("tokenDecimal", 18)
        )

        raw_value = int(
            tx.get("value", 0)
        )

        amount = raw_value / (10 ** decimals)

        transfers.append({
            "tx_hash": tx["hash"],
            "from": tx["from"],
            "to": tx["to"],
            "amount": amount,
            "chain": "Ethereum",
            "type": "erc20",
            "token": tx.get(
                "tokenSymbol",
                "ERC20"
            ),
            "contract": tx.get(
                "contractAddress",
                ""
            ),
            "block": tx.get(
                "blockNumber"
            ),
            "timestamp": tx.get(
                "timeStamp"
            )
        })

    return transfers


def get_live_wallet_activity(
    wallet,
    chain_id="1"
):
    native_transactions = []
    token_transfers = []

    try:
        native_transactions = (
            get_live_transactions(
                wallet,
                chain_id
            )
        )
    except Exception as error:
        print(
            f"Native transaction lookup failed "
            f"for {wallet}: {error}"
        )

    try:
        token_transfers = (
            get_live_token_transfers(
                wallet,
                chain_id
            )
        )
    except Exception as error:
        print(
            f"ERC20 lookup failed "
            f"for {wallet}: {error}"
        )

    combined = (
        native_transactions +
        token_transfers
    )

    unique = {}

    for tx in combined:

        key = (
            tx["tx_hash"],
            tx["from"].lower(),
            tx["to"].lower(),
            tx.get("type", "")
        )

        unique[key] = tx

    return list(
        unique.values()
    )


def trace_wallet(
    start_wallet,
    max_hops=MAX_HOPS,
    max_addresses=MAX_ADDRESSES,
    chain_id="1"
):
    visited = set()
    queued = set()
    traced_transactions = []

    queue = [(start_wallet, 0)]

    while queue and len(visited) < max_addresses:

        wallet, hop = queue.pop(0)

        if not is_evm_address(wallet):
            continue

        wallet_key = wallet.lower()

        if wallet_key in visited:
            continue

        if hop > max_hops:
            continue

        visited.add(wallet_key)

        try:
            activity = get_live_wallet_activity(
            wallet,
            chain_id
            )

            print(
                f"[TRACE] {wallet} -> "
                f"{len(activity)} transactions"
            )

        except Exception as error:

            print(
                f"[TRACE ERROR] {wallet}: "
                f"{error}"
            )

            continue

        for tx in activity:
            traced_transactions.append(tx)

        # Only follow addresses that received funds
        # from the current wallet.
        candidates = []

        for tx in activity:

            if (
                tx["from"].lower()
                == wallet_key
                and
                is_evm_address(tx["to"])
            ):
                candidates.append(tx["to"])

        # Remove duplicates
        candidates = list(
            dict.fromkeys(
                candidates
            )
        )

        # Follow only a small number of destinations
        for destination in candidates[:3]:

            destination_key = (
                destination.lower()
            )

            if (
                destination_key
                not in visited
                and
                destination_key
                not in queued
                and
                len(visited)
                + len(queue)
                < max_addresses
            ):
                queued.add(
                    destination_key
                )

                queue.append(
                    (
                        destination,
                        hop + 1
                    )
                )

    # Remove duplicate transactions
    unique_transactions = {}

    for tx in traced_transactions:

        key = (
            tx["tx_hash"],
            tx["from"].lower(),
            tx["to"].lower(),
            tx.get("type", "")
        )

        unique_transactions[key] = tx

    return (
        list(
            unique_transactions.values()
        ),
        visited
    )


def trace_demo_wallet(
    start_wallet,
    transactions,
    max_hops=6
):
    visited = set()
    traced_transactions = []

    queue = [
        (start_wallet, 0)
    ]

    while queue:

        wallet, hop = queue.pop(0)

        wallet_key = wallet.lower()

        if wallet_key in visited:
            continue

        if hop > max_hops:
            continue

        visited.add(wallet_key)

        outgoing = [
            tx
            for tx in transactions
            if tx["from"].lower()
            == wallet.lower()
        ]

        for tx in outgoing:

            traced_transactions.append(
                tx
            )

            destination = tx["to"]

            if (
                destination.lower()
                not in visited
            ):
                queue.append(
                    (
                        destination,
                        hop + 1
                    )
                )

    return (
        traced_transactions,
        visited
    )


@app.get("/")
def home():
    return FileResponse(
        os.path.join(FRONTEND_DIR, "index.html")
    )


@app.get("/investigate/{wallet}")
def investigate(wallet: str):

    if wallet.upper() in [
        "0XABC",
        "0XMIXABC"
    ]:

        transactions = load_json(
            "transactions.json"
        )

        vasp_data = load_json(
            "vasp_data.json"
        )

        traced_transactions, addresses = (
            trace_demo_wallet(
                wallet,
                transactions
            )
        )

        intelligence = (
            analyze_transactions(
                traced_transactions,
                vasp_data
            )
        )

        return {
            "wallet": wallet,
            "source": "DEMO DATA",
            "transactions":
                traced_transactions,
            "transaction_count":
                len(traced_transactions),
            "address_count":
                len(addresses),
            "cluster_count":
                (
                    1
                    if intelligence[
                        "cluster_size"
                    ]
                    else 0
                ),
            "intelligence":
                intelligence
        }

    try:

        transactions, addresses = (
            trace_wallet(
                wallet,
                max_hops=MAX_HOPS,
                max_addresses=MAX_ADDRESSES,
                chain_id="1"
            )
        )

        live_clusters = detect_live_behavioral_clusters(
            transactions,
            wallet
        )

        intelligence_results = []

        try:
            intelligence_results = (
                get_publicaml_intelligence(
                    list(addresses)
                )
            )
        except Exception as error:
            intelligence_results = []

        external_vasp_matches = []

        for entity in intelligence_results:

            label = entity.get(
                "label"
            )

            category = entity.get(
                "category"
            )

            address = entity.get(
                "wallet_address"
            )

            aml_score = entity.get(
                "aml_score",
                0
            )

            if not label:
                continue

            if category in [
            "cex",
            "exchange",
            "centralized_exchange",
            "custodian"
            ]:
                external_vasp_matches.append({
                    "address": address,
                    "entity": label,
                    "category": category,
                    "aml_score": aml_score
                })        

        intelligence = (
            analyze_transactions(
                transactions,
                []
            )
        )

        intelligence[
            "behavioral_clusters"
        ] = live_clusters

        intelligence[
            "cluster_size"
        ] = sum(
            cluster["size"]
            for cluster
            in live_clusters
        )        

        if external_vasp_matches:

            best_match = max(
                external_vasp_matches,
                key=lambda x:
                    x.get(
                        "aml_score",
                        0
                    )
            )

            intelligence[
                "external_vasp"
            ] = best_match[
                "entity"
            ]

            intelligence[
                "external_vasp_address"
            ] = best_match[
                "address"
            ]

            intelligence[
                "external_vasp_category"
            ] = best_match[
                "category"
            ]

            intelligence[
                "external_aml_score"
            ] = best_match[
                "aml_score"
            ]

            intelligence[
                "candidate_vasp"
            ] = best_match[
                "entity"
            ]

            intelligence[
                "findings"
            ].append({
                "name":
                    "External VASP/service label matched",
                "status":
                    "positive",
                "points":
                    0
            })

            live_confidence = calculate_live_confidence(

                transactions=transactions,
                addresses=addresses,
                external_vasp_matches=external_vasp_matches,
                intelligence=intelligence
            )

            intelligence[
                "confidence"
            ] = live_confidence[
                "confidence"
            ]

            intelligence[
                "evidence_breakdown"
            ] = live_confidence[
                "evidence_breakdown"
            ]

            intelligence[
                "score_explanation"
            ] = live_confidence[
                "score_explanation"
            ]

           

        return {
            "wallet": wallet,
            "source":
                "LIVE BLOCKCHAIN + PUBLIC INTELLIGENCE",
                "external_intelligence": intelligence_results,
            "transactions":
                transactions,
            "transaction_count":
                len(transactions),
            "address_count":
                len(addresses),
            "cluster_count":
                (
                    1
                    if intelligence[
                        "cluster_size"
                    ]
                    else 0
                ),
            "intelligence":
                intelligence
        }

    except Exception as error:

        print(
            f"[INVESTIGATION ERROR] {error}"
        )

        return {
            "wallet": wallet,
            "source":
                "LIVE BLOCKCHAIN ERROR",
            "transactions": [],
            "transaction_count": 0,
            "address_count": 0,
            "cluster_count": 0,
            "intelligence": {
                "candidate_vasp":
                    "INCONCLUSIVE",
                "confidence": 0,
                "findings": [
                    {
                        "name":
                            "Live blockchain lookup failed",
                        "status":
                            "warning",
                        "points": 0
                    }
                ],
                "deposit_candidates": [],
                "hot_wallets": [],
                "cluster_size": 0,
                "mixer_detected": False,
                "bridge_detected": False,
                "error": str(error)
            }
        }

# Serve the existing frontend from the same FastAPI service.
# API routes above remain available under /api-style paths (here /investigate).
app.mount(
    "/",
    StaticFiles(directory=FRONTEND_DIR),
    name="frontend"
)
