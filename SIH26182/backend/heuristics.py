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

        outgoing.setdefault(
            sender,
            []
        ).append(tx)

        incoming.setdefault(
            receiver,
            []
        ).append(tx)

    # -------------------------
    # Transaction path
    # -------------------------

    if len(transactions) > 1:

        findings.append({
            "name":
                "Transaction path traced",
            "status":
                "positive",
            "points":
                15
        })

        score += 15

    # -------------------------
    # Behavioral cluster
    # -------------------------

    cluster_addresses = []

    for address, txs in outgoing.items():

        if len(txs) >= 2:

            cluster_addresses.append(
                address
            )

    if cluster_addresses:

        findings.append({
            "name":
                "Behavioral address cluster detected",
            "status":
                "positive",
            "points":
                20
        })

        score += 20

    # -------------------------
    # Deposit candidates
    # -------------------------

    for address, txs in incoming.items():

        if len(txs) >= 2:

            deposit_candidates.append(
                address
            )

        elif address.upper().startswith(
            "0XDEP"
        ):

            deposit_candidates.append(
                address
            )

    if deposit_candidates:

        findings.append({
            "name":
                "Candidate deposit address detected",
            "status":
                "positive",
            "points":
                20
        })

        score += 20

    # -------------------------
    # Deposit → hot wallet
    # -------------------------

    for address in deposit_candidates:

        outgoing_txs = outgoing.get(
            address,
            []
        )

        if outgoing_txs:

            destination = (
                outgoing_txs[0]["to"]
            )

            hot_wallets.append(
                destination
            )

            findings.append({
                "name":
                    "Deposit-to-hot-wallet sweep detected",
                "status":
                    "positive",
                "points":
                    17
            })

            score += 17

            break

    # -------------------------
    # Mixer
    # -------------------------

    for tx in transactions:

        if (
            tx["from"].upper()
            == "MIXER"
            or
            tx["to"].upper()
            == "MIXER"
        ):

            mixer_detected = True

            findings.append({
                "name":
                    "Mixer interaction detected",
                "status":
                    "warning",
                "points":
                    -20
            })

            score -= 20

            break

    # -------------------------
    # Bridge
    # -------------------------

    for tx in transactions:

        if (
            tx["from"].upper()
            == "BRIDGE"
            or
            tx["to"].upper()
            == "BRIDGE"
        ):

            bridge_detected = True

            findings.append({
                "name":
                    "Cross-chain bridge detected",
                "status":
                    "warning",
                "points":
                    -10
            })

            score -= 10

            break

    # -------------------------
    # VASP intelligence
    # -------------------------

    candidate_vasp = None
    candidate_type = None
    matched_addresses = []

    for vasp in vasp_data:

        known_hot = {
            address.lower()
            for address
            in vasp.get(
                "hot_wallets",
                []
            )
        }

        known_deposits = {
            address.lower()
            for address
            in vasp.get(
                "deposit_addresses",
                []
            )
        }

        matched_hot = (
            known_hot.intersection(
                {
                    address.lower()
                    for address
                    in hot_wallets
                }
            )
        )

        matched_deposits = (
            known_deposits.intersection(
                {
                    address.lower()
                    for address
                    in deposit_candidates
                }
            )
        )

        if matched_hot:

            candidate_vasp = (
                vasp["vasp"]
            )

            candidate_type = (
                vasp.get(
                    "type",
                    "unknown"
                )
            )

            matched_addresses.extend(
                matched_hot
            )

            findings.append({
                "name":
                    "Known VASP hot wallet matched",
                "status":
                    "positive",
                "points":
                    15
            })

            score += 15

            break

        if matched_deposits:

            candidate_vasp = (
                vasp["vasp"]
            )

            candidate_type = (
                vasp.get(
                    "type",
                    "unknown"
                )
            )

            matched_addresses.extend(
                matched_deposits
            )

            findings.append({
                "name":
                    "Known VASP deposit address matched",
                "status":
                    "positive",
                "points":
                    12
            })

            score += 12

            break

    # -------------------------
    # Final attribution
    # -------------------------

    if not candidate_vasp:

        candidate_vasp = (
            "INCONCLUSIVE"
        )

        candidate_type = (
            "unknown"
        )

    confidence = max(
        0,
        min(score, 100)
    )

    return {
        "candidate_vasp":
            candidate_vasp,

        "candidate_type":
            candidate_type,

        "confidence":
            confidence,

        "findings":
            findings,

        "deposit_candidates":
            deposit_candidates,

        "hot_wallets":
            hot_wallets,

        "matched_addresses":
            matched_addresses,

        "cluster_size":
            len(cluster_addresses),

        "mixer_detected":
            mixer_detected,

        "bridge_detected":
            bridge_detected
    }

