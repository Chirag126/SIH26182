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



from collections import defaultdict, deque
from math import log1p
from statistics import median


def _norm(value):
    return str(value or "").strip().lower()


def _safe_amount(tx):
    try:
        return max(float(tx.get("amount") or 0), 0.0)
    except (TypeError, ValueError):
        return 0.0


def _timestamp(tx):
    try:
        return int(tx.get("timestamp"))
    except (TypeError, ValueError):
        return None


def _tx_addresses(transactions):
    addresses = set()
    for tx in transactions:
        sender = _norm(tx.get("from"))
        receiver = _norm(tx.get("to"))
        if sender:
            addresses.add(sender)
        if receiver:
            addresses.add(receiver)
    return addresses


def _build_flow_maps(transactions):
    incoming = defaultdict(list)
    outgoing = defaultdict(list)
    for tx in transactions:
        sender = _norm(tx.get("from"))
        receiver = _norm(tx.get("to"))
        if not sender or not receiver:
            continue
        outgoing[sender].append(tx)
        incoming[receiver].append(tx)
    return incoming, outgoing


def _amount_similarity(values):
    values = [v for v in values if v > 0]
    if len(values) < 2:
        return 0.0
    med = median(values)
    if med <= 0:
        return 0.0
    deviations = [abs(v - med) / med for v in values]
    return max(0.0, min(1.0, 1.0 - median(deviations)))


def detect_live_behavioral_clusters(transactions, start_wallet=None):
    """Build evidence-weighted behavioral clusters from observed EVM activity."""
    incoming, outgoing = _build_flow_maps(transactions)
    addresses = _tx_addresses(transactions)
    if start_wallet:
        addresses.add(_norm(start_wallet))

    # Pairwise similarity is deliberately conservative: two addresses need
    # multiple independent signals before they are clustered.
    address_list = sorted(addresses)
    relationships = []
    for i, a in enumerate(address_list):
        for b in address_list[i + 1:]:
            a_out = {_norm(tx.get("to")) for tx in outgoing.get(a, []) if tx.get("to")}
            b_out = {_norm(tx.get("to")) for tx in outgoing.get(b, []) if tx.get("to")}
            a_in = {_norm(tx.get("from")) for tx in incoming.get(a, []) if tx.get("from")}
            b_in = {_norm(tx.get("from")) for tx in incoming.get(b, []) if tx.get("from")}

            shared_destinations = a_out & b_out
            shared_sources = a_in & b_in
            direct = b in a_out or a in b_out

            a_amounts = [_safe_amount(tx) for tx in outgoing.get(a, [])]
            b_amounts = [_safe_amount(tx) for tx in outgoing.get(b, [])]
            amount_pattern = _amount_similarity(a_amounts + b_amounts)

            # Temporal proximity is supporting evidence, never sufficient alone.
            times_a = [t for t in (_timestamp(tx) for tx in outgoing.get(a, [])) if t]
            times_b = [t for t in (_timestamp(tx) for tx in outgoing.get(b, [])) if t]
            temporal = 0.0
            if times_a and times_b:
                nearest = min(abs(x-y) for x in times_a for y in times_b)
                temporal = max(0.0, 1.0 - min(nearest / 86400.0, 1.0))

            signals = []
            if shared_destinations:
                signals.append(("shared destinations", min(len(shared_destinations), 3) * 0.30))
            if shared_sources:
                signals.append(("shared funding sources", min(len(shared_sources), 3) * 0.30))
            if direct:
                signals.append(("direct interaction", 0.20))
            if amount_pattern >= 0.65:
                signals.append(("similar transfer-size pattern", 0.10))
            if temporal >= 0.75:
                signals.append(("close temporal activity", 0.10))

            score = min(1.0, sum(weight for _, weight in signals))
            if score < 0.50:
                continue

            relationships.append({
                "a": a,
                "b": b,
                "score": round(score, 4),
                "reasons": [name for name, _ in signals],
                "shared_destinations": sorted(shared_destinations),
                "shared_sources": sorted(shared_sources),
            })

    graph = defaultdict(set)
    for relation in relationships:
        graph[relation["a"]].add(relation["b"])
        graph[relation["b"]].add(relation["a"])

    visited = set()
    clusters = []
    for address in sorted(graph):
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
            stack.extend(n for n in graph.get(current, set()) if n not in visited)
        if len(component) >= 2:
            rels = [r for r in relationships if r["a"] in component and r["b"] in component]
            strength = sum(r["score"] for r in rels)
            clusters.append({
                "cluster_id": len(clusters) + 1,
                "addresses": sorted(component),
                "size": len(component),
                "relationship_strength": round(strength, 4),
                "relationships": rels,
                "confidence": round(min(1.0, strength / max(len(component), 1)), 4),
            })

    return {"count": len(clusters), "clusters": clusters, "addresses": sorted(addresses)}


