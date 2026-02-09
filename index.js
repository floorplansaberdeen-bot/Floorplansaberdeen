/* index.js — Public page (backend critical + polling)
   Rules:
   - All stands orange
   - Selected stand red
   - No green anywhere
   - Desktop: can click plan or list
   - Mobile: plan tapping disabled (list only)
*/
(() => {
  "use strict";
  const F = window.Floorplan;
  const SVG_URL = "./event_plan.svg";

  const el = F.$;
  const svgHost = el("svgHost");
  const planStack = el("planStack");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearSearchBtn = el("clearSearchBtn");
  const countEl = el("count");
  const totalEl = el("total");
  const updatedAtEl = el("updatedAt");
  const eventTitle = el("eventTitle");

  let svgRoot = null;
  let standMap = new Map();
  let rows = [];
  let selectedStandId = null;
  let pollTimer = null;

  const isMobile = () => window.matchMedia("(max-width: 640px)").matches;

  function normRow(row){
    return {
      standId: String(row.standId ?? row.stand ?? row.id ?? "").trim().toUpperCase(),
      status: String(row.status || "available").toLowerCase(),
      company: String(row.company || "").trim()
    };
  }

  async function loadSvg() {
    const svg = await F.loadSvgInline(SVG_URL, svgHost);
    svgRoot = svg;
    standMap = F.buildStandMap(svgRoot);

    svgRoot.addEventListener("click", (ev) => {
      if (isMobile()) return; // disabled on phone
      const standId = F.findClickedStandId(ev.target, rows);
      if (standId) selectStand(standId, "plan");
    }, { passive:true });
  }

  function renderTable(){
    const q = (searchEl?.value || "").trim().toLowerCase();
    // Public list: sold stands only with company (visitors), but keep stand if sold with blank company.
    const soldOnly = rows.filter(r => r.status === "sold");
    const filtered = soldOnly.filter(r => {
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    filtered.forEach(r => {
      const tr = document.createElement("tr");
      if (selectedStandId && r.standId === selectedStandId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.company || "";

      tr.appendChild(td1); tr.appendChild(td2);
      tr.addEventListener("click", () => selectStand(r.standId, "list"));
      tbody.appendChild(tr);
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (totalEl) totalEl.textContent = String(soldOnly.length);
  }

  function updateColours(){
    F.applyColoursPublic(rows, standMap, getComputedStyle(document.documentElement), selectedStandId);
  }

  function updateCallout(){
    if (!selectedStandId) {
      F.clearCallout(calloutSvg, lozenge, lozStand, lozCompany);
      return;
    }
    const row = rows.find(r => r.standId === selectedStandId);
    const standEl = F.elementForStand(standMap, selectedStandId);
    const company = (row && row.status === "sold") ? (row.company||"") : "";
    F.drawCallout({ standElem: standEl, standId: selectedStandId, company, planStack, calloutSvg, lozenge, lozStand, lozCompany });
  }

  function selectStand(standId, source){
    const id = String(standId||"").trim().toUpperCase();
    selectedStandId = id;

    renderTable();
    updateColours();
    updateCallout();
  }

  async function loadData() {
    const backend = F.getBackendUrl();
    const data = await F.fetchJson(`${backend}/stands`);
    rows = (Array.isArray(data) ? data : []).map(normRow).filter(r => r.standId);

    // keep selection if still exists
    if (selectedStandId && !rows.some(r => r.standId === selectedStandId)) {
      selectedStandId = null;
    }

    renderTable();
    updateColours();
    updateCallout();

    if (updatedAtEl) updatedAtEl.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }

  function startPolling(){
    stopPolling();
    pollTimer = setInterval(async () => {
      try { await loadData(); } catch(e){ /* silent */ }
    }, 8000);
  }
  function stopPolling(){
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // Search
  searchEl?.addEventListener("input", renderTable);
  clearSearchBtn?.addEventListener("click", () => { searchEl.value=""; renderTable(); });

  // Keep callout correct on resize/scroll
  const redraw = () => updateCallout();
  window.addEventListener("resize", redraw);
  window.addEventListener("scroll", redraw, true);

  // init
  (async () => {
    try {
      await loadSvg();
    } catch (e) {
      console.error(e);
      return;
    }
    try {
      await loadData();
      startPolling();
    } catch (e) {
      console.error(e);
    }
  })();
})();
