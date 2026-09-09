let investigationData = null;
let activeGraph = null;
let graphAnimationFrame = null;
let graphDashPhase = 0;

const scenarios = {
    normal: {
        wallet: "0xABC"
    },

    difficult: {
        wallet: "0xMIXABC"
    },

    real: {
        wallet: "0x8EB8fd3df2F6203C17e9B9218FB5b5B309344c13"
    }
};


/* =========================================================
   SCENARIO
   ========================================================= */

function changeScenario() {

    const scenario =
        document.getElementById("scenarioSelect").value;

    const walletInput =
        document.getElementById("walletInput");

        if (scenario === "real") {
            walletInput.value = scenarios[scenario].wallet;
            walletInput.placeholder = "Real wallet address";
        } else {
            walletInput.value = scenarios[scenario].wallet;
            walletInput.placeholder =  "Real wallet address";
        }  
}


/* =========================================================
   START INVESTIGATION
   ========================================================= */

async function startInvestigation() {

    const wallet =
        document.getElementById("walletInput").value.trim();

    if (!wallet) {
        alert("Enter a wallet address");
        return;
    }

    document
        .getElementById("results")
        .classList.remove("hidden");

    document.getElementById("traceStatus").innerText =
        "TRACING...";

    document.getElementById("graphStatus").innerText =
        "Analyzing blockchain activity...";

    try {

        const response =
            await fetch(
                `/investigate/${wallet}`
            );

        if (!response.ok) {
            throw new Error(
                "Investigation failed"
            );
        }

        const data =
            await response.json();

        investigationData = data;


        /* ---------------- DATA SOURCE ---------------- */

        document.getElementById("dataSource").innerText =
            data.source || "LIVE DATA";


        /* ---------------- STATISTICS ---------------- */

        document.getElementById("txCount").innerText =
            data.transaction_count ?? 0;

        document.getElementById("addressCount").innerText =
            data.address_count ?? 0;

        document.getElementById("clusterCount").innerText =
            data.cluster_count ?? 0;


        /* ---------------- STATUS ---------------- */

        document.getElementById("traceStatus").innerText =
            data.trace_status || "COMPLETE";

        document.getElementById("graphStatus").innerText =
            data.trace_status === "PARTIAL"
                ? "Partial graph — some API lookups were unavailable"
                : "Transaction graph generated";


        /* ---------------- GRAPH ---------------- */

        drawGraph(
            data.transactions || [],
            wallet,
            data
        );


        /* ---------------- INTELLIGENCE ---------------- */

        const intelligence =
            data.intelligence || {};

        const candidateVasp =
            intelligence.candidate_vasp ||
            "INCONCLUSIVE";

        const confidence =
            intelligence.confidence ?? 0;


        document.querySelector(".vasp-name").innerText =
            candidateVasp;

        document.querySelector(".confidence strong").innerText =
            confidence + "%";

        document.getElementById("confidenceBar").style.width =
            confidence + "%";


        /* ---------------- CONFIDENCE EXPLANATION ---------------- */

        let explanation =
            intelligence.score_explanation
            || "Confidence is based on observable transaction evidence.";

        if (
            candidateVasp !==
            "INCONCLUSIVE"
            && !explanation.toLowerCase().includes("external")
        ) {
            explanation +=
                " External service intelligence provided supporting attribution evidence.";
        }

        document.getElementById(
            "confidenceExplanation"
        ).innerText =
            explanation;


        /* ---------------- FINDINGS ---------------- */

        const findingContainer =
            document.querySelector(
                ".analysis-card:first-child"
            );

        findingContainer.innerHTML =
            "<h2>Detected Intelligence</h2>";

        const findings =
            intelligence.findings || [];

        findings.forEach(
            finding => {

                const div =
                    document.createElement("div");

                div.className =
                    "finding";

                if (
                    finding.status ===
                    "warning"
                ) {

                    div.classList.add(
                        "warning"
                    );

                    div.innerText =
                        "⚠ " + finding.name;

                } else {

                    div.innerText =
                        "✓ " + finding.name;
                }

                findingContainer.appendChild(
                    div
                );
            }
        );

    } catch (error) {

        console.error(
            "[INVESTIGATION ERROR]",
            error
        );

        document.getElementById(
            "traceStatus"
        ).innerText =
            "API ERROR";

        document.getElementById(
            "graphStatus"
        ).innerText =
            "Unable to retrieve transaction data";
    }
}