def detect_live_deposit_addresses(transactions, start_wallet=None):
    """Score deposit-like addresses using fan-in, forwarding and sweep conservation."""
    incoming, outgoing = _build_flow_maps(transactions)
    start = _norm(start_wallet)
    candidates = []

    for address, received in incoming.items():
        if address == start:
            continue
        forwarded = outgoing.get(address, [])
        if not received or not forwarded:
            continue

        senders = {_norm(tx.get("from")) for tx in received if tx.get("from")}
        receivers = {_norm(tx.get("to")) for tx in forwarded if tx.get("to")}
        if len(senders) < 2:
            continue

        incoming_volume = sum(_safe_amount(tx) for tx in received)
        outgoing_volume = sum(_safe_amount(tx) for tx in forwarded)
        sweep_ratio = min(outgoing_volume / incoming_volume, 1.0) if incoming_volume else 0.0
        fan_in_score = min(1.0, log1p(len(senders)) / log1p(10))
        forwarding_score = min(1.0, len(forwarded) / max(len(received), 1))
        repeat_score = min(1.0, (len(received) - 1) / max(len(received), 1))
        recipient_concentration = 1.0 / max(len(receivers), 1)
        temporal_sweep = 0.0
        receive_times = [t for t in (_timestamp(tx) for tx in received) if t]
        send_times = [t for t in (_timestamp(tx) for tx in forwarded) if t]
        if receive_times and send_times:
            earliest_send = min(send_times)
            prior_receives = [t for t in receive_times if t <= earliest_send]
            if prior_receives:
                delta = earliest_send - max(prior_receives)
                temporal_sweep = max(0.0, 1.0 - min(delta / 7*86400, 1.0))

        behavior_score = (
            fan_in_score * 0.30
            + forwarding_score * 0.20
            + repeat_score * 0.15
            + sweep_ratio * 0.20
            + recipient_concentration * 0.10
            + temporal_sweep * 0.05
        )
        if behavior_score < 0.45:
            continue

        reasons = [
            f"{len(senders)} unique funding source(s)",
            f"{len(received)} inbound transfer(s)",
            f"{len(forwarded)} forwarding transfer(s)",
        ]
        if sweep_ratio >= 0.70:
            reasons.append("strong inbound-to-outbound value continuity")
        if len(receivers) == 1:
            reasons.append("funds consolidated to one downstream address")

        candidates.append({
            "address": address,
            "incoming_count": len(received),
            "unique_senders": len(senders),
            "forwarding_count": len(forwarded),
            "unique_receivers": len(receivers),
            "incoming_volume": round(incoming_volume, 8),
            "outgoing_volume": round(outgoing_volume, 8),
            "sweep_ratio": round(sweep_ratio, 4),
            "sender_diversity": round(len(senders) / max(len(received), 1), 4),
            "recipient_concentration": round(recipient_concentration, 4),
            "behavior_score": round(behavior_score, 4),
            "reasons": reasons,
        })

    candidates.sort(key=lambda x: x["behavior_score"], reverse=True)
    return {"count": len(candidates), "candidates": candidates}


