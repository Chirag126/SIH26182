def analyze_transactions(transactions, vasp_data):

    findings = []
    score = 0

    deposit_candidates = []
    hot_wallets = []

    incoming = {}
    outgoing = {}

    mixer_detected = False
    bridge_detected = False

    for tx in transactions:

        sender = tx["from"]
        receiver = tx["to"]

        outgoing.setdefault(sender, []).append(tx)
        incoming.setdefault(receiver, []).append(tx)

    # Transaction path
    if len(transactions) > 1:
        findings.append({"name": "Transaction path traced", "status": "positive", "points": 15})
        score += 15

    # Behavioral cluster -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    cluster_addresses = []
    for address, txs in outgoing.items():
        if len(txs) >= 2:
            cluster_addresses.append(address)

    if cluster_addresses:
        findings.append({"name": "Behavioral address cluster detected", "status": "positive", "points": 20})
        score += 20

    # Deposit candidates -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    for address, txs in incoming.items():
        if len(txs) >= 2:
            deposit_candidates.append(address)
        elif address.upper().startswith("0XDEP"):
            deposit_candidates.append(address)

    if deposit_candidates:
        findings.append({"name": "Candidate deposit address detected", "status": "positive", "points": 20})
        score += 20

    # Deposit -> hot wallet -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    for address in deposit_candidates:
        outgoing_txs = outgoing.get(address, [])
        if outgoing_txs:
            destination = outgoing_txs[0]["to"]
            hot_wallets.append(destination)
            findings.append({"name": "Deposit-to-hot-wallet sweep detected", "status": "positive", "points": 17})
            score += 17
            break

    # Mixer -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    for tx in transactions:
        if tx["from"].upper() == "MIXER" or tx["to"].upper() == "MIXER":
            mixer_detected = True
            findings.append({"name": "Mixer interaction detected", "status": "warning", "points": -20})
            score -= 20
            break

    # Bridge -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    for tx in transactions:
        if tx["from"].upper() == "BRIDGE" or tx["to"].upper() == "BRIDGE":
            bridge_detected = True
            findings.append({"name": "Cross-chain bridge detected", "status": "warning", "points": -10})
            score -= 10
            break

    # VASP intelligence -- ORIGINAL DEMO LOGIC, intentionally unchanged.
    candidate_vasp = None
    candidate_type = None
    matched_addresses = []

    for vasp in vasp_data:
        known_hot = {address.lower() for address in vasp.get("hot_wallets", [])}
        known_deposits = {address.lower() for address in vasp.get("deposit_addresses", [])}

        matched_hot = known_hot.intersection({address.lower() for address in hot_wallets})
        matched_deposits = known_deposits.intersection({address.lower() for address in deposit_candidates})

        if matched_hot:
            candidate_vasp = vasp["vasp"]
            candidate_type = vasp.get("type", "unknown")
            matched_addresses.extend(matched_hot)
            findings.append({"name": "Known VASP hot wallet matched", "status": "positive", "points": 15})
            score += 15
            break

        if matched_deposits:
            candidate_vasp = vasp["vasp"]
            candidate_type = vasp.get("type", "unknown")
            matched_addresses.extend(matched_deposits)
            findings.append({"name": "Known VASP deposit address matched", "status": "positive", "points": 12})
            score += 12
            break

    if not candidate_vasp:
        candidate_vasp = "INCONCLUSIVE"
        candidate_type = "unknown"

    confidence = max(0, min(score, 100))

    return {
        "candidate_vasp": candidate_vasp,
        "candidate_type": candidate_type,
        "confidence": confidence,
        "findings": findings,
        "deposit_candidates": deposit_candidates,
        "hot_wallets": hot_wallets,
        "matched_addresses": matched_addresses,
        "cluster_size": len(cluster_addresses),
        "mixer_detected": mixer_detected,
        "bridge_detected": bridge_detected
    }


def _tx_addresses(transactions):
    addresses = set()
    for tx in transactions:
        sender = str(tx.get("from", "")).lower()
        receiver = str(tx.get("to", "")).lower()
        if sender:
            addresses.add(sender)
        if receiver:
            addresses.add(receiver)
    return addresses