/* =========================================================
   GRAPH
   ========================================================= */

function drawGraph(
    transactions,
    startingWallet,
    analysisData = {}
) {

    const elements = [];
    const addedNodes = new Set();

    const intelligence = analysisData.intelligence || {};
    const depositSet = new Set(
        (analysisData.deposit_analysis?.candidates || [])
            .map(item => String(item.address || "").toLowerCase())
    );
    const hotSet = new Set(
        (analysisData.hot_wallet_analysis?.candidates || [])
            .map(item => String(item.address || "").toLowerCase())
    );
    const matchedSet = new Set(
        (intelligence.matched_addresses || [])
            .map(address => String(address).toLowerCase())
    );


    /* -----------------------------------------------------
       ADD NODE
       ----------------------------------------------------- */

    function addNode(address) {

        if (!address) {
            return;
        }

        if (
            addedNodes.has(address)
        ) {
            return;
        }

        addedNodes.add(address);

        let type =
            "wallet";

        const normalized =
            address.toUpperCase();


        if (
            address.toLowerCase() ===
            startingWallet.toLowerCase()
        ) {

            type =
                "start";

        }

        else if (
            depositSet.has(address.toLowerCase())
            || normalized.startsWith("0XDEP")
        ) {

            type =
                "deposit";

        }

        else if (
            hotSet.has(address.toLowerCase())
            || normalized.startsWith("0XHOT")
        ) {

            type =
                "hot";

        }

        else if (
            normalized ===
            "MIXER"
        ) {

            type =
                "mixer";

        }

        else if (
            normalized ===
            "BRIDGE"
        ) {

            type =
                "bridge";

        }

        else if (
            normalized.startsWith("0XDEST")
        ) {

            type =
                "destination";
        }


        elements.push({

            data: {

                id: address,

                label:
                    address.length > 17
                        ? address.slice(0, 8) + "…" + address.slice(-6)
                        : address,

                address: address,

                type: type,

                vaspMatch: matchedSet.has(address.toLowerCase())
            }
        });
    }


    /* -----------------------------------------------------
       ADD TRANSACTIONS
       ----------------------------------------------------- */

    transactions.forEach(
        tx => {

            if (
                !tx.from ||
                !tx.to
            ) {
                return;
            }

            addNode(tx.from);
            addNode(tx.to);


            elements.push({

                data: {

                    id:
                        tx.tx_hash ||
                        (
                            tx.from +
                            "_" +
                            tx.to +
                            "_" +
                            Math.random()
                        ),

                    source:
                        tx.from,

                    target:
                        tx.to,

                    amount:
                        tx.amount ?? "Unknown",

                    chain:
                        tx.chain ||
                        "Unknown",

                    tx_hash:
                        tx.tx_hash ||
                        "Unknown",

                    from:
                        tx.from,

                    to:
                        tx.to,

                    displayAmount:
                        tx.amount ?? "Unknown"
                }
            });
        }
    );


    /* -----------------------------------------------------
       CREATE CYTOSCAPE
       ----------------------------------------------------- */

    if (graphAnimationFrame) {
        cancelAnimationFrame(graphAnimationFrame);
        graphAnimationFrame = null;
    }

    if (activeGraph) {
        activeGraph.destroy();
        activeGraph = null;
    }

    const cy =
        cytoscape({

            container:
                document.getElementById(
                    "graph"
                ),

            elements:
                elements,


            style: [

                /* ---------- NORMAL NODE ---------- */

                {
                    selector:
                        "node",

                    style: {

                        "background-color":
                            "#4f7cff",

                        "label":
                            "",

                        "color":
                            "#ffffff",

                        "text-valign":
                            "center",

                        "text-halign":
                            "center",

                        "font-size":
                            "10px",

                        "width":
                            "65px",

                        "height":
                            "65px",

                        "border-width":
                            "2px",

                        "border-color":
                            "#65728f",

                        "opacity":
                            0.45
                    }
                },


                /* ---------- START ---------- */

                {
                    selector:
                        'node[type="start"]',

                    style: {

                        "background-color":
                            "#e05a5a",

                        "border-width":
                            "4px",

                        "border-color":
                            "#ff9b9b"
                    }
                },


                /* ---------- DEPOSIT ---------- */

                {
                    selector:
                        'node[type="deposit"]',

                    style: {

                        "background-color":
                            "#e6a817",

                        "border-width":
                            "4px",

                        "border-color":
                            "#ffe08a"
                    }
                },


                /* ---------- HOT WALLET ---------- */

                {
                    selector:
                        'node[type="hot"]',

                    style: {

                        "background-color":
                            "#22b573",

                        "border-width":
                            "4px",

                        "border-color":
                            "#75e6ad"
                    }
                },


                /* ---------- MIXER ---------- */

                {
                    selector:
                        'node[type="mixer"]',

                    style: {

                        "background-color":
                            "#b84b4b",

                        "border-width":
                            "4px",

                        "border-color":
                            "#ff8585"
                    }
                },


                /* ---------- BRIDGE ---------- */

                {
                    selector:
                        'node[type="bridge"]',

                    style: {

                        "background-color":
                            "#7a55c7",

                        "border-width":
                            "4px",

                        "border-color":
                            "#b99cff"
                    }
                },


                /* ---------- DESTINATION ---------- */

                {
                    selector:
                        'node[type="destination"]',

                    style: {

                        "background-color":
                            "#3298db",

                        "border-width":
                            "3px",

                        "border-color":
                            "#8bd5ff"
                    }
                },


                /* ---------- HOVER / PIN ---------- */

                {
                    selector:
                        "node.selected",

                    style: {
                        "opacity": 1,
                        "border-width": 6,
                        "border-color": "#ffffff",
                        "z-index": 999
                    }
                },

                {
                    selector:
                        "node.hovered",

                    style: {

                        "opacity":
                            1,

                        "width":
                            "78px",

                        "height":
                            "78px",

                        "border-width":
                            "5px"
                    }
                },


                /* ---------- MATCHED VASP INFRASTRUCTURE ---------- */

                {
                    selector:
                        'node[vaspMatch = true]',

                    style: {
                        "border-width": 6,
                        "border-color": "#ffffff",
                        "opacity": 1
                    }
                },


                /* ---------- NORMAL EDGE ---------- */

                {
                    selector:
                        "edge",

                    style: {

                        "width":
                            2,

                        "line-color":
                            "#65728f",

                        "line-dash-pattern":
                            [7, 5],

                        "line-dash-phase":
                            0,

                        "target-arrow-color":
                            "#65728f",

                        "target-arrow-shape":
                            "triangle",

                        "curve-style":
                            "bezier",

                        "opacity":
                            0.18,

                        "label":
                            ""
                    }
                },


                /* ---------- HOVER / PIN EDGE ---------- */

                {
                    selector:
                        "edge.selected",

                    style: {
                        "width": 5,
                        "line-color": "#ffffff",
                        "target-arrow-color": "#ffffff",
                        "target-arrow-shape": "triangle",
                        "opacity": 1,
                        "line-dash-pattern": [9, 5]
                    }
                },

                {
                    selector:
                        "edge.hovered",

                    style: {

                        "width":
                            5,

                        "line-color":
                            "#ffffff",

                        "target-arrow-color":
                            "#ffffff",

                        "target-arrow-shape":
                            "triangle",

                        "opacity":
                            1
                    }
                }
            ],


            layout: {

                name:
                    "breadthfirst",

                directed:
                    true,

                padding:
                    50,

                spacingFactor:
                    1.5
            }
        });


    /* =====================================================
       GRAPH INTERACTION
       ===================================================== */

    const popup = document.getElementById("graphPopup");
    const popupContent = document.getElementById("graphPopupContent");
    const popupClose = document.getElementById("graphPopupClose");

    function closeGraphPopup() {
        if (popup) {
            popup.classList.add("hidden");
        }
        cy.elements().removeClass("selected");
    }

    function showGraphPopup(kicker, title, rows, element) {
        if (!popup || !popupContent) {
            return;
        }

        popupContent.innerHTML = "";

        const kickerEl = document.createElement("div");
        kickerEl.className = "popup-kicker";
        kickerEl.textContent = kicker;

        const titleEl = document.createElement("div");
        titleEl.className = "popup-title";
        titleEl.textContent = title;

        popupContent.appendChild(kickerEl);
        popupContent.appendChild(titleEl);

        rows.forEach(item => {
            const row = document.createElement("div");
            row.className = "popup-row";

            const label = document.createElement("strong");
            label.textContent = item.label;

            const value = document.createElement("span");
            value.textContent = item.value ?? "Unknown";

            row.appendChild(label);
            row.appendChild(value);
            popupContent.appendChild(row);
        });

        cy.elements().removeClass("selected");
        if (element) {
            element.addClass("selected");
        }

        popup.classList.remove("hidden");
    }

    function nodeTypeLabel(type) {
        const labels = {
            start: "Investigated Wallet",
            deposit: "Candidate Deposit Address",
            hot: "VASP Hot Wallet",
            mixer: "Mixer",
            bridge: "Cross-Chain Bridge",
            destination: "Destination Wallet",
            wallet: "Wallet"
        };
        return labels[type] || "Wallet";
    }

    function getNodeRows(node) {
        const data = node.data();
        return [
            { label: "Type", value: nodeTypeLabel(data.type) },
            { label: "Address", value: data.address },
            { label: "Incoming", value: node.incomers("edge").length },
            { label: "Outgoing", value: node.outgoers("edge").length },
            ...(data.vaspMatch ? [{ label: "VASP", value: "Matched infrastructure" }] : [])
        ];
    }

    function getEdgeRows(edge) {
        const data = edge.data();
        return [
            { label: "TX Hash", value: data.tx_hash },
            { label: "From", value: data.from },
            { label: "To", value: data.to },
            { label: "Amount", value: data.amount },
            { label: "Chain", value: data.chain }
        ];
    }

    cy.on("tap", "node", function(event) {
        const node = event.target;
        showGraphPopup(
            "WALLET DETAILS",
            node.data("address"),
            getNodeRows(node),
            node
        );
    });

    cy.on("tap", "edge", function(event) {
        const edge = event.target;
        showGraphPopup(
            "TRANSACTION DETAILS",
            edge.data("tx_hash") || "Transaction",
            getEdgeRows(edge),
            edge
        );
    });

    cy.on("tap", function(event) {
        if (event.target === cy) {
            closeGraphPopup();
        }
    });

    if (popupClose) {
        popupClose.onclick = closeGraphPopup;
    }

    /* -----------------------------------------------------
       SUBTLE MOVING TRANSACTION PATHS
       ----------------------------------------------------- */

    function animateGraphEdges() {
        if (!cy || cy.destroyed()) {
            return;
        }

        graphDashPhase = (graphDashPhase + 0.65) % 20;
        cy.edges().forEach(edge => {
            edge.style("line-dash-phase", graphDashPhase);
        });

        graphAnimationFrame = requestAnimationFrame(animateGraphEdges);
    }

    animateGraphEdges();
    activeGraph = cy;

    return cy;
}