def detect_live_hot_wallets(transactions, deposit_analysis=None):
    """Identify high-connectivity consolidation infrastructure, not just high volume."""
    incoming, outgoing = _build_flow_maps(transactions)
    deposit_addresses = {_norm(x.get("address")) for x in (deposit_analysis or {}).get("candidates", [])}
    candidates = []

    for address in sorted(set(incoming) | set(outgoing)):
        received = incoming.get(address, [])
        sent = outgoing.get(address, [])
        if len(received) < 2 or not sent:
            continue

        senders = {_norm(tx.get("from")) for tx in received if tx.get("from")}
        receivers = {_norm(tx.get("to")) for tx in sent if tx.get("to")}
        incoming_volume = sum(_safe_amount(tx) for tx in received)
        outgoing_volume = sum(_safe_amount(tx) for tx in sent)
        conservation = min(outgoing_volume / incoming_volume, 1.0) if incoming_volume else 0.0
        fan_in = min(1.0, log1p(len(senders)) / log1p(20))
        fan_out = min(1.0, log1p(len(receivers)) / log1p(10))
        activity = min(1.0, log1p(len(received) + len(sent)) / log1p(30))
        deposit_link = 1.0 if address in deposit_addresses else 0.0
        breadth = min(1.0, (len(senders) + len(receivers)) / 12.0)

        score = (
            fan_in * 0.25
            + fan_out * 0.15
            + activity * 0.20
            + conservation * 0.20
            + deposit_link * 0.10
            + breadth * 0.10
        )
        if score < 0.50:
            continue

        reasons = [
            f"{len(senders)} unique inbound counterparty(s)",
            f"{len(receivers)} unique outbound destination(s)",
            f"{len(received) + len(sent)} observed transfer(s)",
        ]
        if conservation >= 0.70:
            reasons.append("high value conservation through the wallet")
        if deposit_link:
            reasons.append("linked to a deposit-like address")

        candidates.append({
            "address": address,
            "unique_senders": len(senders),
            "unique_receivers": len(receivers),
            "incoming_transactions": len(received),
            "outgoing_transactions": len(sent),
            "incoming_volume": round(incoming_volume, 8),
            "outgoing_volume": round(outgoing_volume, 8),
            "conservation_ratio": round(conservation, 4),
            "deposit_link": bool(deposit_link),
            "behavior_score": round(score, 4),
            "classification": "hot_wallet_candidate",
            "reasons": reasons,
        })

    candidates.sort(key=lambda x: x["behavior_score"], reverse=True)
    return {"count": len(candidates), "candidates": candidates}


def rank_live_vasp_candidates(traced_addresses, external_vasp_matches, deposit_analysis, hot_analysis, transactions=None):
    """Aggregate evidence by VASP and rank candidates; AML is never treated as identity probability."""
    traced = {_norm(a) for a in traced_addresses}
    deposit_map = {_norm(x.get("address")): x for x in deposit_analysis.get("candidates", [])}
    hot_map = {_norm(x.get("address")): x for x in hot_analysis.get("candidates", [])}
    tx_by_address = defaultdict(list)
    for tx in transactions or []:
        tx_by_address[_norm(tx.get("from"))].append(tx)
        tx_by_address[_norm(tx.get("to"))].append(tx)

    grouped = {}
    for match in external_vasp_matches:
        label = str(match.get("entity") or "").strip()
        address = _norm(match.get("address"))
        if not label or not address:
            continue
        key = label.lower()
        candidate = grouped.setdefault(key, {
            "vasp": label,
            "category": match.get("category", "unknown"),
            "addresses": [],
            "evidence": [],
            "evidence_strength": 0.0,
            "aml_scores": [],
        })
        if address not in candidate["addresses"]:
            candidate["addresses"].append(address)
        if match.get("aml_score") is not None:
            candidate["aml_scores"].append(match.get("aml_score"))

        if address in traced:
            candidate["evidence_strength"] += 0.45
            candidate["evidence"].append({"type": "trace_match", "address": address, "weight": 0.45, "reason": "labelled service address is in the observed trace"})
        if address in deposit_map:
            strength = 0.25 * float(deposit_map[address].get("behavior_score", 0))
            candidate["evidence_strength"] += strength
            candidate["evidence"].append({"type": "deposit_behavior", "address": address, "weight": round(strength, 4), "reason": "labelled address also exhibits deposit-like fan-in and forwarding"})
        if address in hot_map:
            strength = 0.25 * float(hot_map[address].get("behavior_score", 0))
            candidate["evidence_strength"] += strength
            candidate["evidence"].append({"type": "hot_wallet_behavior", "address": address, "weight": round(strength, 4), "reason": "labelled address exhibits consolidation infrastructure behavior"})

        observed_count = len(tx_by_address.get(address, []))
        if observed_count:
            strength = min(0.05, observed_count / 1000.0)
            candidate["evidence_strength"] += strength
            candidate["evidence"].append({"type": "activity", "address": address, "weight": round(strength, 4), "reason": f"{observed_count} observed transaction edge(s) touch the labelled address"})

    ranked = []
    for candidate in grouped.values():
        candidate["evidence_strength"] = round(min(candidate["evidence_strength"], 1.0), 4)
        candidate["score"] = round(candidate["evidence_strength"] * 100)
        candidate["addresses"] = sorted(candidate["addresses"])
        candidate["aml_context"] = {
            "available": bool(candidate["aml_scores"]),
            "scores": candidate["aml_scores"],
            "note": "AML/risk score is contextual intelligence, not VASP ownership probability."
        }
        candidate.pop("aml_scores", None)
        ranked.append(candidate)

    ranked.sort(key=lambda x: (x["score"], len(x["evidence"])), reverse=True)
    for index, candidate in enumerate(ranked, start=1):
        candidate["rank"] = index
    return ranked


