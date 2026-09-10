let investigationData = null;
let activeGraph = null;

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
    breaks.slice(0, 8).forEach(item => {
        const row = document.createElement("div");
        row.className = `trail-item ${item.type === "mixer" ? "danger" : item.type === "bridge" ? "caution" : "neutral"}`;
        row.innerHTML = `<span class="trail-icon">${item.type === "mixer" ? "⚠" : item.type === "bridge" ? "↗" : "•"}</span><div><strong>${escapeHtml((item.type || "Trail").toUpperCase())}</strong><small>${escapeHtml(item.reason || "Trail uncertainty detected")}</small></div>`;
        container.appendChild(row);
    });
}

function renderQuality(data) {
    const report = data.investigation_report || {};
    const quality = report.data_quality || {};
    const rows = [
        ["Blockchain activity", (data.transaction_count ?? 0) > 0, `${data.transaction_count ?? 0} transaction edge(s)`],
        ["Trace completeness", data.trace_status !== "PARTIAL" && data.trace_status !== "ERROR", data.trace_status || "UNKNOWN"],
        ["External intelligence", Boolean(data.external_intelligence?.length), data.external_intelligence?.length ? "Supporting data returned" : "Not available"],
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
    const elements = [];
    const nodes = new Set();

    function inferType(address) {
        const key = String(address).toLowerCase();
        if (key === String(startingWallet).toLowerCase()) return "start";
        if (classifications.has(key)) return classifications.get(key).type || "wallet";
        if (matchedSet.has(key)) return "vasp";
        if (depositSet.has(key) || key.startsWith("0xdep")) return "deposit";
        if (hotSet.has(key) || key.startsWith("0xhot")) return "hot";
        if (key === "mixer") return "mixer";
        if (key === "bridge") return "bridge";
        if (key.startsWith("0xdest")) return "destination";
        return "wallet";
    }

    function addNode(address) {
        if (!address || nodes.has(address)) return;
        nodes.add(address);
        const type = inferType(address);
        const cls = classifications.get(String(address).toLowerCase());
        elements.push({ data: { id: address, address, type, reason: cls?.reason || nodeReason(type), vaspMatch: matchedSet.has(String(address).toLowerCase()) } });
    }

    transactions.forEach((tx, index) => {
        if (!tx.from || !tx.to) return;
        addNode(tx.from); addNode(tx.to);
        const edgeType = inferType(tx.to);
        elements.push({ data: {
            id: tx.tx_hash || `edge-${index}`,
            source: tx.from,
            target: tx.to,
            amount: tx.amount ?? "Unknown",
            chain: tx.chain || "Unknown",
            tx_hash: tx.tx_hash || "Unknown",
            from: tx.from,
            to: tx.to,
            edgeType,
            token: tx.token || "",
            timestamp: tx.timestamp || ""
        }});
    });

    const cy = cytoscape({
        container: graphEl,
        elements,
        style: [
            { selector: "node", style: { "background-color": COLORS.wallet, "label": "", "color": "#eaf2ff", "text-valign": "center", "text-halign": "center", "font-size": 9, "font-weight": 700, "text-wrap": "wrap", "text-max-width": 78, "width": 64, "height": 64, "border-width": 2, "border-color": "#4c6485", "opacity": 0.82, "overlay-opacity": 0 } },
            { selector: 'node[type="start"]', style: { "background-color": COLORS.start, "border-color": "#ffb1c0", "border-width": 4, "width": 76, "height": 76, "opacity": 1 } },
            { selector: 'node[type="deposit"]', style: { "background-color": COLORS.deposit, "border-color": "#ffe08a", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="hot"]', style: { "background-color": COLORS.hot, "border-color": "#8bf0bd", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="vasp"]', style: { "background-color": "#eaf2ff", "color": "#08111f", "border-color": "#ffffff", "border-width": 5, "opacity": 1 } },
            { selector: 'node[type="mixer"]', style: { "background-color": COLORS.mixer, "border-color": "#ffb16f", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="bridge"]', style: { "background-color": COLORS.bridge, "border-color": "#d2b7ff", "border-width": 4, "opacity": 1 } },
            { selector: 'node[type="destination"]', style: { "background-color": COLORS.destination, "border-color": "#a9dcff", "border-width": 3, "opacity": 1 } },
            { selector: "node:selected", style: { "border-width": 6, "border-color": "#ffffff", "opacity": 1 } },
            { selector: "edge", style: { "width": 2, "line-color": "#49617f", "target-arrow-color": "#49617f", "target-arrow-shape": "triangle", "curve-style": "bezier", "control-point-step-size": 55, "opacity": 0.28 } },
            { selector: 'edge[edgeType="deposit"]', style: { "line-color": COLORS.deposit, "target-arrow-color": COLORS.deposit, "opacity": 0.55 } },
            { selector: 'edge[edgeType="hot"]', style: { "line-color": COLORS.hot, "target-arrow-color": COLORS.hot, "opacity": 0.65 } },
            { selector: 'edge[edgeType="vasp"]', style: { "line-color": COLORS.vasp, "target-arrow-color": COLORS.vasp, "opacity": 0.8 } },
            { selector: 'edge[edgeType="mixer"]', style: { "line-color": COLORS.mixer, "target-arrow-color": COLORS.mixer, "opacity": 0.8 } },
            { selector: 'edge[edgeType="bridge"]', style: { "line-color": COLORS.bridge, "target-arrow-color": COLORS.bridge, "opacity": 0.8 } },
            { selector: "edge:selected", style: { "width": 5, "line-color": "#ffffff", "target-arrow-color": "#ffffff", "opacity": 1 } }
        ],
        layout: { name: "breadthfirst", directed: true, padding: 55, spacingFactor: 1.55, animate: false }
    });

    activeGraph = cy;
    document.getElementById("graphEmpty").classList.toggle("hidden", transactions.length > 0);

    function showPopup(title, rows, element) {
        popupContent.innerHTML = "";
        const kicker = document.createElement("div"); kicker.className = "popup-kicker"; kicker.textContent = title;
        popupContent.appendChild(kicker);
        rows.forEach(row => {
            const div = document.createElement("div"); div.className = "popup-row";
            div.innerHTML = `<strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(String(row.value ?? "Unknown"))}</span>`;
            popupContent.appendChild(div);
        });
        cy.elements().unselect();
        element.select();
        popup.classList.remove("hidden");
    }
    function closePopup() { popup.classList.add("hidden"); cy.elements().unselect(); }

    cy.on("tap", "node", event => {
        const n = event.target; const d = n.data();
        showPopup("WALLET / ENTITY", [
            ["Type", nodeTypeLabel(d.type)], ["Address", d.address], ["Incoming", n.incomers("edge").length], ["Outgoing", n.outgoers("edge").length], ["Why classified", d.reason || "Observed address"]
        ].map(([label, value]) => ({label, value})), n);
    });
    cy.on("tap", "edge", event => {
        const e = event.target; const d = e.data();
        showPopup("TRANSACTION EVIDENCE", [
            ["TX Hash", d.tx_hash], ["From", d.from], ["To", d.to], ["Amount", d.amount], ["Chain", d.chain], ["Token", d.token || "Native"], ["Block / Time", d.timestamp || "Not supplied"]
        ].map(([label, value]) => ({label, value})), e);
    });
    cy.on("tap", event => { if (event.target === cy) closePopup(); });
    popupClose.onclick = closePopup;

    setTimeout(() => { cy.fit(undefined, 55); }, 120);
}

function fitGraph() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.fit(undefined, 55); } }
function resetGraphView() { if (activeGraph && !activeGraph.destroyed()) { activeGraph.layout({name: "breadthfirst", directed: true, padding: 55, spacingFactor: 1.55, animate: false}).run(); setTimeout(fitGraph, 100); } }

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
    document.getElementById("reportSource").innerText = `${data.source || "Blockchain data"}${data.trace_errors?.length ? ` • ${data.trace_errors.length} lookup issue(s)` : ""}`;
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