/* =========================================================
   GRAPH FULL SCREEN
   ========================================================= */

async function toggleGraphFullscreen() {
    const stage = document.getElementById("graphStage");
    const button = document.getElementById("graphFullscreenBtn");

    if (!stage) {
        return;
    }

    try {
        if (!document.fullscreenElement) {
            if (stage.requestFullscreen) {
                await stage.requestFullscreen();
            } else {
                stage.classList.add("graph-fullscreen");
            }
        } else if (document.exitFullscreen) {
            await document.exitFullscreen();
        }
    } catch (error) {
        stage.classList.toggle("graph-fullscreen");
    }

    if (activeGraph) {
        setTimeout(() => activeGraph.resize(), 120);
    }

    if (button) {
        button.innerText = document.fullscreenElement
            ? "⛶ Exit Full Screen"
            : "⛶ Full Screen";
    }
}

document.addEventListener("fullscreenchange", function() {
    const stage = document.getElementById("graphStage");
    const button = document.getElementById("graphFullscreenBtn");

    if (!stage) {
        return;
    }

    if (!document.fullscreenElement) {
        stage.classList.remove("graph-fullscreen");
    }

    if (button) {
        button.innerText = document.fullscreenElement
            ? "⛶ Exit Full Screen"
            : "⛶ Full Screen";
    }

    if (activeGraph) {
        setTimeout(() => activeGraph.resize(), 120);
    }
});