def detect_live_behavioral_clusters(transactions, start_wallet=None):
    """Detect related live addresses from observed transaction relationships."""
    outgoing = {}
    incoming = {}

    for tx in transactions:
        sender = str(tx.get("from", "")).lower()
        receiver = str(tx.get("to", "")).lower()
        if not sender or not receiver:
            continue
        outgoing.setdefault(sender, set()).add(receiver)
        incoming.setdefault(receiver, set()).add(sender)

    addresses = _tx_addresses(transactions)
    if start_wallet:
        addresses.add(start_wallet.lower())

    relationships = []
    address_list = sorted(addresses)

    for i, a in enumerate(address_list):
        for b in address_list[i + 1:]:
            shared_destinations = outgoing.get(a, set()) & outgoing.get(b, set())
            shared_sources = incoming.get(a, set()) & incoming.get(b, set())
            direct = b in outgoing.get(a, set()) or a in outgoing.get(b, set())

            score = len(shared_destinations) + len(shared_sources) + (1 if direct else 0)
            if score >= 2:
                reasons = []
                if shared_destinations:
                    reasons.append(f"shared destinations: {len(shared_destinations)}")
                if shared_sources:
                    reasons.append(f"shared funding sources: {len(shared_sources)}")
                if direct:
                    reasons.append("direct interaction")
                relationships.append({"a": a, "b": b, "score": score, "reasons": reasons})

    graph = {}
    for relation in relationships:
        graph.setdefault(relation["a"], set()).add(relation["b"])
        graph.setdefault(relation["b"], set()).add(relation["a"])

    visited = set()
    clusters = []
    for address in graph:
        if address in visited:
            continue
        stack = [address]
        component = set()
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            component.add(current)
            stack.extend(neighbour for neighbour in graph.get(current, set()) if neighbour not in visited)

        if len(component) >= 2:
            cluster_relationships = [
                r for r in relationships
                if r["a"] in component and r["b"] in component
            ]
            clusters.append({
                "cluster_id": len(clusters) + 1,
                "addresses": sorted(component),
                "size": len(component),
                "relationship_strength": sum(r["score"] for r in cluster_relationships),
                "relationships": cluster_relationships
            })

    return {"count": len(clusters), "clusters": clusters, "addresses": sorted(addresses)}


def detect_live_deposit_addresses(transactions, start_wallet=None):
    """Detect deposit-like addresses from observed fan-in and forwarding behavior."""
    incoming = {}
    outgoing = {}

    for tx in transactions:
        sender = str(tx.get("from", "")).lower()
        receiver = str(tx.get("to", "")).lower()
        if not sender or not receiver:
            continue
        incoming.setdefault(receiver, []).append(tx)
        outgoing.setdefault(sender, []).append(tx)

    candidates = []
    start = start_wallet.lower() if start_wallet else None

    for address, received_txs in incoming.items():
        if start and address == start:
            continue

        senders = {str(tx.get("from", "")).lower() for tx in received_txs if tx.get("from")}
        forwarded = outgoing.get(address, [])
        incoming_count = len(received_txs)
        unique_senders = len(senders)

        if unique_senders < 2 or not forwarded:
            continue

        sender_diversity = unique_senders / incoming_count
        forwarding_ratio = min(len(forwarded) / incoming_count, 1.0)
        repeat_incoming = min((incoming_count - 1) / incoming_count, 1.0)
        behavior_score = (sender_diversity + forwarding_ratio + repeat_incoming) / 3

        candidates.append({
            "address": address,
            "incoming_count": incoming_count,
            "unique_senders": unique_senders,
            "forwarding_count": len(forwarded),
            "sender_diversity": round(sender_diversity, 4),
            "forwarding_ratio": round(forwarding_ratio, 4),
            "repeat_incoming": round(repeat_incoming, 4),
            "behavior_score": round(behavior_score, 4)
        })

    candidates.sort(key=lambda item: item["behavior_score"], reverse=True)
    return {"count": len(candidates), "candidates": candidates}


def detect_live_hot_wallets(transactions, deposit_analysis=None):
    """Detect consolidation/hot-wallet-like behavior from the traced graph."""
    incoming = {}
    outgoing = {}

    for tx in transactions:
        sender = str(tx.get("from", "")).lower()
        receiver = str(tx.get("to", "")).lower()
        if not sender or not receiver:
            continue
        incoming.setdefault(receiver, []).append(tx)
        outgoing.setdefault(sender, []).append(tx)

    deposit_addresses = {
        item["address"].lower()
        for item in (deposit_analysis or {}).get("candidates", [])
    }

    candidates = []
    for address in sorted(set(incoming) | set(outgoing)):
        received = incoming.get(address, [])
        sent = outgoing.get(address, [])
        senders = {str(tx.get("from", "")).lower() for tx in received if tx.get("from")}
        receivers = {str(tx.get("to", "")).lower() for tx in sent if tx.get("to")}

        fan_in = len(senders)
        fan_out = len(receivers)
        volume_in = sum(float(tx.get("amount") or 0) for tx in received)
        volume_out = sum(float(tx.get("amount") or 0) for tx in sent)

        # A consolidation wallet has broad inbound connectivity and forwards funds.
        if fan_in < 2 or not sent:
            continue

        consolidation_ratio = volume_out / volume_in if volume_in > 0 else 0
        flow_balance = min(consolidation_ratio, 1.0)
        inbound_diversity = fan_in / (fan_in + 1)
        forward_activity = fan_out / (fan_out + 1)
        deposit_link = 1.0 if address in deposit_addresses else 0.0

        behavior_score = (
            inbound_diversity + forward_activity + flow_balance + deposit_link
        ) / 4

        candidates.append({
            "address": address,
            "unique_senders": fan_in,
            "unique_receivers": fan_out,
            "incoming_volume": round(volume_in, 8),
            "outgoing_volume": round(volume_out, 8),
            "consolidation_ratio": round(consolidation_ratio, 4),
            "deposit_link": bool(deposit_link),
            "behavior_score": round(behavior_score, 4)
        })

    candidates.sort(key=lambda item: item["behavior_score"], reverse=True)
    return {"count": len(candidates), "candidates": candidates}