def classify_live_addresses(transactions, start_wallet, deposit_analysis, hot_analysis, vasp_candidates=None):
    """Return backend-owned node classifications for the graph UI."""
    addresses = _tx_addresses(transactions) | {_norm(start_wallet)}
    deposit_map = {_norm(x.get("address")): x for x in deposit_analysis.get("candidates", [])}
    hot_map = {_norm(x.get("address")): x for x in hot_analysis.get("candidates", [])}
    matched = set()
    for candidate in vasp_candidates or []:
        matched.update(_norm(a) for a in candidate.get("addresses", []))

    result = []
    for address in sorted(addresses):
        if address == _norm(start_wallet):
            node_type = "start"
            reason = "investigation target"
            confidence = 1.0
        elif address in matched:
            node_type = "vasp"
            reason = "externally labelled VASP/service infrastructure"
            confidence = 1.0
        elif address in hot_map:
            node_type = "hot"
            reason = "; ".join(hot_map[address].get("reasons", []))
            confidence = hot_map[address].get("behavior_score", 0)
        elif address in deposit_map:
            node_type = "deposit"
            reason = "; ".join(deposit_map[address].get("reasons", []))
            confidence = deposit_map[address].get("behavior_score", 0)
        else:
            node_type = "wallet"
            reason = "observed blockchain address"
            confidence = 0.0

        result.append({
            "address": address,
            "type": node_type,
            "classification_confidence": round(float(confidence), 4),
            "reason": reason,
            "vasp_match": address in matched,
        })
    return result


def detect_trail_breaks(transactions):
    """Detect uncertainty-producing trail breaks such as mixers, bridges and rapid peeling."""
    breaks = []
    for tx in transactions:
        sender = _norm(tx.get("from"))
        receiver = _norm(tx.get("to"))
        combined = f"{sender} {receiver}"
        if "mixer" in combined or "tornado" in combined:
            breaks.append({"type": "mixer", "tx_hash": tx.get("tx_hash"), "from": tx.get("from"), "to": tx.get("to"), "severity": "high", "reason": "flow enters or leaves a mixer-like endpoint"})
        if "bridge" in combined:
            breaks.append({"type": "bridge", "tx_hash": tx.get("tx_hash"), "from": tx.get("from"), "to": tx.get("to"), "severity": "medium", "reason": "flow crosses a bridge-like endpoint"})

    # A simple peel-chain signal: repeated single-destination forwarding.
    incoming, outgoing = _build_flow_maps(transactions)
    for address, sent in outgoing.items():
        received = incoming.get(address, [])
        if len(received) >= 2 and len(sent) >= 2:
            unique_destinations = {_norm(tx.get("to")) for tx in sent if tx.get("to")}
            if len(unique_destinations) == 1:
                breaks.append({"type": "consolidation", "address": address, "severity": "low", "reason": "repeated inbound activity followed by single-destination forwarding"})
    return breaks


