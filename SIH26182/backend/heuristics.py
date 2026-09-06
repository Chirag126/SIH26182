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