def calculate_live_confidence(
    transactions,
    addresses,
    external_vasp_matches,
    intelligence
):
    """
    Calculate attribution confidence for REAL wallet investigations.

    This is an evidence score, not a probability of ownership.
    It uses only observed blockchain / intelligence signals.
    """

    if not transactions:
        return {
            "confidence": 0,
            "evidence_breakdown": {},
            "score_explanation": "No transaction evidence available."
        }

    wallet_addresses = {
        str(address).lower()
        for address in addresses
    }

    # --------------------------------------------------
    # 1. Transaction evidence
    # --------------------------------------------------

    transaction_count = len(transactions)

    transaction_evidence = min(
        transaction_count / 20,
        1.0
    )

    # --------------------------------------------------
    # 2. Counterparty diversity
    # --------------------------------------------------

    counterparties = set()

    for tx in transactions:

        sender = str(
            tx.get("from", "")
        ).lower()

        receiver = str(
            tx.get("to", "")
        ).lower()

        if sender:
            counterparties.add(sender)

        if receiver:
            counterparties.add(receiver)

    counterparty_evidence = min(
        len(counterparties) / 20,
        1.0
    )

    # --------------------------------------------------
    # 3. Flow continuity
    #
    # Measures how often a received address also
    # becomes a sender later in the observed graph.
    # --------------------------------------------------

    senders = {
        str(tx.get("from", "")).lower()
        for tx in transactions
        if tx.get("from")
    }

    receivers = {
        str(tx.get("to", "")).lower()
        for tx in transactions
        if tx.get("to")
    }

    continuing_addresses = (
        senders.intersection(receivers)
    )

    if receivers:
        flow_continuity = min(
            len(continuing_addresses)
            / len(receivers),
            1.0
        )
    else:
        flow_continuity = 0.0

    # --------------------------------------------------
    # 4. Deposit behaviour
    # --------------------------------------------------

    deposit_candidates = intelligence.get(
        "deposit_candidates",
        []
    )

    deposit_evidence = min(
        len(deposit_candidates) / 3,
        1.0
    )

    # --------------------------------------------------
    # 5. Hot-wallet / sweep behaviour
    # --------------------------------------------------

    hot_wallets = intelligence.get(
        "hot_wallets",
        []
    )

    sweep_evidence = min(
        len(hot_wallets) / 2,
        1.0
    )

    # --------------------------------------------------
    # 6. External VASP intelligence
    #
    # Presence of a labelled exchange/custodian address
    # is an attribution signal.
    # --------------------------------------------------

    external_match_evidence = 0.0

    if external_vasp_matches:

        labelled_addresses = {
            str(match.get("address", "")).lower()
            for match in external_vasp_matches
            if match.get("address")
        }

        matched_count = len(
            labelled_addresses.intersection(
                wallet_addresses
            )
        )

        if matched_count:
            external_match_evidence = min(
                matched_count / 2,
                1.0
            )
        else:
            # Intelligence returned a VASP/service label,
            # but it was not necessarily one of the exact
            # traced addresses.
            external_match_evidence = 0.5

    # --------------------------------------------------
    # 7. Graph proximity
    #
    # The current tracer records the addresses actually
    # reached. More observed connected addresses provide
    # stronger graph evidence.
    # --------------------------------------------------

    graph_evidence = min(
        len(wallet_addresses) / 8,
        1.0
    )

    # --------------------------------------------------
    # 8. Risk factors
    # --------------------------------------------------

    risk_penalty = 0.0

    if intelligence.get(
        "mixer_detected",
        False
    ):
        risk_penalty += 0.20

    if intelligence.get(
        "bridge_detected",
        False
    ):
        risk_penalty += 0.10

    risk_penalty = min(
        risk_penalty,
        1.0
    )

    # --------------------------------------------------
    # Evidence aggregation
    #
    # Equal contribution prevents one single signal
    # from dominating the entire attribution.
    # --------------------------------------------------

    evidence_signals = [
        transaction_evidence,
        counterparty_evidence,
        flow_continuity,
        deposit_evidence,
        sweep_evidence,
        external_match_evidence,
        graph_evidence
    ]

    base_evidence = (
        sum(evidence_signals)
        / len(evidence_signals)
    )

    final_score = (
        base_evidence
        * (1 - risk_penalty)
        * 100
    )

    confidence = round(
        max(
            0,
            min(
                final_score,
                100
            )
        )
    )

    evidence_breakdown = {
        "transaction_evidence": round(
            transaction_evidence * 100
        ),
        "counterparty_evidence": round(
            counterparty_evidence * 100
        ),
        "flow_continuity": round(
            flow_continuity * 100
        ),
        "deposit_evidence": round(
            deposit_evidence * 100
        ),
        "sweep_evidence": round(
            sweep_evidence * 100
        ),
        "external_vasp_evidence": round(
            external_match_evidence * 100
        ),
        "graph_evidence": round(
            graph_evidence * 100
        ),
        "risk_penalty": round(
            risk_penalty * 100
        )
    }

    return {
        "confidence": confidence,
        "evidence_breakdown": evidence_breakdown,
        "score_explanation": (
            "Confidence is calculated from observed "
            "transaction, graph, behavioural and "
            "external-intelligence evidence. "
            "Mixer and bridge activity reduce the score."
        )
    }