def build_trace_paths(transactions, start_wallet):
    """Build shortest observed transaction paths and annotate hops/flow values."""
    start = _norm(start_wallet)
    adjacency = defaultdict(list)
    for tx in transactions:
        sender = _norm(tx.get("from"))
        receiver = _norm(tx.get("to"))
        if sender and receiver:
            adjacency[sender].append(tx)

    paths = []
    queue = deque([(start, [], set())])
    best_depth = {start: 0}
    while queue:
        address, path, used = queue.popleft()
        for tx in adjacency.get(address, []):
            txid = str(tx.get("tx_hash") or f"{address}>{_norm(tx.get('to'))}")
            if txid in used:
                continue
            new_path = path + [tx]
            destination = _norm(tx.get("to"))
            paths.append({
                "hop": len(new_path),
                "tx_hash": tx.get("tx_hash"),
                "from": tx.get("from"),
                "to": tx.get("to"),
                "amount": tx.get("amount"),
                "chain": tx.get("chain", "Unknown"),
                "path": [_norm(x.get("from")) for x in new_path] + [destination],
            })
            depth = len(new_path)
            if destination and depth < 6 and depth < best_depth.get(destination, 999):
                best_depth[destination] = depth
                queue.append((destination, new_path, used | {txid}))
    return paths


def build_evidence_report(transactions, start_wallet, intelligence, behavioral_clusters, deposit_analysis, hot_analysis, vasp_candidates, trace_errors=None, external_intelligence=None):
    """Create one stable report contract consumed by the UI/export layer."""
    target = _norm(start_wallet)
    evidence = []
    if transactions:
        evidence.append({"type": "blockchain_activity", "strength": "observed", "title": "Blockchain activity observed", "details": f"{len(transactions)} transaction edge(s) were retrieved for the investigation."})
    for candidate in deposit_analysis.get("candidates", [])[:5]:
        evidence.append({"type": "deposit_behavior", "strength": "behavioral", "title": "Deposit-like address detected", "address": candidate.get("address"), "details": "; ".join(candidate.get("reasons", []))})
    for candidate in hot_analysis.get("candidates", [])[:5]:
        evidence.append({"type": "hot_wallet_behavior", "strength": "behavioral", "title": "Hot-wallet candidate detected", "address": candidate.get("address"), "details": "; ".join(candidate.get("reasons", []))})
    for cluster in behavioral_clusters.get("clusters", [])[:5]:
        evidence.append({"type": "cluster", "strength": "behavioral", "title": f"Behavioral cluster {cluster.get('cluster_id')} detected", "addresses": cluster.get("addresses", []), "details": f"Relationship strength {cluster.get('relationship_strength')}"})
    for candidate in vasp_candidates[:5]:
        for item in candidate.get("evidence", [])[:6]:
            evidence.append({"type": "vasp_attribution", "strength": "external+behavioral", "title": f"Evidence supporting {candidate.get('vasp')}", "address": item.get("address"), "details": item.get("reason"), "weight": item.get("weight")})

    uncertainties = []
    if intelligence.get("mixer_detected"):
        uncertainties.append("Mixer interaction reduces trace continuity and attribution confidence.")
    if intelligence.get("bridge_detected"):
        uncertainties.append("Cross-chain bridge interaction reduces direct continuity between chain segments.")
    if trace_errors:
        uncertainties.append(f"{len(trace_errors)} downstream lookup(s) failed or were incomplete.")
    if not vasp_candidates:
        uncertainties.append("No externally labelled VASP infrastructure was established in the observed graph.")

    return {
        "case": {
            "wallet": start_wallet,
            "target": target,
            "status": "PARTIAL" if trace_errors else "COMPLETE",
            "transaction_count": len(transactions),
            "address_count": len(_tx_addresses(transactions) | {target}),
        },
        "attribution": {
            "candidate": intelligence.get("candidate_vasp", "INCONCLUSIVE"),
            "score": intelligence.get("confidence", 0),
            "level": "HIGH" if intelligence.get("confidence", 0) >= 75 else "MEDIUM" if intelligence.get("confidence", 0) >= 45 else "LOW" if intelligence.get("confidence", 0) > 0 else "INCONCLUSIVE",
            "alternatives": vasp_candidates[:5],
        },
        "evidence": evidence,
        "transaction_paths": build_trace_paths(transactions, start_wallet),
        "uncertainties": uncertainties,
        "sources": {
            "blockchain": "Etherscan V2 API",
            "external_intelligence": bool(external_intelligence),
            "external_intelligence_name": "PublicAML" if external_intelligence else None,
        },
        "data_quality": {
            "trace_errors": len(trace_errors or []),
            "external_intelligence_available": bool(external_intelligence),
            "observed_transactions": len(transactions),
        },
    }


