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
    graphEl.innerHTML = "";

    const intelligence = analysisData.intelligence || {};
    const classifications = new Map((analysisData.node_classification || []).map(x => [String(x.address).toLowerCase(), x]));
    const depositSet = new Set((analysisData.deposit_analysis?.candidates || []).map(x => String(x.address).toLowerCase()));
    const hotSet = new Set((analysisData.hot_wallet_analysis?.candidates || []).map(x => String(x.address).toLowerCase()));
    const matchedSet = new Set((intelligence.matched_addresses || []).map(x => String(x).toLowerCase()));
    const vaspName = intelligence.candidate_vasp || analysisData.vasp_candidates?.[0]?.vasp || "VASP";
    const startKey = String(startingWallet).toLowerCase();
    const MAX_VISUAL_NODES = 72;
    const MAX_VISUAL_EDGES = 76;
    const elements = [];
    const nodes = new Set();
    const txRecords = [];

    function keyOf(address) { return String(address || "").toLowerCase(); }
    function inferType(address) {
        const key = keyOf(address);
        if (key === startKey) return "start";
        if (matchedSet.has(key)) return "vasp";
        if (classifications.has(key)) return classifications.get(key).type || "wallet";
        if (depositSet.has(key) || key.startsWith("0xdep")) return "deposit";
        if (hotSet.has(key) || key.startsWith("0xhot")) return "hot";
        if (key === "mixer") return "mixer";
        if (key === "bridge") return "bridge";
        if (key.startsWith("0xdest")) return "destination";
        return "wallet";
    }
    function addNode(address) {
        if (!address) return false;
        const raw = String(address);
        const key = keyOf(raw);
        if (nodes.has(key)) return false;
        if (nodes.size >= MAX_VISUAL_NODES) return false;
        nodes.add(key);
        const type = inferType(raw);
        const cls = classifications.get(key);
        const isVasp = matchedSet.has(key);
        elements.push({ data: {
            id: raw, address: raw, type,
            label: nodeTypeLabel(type),
            reason: cls?.reason || nodeReason(type),
            classification_confidence: cls?.classification_confidence,
            vaspMatch: isVasp,
            vaspName: isVasp ? vaspName : ""
        }});
        return true;
    }

    // Build a compact, connected visual subset. Priority is given to the investigated
    // wallet, VASP evidence, deposit/hot-wallet evidence and their actual transaction edges.
    const rawTxs = (transactions || []).filter(tx => tx && tx.from && tx.to).map((tx, index) => ({ tx, index, from: String(tx.from), to: String(tx.to) }));
    const priority = rawTxs.map(r => {
        const a = keyOf(r.from), b = keyOf(r.to);
        let score = 0;
        if (a === startKey || b === startKey) score += 100;
        if (matchedSet.has(a) || matchedSet.has(b)) score += 90;
        if (depositSet.has(a) || depositSet.has(b)) score += 50;
        if (hotSet.has(a) || hotSet.has(b)) score += 45;
        if (["mixer", "bridge"].includes(a) || ["mixer", "bridge"].includes(b)) score += 40;
        return { ...r, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);

    for (const record of priority) {
        if (txRecords.length >= MAX_VISUAL_EDGES) break;
        const aKey = keyOf(record.from), bKey = keyOf(record.to);
        const need = (nodes.has(aKey) ? 0 : 1) + (nodes.has(bKey) ? 0 : 1);
        if (nodes.size + need > MAX_VISUAL_NODES) continue;
        addNode(record.from); addNode(record.to);
        txRecords.push(record);
    }

    // Always reserve room for VASP infrastructure so it cannot disappear behind the node cap.
    for (const address of matchedSet) {
        if (nodes.size >= MAX_VISUAL_NODES) break;
        addNode(address);
    }

    txRecords.forEach(({tx, index}) => {
        const amount = tx.amount ?? tx.value ?? tx.value_eth ?? 0;
        const chain = tx.chain || tx.network || "Ethereum";
        const token = tx.token || tx.tokenSymbol || (tx.type === "erc20" ? "ERC20" : "Native");
        const txHash = tx.tx_hash || tx.hash || `edge-${index}`;
        elements.push({ data: {
            id: txHash, source: String(tx.from), target: String(tx.to),
            amount, chain, tx_hash: txHash, hash: txHash,
            from: String(tx.from), to: String(tx.to),
            edgeType: inferType(tx.to), token, tokenSymbol: tx.tokenSymbol || tx.token || "",
            timestamp: tx.timestamp || tx.timeStamp || "", block: tx.block || tx.blockNumber || ""
        }});
    });

    const edgeElements = elements.filter(e => e.data.source && e.data.target);
    const adjacency = new Map();
    function link(a, b) {
        if (!adjacency.has(a)) adjacency.set(a, []);
        adjacency.get(a).push(b);
    }
    edgeElements.forEach(e => { link(keyOf(e.data.source), keyOf(e.data.target)); link(keyOf(e.data.target), keyOf(e.data.source)); });

    // Find the shortest observed path from the investigated wallet to a VASP-labelled
    // address. If no such path exists, use the deepest observed path from the target.
    function shortestPath(targetSet) {
        const queue = [startKey];
        const prev = new Map([[startKey, null]]);
        while (queue.length) {
            const cur = queue.shift();
            if (targetSet.has(cur)) {
                const path = [];
                let p = cur;
                while (p !== null) { path.unshift(p); p = prev.get(p); }
                return path;
            }
            for (const next of adjacency.get(cur) || []) {
                if (!prev.has(next)) { prev.set(next, cur); queue.push(next); }
            }
        }
        return [];
    }

    let mainPath = shortestPath(matchedSet);
    if (!mainPath.length) {
        const depth = new Map([[startKey, 0]]), queue = [startKey];
        let deepest = startKey;
        while (queue.length) {
            const cur = queue.shift();
            if ((depth.get(cur) || 0) > (depth.get(deepest) || 0)) deepest = cur;
            for (const next of adjacency.get(cur) || []) {
                if (!depth.has(next)) { depth.set(next, (depth.get(cur) || 0) + 1); queue.push(next); }
            }
        }
        mainPath = shortestPath(new Set([deepest]));
    }
    if (!mainPath.length && nodes.has(startKey)) mainPath = [startKey];

    const nodeByKey = new Map(elements.filter(e => e.data.address).map(e => [keyOf(e.data.address), e]));
    const stageRect = graphEl.getBoundingClientRect();
    const W = Math.max(700, stageRect.width || 1200);
    const H = Math.max(500, stageRect.height || 560);
    const centerY = H * 0.50;
    const upperY = H * 0.19;
    const lowerY = H * 0.81;
    const positions = new Map();

    // Central evidence path: investigated wallet -> observed hops -> VASP evidence.
    const mainGap = Math.max(92, Math.min(155, (W - 140) / Math.max(1, mainPath.length - 1)));
    const mainWidth = Math.min(W - 120, mainGap * Math.max(0, mainPath.length - 1));
    const mainStartX = (W - mainWidth) / 2;
    mainPath.forEach((key, i) => positions.set(key, { x: mainStartX + i * mainGap, y: centerY }));

    // Every remaining wallet stays on one of two clean rails. Nodes are packed with
    // guaranteed spacing so they cannot overlap, while actual edges remain intact.
    const remaining = Array.from(nodes).filter(k => !positions.has(k));
    const upper = [], lower = [];
    remaining.forEach((key, i) => (i % 2 === 0 ? upper : lower).push(key));
    function placeRail(list, y) {
        if (!list.length) return;
        const gap = Math.max(62, Math.min(105, (W - 90) / list.length));
        const total = gap * (list.length - 1);
        const x0 = Math.max(45, (W - total) / 2);
        list.forEach((key, i) => positions.set(key, { x: x0 + i * gap, y }));
    }
    placeRail(upper, upperY);
    placeRail(lower, lowerY);

    // VASP must remain central even when public intelligence found it but there is no
    // direct observed transaction edge to that labelled infrastructure address.
    const vaspKeys = Array.from(matchedSet).filter(k => nodeByKey.has(k));
    if (vaspKeys.length) {
        const centralVasp = vaspKeys[0];
        positions.set(centralVasp, { x: W * 0.62, y: centerY });
        if (mainPath.includes(centralVasp)) {
            const idx = mainPath.indexOf(centralVasp);
            const left = Math.max(60, W * 0.16);
            const right = Math.min(W - 60, W * 0.86);
            const count = Math.max(1, mainPath.length - 1);
            mainPath.forEach((key, i) => {
                if (key === centralVasp) return;
                positions.set(key, { x: left + ((right - left) * i / count), y: centerY });
            });
        }
    }
    nodeByKey.forEach((el, key) => { el.position = positions.get(key) || { x: W / 2, y: centerY }; });

    const cy = cytoscape({
        container: graphEl,
        elements,
        style: [
            { selector: "node", style: { "background-color": COLORS.wallet, "label": "data(label)", "color": "#eaf2ff", "text-valign": "center", "text-halign": "center", "font-size": 8, "font-weight": 700, "width": 42, "height": 42, "border-width": 2, "border-color": "#4c6485", "opacity": 0.9, "overlay-opacity": 0 } },
            { selector: 'node[type="start"]', style: { "background-color": COLORS.start, "border-color": "#ffb1c0", "border-width": 4, "width": 56, "height": 56, "opacity": 1 } },
            { selector: 'node[type="deposit"]', style: { "background-color": COLORS.deposit, "border-color": "#ffe08a", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="hot"]', style: { "background-color": COLORS.hot, "border-color": "#8bf0bd", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="vasp"]', style: { "background-color": "#ffffff", "color": "#08111f", "border-color": "#ffffff", "border-width": 5, "width": 54, "height": 54, "opacity": 1 } },
            { selector: 'node[type="mixer"]', style: { "background-color": COLORS.mixer, "border-color": "#ffb16f", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="bridge"]', style: { "background-color": COLORS.bridge, "border-color": "#d2b7ff", "border-width": 3, "opacity": 1 } },
            { selector: 'node[type="destination"]', style: { "background-color": COLORS.destination, "border-color": "#a9dcff", "border-width": 3, "opacity": 1 } },
            { selector: "node:selected", style: { "border-width": 6, "border-color": "#ffffff", "opacity": 1 } },
            { selector: "edge", style: { "width": 1.6, "line-color": "#49617f", "target-arrow-color": "#49617f", "target-arrow-shape": "triangle", "curve-style": "straight", "opacity": 0.42, "underlay-color": "#67cfff", "underlay-opacity": 0.035, "underlay-padding": 2 } },
            { selector: 'edge[edgeType="deposit"]', style: { "line-color": COLORS.deposit, "target-arrow-color": COLORS.deposit, "opacity": 0.7, "underlay-color": COLORS.deposit, "underlay-opacity": 0.08 } },
            { selector: 'edge[edgeType="hot"]', style: { "line-color": COLORS.hot, "target-arrow-color": COLORS.hot, "opacity": 0.72, "underlay-color": COLORS.hot, "underlay-opacity": 0.08 } },
            { selector: 'edge[edgeType="vasp"]', style: { "line-color": COLORS.vasp, "target-arrow-color": COLORS.vasp, "opacity": 0.9, "underlay-color": COLORS.vasp, "underlay-opacity": 0.12 } },
            { selector: 'edge[edgeType="mixer"]', style: { "line-color": COLORS.mixer, "target-arrow-color": COLORS.mixer, "opacity": 0.85 } },
            { selector: 'edge[edgeType="bridge"]', style: { "line-color": COLORS.bridge, "target-arrow-color": COLORS.bridge, "opacity": 0.85 } },
            { selector: "edge:selected", style: { "width": 4, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1, "underlay-opacity": 0.18 } },
            { selector: "node.search-hit", style: { "border-width": 7, "border-color": "#ffffff", "overlay-color": "#ffffff", "overlay-opacity": 0.2, "opacity": 1 } },
            { selector: "edge.search-hit", style: { "width": 5, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } }
        ],
        layout: { name: "preset", fit: true, padding: 45 }
    });

    // One lightweight canvas carries a few moving highlights. It follows the current
    // rendered edge positions, so highlights react when a node is dragged.
    const motionCanvas = document.createElement("canvas");
    motionCanvas.className = "graph-motion-canvas";
    motionCanvas.setAttribute("aria-hidden", "true");
    graphEl.appendChild(motionCanvas);
    const motionCtx = motionCanvas.getContext("2d");
    const motionEdges = cy.edges().slice(0, 8);
    const particles = motionEdges.map((edge, index) => ({ edge, offset: index / Math.max(1, motionEdges.length), speed: 0.000045 + (index % 3) * 0.00001 }));
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
        if (!motionCtx || document.hidden) { graphMotionFrame = null; return; }
        const rect = graphEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        if (now - graphMotionLast < 65) { graphMotionFrame = requestAnimationFrame(drawMotion); return; }
        graphMotionLast = now;
        motionCtx.clearRect(0, 0, rect.width, rect.height);
        particles.forEach(p => {
            const source = p.edge.source().renderedPosition(), target = p.edge.target().renderedPosition();
            if (!source || !target) return;
            const t = (now * p.speed + p.offset) % 1;
            const x = source.x + (target.x - source.x) * t, y = source.y + (target.y - source.y) * t;
            motionCtx.beginPath(); motionCtx.arc(x, y, 1.7, 0, Math.PI * 2);
            motionCtx.fillStyle = "rgba(225,248,255,0.9)"; motionCtx.shadowBlur = 6; motionCtx.shadowColor = "rgba(110,220,255,0.75)"; motionCtx.fill(); motionCtx.shadowBlur = 0;
        });
        graphMotionFrame = requestAnimationFrame(drawMotion);
    }
    resizeMotionCanvas();
    cy.on("resize", resizeMotionCanvas);
    cy.on("zoom pan drag free position", () => { if (!graphMotionFrame && !document.hidden) graphMotionFrame = requestAnimationFrame(drawMotion); });
    graphMotionFrame = requestAnimationFrame(drawMotion);
    activeGraph = cy;
    document.getElementById("graphEmpty").classList.toggle("hidden", transactions.length > 0);

    function showPopup(title, rows, element) {
        popupContent.innerHTML = "";
        const kicker = document.createElement("div"); kicker.className = "popup-kicker"; kicker.textContent = title;
        popupContent.appendChild(kicker);
        rows.forEach(row => {
            const div = document.createElement("div"); div.className = "popup-row";
            const value = row.value === undefined || row.value === null || row.value === "" ? "Not available in source data" : row.value;
            div.innerHTML = `<strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(String(value))}</span>`;
            popupContent.appendChild(div);
        });
        cy.elements().unselect(); element.select(); popup.classList.remove("hidden");
    }
    function closePopup() { popup.classList.add("hidden"); cy.elements().unselect(); }
    cy.on("tap", "node", event => {
        const n = event.target, d = n.data();
        showPopup(d.type === "vasp" ? "VASP INFRASTRUCTURE" : "WALLET / ENTITY", [
            ["Type", nodeTypeLabel(d.type)], ["Address", d.address], ["VASP", d.vaspMatch ? d.vaspName : "Not a VASP match"],
            ["Incoming", n.incomers("edge").length], ["Outgoing", n.outgoers("edge").length], ["Classification", d.reason],
            ["Classification confidence", d.classification_confidence === undefined ? "Not scored" : `${Math.round(Number(d.classification_confidence) * 100)}%`]
        ].map(([label, value]) => ({label, value})), n);
    });
    cy.on("tap", "edge", event => {
        const e = event.target, d = e.data();
        showPopup("TRANSACTION EVIDENCE", [
            ["TX Hash", d.tx_hash || d.hash], ["From", d.from || e.source().data("address")], ["To", d.to || e.target().data("address")],
            ["Amount", d.amount], ["Chain", d.chain], ["Token", d.token || d.tokenSymbol || "Native"],
            ["Block", d.block], ["Time", d.timestamp ? new Date(Number(d.timestamp) * 1000).toLocaleString() : "Not supplied"]
        ].map(([label, value]) => ({label, value})), e);
    });
    cy.on("tap", event => { if (event.target === cy) closePopup(); });
    popupClose.onclick = closePopup;

    function clearGraphSearch() {
        if (graphSearchPulse) { clearInterval(graphSearchPulse); graphSearchPulse = null; }
        cy.elements().removeClass("search-hit").removeStyle("opacity");
        const input = document.getElementById("graphSearchInput"), clear = document.getElementById("graphSearchClear"), count = document.getElementById("graphSearchCount");
        if (input) input.value = ""; if (clear) clear.classList.add("hidden"); if (count) { count.textContent = ""; count.className = "graph-search-count"; }
    }
    function runGraphSearch() {
        const input = document.getElementById("graphSearchInput"), clear = document.getElementById("graphSearchClear"), count = document.getElementById("graphSearchCount");
        const term = (input?.value || "").trim().toLowerCase();
        clearGraphSearch();
        if (!term) return;
        if (clear) clear.classList.remove("hidden");
        const aliases = { vasp:"vasp", exchange:"vasp", "hot wallet":"hot", hot:"hot", hotwallet:"hot", deposit:"deposit", wallet:"wallet", investigated:"start", start:"start", mixer:"mixer", bridge:"bridge", destination:"destination" };
        const wantedType = aliases[term];
        const matches = cy.nodes().filter(n => {
            const d = n.data();
            const haystack = [d.type, nodeTypeLabel(d.type), d.address, d.reason, d.vaspName].join(" ").toLowerCase();
            return wantedType ? d.type === wantedType : haystack.includes(term);
        });
        const edgeMatches = cy.edges().filter(e => ["tx_hash","hash","from","to","amount","chain","token","block","timestamp","edgeType"].map(k => e.data(k)).join(" ").toLowerCase().includes(term));
        const hits = matches.union(edgeMatches);
        if (!hits.length) { if (count) { count.textContent = "No match"; count.className = "graph-search-count none"; } return; }
        hits.addClass("search-hit"); cy.elements().not(hits).style("opacity", 0.13);
        if (count) { count.textContent = `${hits.length} match${hits.length === 1 ? "" : "es"}`; count.className = "graph-search-count match"; }
        cy.fit(hits, 100);
        let on = true;
        graphSearchPulse = setInterval(() => { on = !on; hits.style("opacity", on ? 1 : 0.65); }, 500);
    }
    const searchInput = document.getElementById("graphSearchInput"), searchButton = document.getElementById("graphSearchBtn"), searchClear = document.getElementById("graphSearchClear");
    if (searchButton) searchButton.onclick = runGraphSearch;
    if (searchInput) searchInput.onkeydown = event => { if (event.key === "Enter") runGraphSearch(); if (event.key === "Escape") clearGraphSearch(); };
    if (searchClear) searchClear.onclick = clearGraphSearch;

    setTimeout(() => { if (activeGraph && !activeGraph.destroyed()) cy.fit(undefined, 45); }, 50);
}

function fitGraph() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.fit(undefined, 55); } }
function resetGraphView() {
    if (!activeGraph || activeGraph.destroyed()) return;
    activeGraph.fit(undefined, 45);
}

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
