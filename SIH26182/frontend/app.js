let investigationData = null;
let activeGraph = null;
let flowOverlayFrame = null;
let graphSearchPulse = null;
let graphMotionFrame = null;
let graphMotionLast = 0;

const scenarios = {
    normal: { wallet: "0xABC" },
    difficult: { wallet: "0xMIXABC" },
    real: { wallet: "0x8EB8fd3df2F6203C17e9B9218FB5b5B309344c13" }
};

const COLORS = {
    start: "#ff5c7a",
    wallet: "#38bdf8",
    deposit: "#f5b942",
    hot: "#22c55e",
    vasp: "#ffffff",
    mixer: "#f97316",
    bridge: "#a855f7",
    destination: "#60a5fa"
};

function changeScenario() {
    const scenario = document.getElementById("scenarioSelect").value;
    const walletInput = document.getElementById("walletInput");
    walletInput.value = scenarios[scenario]?.wallet || "";
}

async function startInvestigation() {
    const wallet = document.getElementById("walletInput").value.trim();
    if (!wallet) { alert("Enter a wallet address"); return; }

    const results = document.getElementById("results");
    const button = document.getElementById("traceButton");
    results.classList.remove("hidden");
    document.getElementById("report").classList.add("hidden");
    document.getElementById("traceStatus").innerText = "TRACING...";
    document.getElementById("graphStatus").innerText = "Collecting blockchain evidence...";
    button.disabled = true;
    button.innerHTML = "TRACING <span class=\"spinner\"></span>";

    try {
        const response = await fetch(`/investigate/${encodeURIComponent(wallet)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Investigation failed");
        const data = await response.json();
        investigationData = data;
        renderInvestigation(data, wallet);
    } catch (error) {
        console.error(error);
        document.getElementById("traceStatus").innerText = "API ERROR";
        document.getElementById("graphStatus").innerText = "Unable to retrieve transaction data";
        renderFailure(error);
    } finally {
        button.disabled = false;
        button.innerHTML = "TRACE FUNDS <span>→</span>";
    }
}

function renderInvestigation(data, wallet) {
    const intelligence = data.intelligence || {};
    const confidence = Number(intelligence.confidence ?? 0);
    const level = intelligence.confidence_level || levelFromScore(confidence);

    document.getElementById("dataSource").innerText = data.source || "LIVE DATA";
    document.getElementById("txCount").innerText = data.transaction_count ?? (data.transactions || []).length;
    document.getElementById("addressCount").innerText = data.address_count ?? 0;
    document.getElementById("clusterCount").innerText = data.cluster_count ?? 0;
    document.getElementById("traceStatus").innerText = data.trace_status || (data.source === "DEMO DATA" ? "COMPLETE" : "UNKNOWN");
    document.getElementById("graphStatus").innerText = data.trace_status === "PARTIAL" ? "Partial graph — some lookups unavailable" : "Evidence graph ready";

    drawGraph(data.transactions || [], wallet, data);
    renderFindings(intelligence.findings || []);
    renderAttribution(intelligence, confidence, level);
    renderCandidates(data.vasp_candidates || []);
    renderTrailBreaks(data.trail_breaks || data.investigation_report?.trail_breaks || [], intelligence);
    renderQuality(data);
}

function renderFailure(error) {
    renderFindings([{ name: error.message || "Investigation failed", status: "warning" }]);
    renderAttribution({ candidate_vasp: "INCONCLUSIVE", confidence: 0 }, 0, "INCONCLUSIVE");
    renderCandidates([]);
    renderTrailBreaks([], {});
    renderQuality({ trace_status: "ERROR", trace_errors: [error.message] });
}

function renderFindings(findings) {
    const container = document.getElementById("findingsList");
    container.innerHTML = "";
    document.getElementById("findingCount").innerText = findings.length;
    if (!findings.length) {
        container.appendChild(makeEmpty("No additional findings returned."));
        return;
    }
    findings.forEach(finding => {
        const item = document.createElement("div");
        item.className = `finding-item ${finding.status === "warning" ? "warning" : "positive"}`;
        item.innerHTML = `<span class="finding-icon">${finding.status === "warning" ? "!" : "✓"}</span><div><strong>${escapeHtml(finding.name || "Observation")}</strong>${finding.details ? `<small>${escapeHtml(finding.details)}</small>` : ""}</div>`;
        container.appendChild(item);
    });
}

function renderAttribution(intelligence, confidence, level) {
    document.getElementById("vaspName").innerText = intelligence.candidate_vasp || "INCONCLUSIVE";
    document.getElementById("confidenceValue").innerText = `${confidence}%`;
    document.getElementById("confidenceLevel").innerText = level;
    document.getElementById("confidenceLevel").className = `level-pill level-${String(level).toLowerCase()}`;
    document.getElementById("confidenceBar").style.width = `${Math.max(0, Math.min(100, confidence))}%`;
    document.getElementById("scoreType").innerText = intelligence.score_type || "Evidence-based";
    document.getElementById("confidenceExplanation").innerText = intelligence.score_explanation || "Score is based on observable blockchain evidence.";

    const breakdown = document.getElementById("scoreBreakdown");
    breakdown.innerHTML = "";
    const values = intelligence.evidence_breakdown || {};
    const labels = {
        transaction_activity: "Transaction activity",
        graph_coverage: "Graph coverage",
        flow_continuity: "Flow continuity",
        behavioral_clustering: "Behavioral clustering",
        deposit_behavior: "Deposit behavior",
        hot_wallet_behavior: "Hot-wallet behavior",
        external_vasp_evidence: "External VASP evidence"
    };
    Object.entries(values).forEach(([key, value]) => {
        const row = document.createElement("div");
        const pct = Math.round(Number(value) * 100);
        row.innerHTML = `<span>${escapeHtml(labels[key] || key)}</span><div class="mini-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div><b>${pct}%</b>`;
        breakdown.appendChild(row);
    });
}