def calculate_live_confidence(transactions, addresses, external_vasp_matches, intelligence, behavioral_clusters=None, deposit_analysis=None, hot_analysis=None, vasp_candidates=None, trace_errors=None):
    """Calculate attribution evidence score from independent, quality-weighted evidence."""
    tx_count = len(transactions)
    address_count = max(len(addresses), 1)
    clusters = (behavioral_clusters or {}).get("clusters", [])
    deposits = (deposit_analysis or {}).get("candidates", [])
    hots = (hot_analysis or {}).get("candidates", [])
    candidates = vasp_candidates or []

    activity = min(1.0, log1p(tx_count) / log1p(50))
    graph = min(1.0, address_count / 10.0)
    flow = min(1.0, len({(_norm(t.get('from')), _norm(t.get('to'))) for t in transactions}) / max(tx_count, 1))
    cluster_strength = max([float(c.get("confidence", 0)) for c in clusters] or [0.0])
    deposit_strength = max([float(c.get("behavior_score", 0)) for c in deposits] or [0.0])
    hot_strength = max([float(c.get("behavior_score", 0)) for c in hots] or [0.0])
    vasp_strength = float(candidates[0].get("evidence_strength", 0)) if candidates else 0.0

    # Attribution-specific evidence gets more weight than generic activity.
    weighted = {
        "transaction_activity": activity,
        "graph_coverage": graph,
        "flow_continuity": flow,
        "behavioral_clustering": cluster_strength,
        "deposit_behavior": deposit_strength,
        "hot_wallet_behavior": hot_strength,
        "external_vasp_evidence": vasp_strength,
    }
    weights = {
        "transaction_activity": 0.08,
        "graph_coverage": 0.07,
        "flow_continuity": 0.10,
        "behavioral_clustering": 0.12,
        "deposit_behavior": 0.18,
        "hot_wallet_behavior": 0.15,
        "external_vasp_evidence": 0.30,
    }

    base = sum(weighted[key] * weights[key] for key in weighted) / sum(weights.values())
    penalties = 0.0
    reasons = []
    if intelligence.get("mixer_detected"):
        penalties += 0.20
        reasons.append("mixer interaction")
    if intelligence.get("bridge_detected"):
        penalties += 0.10
        reasons.append("cross-chain bridge")
    if trace_errors:
        penalties += min(0.15, 0.03 * len(trace_errors))
        reasons.append("partial downstream lookups")

    # No VASP evidence means the score is a quality-of-trace score capped as inconclusive,
    # rather than pretending generic activity proves a service identity.
    attribution_cap = 100 if candidates else 39
    score = round(max(0.0, min(base * (1.0 - penalties), 1.0)) * attribution_cap)

    breakdown = {key: round(value, 4) for key, value in weighted.items()}
    explanation = "Attribution evidence score weights service evidence, deposit/hot-wallet behavior, flow continuity and clustering more heavily than generic transaction activity."
    if reasons:
        explanation += " Uncertainty modifiers: " + ", ".join(reasons) + "."
    if not candidates:
        explanation += " No externally labelled VASP candidate was established, so the score is capped to avoid presenting generic activity as ownership evidence."

    return {
        "confidence": score,
        "evidence_breakdown": breakdown,
        "evidence_weights": weights,
        "score_explanation": explanation,
        "risk_penalty": round(penalties, 4),
        "score_type": "attribution evidence score",
        "confidence_level": "HIGH" if score >= 75 else "MEDIUM" if score >= 45 else "LOW" if score > 0 else "INCONCLUSIVE",
    }


def evaluation_summary(cases):
    """Evaluate labelled cases without fabricating metrics. Cases must provide expected_vasp."""
    evaluated = [c for c in cases if c.get("expected_vasp")]
    if not evaluated:
        return {"status": "NO_LABELLED_CASES", "message": "Evaluation harness is ready but no labelled benchmark cases were supplied.", "top1_accuracy": None, "top3_coverage": None, "cases": 0}
    top1 = 0
    top3 = 0
    for case in evaluated:
        candidates = [str(x).lower() for x in case.get("predicted_vasps", [])]
        expected = str(case.get("expected_vasp")).lower()
        if candidates and candidates[0] == expected:
            top1 += 1
        if expected in candidates[:3]:
            top3 += 1
    n = len(evaluated)
    return {"status": "MEASURED", "cases": n, "top1_accuracy": round(top1/n, 4), "top3_coverage": round(top3/n, 4)}