def rank_live_vasp_candidates(
    traced_addresses,
    external_vasp_matches,
    deposit_analysis,
    hot_analysis
):
    """Rank externally labelled service candidates without treating AML risk as identity proof."""
    traced = {str(a).lower() for a in traced_addresses}
    deposit_addresses = {item["address"].lower() for item in deposit_analysis.get("candidates", [])}
    hot_addresses = {item["address"].lower() for item in hot_analysis.get("candidates", [])}

    candidates = {}
    for match in external_vasp_matches:
        label = str(match.get("entity") or "").strip()
        address = str(match.get("address") or "").lower()
        if not label or not address:
            continue

        key = (label.lower(), address)
        evidence = []
        exact_trace = address in traced
        deposit_match = address in deposit_addresses
        hot_match = address in hot_addresses

        if exact_trace:
            evidence.append("labelled address is present in traced graph")
        if deposit_match:
            evidence.append("labelled address behaves like a deposit address")
        if hot_match:
            evidence.append("labelled address behaves like a consolidation wallet")

        # AML score is risk/supporting intelligence, not attribution probability.
        raw_aml = match.get("aml_score")
        try:
            aml_support = max(0.0, min(float(raw_aml) / 100.0, 1.0))
        except (TypeError, ValueError):
            aml_support = 0.0

        evidence_strength = (
            (1.0 if exact_trace else 0.0) * 0.60
            + (1.0 if deposit_match else 0.0) * 0.20
            + (1.0 if hot_match else 0.0) * 0.15
            + aml_support * 0.05
        )

        candidates[key] = {
            "vasp": label,
            "address": address,
            "category": match.get("category", "unknown"),
            "aml_score": raw_aml,
            "evidence_strength": round(evidence_strength, 4),
            "evidence": evidence
        }

    ranked = sorted(candidates.values(), key=lambda x: x["evidence_strength"], reverse=True)
    return ranked


def calculate_live_confidence(
    transactions,
    addresses,
    external_vasp_matches,
    intelligence,
    behavioral_clusters=None,
    deposit_analysis=None,
    hot_analysis=None
):
    """Calculate an explainable evidence score for live data; it is not a probability of ownership."""
    tx_count = len(transactions)
    address_count = len(addresses)
    cluster_count = (behavioral_clusters or {}).get("count", 0)
    deposit_count = (deposit_analysis or {}).get("count", 0)
    hot_count = (hot_analysis or {}).get("count", 0)

    senders = {str(tx.get("from", "")).lower() for tx in transactions if tx.get("from")}
    receivers = {str(tx.get("to", "")).lower() for tx in transactions if tx.get("to")}
    active_addresses = senders | receivers

    transaction_evidence = min(tx_count / max(address_count * 10, 1), 1.0)
    graph_coverage = min(address_count / max(len(active_addresses), 1), 1.0)
    counterparties = min((len(senders) + len(receivers)) / max(address_count * 4, 1), 1.0)
    flow_continuity = min(len(senders & receivers) / max(len(receivers), 1), 1.0)
    cluster_evidence = min(cluster_count / max(address_count / 2, 1), 1.0)
    deposit_evidence = min(deposit_count / max(address_count / 3, 1), 1.0)
    hot_evidence = min(hot_count / max(address_count / 4, 1), 1.0)

    traced = {str(a).lower() for a in addresses}
    exact_external = sum(
        1 for item in external_vasp_matches
        if str(item.get("address") or "").lower() in traced
    )
    external_evidence = min(exact_external / max(len(external_vasp_matches), 1), 1.0)

    risk_penalty = 0.0
    risk_reasons = []
    if intelligence.get("mixer_detected"):
        risk_penalty += 0.20
        risk_reasons.append("mixer interaction")
    if intelligence.get("bridge_detected"):
        risk_penalty += 0.10
        risk_reasons.append("cross-chain bridge")

    evidence_values = {
        "transaction_activity": round(transaction_evidence, 4),
        "graph_coverage": round(graph_coverage, 4),
        "counterparty_activity": round(counterparties, 4),
        "flow_continuity": round(flow_continuity, 4),
        "behavioral_clusters": round(cluster_evidence, 4),
        "deposit_behavior": round(deposit_evidence, 4),
        "hot_wallet_behavior": round(hot_evidence, 4),
        "external_intelligence": round(external_evidence, 4)
    }

    base_evidence = sum(evidence_values.values()) / len(evidence_values)
    confidence = round(max(0.0, min(base_evidence * (1.0 - risk_penalty), 1.0)) * 100)

    explanation = (
        "Evidence score combines observed transaction activity, graph coverage, "
        "counterparty/flow continuity, behavioral clustering, deposit-like behavior, "
        "consolidation behavior and externally labelled service intelligence."
    )
    if risk_reasons:
        explanation += " Uncertainty modifiers: " + ", ".join(risk_reasons) + "."

    return {
        "confidence": confidence,
        "evidence_breakdown": evidence_values,
        "score_explanation": explanation,
        "risk_penalty": round(risk_penalty, 4)
    }