function renderCandidates(candidates) {
    const container = document.getElementById("vaspCandidates");
    container.innerHTML = "";
    if (!candidates.length) {
        container.appendChild(makeEmpty("No externally supported VASP candidate was established."));
        return;
    }
    candidates.slice(0, 5).forEach(candidate => {
        const item = document.createElement("div");
        item.className = "candidate-item";
        const evidenceCount = (candidate.evidence || []).length;
        item.innerHTML = `<div class="candidate-rank">#${candidate.rank || "—"}</div><div class="candidate-main"><strong>${escapeHtml(candidate.vasp || "Unknown")}</strong><small>${evidenceCount} evidence item(s) · ${(candidate.addresses || []).length} matched address(es)</small></div><div class="candidate-score">${candidate.score ?? 0}</div>`;
        container.appendChild(item);
    });
}

function renderTrailBreaks(breaks, intelligence) {
    const container = document.getElementById("trailBreaks");
    container.innerHTML = "";
    if (!breaks.length && !intelligence.mixer_detected && !intelligence.bridge_detected) {
        container.appendChild(makeEmpty("No mixer or bridge trail-break was detected."));
        return;
    }

    // Group repeated intelligence messages so the same signal is shown once.
    // This is UI-only: underlying evidence, addresses and scoring are unchanged.
    const grouped = new Map();
    breaks.forEach(item => {
        const type = String(item.type || "trail").toLowerCase();
        const reason = String(item.reason || "Trail uncertainty detected");
        const key = `${type}|${reason}`;
        if (!grouped.has(key)) grouped.set(key, { ...item, _count: 0 });
        grouped.get(key)._count += 1;
    });

    Array.from(grouped.values()).slice(0, 8).forEach(item => {
        const row = document.createElement("div");
        row.className = `trail-item ${item.type === "mixer" ? "danger" : item.type === "bridge" ? "caution" : "neutral"}`;
        const countText = item._count > 1 ? ` · ${item._count} observed address(es)` : "";
        row.innerHTML = `<span class="trail-icon">${item.type === "mixer" ? "⚠" : item.type === "bridge" ? "↗" : "•"}</span><div><strong>${escapeHtml((item.type || "Trail").toUpperCase())}</strong><small>${escapeHtml(item.reason || "Trail uncertainty detected")}${escapeHtml(countText)}</small></div>`;
        container.appendChild(row);
    });
}
function renderQuality(data) {
    const report = data.investigation_report || {};
    const quality = report.data_quality || {};
    const publicLabels = data.public_label_intelligence || {};
    const rows = [
        ["Blockchain activity", (data.transaction_count ?? 0) > 0, `${data.transaction_count ?? 0} transaction edge(s)`],
        ["Trace completeness", data.trace_status !== "PARTIAL" && data.trace_status !== "ERROR", data.trace_status || "UNKNOWN"],
        ["External intelligence", Boolean(data.external_intelligence?.length), data.external_intelligence?.length ? "Supporting data returned" : "Not available"],
        ["Public label intelligence", Boolean(data.public_label_intelligence), data.public_label_intelligence ? `${publicLabels.matched_addresses ?? 0} traced address(es) matched` : "Demo path unchanged"],
        ["Evidence report", Boolean(data.investigation_report), data.investigation_report ? "Generated" : "Demo-compatible report"],
    ];
    const container = document.getElementById("dataQuality");
    container.innerHTML = "";
    rows.forEach(([label, ok, detail]) => {
        const row = document.createElement("div");
        row.className = "quality-item";
        row.innerHTML = `<span class="quality-icon ${ok ? "ok" : "warn"}">${ok ? "✓" : "!"}</span><div><strong>${label}</strong><small>${escapeHtml(detail)}</small></div>`;
        container.appendChild(row);
    });
    if (quality.trace_errors || data.trace_errors?.length) {
        const row = document.createElement("div");
        row.className = "quality-note";
        row.textContent = `${quality.trace_errors ?? data.trace_errors?.length ?? 0} lookup issue(s) retained as uncertainty.`;
        container.appendChild(row);
    }
}