/* =========================================================
   ADDRESS TYPE
   ========================================================= */

function getAddressType(
    address
) {

    if (!address) {
        return "WALLET";
    }


    const normalized =
        address.toUpperCase();


    if (
        normalized.startsWith("0XDEP")
    ) {
        return "DEPOSIT ADDRESS";
    }


    if (
        normalized.startsWith("0XHOT")
    ) {
        return "HOT WALLET";
    }


    if (
        normalized ===
        "MIXER"
    ) {
        return "MIXER ⚠";
    }


    if (
        normalized ===
        "BRIDGE"
    ) {
        return "CROSS-CHAIN BRIDGE";
    }


    if (
        normalized.startsWith("0XDEST")
    ) {
        return "DESTINATION CHAIN";
    }


    if (
        normalized === "0XABC" ||
        normalized === "0XMIXABC"
    ) {
        return "UNKNOWN WALLET";
    }


    return "WALLET";
}


/* =========================================================
   EVIDENCE CHAIN HELPERS
   ========================================================= */

function buildEvidenceChain(
    data,
    intelligence
) {

    const transactions =
        data.transactions || [];

    const startingWallet =
        data.wallet;


    /*
     * Build transaction adjacency.
     */

    const outgoing =
        {};

    transactions.forEach(
        tx => {

            if (!tx.from || !tx.to) {
                return;
            }

            if (
                !outgoing[tx.from]
            ) {

                outgoing[tx.from] =
                    [];
            }

            outgoing[tx.from].push(
                tx
            );
        }
    );


    /*
     * Find important addresses.
     */

    let depositAddress =
        null;

    if (
        intelligence.deposit_candidates &&
        intelligence.deposit_candidates.length
    ) {

        depositAddress =
            intelligence.deposit_candidates[0];
    }


    let hotWallet =
        null;

    if (
        intelligence.hot_wallets &&
        intelligence.hot_wallets.length
    ) {

        hotWallet =
            intelligence.hot_wallets[0];
    }


    /*
     * Find a clean path from the
     * investigated wallet toward
     * the deposit address.
     */

    const path =
        [];

    const visited =
        new Set();


    function findPath(
        current,
        target,
        currentPath
    ) {

        if (
            current ===
            target
        ) {

            return currentPath;
        }


        if (
            visited.has(current)
        ) {

            return null;
        }

        visited.add(
            current
        );


        const nextTransactions =
            outgoing[current] || [];


        for (
            const tx of nextTransactions
        ) {

            const next =
                tx.to;


            const result =
                findPath(
                    next,
                    target,
                    [
                        ...currentPath,
                        tx
                    ]
                );


            if (result) {
                return result;
            }
        }


        return null;
    }


    if (depositAddress) {

        const result =
            findPath(
                startingWallet,
                depositAddress,
                []
            );


        if (result) {

            path.push(
                ...result
            );
        }
    }


    /*
     * If no deposit path was found,
     * fall back to the first transactions.
     */

    if (
        path.length === 0 &&
        transactions.length > 0
    ) {

        let current =
            startingWallet;

        const fallbackVisited =
            new Set();


        for (
            let i = 0;
            i < 10;
            i++
        ) {

            if (
                fallbackVisited.has(
                    current
                )
            ) {
                break;
            }

            fallbackVisited.add(
                current
            );


            const next =
                outgoing[current];


            if (
                !next ||
                !next.length
            ) {
                break;
            }


            const tx =
                next[0];


            path.push(
                tx
            );

            current =
                tx.to;
        }
    }


    /*
     * Create professional
     * investigation stages.
     */

    const stages =
        [];


    stages.push({

        title:
            "Source Wallet",

        value:
            startingWallet,

        description:
            "Wallet under investigation",

        type:
            "source"
    });


    /*
     * Add important intermediaries
     * in the actual transaction path.
     */

    const addedStageAddresses =
        new Set();


    path.forEach(
        tx => {

            const address =
                tx.to;


            const normalized =
                address.toUpperCase();


            if (
                address ===
                depositAddress
            ) {
                return;
            }


            if (
                address ===
                hotWallet
            ) {
                return;
            }


            if (
                normalized ===
                "MIXER"
            ) {

                if (
                    !addedStageAddresses.has(
                        address
                    )
                ) {

                    stages.push({

                        title:
                            "Mixer",

                        value:
                            address,

                        description:
                            "Mixer interaction increases attribution uncertainty",

                        type:
                            "warning"
                    });

                    addedStageAddresses.add(
                        address
                    );
                }

                return;
            }


            if (
                normalized ===
                "BRIDGE"
            ) {

                if (
                    !addedStageAddresses.has(
                        address
                    )
                ) {

                    stages.push({

                        title:
                            "Cross-Chain Bridge",

                        value:
                            address,

                        description:
                            "Cross-chain movement introduces uncertainty",

                        type:
                            "warning"
                    });

                    addedStageAddresses.add(
                        address
                    );
                }

                return;
            }


            /*
             * Only show meaningful
             * intermediate wallets.
             */

            if (
                !normalized.startsWith(
                    "0XDEST"
                )
            ) {

                if (
                    !addedStageAddresses.has(
                        address
                    )
                ) {

                    stages.push({

                        title:
                            "Intermediate Wallet",

                        value:
                            address,

                        description:
                            "Observed fund movement",

                        type:
                            "wallet"
                    });

                    addedStageAddresses.add(
                        address
                    );
                }
            }


            /*
             * Destination-chain wallet.
             */

            if (
                normalized.startsWith(
                    "0XDEST"
                )
            ) {

                if (
                    !addedStageAddresses.has(
                        address
                    )
                ) {

                    stages.push({

                        title:
                            "Destination Wallet",

                        value:
                            address,

                        description:
                            "Observed destination after cross-chain movement",

                        type:
                            "destination"
                    });

                    addedStageAddresses.add(
                        address
                    );
                }
            }
        }
    );


    /*
     * Deposit address.
     */

    if (depositAddress) {

        stages.push({

            title:
                "Candidate Deposit Address",

            value:
                depositAddress,

            description:
                "Address receiving funds before the service sweep",

            type:
                "deposit"
        });
    }


    /*
     * Hot wallet.
     */

    if (hotWallet) {

        stages.push({

            title:
                "VASP Hot Wallet",

            value:
                hotWallet,

            description:
                "Observed deposit-to-hot-wallet sweep",

            type:
                "hot"
        });
    }


    /*
     * External attribution.
     */

    if (
        intelligence.candidate_vasp &&
        intelligence.candidate_vasp !==
        "INCONCLUSIVE"
    ) {

        stages.push({

            title:
                "Candidate VASP",

            value:
                intelligence.candidate_vasp,

            description:
                "External blockchain intelligence supports this service attribution",

            type:
                "vasp"
        });
    }


    return stages;
}

