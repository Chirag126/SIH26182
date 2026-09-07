let investigationData = null;

const scenarios = {
    normal: {
        wallet: "0xABC"
    },

    difficult: {
        wallet: "0xMIXABC"
    },

    real: {
        wallet: ""
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
            walletInput.value = "";
            walletInput.placeholder = "Enter a real crypto address";
            walletInput.focus();
        } else {
            walletInput.value = scenarios[scenario].wallet;
            walletInput.placeholder = "Enter wallet address";
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
            "COMPLETE";

        document.getElementById("graphStatus").innerText =
            "Transaction graph generated";


        /* ---------------- GRAPH ---------------- */

        drawGraph(
            data.transactions || [],
            wallet
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
            "Confidence is based on observable transaction evidence.";

        if (
            intelligence.mixer_detected
        ) {
            explanation +=
                " Mixer interaction reduced confidence.";
        }

        if (
            intelligence.bridge_detected
        ) {
            explanation +=
                " Cross-chain movement introduced additional uncertainty.";
        }

        if (
            candidateVasp !==
            "INCONCLUSIVE"
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
    startingWallet
) {

    const elements = [];
    const addedNodes = new Set();


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
            normalized.startsWith("0XDEP")
        ) {

            type =
                "deposit";

        }

        else if (
            normalized.startsWith("0XHOT")
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

                label: "",

                address: address,

                type: type
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
                        tx.to
                }
            });
        }
    );


    /* -----------------------------------------------------
       CREATE CYTOSCAPE
       ----------------------------------------------------- */

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


                /* ---------- NORMAL EDGE ---------- */

                {
                    selector:
                        "edge",

                    style: {

                        "width":
                            2,

                        "line-color":
                            "#65728f",

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
       GRAPH TOOLTIP
       ===================================================== */

    let tooltip =
        document.getElementById(
            "graphTooltip"
        );


    if (!tooltip) {

        tooltip =
            document.createElement(
                "div"
            );

        tooltip.id =
            "graphTooltip";

        document.body.appendChild(
            tooltip
        );
    }


    let pinnedElement =
        null;


    /* -----------------------------------------------------
       SHOW TOOLTIP
       ----------------------------------------------------- */

    function showTooltip(
        content,
        position
    ) {

        tooltip.innerHTML =
            "";


        content.forEach(
            item => {

                const row =
                    document.createElement(
                        "div"
                    );

                const label =
                    document.createElement(
                        "strong"
                    );

                const value =
                    document.createElement(
                        "span"
                    );


                label.textContent =
                    item.label + ": ";

                value.textContent =
                    item.value;


                row.appendChild(
                    label
                );

                row.appendChild(
                    value
                );

                tooltip.appendChild(
                    row
                );
            }
        );


        tooltip.style.display =
            "block";


        const graphRect =
            document
                .getElementById(
                    "graph"
                )
                .getBoundingClientRect();


        tooltip.style.left =
            (
                graphRect.left +
                position.x +
                15
            ) + "px";


        tooltip.style.top =
            (
                graphRect.top +
                position.y +
                15
            ) + "px";
    }


    /* -----------------------------------------------------
       HIDE TOOLTIP
       ----------------------------------------------------- */

    function hideTooltip() {

        tooltip.style.display =
            "none";
    }


    /* -----------------------------------------------------
       NODE INFORMATION
       ----------------------------------------------------- */

    function getNodeInformation(
        node
    ) {

        const data =
            node.data();

        let type =
            "Wallet";


        if (
            data.type ===
            "start"
        ) {

            type =
                "Unknown / Investigated Wallet";
        }

        else if (
            data.type ===
            "deposit"
        ) {

            type =
                "Candidate Deposit Address";
        }

        else if (
            data.type ===
            "hot"
        ) {

            type =
                "VASP Hot Wallet";
        }

        else if (
            data.type ===
            "mixer"
        ) {

            type =
                "Mixer";
        }

        else if (
            data.type ===
            "bridge"
        ) {

            type =
                "Cross-Chain Bridge";
        }

        else if (
            data.type ===
            "destination"
        ) {

            type =
                "Destination Chain Wallet";
        }


        return [

            {
                label:
                    "Type",

                value:
                    type
            },

            {
                label:
                    "Address",

                value:
                    data.address
            },

            {
                label:
                    "Incoming",

                value:
                    node
                        .incomers("edge")
                        .length
            },

            {
                label:
                    "Outgoing",

                value:
                    node
                        .outgoers("edge")
                        .length
            }
        ];
    }


    /* -----------------------------------------------------
       EDGE INFORMATION
       ----------------------------------------------------- */

    function getEdgeInformation(
        edge
    ) {

        const data =
            edge.data();


        return [

            {
                label:
                    "Transaction",

                value:
                    data.tx_hash
            },

            {
                label:
                    "From",

                value:
                    data.from
            },

            {
                label:
                    "To",

                value:
                    data.to
            },

            {
                label:
                    "Amount",

                value:
                    data.amount
            },

            {
                label:
                    "Chain",

                value:
                    data.chain
            }
        ];
    }


    /* =====================================================
       NODE HOVER
       ===================================================== */

    cy.on(
        "mouseover",
        "node",
        function(event) {

            const node =
                event.target;


            /*
             * If something is already pinned,
             * don't let another hover replace it.
             */

            if (
                pinnedElement &&
                pinnedElement !== node
            ) {
                return;
            }


            node.addClass(
                "hovered"
            );


            showTooltip(
                getNodeInformation(
                    node
                ),
                node.renderedPosition()
            );
        }
    );


    /* =====================================================
       NODE MOUSEOUT
       ===================================================== */

    cy.on(
        "mouseout",
        "node",
        function(event) {

            const node =
                event.target;


            /*
             * Pinned details stay visible.
             */

            if (
                pinnedElement ===
                node
            ) {
                return;
            }


            node.removeClass(
                "hovered"
            );

            hideTooltip();
        }
    );


    /* =====================================================
       NODE CLICK
       ===================================================== */

    cy.on(
        "tap",
        "node",
        function(event) {

            const node =
                event.target;


            /*
             * Clicking the same node again
             * removes the pinned information.
             */

            if (
                pinnedElement ===
                node
            ) {

                pinnedElement =
                    null;

                node.removeClass(
                    "hovered"
                );

                hideTooltip();

                return;
            }


            /*
             * Remove previous pinned object.
             */

            if (
                pinnedElement
            ) {

                pinnedElement.removeClass(
                    "hovered"
                );
            }


            /*
             * Pin new node.
             */

            pinnedElement =
                node;

            node.addClass(
                "hovered"
            );


            showTooltip(
                getNodeInformation(
                    node
                ),
                node.renderedPosition()
            );
        }
    );


    /* =====================================================
       EDGE HOVER
       ===================================================== */

    cy.on(
        "mouseover",
        "edge",
        function(event) {

            const edge =
                event.target;


            if (
                pinnedElement &&
                pinnedElement !== edge
            ) {
                return;
            }


            edge.addClass(
                "hovered"
            );


            showTooltip(
                getEdgeInformation(
                    edge
                ),
                edge.renderedMidpoint()
            );
        }
    );


    /* =====================================================
       EDGE MOUSEOUT
       ===================================================== */

    cy.on(
        "mouseout",
        "edge",
        function(event) {

            const edge =
                event.target;


            if (
                pinnedElement ===
                edge
            ) {
                return;
            }


            edge.removeClass(
                "hovered"
            );

            hideTooltip();
        }
    );


    /* =====================================================
       EDGE CLICK
       ===================================================== */

       cy.on(
        "tap",
        "edge",
        function(event) {

            const edge =
                event.target;


            /*
             * Click same edge again = close.
             */

            if (
                pinnedElement ===
                edge
            ) {

                pinnedElement =
                    null;

                edge.removeClass(
                    "hovered"
                );

                hideTooltip();

                return;
            }


            /*
             * Remove previous pinned object.
             */

            if (
                pinnedElement
            ) {

                pinnedElement.removeClass(
                    "hovered"
                );
            }


            /*
             * Pin selected transaction.
             */

            pinnedElement =
                edge;

            edge.addClass(
                "hovered"
            );


            showTooltip(
                getEdgeInformation(
                    edge
                ),
                edge.renderedMidpoint()
            );
        }
    );


    /* =====================================================
       CLICK EMPTY GRAPH
       ===================================================== */

    cy.on(
        "tap",
        function(event) {

            if (
                event.target ===
                cy
            ) {

                if (
                    pinnedElement
                ) {

                    pinnedElement.removeClass(
                        "hovered"
                    );
                }


                pinnedElement =
                    null;

                hideTooltip();
            }
        }
    );


    /* =====================================================
       LEAVE GRAPH
       ===================================================== */

    document
        .getElementById("graph")
        .addEventListener(
            "mouseleave",
            function() {

                if (
                    !pinnedElement
                ) {

                    hideTooltip();
                }
            }
        );


    return cy;
}


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

    const container =
        document.getElementById(
            "evidenceChain"
        );


    if (!container) {
        return;
    }


    const stages =
        buildEvidenceChain(
            data,
            intelligence
        );


    container.innerHTML =
        "";


    /*
     * Main evidence-chain wrapper.
     */

    const wrapper =
        document.createElement(
            "div"
        );


    wrapper.style.display =
        "flex";

    wrapper.style.flexDirection =
        "column";

    wrapper.style.gap =
        "0";


    stages.forEach(
        (stage, index) => {

            const item =
                document.createElement(
                    "div"
                );


            item.style.display =
                "flex";

            item.style.alignItems =
                "stretch";


            /* ---------- NUMBER ---------- */

            const number =
                document.createElement(
                    "div"
                );


            number.innerText =
                index + 1;


            number.style.minWidth =
                "34px";

            number.style.height =
                "34px";

            number.style.borderRadius =
                "50%";

            number.style.display =
                "flex";

            number.style.alignItems =
                "center";

            number.style.justifyContent =
                "center";

            number.style.background =
                "#1d293d";

            number.style.border =
                "1px solid #52627f";

            number.style.color =
                "#ffffff";

            number.style.fontWeight =
                "700";


            /* ---------- CONTENT ---------- */

            const content =
                document.createElement(
                    "div"
                );


            content.style.marginLeft =
                "14px";

            content.style.paddingBottom =
                index ===
                stages.length - 1
                    ? "0"
                    : "18px";


            /* ---------- TITLE ---------- */

            const title =
                document.createElement(
                    "div"
                );


            title.innerText =
                stage.title;


            title.style.fontWeight =
                "700";

            title.style.fontSize =
                "14px";


            if (
                stage.type ===
                "warning"
            ) {

                title.style.color =
                    "#ffd166";

            } else if (
                stage.type ===
                "vasp"
            ) {

                title.style.color =
                    "#75e6ad";

            } else {

                title.style.color =
                    "#ffffff";
            }


            /* ---------- VALUE ---------- */

            const value =
                document.createElement(
                    "div"
                );


            value.innerText =
                stage.value;


            value.style.fontFamily =
                "monospace";

            value.style.fontSize =
                "12px";

            value.style.marginTop =
                "3px";

            value.style.wordBreak =
                "break-all";

            value.style.color =
                "#9ca8bd";


            /* ---------- DESCRIPTION ---------- */

            const description =
                document.createElement(
                    "div"
                );


            description.innerText =
                stage.description;


            description.style.fontSize =
                "11px";

            description.style.marginTop =
                "4px";

            description.style.color =
                "#65728f";


            content.appendChild(
                title
            );

            content.appendChild(
                value
            );

            content.appendChild(
                description
            );


            /* ---------- CONNECTOR ---------- */

            if (
                index <
                stages.length - 1
            ) {

                const connector =
                    document.createElement(
                        "div"
                    );


                connector.style.position =
                    "absolute";

                connector.style.left =
                    "16px";

                connector.style.marginTop =
                    "34px";

                connector.style.width =
                    "2px";

                connector.style.height =
                    "42px";

                connector.style.background =
                    "#39465e";
            }


            item.appendChild(
                number
            );

            item.appendChild(
                content
            );


            /*
             * Relative position allows
             * the evidence chain to remain
             * visually connected.
             */

            item.style.position =
                "relative";


            wrapper.appendChild(
                item
            );
        }
    );


    container.appendChild(
        wrapper
    );
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

                ? "Transaction behavior + deposit/hot-wallet relationship + external VASP intelligence."

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

        transactionContainer.innerHTML =
            "";


        const transactions =
            data.transactions ||
            [];


        transactions.forEach(
            tx => {

                const row =
                    document.createElement(
                        "div"
                    );


                row.className =
                    "transaction-row";


                const txHash =
                    tx.tx_hash ||
                    "Unknown";


                row.innerHTML = `
                    <span>${txHash}</span>
                    <span>${tx.from}</span>
                    <span>${tx.to}</span>
                    <span>${tx.amount ?? "Unknown"}</span>
                `;


                transactionContainer.appendChild(
                    row
                );
            }
        );
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