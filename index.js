(() => {
    const el = (id)=>document.getElementById(id);

    const updatedAt = el("updatedAt");
	    const eventNameEl = el("eventName");
    const clearBtn = el("clearBtn");

    const planStack = el("planStack");
    const planWrap = el("planWrap");
    const svgHost = el("svgHost");
    const svgFallback = document.getElementById("svgFallback");
    const calloutSvg = el("calloutSvg");
    const lozenge = el("lozenge");
    const lozStand = el("lozStand");
    const lozCompany = el("lozCompany");

    const tbody = el("tbody");
    const searchEl = el("search");
    const clearSearchBtn = el("clearSearchBtn");
    const countEl = el("count");
    const totalEl = el("total");

    const selStand = el("selStand");
    const selCompany = el("selCompany");

    let core = null;
    let soldRows = [];

    function renderList(){
      const q = (searchEl.value || "").trim().toLowerCase();
      const filtered = soldRows.filter(r=>{
        if (!q) return true;
        return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
      });

      tbody.innerHTML = "";
      filtered.forEach(r=>{
        const tr = document.createElement("tr");
        if (core && core.selectedStandId === r.standId) tr.classList.add("active");

        const td1 = document.createElement("td"); td1.textContent = r.standId;
        const td2 = document.createElement("td"); td2.textContent = r.company || "";
        tr.appendChild(td1); tr.appendChild(td2);

        tr.addEventListener("click", ()=> core.selectStand(r.standId, {fromPlan:false}));
        tbody.appendChild(tr);
      });

      countEl.textContent = String(filtered.length);
      totalEl.textContent = String(soldRows.length);
    }

    function clearSelection(){
      if (!core) return;
      core.selectedStandId = null;
      core.applyColoursPublic();
      core.clearCallout();
      selStand.textContent = "None";
      selCompany.textContent = "Desktop: click a stand or choose from the list. Phone: use the list (plan tapping is disabled).";
      renderList();
    }

    clearBtn.addEventListener("click", clearSelection);
    searchEl.addEventListener("input", () => {
      renderList();
      clearSearchBtn.disabled = !searchEl.value;
    });

    clearSearchBtn.disabled = true;
    clearSearchBtn.addEventListener("click", () => {
      searchEl.value = "";
      clearSearchBtn.disabled = true;
      renderList();
      searchEl.focus();
    });

    window.addEventListener("resize", ()=>{
      if (!core || !core.selectedStandId) return;
      const row = core.rows.find(r=>r.standId === core.selectedStandId);
      if (row) core.drawCallout(row.standId, row.company || "");
    });

    (async ()=>{
      core = new window.FloorplanCore({
        allowBackendOverride: false,
        svgHost, planWrap, planStack, calloutSvg,
        lozenge, lozStand, lozCompany,
        onSelect: (row)=>{
          selStand.textContent = row.standId;
          selCompany.textContent = row.company ? row.company : "(No company name set)";
          renderList();
        }
      });

      try{
        try{
        await core.loadSvg();
        if (svgFallback) svgFallback.style.display = "none";
      }catch(e){
        if (svgFallback) svgFallback.style.display = "block";
        updatedAt.textContent = "Error loading SVG";
        console.error(e);
        return;
      }

      try{
        await core.loadStands();
        // Public list: sold exhibitors only
        soldRows = core.rows.filter(r=>r.status === "sold" && (r.company||"").trim().length > 0);
        renderList();
        core.applyColoursPublic();
        updatedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
      }catch(e){
        updatedAt.textContent = "Error loading data";
        console.error(e);
        return;
      }

      // Desktop: allow plan click. Mobile: disable plan tapping.
      core.enablePlanClick({ enabled:true, disableOnMobile:true });

// --- Polling (public auto-refresh) ---
let pollTimer = null;

async function pollSettings(){
  if (!eventNameEl) return;
  try{
    const res = await fetch(core.backend() + "/settings?_=" + Date.now(), { cache: "no-store" });
    const js = await res.json();
    if (js && typeof js.eventName === "string" && js.eventName.trim()) {
      eventNameEl.textContent = js.eventName.trim();
    }
  }catch(e){
    // keep existing
  }
}
async function pollOnce() {
  try {
    await pollSettings();              // refresh event name
    await core.loadStands();           // refresh stands (source of truth)

    // Only show sold exhibitors on public page
    soldRows = core.rows.filter(r => r.status === "sold" && r.company);
    renderList();

    // Re-apply colours & callout WITHOUT overriding user's current selection.
    core.applyColoursPublic();
    if (core.selectedStandId) {
      const row = core.rowMap.get(core.selectedStandId);
      if (row && row.status === "sold" && row.company) {
        core.drawCallout(svg, row.standId, row.company || "");
      } else {
        // Selection no longer valid (e.g. stand became available)
        clearSelection();
      }
    }

    updatedAt.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    statusEl.textContent = "";
  } catch (err) {
    console.warn(err);
    statusEl.textContent = "Error loading data";
  }
}

function startPolling(){
  stopPolling();
  pollTimer = setInterval(pollOnce, 12000);
}
function stopPolling(){
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// Pause polling when tab is hidden (saves battery / data)
document.addEventListener("visibilitychange", ()=>{
  if (document.hidden) stopPolling();
  else { pollOnce(); startPolling(); }
});

startPolling();
})();