/* =========================================================
   RENDER EVIDENCE CHAIN
   ========================================================= */

function renderEvidenceChain(
    data,
    intelligence
) {
    const container = document.getElementById("evidenceChain");

    if (!container) {
        return;
    }

    const stages = buildEvidenceChain(data, intelligence);
    container.innerHTML = "";

    if (!stages.length) {
        container.innerText = "No traceable evidence chain was generated.";
        return;
    }

    stages.forEach((stage, index) => {
        const item = document.createElement("div");
        item.className = "evidence-stage " + (stage.type || "wallet");

        const marker = document.createElement("div");
        marker.className = "evidence-marker";

        const number = document.createElement("div");
        number.className = "evidence-number";
        number.innerText = index + 1;
        marker.appendChild(number);

        const content = document.createElement("div");
        content.className = "evidence-content";

        const title = document.createElement("div");
        title.className = "evidence-title";
        title.innerText = stage.title;

        const value = document.createElement("div");
        value.className = "evidence-value";
        value.innerText = stage.value || "Unknown";

        const description = document.createElement("div");
        description.className = "evidence-description";
        description.innerText = stage.description || "Observed fund movement";

        content.append(title, value, description);
        item.append(marker, content);
        container.appendChild(item);
    });
}

/* =========================================================
   GENERATE REPORT
   ========================================================= */