function drawGraph(transactions, startingWallet, analysisData = {}) {
    if (graphMotionFrame) { cancelAnimationFrame(graphMotionFrame); graphMotionFrame = null; }
    graphMotionLast = 0;
    if (graphSearchPulse) { clearInterval(graphSearchPulse); graphSearchPulse = null; }
    if (activeGraph) activeGraph.destroy();

    const graphEl = document.getElementById("graph");
    const popup = document.getElementById("graphPopup");
    const popupContent = document.getElementById("graphPopupContent");
    const popupClose = document.getElementById("graphPopupClose");
    const intelligence = analysisData.intelligence || {};
    const classifications = new Map(
        (analysisData.node_classification || []).map(x => [String(x.address || "").toLowerCase(), x])
    );
    const matchedSet = new Set(
        (intelligence.matched_addresses || []).map(x => String(x).toLowerCase())
    );
    const vaspName = intelligence.candidate_vasp ||
        analysisData.vasp_candidates?.[0]?.vasp || "VASP";

    const nodes = new Set();
    const displayAddresses = new Map();
    const elements = [];
    const MAX_VISUAL_NODES = 90;
    const MAX_VISUAL_EDGES = 80;

    function norm(value) { return String(value || "").toLowerCase(); }

    function inferType(address) {
        const key = norm(address);
        const classified = classifications.get(key);
        if (classified?.type) return classified.type;
        if (matchedSet.has(key)) return "vasp";
        if (key === norm(startingWallet)) return "start";
        if (key.includes("mixer") || key.includes("tornado")) return "mixer";
        if (key.includes("bridge")) return "bridge";
        if (key.startsWith("0xdep")) return "deposit";
        if (key.startsWith("0xhot")) return "hot";
        if (key.startsWith("0xdest")) return "destination";
        return "wallet";
    }

    function nodePriority(type) {
        return ({
            vasp: 100,
            start: 95,
            deposit: 90,
            hot: 88,
            mixer: 86,
            bridge: 86,
            destination: 82,
            wallet: 20
        })[type] || 10;
    }

    function addNode(address) {
        if (!address) return false;
        const key = norm(address);
        if (nodes.has(key)) return true;
        if (nodes.size >= MAX_VISUAL_NODES) return false;
        const type = inferType(key);
        const cls = classifications.get(key);
        const isVasp = matchedSet.has(key) || type === "vasp";
        nodes.add(key);
        displayAddresses.set(key, String(address));
        elements.push({
            data: {
                id: key,
                address: String(address),
                type,
                label: nodeTypeLabel(type),
                reason: cls?.reason || nodeReason(type),
                vaspMatch: isVasp,
                vaspName: isVasp ? vaspName : ""
            }
        });
        return true;
    }

    // IMPORTANT: reserve VASP infrastructure before admitting ordinary wallets.
    // The previous version filled the 90-node visual budget with wallets first,
    // so the white VASP node could disappear from the graph.
    const priorityAddresses = [];
    priorityAddresses.push(String(startingWallet));
    matchedSet.forEach(a => priorityAddresses.push(a));
    (analysisData.node_classification || [])
        .slice()
        .sort((a, b) => nodePriority(b.type) - nodePriority(a.type))
        .forEach(x => priorityAddresses.push(x.address));

    Array.from(new Set(priorityAddresses.filter(Boolean))).forEach(addNode);

    // Prefer transaction edges that connect the investigation target or an important
    // infrastructure node. This keeps the visible graph informative without drawing
    // hundreds of lines.
    const txRows = (transactions || [])
        .map((tx, index) => ({ tx, index }))
        .filter(({tx}) => tx?.from && tx?.to);

    txRows.sort((a, b) => {
        const score = ({tx}) => {
            const s = nodePriority(inferType(tx.from)) + nodePriority(inferType(tx.to));
            return s + (norm(tx.from) === norm(startingWallet) ? 80 : 0)
                     + (matchedSet.has(norm(tx.to)) || matchedSet.has(norm(tx.from)) ? 70 : 0);
        };
        return score(b) - score(a) || a.index - b.index;
    });

    let visibleEdgeCount = 0;
    txRows.forEach(({tx, index}) => {
        if (visibleEdgeCount >= MAX_VISUAL_EDGES) return;
        const a = norm(tx.from), b = norm(tx.to);
        const missing = (nodes.has(a) ? 0 : 1) + (nodes.has(b) ? 0 : 1);
        if (nodes.size + missing > MAX_VISUAL_NODES) return;
        addNode(tx.from);
        addNode(tx.to);

        elements.push({
            data: {
                id: tx.tx_hash || `edge-${index}`,
                source: a,
                target: b,
                amount: tx.amount ?? "Unknown",
                chain: tx.chain || "Unknown",
                tx_hash: tx.tx_hash || "Unknown",
                from: a,
                to: b,
                edgeType: inferType(b),
                token: tx.token || "",
                timestamp: tx.timestamp || ""
            }
        });
        visibleEdgeCount += 1;
    });

    // Deterministic, investigation-oriented layout:
    // VASP stays in the middle, important infrastructure sits around it,
    // and ordinary wallets occupy clean upper/lower rows.
    const positions = new Map();
    const mainTypes = new Set(["start", "vasp", "deposit", "hot", "mixer", "bridge", "destination"]);
    const mainNodes = Array.from(nodes).filter(a => mainTypes.has(inferType(a)));
    const walletNodes = Array.from(nodes).filter(a => inferType(a) === "wallet");

    const CENTER_X = 620;
    const CENTER_Y = 285;
    const MAIN_X = {
        start: 115,
        mixer: 330,
        bridge: 470,
        vasp: CENTER_X,
        deposit: 780,
        hot: 920,
        destination: 1060
    };

    const grouped = new Map();
    mainNodes.forEach(address => {
        const type = inferType(address);
        if (!grouped.has(type)) grouped.set(type, []);
        grouped.get(type).push(address);
    });

    grouped.forEach((items, type) => {
        items.sort((a,b) => String(a).localeCompare(String(b)));
        const x = MAIN_X[type] ?? CENTER_X;
        const gap = type === "vasp" ? 82 : 72;
        const startY = CENTER_Y - ((items.length - 1) * gap) / 2;
        items.forEach((address, i) => {
            positions.set(address, { x, y: startY + i * gap });
        });
    });

    // Wallets are deliberately kept on two clean rails. Their x positions are
    // evenly distributed so a real-wallet graph remains readable.
    walletNodes.sort((a,b) => {
        const da = classifications.get(norm(a)), db = classifications.get(norm(b));
        return String(da?.address || a).localeCompare(String(db?.address || b));
    });
    const top = [], bottom = [];
    walletNodes.forEach((address, i) => (i % 2 === 0 ? top : bottom).push(address));

    function placeRail(items, y) {
        if (!items.length) return;
        const left = 95, right = 1080;
        const step = items.length === 1 ? 0 : (right - left) / (items.length - 1);
        items.forEach((address, i) => {
            positions.set(address, {
                x: items.length === 1 ? CENTER_X : left + i * step,
                y
            });
        });
    }
    placeRail(top, 95);
    placeRail(bottom, 475);

    // Fallback for any node not classified above.
    let fallbackIndex = 0;
    nodes.forEach(address => {
        if (!positions.has(address)) {
            positions.set(address, {
                x: 120 + (fallbackIndex % 8) * 135,
                y: 180 + Math.floor(fallbackIndex / 8) * 70
            });
            fallbackIndex++;
        }
    });

    elements.forEach(element => {
        if (element.data.address) {
            element.position = positions.get(norm(element.data.address));
        }
    });

    const cy = cytoscape({
        container: graphEl,
        elements,
        style: [
            {
                selector: "node",
                style: {
                    "background-color": COLORS.wallet,
                    "label": "data(label)",
                    "color": "#eaf2ff",
                    "text-valign": "center",
                    "text-halign": "center",
                    "font-size": 8,
                    "font-weight": 700,
                    "text-wrap": "wrap",
                    "text-max-width": 78,
                    "width": 44,
                    "height": 44,
                    "border-width": 2,
                    "border-color": "#41617d",
                    "opacity": 0.9,
                    "overlay-opacity": 0
                }
            },
            { selector: 'node[type="start"]', style: { "background-color": COLORS.start, "border-color": "#ffb1c0", "border-width": 4, "width": 58, "height": 58, "opacity": 1 } },
            { selector: 'node[type="deposit"]', style: { "background-color": COLORS.deposit, "border-color": "#ffe08a", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="hot"]', style: { "background-color": COLORS.hot, "border-color": "#8bf0bd", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="vasp"]', style: { "background-color": "#f5f8ff", "color": "#08111f", "border-color": "#ffffff", "border-width": 5, "width": 58, "height": 58, "opacity": 1 } },
            { selector: 'node[type="mixer"]', style: { "background-color": COLORS.mixer, "border-color": "#ffb16f", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="bridge"]', style: { "background-color": COLORS.bridge, "border-color": "#d2b7ff", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="destination"]', style: { "background-color": COLORS.destination, "border-color": "#a9dcff", "border-width": 3, "opacity": 1 } },

            // Search highlighting uses direct style changes below instead of
            // CSS animation, which is much cheaper on dense graphs.
            { selector: "node.search-hit", style: { "border-width": 7, "border-color": "#ffffff", "overlay-color": "#ffffff", "overlay-opacity": 0.18, "opacity": 1 } },
            { selector: "edge.search-hit", style: { "width": 5, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } },
            { selector: "node:selected", style: { "border-width": 6, "border-color": "#ffffff", "opacity": 1 } },
            {
                selector: "edge",
                style: {
                    "width": 1.5,
                    "line-color": "#3c5875",
                    "target-arrow-color": "#3c5875",
                    "target-arrow-shape": "triangle",
                    "curve-style": "straight",
                    "opacity": 0.34
                }
            },
            { selector: 'edge[edgeType="deposit"]', style: { "line-color": COLORS.deposit, "target-arrow-color": COLORS.deposit, "opacity": 0.55 } },
            { selector: 'edge[edgeType="hot"]', style: { "line-color": COLORS.hot, "target-arrow-color": COLORS.hot, "opacity": 0.62 } },
            { selector: 'edge[edgeType="vasp"]', style: { "line-color": COLORS.vasp, "target-arrow-color": COLORS.vasp, "opacity": 0.72 } },
            { selector: 'edge[edgeType="mixer"]', style: { "line-color": COLORS.mixer, "target-arrow-color": COLORS.mixer, "opacity": 0.68 } },
            { selector: 'edge[edgeType="bridge"]', style: { "line-color": COLORS.bridge, "target-arrow-color": COLORS.bridge, "opacity": 0.68 } },
            { selector: "edge:selected", style: { "width": 4, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } }
        ],
        layout: {
            name: "preset",
            fit: true,
            padding: 50
        },
        minZoom: 0.45,
        maxZoom: 2.5,
        pixelRatio: 1
    });

    activeGraph = cy;
    document.getElementById("graphEmpty").classList.toggle("hidden", transactions.length > 0);

    // One tiny canvas animation layer. It follows the real Cytoscape edge
    // positions, so dragging a node immediately changes the particle path.
    const motionCanvas = document.createElement("canvas");
    motionCanvas.className = "graph-motion-canvas";
    motionCanvas.setAttribute("aria-hidden", "true");
    graphEl.appendChild(motionCanvas);
    const motionCtx = motionCanvas.getContext("2d", { alpha: true });
    const motionEdges = cy.edges().slice(0, Math.min(8, cy.edges().length));
    const particles = motionEdges.map((edge, index) => ({
        edge,
        offset: index / Math.max(1, motionEdges.length),
        speed: 0.000035 + (index % 3) * 0.000009
    }));

    function resizeMotionCanvas() {
        const rect = graphEl.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.15);
        motionCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
        motionCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
        motionCanvas.style.width = `${rect.width}px`;
        motionCanvas.style.height = `${rect.height}px`;
        motionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawMotion(now = performance.now()) {
        if (!motionCtx) return;
        if (document.hidden) {
            graphMotionFrame = null;
            return;
        }
        const rect = graphEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        // ~18 FPS is intentional: enough motion to feel alive without
        // continuously consuming a laptop CPU/GPU core.
        if (now - graphMotionLast < 55) {
            graphMotionFrame = requestAnimationFrame(drawMotion);
            return;
        }
        graphMotionLast = now;
        motionCtx.clearRect(0, 0, rect.width, rect.height);

        particles.forEach(p => {
            if (!p.edge || p.edge.removed()) return;
            const source = p.edge.source().renderedPosition();
            const target = p.edge.target().renderedPosition();
            if (!source || !target) return;

            const t = (now * p.speed + p.offset) % 1;
            const x = source.x + (target.x - source.x) * t;
            const y = source.y + (target.y - source.y) * t;
            const dx = target.x - source.x, dy = target.y - source.y;
            const len = Math.hypot(dx, dy) || 1;

            // Small glow only; no shadow on the whole edge.
            motionCtx.beginPath();
            motionCtx.arc(x, y, 2, 0, Math.PI * 2);
            motionCtx.fillStyle = "rgba(225,248,255,0.95)";
            motionCtx.fill();

            motionCtx.beginPath();
            motionCtx.moveTo(x - (dx / len) * 9, y - (dy / len) * 9);
            motionCtx.lineTo(x, y);
            motionCtx.lineWidth = 1.4;
            motionCtx.strokeStyle = "rgba(125,215,255,0.48)";
            motionCtx.stroke();
        });

        graphMotionFrame = requestAnimationFrame(drawMotion);
    }

    resizeMotionCanvas();
    cy.on("resize", resizeMotionCanvas);
    cy.on("zoom pan", () => {
        if (!graphMotionFrame) graphMotionFrame = requestAnimationFrame(drawMotion);
    });
    graphMotionFrame = requestAnimationFrame(drawMotion);

    function showPopup(title, rows, element) {
        popupContent.innerHTML = "";
        const kicker = document.createElement("div");
        kicker.className = "popup-kicker";
        kicker.textContent = title;
        popupContent.appendChild(kicker);
        rows.forEach(row => {
            const div = document.createElement("div");
            div.className = "popup-row";
            div.innerHTML = `<strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(String(row.value ?? "Unknown"))}</span>`;
            popupContent.appendChild(div);
        });
        cy.elements().unselect();
        element.select();
        popup.classList.remove("hidden");
    }

    function closePopup() {
        popup.classList.add("hidden");
        cy.elements().unselect();
    }

    cy.on("tap", "node", event => {
        const n = event.target, d = n.data();
        showPopup("WALLET / ENTITY", [
            ["Type", nodeTypeLabel(d.type)],
            ["Address", d.address],
            ["VASP", d.vaspMatch ? d.vaspName : "—"],
            ["Incoming", n.incomers("edge").length],
            ["Outgoing", n.outgoers("edge").length],
            ["Why classified", d.reason || "Observed address"]
        ], n);
    });

    cy.on("tap", "edge", event => {
        const e = event.target, d = e.data();
        showPopup("TRANSACTION EVIDENCE", [
            ["TX Hash", d.tx_hash],
            ["From", d.from],
            ["To", d.to],
            ["Amount", d.amount],
            ["Chain", d.chain],
            ["Token", d.token || "Native"],
            ["Block / Time", d.timestamp || "Not supplied"]
        ], e);
    });

    cy.on("tap", event => { if (event.target === cy) closePopup(); });
    popupClose.onclick = closePopup;

    function clearGraphSearch() {
        if (graphSearchPulse) {
            clearInterval(graphSearchPulse);
            graphSearchPulse = null;
        }
        cy.elements().removeClass("search-hit");
        cy.elements().removeStyle();
        const input = document.getElementById("graphSearchInput");
        const clear = document.getElementById("graphSearchClear");
        const count = document.getElementById("graphSearchCount");
        if (input) input.value = "";
        if (clear) clear.classList.add("hidden");
        if (count) {
            count.textContent = "";
            count.className = "graph-search-count";
        }
    }

    function runGraphSearch() {
        const input = document.getElementById("graphSearchInput");
        const clear = document.getElementById("graphSearchClear");
        const count = document.getElementById("graphSearchCount");
        const term = (input?.value || "").trim().toLowerCase();

        if (graphSearchPulse) {
            clearInterval(graphSearchPulse);
            graphSearchPulse = null;
        }
        cy.elements().removeClass("search-hit");
        cy.elements().removeStyle();

        if (!term) {
            if (clear) clear.classList.add("hidden");
            if (count) {
                count.textContent = "";
                count.className = "graph-search-count";
            }
            return;
        }
        if (clear) clear.classList.remove("hidden");

        const aliases = {
            vasp: ["vasp"],
            exchange: ["vasp"],
            hot: ["hot"],
            "hot wallet": ["hot"],
            hotwallet: ["hot"],
            deposit: ["deposit"],
            wallet: ["wallet"],
            investigated: ["start"],
            start: ["start"],
            mixer: ["mixer"],
            bridge: ["bridge"],
            destination: ["destination"]
        };
        const types = aliases[term] || [];

        const matches = cy.nodes().filter(n => {
            const d = n.data();
            const text = [
                d.type, nodeTypeLabel(d.type), d.address, d.reason, d.vaspName
            ].join(" ").toLowerCase();
            return types.length ? types.includes(String(d.type).toLowerCase()) : text.includes(term);
        });

        const edgeMatches = cy.edges().filter(e => {
            const d = e.data();
            return [
                d.tx_hash, d.from, d.to, d.amount, d.chain, d.token,
                d.edgeType, nodeTypeLabel(d.edgeType)
            ].join(" ").toLowerCase().includes(term);
        });

        const matchedElements = matches.union(edgeMatches);

        if (!matchedElements.length) {
            if (count) {
                count.textContent = "No match";
                count.className = "graph-search-count none";
            }
            return;
        }

        matchedElements.addClass("search-hit");
        cy.elements().not(matchedElements).style("opacity", 0.12);
        matchedElements.style("opacity", 1);
        if (count) {
            count.textContent = `${matchedElements.length} match${matchedElements.length === 1 ? "" : "es"}`;
            count.className = "graph-search-count match";
        }

        // Cheap deterministic blinking: only the already matched elements change.
        let on = true;
        graphSearchPulse = setInterval(() => {
            on = !on;
            if (on) {
                matches.style({
                    "border-width": 7,
                    "border-color": "#ffffff",
                    "overlay-opacity": 0.18
                });
                edgeMatches.style({
                    "width": 5,
                    "line-color": "#ffffff",
                    "target-arrow-color": "#ffffff"
                });
            } else {
                matches.style({
                    "border-width": 3,
                    "border-color": "#9fdfff",
                    "overlay-opacity": 0.02
                });
                edgeMatches.style({
                    "width": 2,
                    "opacity": 0.72
                });
            }
        }, 500);

        cy.animate({ fit: { eles: matchedElements, padding: 90 }, duration: 280 });
    }

    const searchInput = document.getElementById("graphSearchInput");
    const searchButton = document.getElementById("graphSearchBtn");
    const searchClear = document.getElementById("graphSearchClear");
    if (searchButton) searchButton.onclick = runGraphSearch;
    if (searchInput) {
        searchInput.oninput = () => {
            if (!searchInput.value.trim()) clearGraphSearch();
        };
        searchInput.onkeydown = event => {
            if (event.key === "Enter") {
                event.preventDefault();
                runGraphSearch();
            } else if (event.key === "Escape") {
                clearGraphSearch();
            }
        };
    }
    if (searchClear) searchClear.onclick = clearGraphSearch;

    // No continuous physics simulation here. The graph is deterministic and
    // readable; Cytoscape still updates every edge geometrically when a node
    // is dragged, so lines naturally stretch and follow the node.
    cy.on("dragfree", "node", event => {
        const node = event.target;
        node.connectedEdges().style("opacity", 0.72);
        setTimeout(() => {
            if (!node.removed()) node.connectedEdges().removeStyle("opacity");
        }, 180);
    });

    setTimeout(() => {
        cy.resize();
        cy.fit(undefined, 50);
    }, 80);
}

