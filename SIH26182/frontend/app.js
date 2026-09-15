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
    const classifications = new Map(
        (analysisData.node_classification || []).map(x => [String(x.address || "").toLowerCase(), x])
    );
    const depositSet = new Set(
        (analysisData.deposit_analysis?.candidates || []).map(x => String(x.address || "").toLowerCase())
    );
    const hotSet = new Set(
        (analysisData.hot_wallet_analysis?.candidates || []).map(x => String(x.address || "").toLowerCase())
    );
    const matchedSet = new Set(
        (intelligence.matched_addresses || []).map(x => String(x || "").toLowerCase())
    );
    const vaspName = intelligence.candidate_vasp || analysisData.vasp_candidates?.[0]?.vasp || "VASP";
    const startKey = String(startingWallet || "").toLowerCase();

    // Higher visual capacity than the previous 72-node version, while still keeping
    // the browser workload bounded. Only nodes connected by real observed edges are
    // admitted; important infrastructure is reserved first.
    const MAX_VISUAL_NODES = 170;
    const MAX_VISUAL_EDGES = 210;
    const MAX_WALLETS_PER_RAIL = 48;

    const elements = [];
    const nodes = new Set();
    const txRecords = [];

    const keyOf = value => String(value || "").toLowerCase();
    const clean = value => value === undefined || value === null || value === "" ? "Not available in source data" : String(value);

    function inferType(address) {
        const key = keyOf(address);
        if (key === startKey) return "start";
        // Explicit VASP intelligence wins over generic classification labels.
        if (matchedSet.has(key)) return "vasp";
        if (classifications.has(key)) return classifications.get(key).type || "wallet";
        if (depositSet.has(key) || key.startsWith("0xdep")) return "deposit";
        if (hotSet.has(key) || key.startsWith("0xhot")) return "hot";
        if (key.includes("mixer") || key.includes("tornado")) return "mixer";
        if (key.includes("bridge")) return "bridge";
        if (key.startsWith("0xdest")) return "destination";
        return "wallet";
    }

    function nodePriority(type) {
        return ({ start: 100, vasp: 98, deposit: 92, hot: 90, mixer: 88, bridge: 88, destination: 84, wallet: 20 })[type] || 10;
    }

    function addNode(address) {
        if (!address) return false;
        const raw = String(address);
        const key = keyOf(raw);
        if (nodes.has(key)) return true;
        if (nodes.size >= MAX_VISUAL_NODES) return false;
        const type = inferType(raw);
        const cls = classifications.get(key);
        const isVasp = matchedSet.has(key) || type === "vasp";
        nodes.add(key);
        elements.push({ data: {
            id: key,
            address: raw,
            type,
            label: nodeTypeLabel(type),
            reason: cls?.reason || nodeReason(type),
            classification_confidence: cls?.classification_confidence,
            vaspMatch: isVasp,
            vaspName: isVasp ? vaspName : ""
        }});
        return true;
    }

    // Normalize every observed transaction once. This preserves the backend data and
    // also makes the graph robust if a source uses Etherscan-style field names.
    const rawTxs = (transactions || [])
        .filter(tx => tx && tx.from && tx.to)
        .map((tx, index) => ({
            tx,
            index,
            from: String(tx.from),
            to: String(tx.to),
            fromKey: keyOf(tx.from),
            toKey: keyOf(tx.to)
        }));

    const incident = new Map();
    rawTxs.forEach(r => {
        if (!incident.has(r.fromKey)) incident.set(r.fromKey, []);
        if (!incident.has(r.toKey)) incident.set(r.toKey, []);
        incident.get(r.fromKey).push(r);
        incident.get(r.toKey).push(r);
    });

    // Seed with the real investigation target and every observed VASP match.
    // Then grow outward through actual transaction edges so displayed blue wallets
    // can never become disconnected decorations.
    const selected = new Set();
    const selectedEdges = new Set();

    function edgeScore(r) {
        let score = 0;
        const a = r.fromKey, b = r.toKey;
        if (a === startKey || b === startKey) score += 1000;
        if (matchedSet.has(a) || matchedSet.has(b)) score += 900;
        if (depositSet.has(a) || depositSet.has(b)) score += 600;
        if (hotSet.has(a) || hotSet.has(b)) score += 560;
        if (["mixer", "bridge"].includes(inferType(r.from)) || ["mixer", "bridge"].includes(inferType(r.to))) score += 500;
        if (r.tx?.type === "erc20") score += 20;
        const ts = Number(r.tx?.timestamp || r.tx?.timeStamp || 0);
        if (Number.isFinite(ts) && ts > 0) score += Math.min(25, Math.max(0, (ts % 1000000) / 40000));
        return score;
    }

    // Build a breadth-first connected backbone from the investigation target.
    // At each frontier, prefer infrastructure and recent/meaningful edges.
    let frontier = new Set([startKey]);
    const visited = new Set([startKey]);
    while (frontier.size && nodes.size < MAX_VISUAL_NODES && selectedEdges.size < MAX_VISUAL_EDGES) {
        const candidates = [];
        frontier.forEach(key => (incident.get(key) || []).forEach(r => {
            const id = txId(r.tx, r.index);
            if (!selectedEdges.has(id)) candidates.push(r);
        }));
        candidates.sort((a, b) => edgeScore(b) - edgeScore(a) || a.index - b.index);

        const next = new Set();
        for (const r of candidates) {
            if (selectedEdges.size >= MAX_VISUAL_EDGES) break;
            const other = r.fromKey === startKey || visited.has(r.fromKey) ? r.toKey : r.fromKey;
            const needA = nodes.has(r.fromKey) ? 0 : 1;
            const needB = nodes.has(r.toKey) ? 0 : 1;
            if (nodes.size + needA + needB > MAX_VISUAL_NODES) continue;
            selectedEdges.add(txId(r.tx, r.index));
            selected.add(r.fromKey); selected.add(r.toKey);
            addNode(r.from); addNode(r.to);
            if (!visited.has(other)) { visited.add(other); next.add(other); }
        }
        frontier = next;
    }

    // If the root has sparse activity, fill the remaining visual budget with additional
    // real edges that touch already-selected nodes. Never add an isolated wallet.
    const fallback = rawTxs.slice().sort((a, b) => edgeScore(b) - edgeScore(a) || a.index - b.index);
    for (const r of fallback) {
        if (selectedEdges.size >= MAX_VISUAL_EDGES || nodes.size >= MAX_VISUAL_NODES) break;
        const id = txId(r.tx, r.index);
        if (selectedEdges.has(id)) continue;
        if (!selected.has(r.fromKey) && !selected.has(r.toKey)) continue;
        const needA = nodes.has(r.fromKey) ? 0 : 1;
        const needB = nodes.has(r.toKey) ? 0 : 1;
        if (nodes.size + needA + needB > MAX_VISUAL_NODES) continue;
        selectedEdges.add(id);
        selected.add(r.fromKey); selected.add(r.toKey);
        addNode(r.from); addNode(r.to);
    }

    // Ensure observed VASP matches are present. If a public label match is not part of
    // the observed transaction set, show the VASP node without inventing an edge.
    matchedSet.forEach(address => {
        if (nodes.size < MAX_VISUAL_NODES && !nodes.has(address)) addNode(address);
    });

    function txId(tx, index) { return `${tx?.tx_hash || tx?.hash || `edge-${index}`}|${tx?.type || "native"}|${index}`; }
    const selectedRecords = rawTxs.filter(r => selectedEdges.has(txId(r.tx, r.index)));
    selectedRecords.forEach(({tx, index, from, to}) => {
        const amount = tx.amount ?? tx.value ?? tx.value_eth ?? tx.native_amount;
        const chain = tx.chain || tx.network || tx.chain_name || "Ethereum";
        const token = tx.token || tx.tokenSymbol || tx.symbol || (tx.type === "erc20" ? "ERC20" : "Native");
        const hash = tx.tx_hash || tx.hash || `edge-${index}`;
        const timestamp = tx.timestamp || tx.timeStamp || tx.time || "";
        const block = tx.block || tx.blockNumber || tx.block_number || "";
        elements.push({ data: {
            id: hash,
            source: keyOf(from), target: keyOf(to),
            amount: amount === undefined || amount === null ? "Not available in source data" : amount,
            chain: clean(chain), token: clean(token), tx_hash: clean(hash), hash: clean(hash),
            from, to, edgeType: inferType(to), timestamp: clean(timestamp), block: clean(block),
            tx_type: tx.type || "native"
        }});
    });

    // ---- Fixed layout structure: central VASP + important path + two clean wallet rails ----
    // No force simulation is used for the initial layout, so a large real graph stays neat.
    const width = Math.max(1200, graphEl.clientWidth || 1400);
    const height = Math.max(520, graphEl.clientHeight || 560);
    const centerX = width / 2;
    const centerY = height / 2;
    const mainTypes = new Set(["start", "vasp", "deposit", "hot", "mixer", "bridge", "destination"]);
    const main = Array.from(nodes).filter(a => mainTypes.has(inferType(a)));
    const wallets = Array.from(nodes).filter(a => inferType(a) === "wallet");
    const positions = new Map();

    // Main infrastructure remains in the same left-to-right / central structure.
    const mainGroups = new Map();
    main.forEach(a => {
        const t = inferType(a);
        if (!mainGroups.has(t)) mainGroups.set(t, []);
        mainGroups.get(t).push(a);
    });
    const mainX = {
        start: Math.max(95, width * 0.16),
        mixer: width * 0.34,
        bridge: width * 0.39,
        vasp: centerX,
        deposit: width * 0.64,
        hot: width * 0.79,
        destination: width * 0.90
    };
    mainGroups.forEach((items, type) => {
        items.sort((a,b) => a.localeCompare(b));
        const x = mainX[type] || centerX;
        const gap = Math.min(70, Math.max(52, height / Math.max(2, items.length + 1)));
        const startY = centerY - ((items.length - 1) * gap) / 2;
        items.forEach((a, i) => positions.set(a, { x, y: startY + i * gap }));
    });

    // Wallets occupy two upper/lower rails. Extra wallets continue in the same rails
    // with compact spacing instead of creating random islands.
    wallets.sort((a,b) => {
        const da = incident.get(a)?.length || 0, db = incident.get(b)?.length || 0;
        return db - da || a.localeCompare(b);
    });
    const railCount = Math.min(MAX_WALLETS_PER_RAIL, Math.ceil(wallets.length / 2));
    const top = wallets.slice(0, railCount);
    const bottom = wallets.slice(railCount, railCount * 2);
    function placeRail(items, y) {
        if (!items.length) return;
        const left = Math.max(45, width * 0.04);
        const right = Math.min(width - 45, width * 0.96);
        const gap = items.length === 1 ? 0 : (right - left) / (items.length - 1);
        items.forEach((a, i) => positions.set(a, { x: left + i * gap, y }));
    }
    placeRail(top, Math.max(72, height * 0.17));
    placeRail(bottom, Math.min(height - 72, height * 0.83));

    // If there are more than two rails worth of wallets, place the remainder in two
    // secondary lanes just inside the main rails. This keeps the same overall structure.
    const remainder = wallets.slice(railCount * 2);
    if (remainder.length) {
        const half = Math.ceil(remainder.length / 2);
        placeRail(remainder.slice(0, half), height * 0.29);
        placeRail(remainder.slice(half), height * 0.71);
    }

    elements.forEach(e => {
        if (e.data.address) e.position = positions.get(e.data.id) || { x: centerX, y: centerY };
    });

    const cy = cytoscape({
        container: graphEl,
        elements,
        style: [
            { selector: "node", style: { "background-color": COLORS.wallet, "label": "data(label)", "color": "#eaf2ff", "text-valign": "center", "text-halign": "center", "font-size": 8, "font-weight": 700, "text-wrap": "wrap", "text-max-width": 70, "width": 38, "height": 38, "border-width": 2, "border-color": "#4c6485", "opacity": 0.86, "overlay-opacity": 0 } },
            { selector: 'node[type="start"]', style: { "background-color": COLORS.start, "border-color": "#ffb1c0", "border-width": 4, "width": 58, "height": 58, "opacity": 1 } },
            { selector: 'node[type="deposit"]', style: { "background-color": COLORS.deposit, "border-color": "#ffe08a", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="hot"]', style: { "background-color": COLORS.hot, "border-color": "#8bf0bd", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="vasp"]', style: { "background-color": COLORS.vasp, "color": "#08111f", "border-color": "#ffffff", "border-width": 5, "width": 72, "height": 72, "opacity": 1 } },
            { selector: 'node[type="mixer"]', style: { "background-color": COLORS.mixer, "border-color": "#ffb16f", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="bridge"]', style: { "background-color": COLORS.bridge, "border-color": "#d2b7ff", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="destination"]', style: { "background-color": COLORS.destination, "border-color": "#a9dcff", "border-width": 3, "opacity": 1 } },
            { selector: "node.search-hit", style: { "border-width": 7, "border-color": "#ffffff", "overlay-color": "#ffffff", "overlay-opacity": 0.18, "opacity": 1 } },
            { selector: "node.selected", style: { "border-width": 6, "border-color": "#ffffff", "opacity": 1 } },
            { selector: "edge", style: { "width": 1.5, "line-color": "#49617f", "target-arrow-color": "#49617f", "target-arrow-shape": "triangle", "curve-style": "straight", "opacity": 0.34 } },
            { selector: 'edge[edgeType="deposit"]', style: { "line-color": COLORS.deposit, "target-arrow-color": COLORS.deposit, "opacity": 0.60 } },
            { selector: 'edge[edgeType="hot"]', style: { "line-color": COLORS.hot, "target-arrow-color": COLORS.hot, "opacity": 0.68 } },
            { selector: 'edge[edgeType="vasp"]', style: { "line-color": COLORS.vasp, "target-arrow-color": COLORS.vasp, "opacity": 0.86 } },
            { selector: 'edge[edgeType="mixer"]', style: { "line-color": COLORS.mixer, "target-arrow-color": COLORS.mixer, "opacity": 0.82 } },
            { selector: 'edge[edgeType="bridge"]', style: { "line-color": COLORS.bridge, "target-arrow-color": COLORS.bridge, "opacity": 0.82 } },
            { selector: "edge.search-hit", style: { "width": 5, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } },
            { selector: "edge:selected", style: { "width": 4, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } }
        ],
        layout: { name: "preset", fit: false, padding: 20 }
    });

    cy.nodes().forEach(node => node.data("label", nodeTypeLabel(node.data("type"))));

    // Lightweight shine: a few particles follow real rendered edges. They are not
    // attached to every edge, so the graph remains responsive with 150+ nodes.
    const motionCanvas = document.createElement("canvas");
    motionCanvas.className = "graph-motion-canvas";
    motionCanvas.setAttribute("aria-hidden", "true");
    graphEl.appendChild(motionCanvas);
    const motionCtx = motionCanvas.getContext("2d");
    const importantEdges = cy.edges().filter(e => {
        const t = e.data("edgeType");
        return ["vasp", "deposit", "hot", "mixer", "bridge"].includes(t) || e.source().data("type") === "start";
    });
    const motionEdges = importantEdges.slice(0, 12);
    const particles = motionEdges.map((edge, index) => ({ edge, offset: index / Math.max(1, motionEdges.length), speed: 0.000055 + (index % 3) * 0.000012 }));

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
        if (!motionCtx || document.hidden) { graphMotionFrame = document.hidden ? null : requestAnimationFrame(drawMotion); return; }
        const rect = graphEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        if (now - graphMotionLast < 55) { graphMotionFrame = requestAnimationFrame(drawMotion); return; }
        graphMotionLast = now;
        motionCtx.clearRect(0, 0, rect.width, rect.height);
        particles.forEach(p => {
            const source = p.edge.source().renderedPosition(), target = p.edge.target().renderedPosition();
            if (!source || !target) return;
            const t = (now * p.speed + p.offset) % 1;
            const x = source.x + (target.x - source.x) * t;
            const y = source.y + (target.y - source.y) * t;
            const dx = target.x - source.x, dy = target.y - source.y, len = Math.hypot(dx, dy) || 1;
            motionCtx.beginPath();
            motionCtx.moveTo(x - dx / len * 9, y - dy / len * 9);
            motionCtx.lineTo(x, y);
            motionCtx.lineWidth = 1.6;
            motionCtx.strokeStyle = "rgba(190,235,255,0.50)";
            motionCtx.shadowBlur = 4;
            motionCtx.shadowColor = "rgba(110,220,255,0.55)";
            motionCtx.stroke();
            motionCtx.beginPath(); motionCtx.arc(x, y, 1.7, 0, Math.PI * 2);
            motionCtx.fillStyle = "rgba(240,252,255,0.95)"; motionCtx.fill(); motionCtx.shadowBlur = 0;
        });
        graphMotionFrame = requestAnimationFrame(drawMotion);
    }
    resizeMotionCanvas();
    cy.on("resize", resizeMotionCanvas);
    cy.on("zoom pan", () => { if (!graphMotionFrame) graphMotionFrame = requestAnimationFrame(drawMotion); });
    graphMotionFrame = requestAnimationFrame(drawMotion);

    activeGraph = cy;
    document.getElementById("graphEmpty").classList.toggle("hidden", transactions.length > 0);

    function showPopup(title, rows, element) {
        popupContent.innerHTML = "";
        const kicker = document.createElement("div"); kicker.className = "popup-kicker"; kicker.textContent = title;
        popupContent.appendChild(kicker);
        rows.forEach(row => {
            const div = document.createElement("div"); div.className = "popup-row";
            div.innerHTML = `<strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(clean(row.value))}</span>`;
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
        const rawTimestamp = Number(d.timestamp);
        const readableTime = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? new Date(rawTimestamp * 1000).toLocaleString() : clean(d.timestamp);
        showPopup("TRANSACTION EVIDENCE", [
            ["TX Hash", d.tx_hash || d.hash], ["From", d.from || e.source().data("address")], ["To", d.to || e.target().data("address")],
            ["Amount", d.amount], ["Chain", d.chain], ["Token", d.token], ["Block", d.block], ["Time", readableTime], ["Type", d.tx_type]
        ].map(([label, value]) => ({label, value})), e);
    });
    cy.on("tap", event => { if (event.target === cy) closePopup(); });
    popupClose.onclick = closePopup;

    function clearGraphSearch() {
        if (graphSearchPulse) { clearInterval(graphSearchPulse); graphSearchPulse = null; }
        cy.elements().removeClass("search-hit").removeStyle("opacity");
        const input = document.getElementById("graphSearchInput"), clear = document.getElementById("graphSearchClear"), count = document.getElementById("graphSearchCount");
        if (input) input.value = "";
        if (clear) clear.classList.add("hidden");
        if (count) { count.textContent = ""; count.className = "graph-search-count"; }
    }
    function runGraphSearch() {
        const input = document.getElementById("graphSearchInput"), clear = document.getElementById("graphSearchClear"), count = document.getElementById("graphSearchCount");
        const term = (input?.value || "").trim().toLowerCase();
        if (graphSearchPulse) { clearInterval(graphSearchPulse); graphSearchPulse = null; }
        cy.elements().removeClass("search-hit").removeStyle("opacity");
        if (!term) { if (clear) clear.classList.add("hidden"); if (count) { count.textContent = ""; count.className = "graph-search-count"; } return; }
        if (clear) clear.classList.remove("hidden");
        const aliases = { vasp:"vasp", exchange:"vasp", "hot wallet":"hot", hot:"hot", hotwallet:"hot", deposit:"deposit", wallet:"wallet", investigated:"start", start:"start", mixer:"mixer", bridge:"bridge", destination:"destination" };
        const wantedType = aliases[term];
        const matches = cy.nodes().filter(n => {
            const d = n.data();
            const haystack = [d.type, nodeTypeLabel(d.type), d.address, d.reason, d.vaspName].join(" ").toLowerCase();
            return wantedType ? d.type === wantedType : haystack.includes(term);
        });
        const edgeMatches = cy.edges().filter(e => {
            const d = e.data();
            return [d.tx_hash, d.hash, d.from, d.to, d.amount, d.chain, d.token, d.block, d.timestamp, d.edgeType, d.tx_type].join(" ").toLowerCase().includes(term);
        });
        const hits = matches.union(edgeMatches);
        if (!hits.length) { if (count) { count.textContent = "No match"; count.className = "graph-search-count none"; } return; }
        hits.addClass("search-hit"); cy.elements().not(hits).style("opacity", 0.12);
        if (count) { count.textContent = `${hits.length} match${hits.length === 1 ? "" : "es"}`; count.className = "graph-search-count match"; }
        cy.animate({ fit: { eles: hits, padding: 90 }, duration: 240 });
        let on = true;
        graphSearchPulse = setInterval(() => {
            on = !on;
            hits.style({ opacity: on ? 1 : 0.62, "border-width": on ? 7 : 3 });
        }, 520);
    }
    const searchInput = document.getElementById("graphSearchInput"), searchButton = document.getElementById("graphSearchBtn"), searchClear = document.getElementById("graphSearchClear");
    if (searchButton) searchButton.onclick = runGraphSearch;
    if (searchInput) searchInput.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); runGraphSearch(); } else if (event.key === "Escape") clearGraphSearch(); };
    if (searchClear) searchClear.onclick = clearGraphSearch;

    setTimeout(() => { if (activeGraph && !activeGraph.destroyed()) { cy.resize(); cy.fit(undefined, 42); } }, 70);
}

function fitGraph() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.fit(undefined, 55); } }
function resetGraphView() { if (activeGraph && !activeGraph.destroyed()) activeGraph.fit(undefined, 42); }

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