function generateReport() {

    if (!investigationData) {

        alert(
            "Run an investigation first"
        );

        return;
    }


    const data =
        investigationData;

    const intelligence =
        data.intelligence || {};


    /* -----------------------------------------------------
       MATCHED ADDRESS
       ----------------------------------------------------- */

    const matchedAddress =
        intelligence.matched_addresses &&
        intelligence.matched_addresses.length > 0
            ? intelligence.matched_addresses.join(
                ", "
            )
            : "No infrastructure matched";


    /* -----------------------------------------------------
       SHOW REPORT
       ----------------------------------------------------- */

    document
        .getElementById("report")
        .classList.remove("hidden");


    document.getElementById(
        "reportWallet"
    ).innerText =
        data.wallet;


    document.getElementById(
        "reportVasp"
    ).innerText =
        intelligence.candidate_vasp ||
        "INCONCLUSIVE";


    const matchedAddressElement =
        document.getElementById(
            "matchedVaspAddresses"
        ) || document.getElementById(
            "matchedVaspAddrresses"
        );


    if (
        matchedAddressElement
    ) {

        matchedAddressElement.innerText =
            matchedAddress;
    }


    document.getElementById(
        "reportConfidence"
    ).innerText =
        (
            intelligence.confidence ??
            0
        ) + "%";


    document.getElementById(
        "reportTransactions"
    ).innerText =
        data.transaction_count ??
        (
            data.transactions ||
            []
        ).length;


    /* -----------------------------------------------------
       PROFESSIONAL EVIDENCE CHAIN
       ----------------------------------------------------- */

    renderEvidenceChain(
        data,
        intelligence
    );


    /* -----------------------------------------------------
       ATTRIBUTION BASIS
       ----------------------------------------------------- */

    const basis =
        document.getElementById(
            "reportBasis"
        );


    if (basis) {

        basis.innerText =
            intelligence.candidate_vasp &&
            intelligence.candidate_vasp !==
            "INCONCLUSIVE"

                ? "Observed transaction behavior + deposit/consolidation evidence + external service intelligence."

                : "Transaction behavior analyzed; no reliable service attribution established.";
    }


    /* -----------------------------------------------------
       INTELLIGENCE SOURCE
       ----------------------------------------------------- */

    const source =
        document.getElementById(
            "reportSource"
        );


    if (source) {

        source.innerText =
            data.source ||
            "Live blockchain data + external VASP intelligence";

        if (data.trace_errors && data.trace_errors.length) {
            source.innerText +=
                " | Partial lookup: " +
                data.trace_errors.length +
                " wallet lookup(s) returned an error.";
        }
    }


    /* -----------------------------------------------------
       RISK MODIFIERS
       ----------------------------------------------------- */

    const risk =
        document.getElementById(
            "reportRisk"
        );


    if (risk) {

        const modifiers =
            [];


        if (
            intelligence.mixer_detected
        ) {

            modifiers.push(
                "Mixer interaction"
            );
        }


        if (
            intelligence.bridge_detected
        ) {

            modifiers.push(
                "Cross-chain bridge"
            );
        }


        risk.innerText =
            modifiers.length > 0
                ? modifiers.join(
                    " • "
                )
                : "No additional uncertainty detected";
    }


    /* -----------------------------------------------------
       FINDINGS
       ----------------------------------------------------- */

    const findingsContainer =
        document.getElementById(
            "reportFindings"
        );


    if (
        findingsContainer
    ) {

        findingsContainer.innerHTML =
            "";


        const findings =
            intelligence.findings ||
            [];


        findings.forEach(
            finding => {

                const div =
                    document.createElement(
                        "div"
                    );


                div.className =
                    "report-finding";


                if (
                    finding.status ===
                    "warning"
                ) {

                    div.innerText =
                        "⚠ " +
                        finding.name;

                } else {

                    div.innerText =
                        "✓ " +
                        finding.name;
                }


                findingsContainer.appendChild(
                    div
                );
            }
        );
    }


    /* -----------------------------------------------------
       RAW TRANSACTION EVIDENCE
       ----------------------------------------------------- */

    const transactionContainer =
        document.getElementById(
            "transactionEvidence"
        );


    if (
        transactionContainer
    ) {

        transactionContainer.innerHTML = "";

        const transactions = data.transactions || [];
        const countLabel = document.getElementById("transactionCountLabel");

        if (countLabel) {
            countLabel.innerText =
                `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`;
        }

        const head = document.createElement("div");
        head.className = "transaction-table-head";
        ["Transaction", "From", "To", "Amount", "Chain"].forEach(label => {
            const cell = document.createElement("span");
            cell.innerText = label;
            head.appendChild(cell);
        });
        transactionContainer.appendChild(head);

        transactions.forEach(tx => {
            const row = document.createElement("div");
            row.className = "transaction-row";

            const hash = document.createElement("span");
            hash.className = "tx-hash";
            hash.innerText = tx.tx_hash || "Unknown";

            const from = document.createElement("span");
            from.className = "tx-address";
            from.innerText = tx.from || "Unknown";

            const to = document.createElement("span");
            to.className = "tx-address";
            to.innerText = tx.to || "Unknown";

            const amount = document.createElement("span");
            amount.className = "tx-amount";
            amount.innerText = tx.amount ?? "Unknown";

            const chain = document.createElement("span");
            chain.className = "tx-chain";
            chain.innerText = tx.chain || "Unknown";

            row.append(hash, from, to, amount, chain);
            transactionContainer.appendChild(row);
        });
    }


    /* -----------------------------------------------------
       REPORT STATUS
       ----------------------------------------------------- */

    const reportStatus =
        document.getElementById(
            "reportStatus"
        );


    if (
        reportStatus
    ) {

        reportStatus.innerText =
            intelligence.candidate_vasp &&
            intelligence.candidate_vasp !==
            "INCONCLUSIVE"

                ? "Candidate Attribution"

                : "Inconclusive";
    }


    /* -----------------------------------------------------
       SCROLL TO REPORT
       ----------------------------------------------------- */

    document
        .getElementById("report")
        .scrollIntoView({
            behavior:
                "smooth"
        });
}