function fitGraph() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.fit(undefined, 55); } }
function resetGraphView() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.fit(undefined, 50); } }

async function toggleGraphFullscreen() {
    const stage = document.getElementById("graphStage");
    try {
        if (!document.fullscreenElement) {
            if (stage.requestFullscreen) await stage.requestFullscreen(); else stage.classList.add("graph-fullscreen");
        } else if (document.exitFullscreen) await document.exitFullscreen();
    } catch { stage.classList.toggle("graph-fullscreen"); }
    setTimeout(() => { if (activeGraph) activeGraph.resize(); fitGraph(); }, 150);
}

document.addEventListener("fullscreenchange", () => {
    const button = document.getElementById("graphFullscreenBtn");
    if (button) button.innerText = document.fullscreenElement ? "⛶ EXIT FULL SCREEN" : "⛶ FULL SCREEN";
    setTimeout(() => { if (activeGraph) { activeGraph.resize(); fitGraph(); } }, 120);
});

function generateReport() {
    if (!investigationData) return;
    const data = investigationData;
    const intelligence = data.intelligence || {};
    document.getElementById("report").classList.remove("hidden");
    document.getElementById("reportWallet").innerText = data.wallet || "--";
    document.getElementById("reportVasp").innerText = intelligence.candidate_vasp || "INCONCLUSIVE";
    document.getElementById("reportConfidence").innerText = `${intelligence.confidence ?? 0}%`;
    document.getElementById("reportTransactions").innerText = data.transaction_count ?? (data.transactions || []).length;
    document.getElementById("reportSubtitle").innerText = data.investigation_report ? "Structured evidence report generated by the investigation engine." : "Controlled demonstration evidence rendered from the observed transaction path.";

    renderEvidenceChain(data, intelligence);
    renderReportFindings(intelligence.findings || []);
    document.getElementById("matchedVaspAddresses").innerText = (intelligence.matched_addresses || []).join(" • ") || "No infrastructure matched";
    document.getElementById("reportBasis").innerText = intelligence.score_explanation || "Observed transaction behavior and available intelligence.";
    const publicLabels = data.public_label_intelligence;
    const labelSource = publicLabels ? ` • Public label repository (${publicLabels.matched_addresses ?? 0} traced address match(es)${publicLabels.status ? `, ${publicLabels.status.toLowerCase()}` : ""})` : "";
    document.getElementById("reportSource").innerText = `${data.source || "Blockchain data"}${labelSource}${data.trace_errors?.length ? ` • ${data.trace_errors.length} lookup issue(s)` : ""}`;
    const risks = [];
    if (intelligence.mixer_detected) risks.push("Mixer interaction");
    if (intelligence.bridge_detected) risks.push("Cross-chain bridge");
    if (data.trace_errors?.length) risks.push("Partial downstream lookups");
    document.getElementById("reportRisk").innerText = risks.join(" • ") || "No additional uncertainty detected";
    const uncertainties = data.investigation_report?.uncertainties || [];
    document.getElementById("reportUncertainties").innerText = uncertainties.join(" • ") || (intelligence.candidate_vasp === "INCONCLUSIVE" ? "No reliable VASP attribution established." : "No additional uncertainty recorded.");
    renderTimeline(data);
    renderTransactions(data.transactions || []);
    document.getElementById("reportStatus").innerText = intelligence.candidate_vasp && intelligence.candidate_vasp !== "INCONCLUSIVE" ? "Candidate Attribution" : "Inconclusive";
    document.getElementById("report").scrollIntoView({behavior: "smooth", block: "start"});
}

function renderEvidenceChain(data, intelligence) {
    const container = document.getElementById("evidenceChain");
    container.innerHTML = "";
    const reportEvidence = data.investigation_report?.evidence || [];
    const txs = data.transactions || [];
    const steps = [];
    steps.push({title: "Investigated wallet", value: data.wallet, description: "Starting point for the trace."});
    const deposit = (data.deposit_analysis?.candidates || [])[0];
    if (deposit) steps.push({title: "Deposit-like behavior", value: deposit.address, description: (deposit.reasons || []).join(" • ")});
    const hot = (data.hot_wallet_analysis?.candidates || [])[0];
    if (hot) steps.push({title: "Hot-wallet candidate", value: hot.address, description: (hot.reasons || []).join(" • ")});
    const candidate = (data.vasp_candidates || [])[0];
    if (candidate) steps.push({title: "VASP attribution candidate", value: candidate.vasp, description: `${candidate.score ?? 0}/100 evidence score`});
    if (!candidate && intelligence.candidate_vasp && intelligence.candidate_vasp !== "INCONCLUSIVE") steps.push({title: "VASP attribution candidate", value: intelligence.candidate_vasp, description: "Controlled demonstration match."});
    if (intelligence.mixer_detected) steps.push({title: "Mixer trail break", value: "Uncertainty introduced", description: "Direct continuity is reduced."});
    if (intelligence.bridge_detected) steps.push({title: "Cross-chain trail break", value: "Chain transition detected", description: "Direct continuity across chains is reduced."});
    if (!steps.length) steps.push({title: "No evidence", value: "INCONCLUSIVE", description: "Insufficient observed evidence."});

    steps.forEach((step, index) => {
        const item = document.createElement("div"); item.className = "evidence-step";
        item.innerHTML = `<div class="evidence-marker">${index + 1}</div><div class="evidence-content"><strong>${escapeHtml(step.title)}</strong><b>${escapeHtml(String(step.value))}</b><small>${escapeHtml(step.description)}</small></div>`;
        container.appendChild(item);
    });
    if (!txs.length && !reportEvidence.length) container.appendChild(makeEmpty("No transaction evidence available."));
}

function renderReportFindings(findings) {
    const container = document.getElementById("reportFindings"); container.innerHTML = "";
    findings.forEach(f => { const div = document.createElement("div"); div.className = `report-finding ${f.status === "warning" ? "warning" : "positive"}`; div.textContent = `${f.status === "warning" ? "⚠" : "✓"} ${f.name}`; container.appendChild(div); });
    if (!findings.length) container.appendChild(makeEmpty("No findings returned."));
}

function renderTimeline(data) {
    const container = document.getElementById("investigationTimeline"); container.innerHTML = "";
    const txs = [...(data.transactions || [])].filter(x => x.timestamp).sort((a,b) => Number(a.timestamp) - Number(b.timestamp));
    if (!txs.length) { container.appendChild(makeEmpty("Transaction timestamps were not available.")); return; }
    txs.slice(0, 20).forEach((tx, index) => {
        const row = document.createElement("div"); row.className = "timeline-item";
        const date = new Date(Number(tx.timestamp) * 1000);
        row.innerHTML = `<div class="timeline-dot"></div><div class="timeline-time">${isNaN(date.getTime()) ? "Observed" : date.toLocaleString()}</div><div class="timeline-body"><strong>${escapeHtml(shortAddress(tx.from))} → ${escapeHtml(shortAddress(tx.to))}</strong><small>${escapeHtml(String(tx.amount ?? "Unknown"))} ${escapeHtml(tx.token || tx.chain || "")}</small></div>`;
        container.appendChild(row);
    });
}

function renderTransactions(transactions) {
    const container = document.getElementById("transactionEvidence"); container.innerHTML = "";
    document.getElementById("transactionCountLabel").innerText = `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`;
    if (!transactions.length) { container.appendChild(makeEmpty("No transaction evidence returned.")); return; }
    const table = document.createElement("div"); table.className = "tx-table-inner";
    const header = document.createElement("div"); header.className = "tx-row tx-head"; header.innerHTML = "<span>Transaction</span><span>From</span><span>To</span><span>Amount</span><span>Chain</span>"; table.appendChild(header);
    transactions.forEach(tx => {
        const row = document.createElement("div"); row.className = "tx-row";
        row.innerHTML = `<span class="tx-hash">${escapeHtml(tx.tx_hash || "Unknown")}</span><span class="mono">${escapeHtml(shortAddress(tx.from))}</span><span class="mono">${escapeHtml(shortAddress(tx.to))}</span><span>${escapeHtml(String(tx.amount ?? "Unknown"))}${tx.token ? ` ${escapeHtml(tx.token)}` : ""}</span><span class="chain-badge">${escapeHtml(tx.chain || "Unknown")}</span>`;
        row.addEventListener("click", () => focusTransaction(tx));
        table.appendChild(row);
    });
    container.appendChild(table);
}

function focusTransaction(tx) {
    if (!activeGraph) return;
    const edge = activeGraph.getElementById(tx.tx_hash);
    if (edge && edge.length) { activeGraph.elements().unselect(); edge.select(); activeGraph.animate({center: {eles: edge}, zoom: Math.max(activeGraph.zoom(), 1.1)}, {duration: 300}); }
}

function downloadInvestigationJSON() {
    if (!investigationData) return;
    const blob = new Blob([JSON.stringify(investigationData, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `sutradhar-investigation-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
}

async function copyEvidenceSummary() {
    if (!investigationData) return;
    const d = investigationData, i = d.intelligence || {};
    const text = `SUTRADHAR Investigation\nWallet: ${d.wallet}\nCandidate VASP: ${i.candidate_vasp || "INCONCLUSIVE"}\nEvidence score: ${i.confidence ?? 0}%\nTransactions: ${d.transaction_count ?? 0}\nStatus: ${d.trace_status || "COMPLETE"}\nBasis: ${i.score_explanation || "Observable blockchain evidence"}`;
    try { await navigator.clipboard.writeText(text); } catch { alert(text); }
}

function levelFromScore(score) { return score >= 75 ? "HIGH" : score >= 45 ? "MEDIUM" : score > 0 ? "LOW" : "INCONCLUSIVE"; }
function nodeTypeLabel(type) { return ({start:"Investigated Wallet", wallet:"Wallet", deposit:"Candidate Deposit Address", hot:"Hot Wallet Candidate", vasp:"VASP Infrastructure", mixer:"Mixer", bridge:"Cross-Chain Bridge", destination:"Destination Wallet"})[type] || "Wallet"; }
function nodeReason(type) { return ({start:"Investigation target", deposit:"Backend deposit-behavior detector", hot:"Backend consolidation-behavior detector", vasp:"External service intelligence match", mixer:"Mixer-like trail break", bridge:"Bridge-like trail break", destination:"Observed downstream destination"})[type] || "Observed blockchain address"; }
function shortAddress(value) { const s = String(value || "Unknown"); return s.length > 18 ? `${s.slice(0, 9)}…${s.slice(-6)}` : s; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function makeEmpty(text) { const d = document.createElement("div"); d.className = "empty-state"; d.textContent = text; return d; }
