(() => {
  const { el, fetchJson } = window.FloorplanShared;

  const svgHost = el("svgHost");
  const planWrap = el("planWrap");
  const planStack = el("planStack");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

  const zoomWrap = el("zoomWrap");
  const zoomSvgHost = el("zoomSvgHost");
  const zoomRing = el("zoomRing");

  const eventNameTitle = el("eventNameTitle");
  const updatedAt = el("updatedAt");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearSearchBtn = el("clearSearchBtn");
  const countEl = el("count");
  const totalEl = el("total");

  let core = null;
  let rows = [];
  let settings = { eventName:"Event", showNames:true };
  let pollingTimer = null;
  let userInteractingUntil = 0;

  function nowMs(){ return Date.now(); }
  function markInteracting(){ userInteractingUntil = nowMs() + 1200; }
  function shouldRespectUser(){ return nowMs() < userInteractingUntil; }

  function setUpdatedAt(d){
    const pad = (n)=> String(n).padStart(2,"0");
    updatedAt.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function normalizeStatus(s){
    s = (s||"").toLowerCase();
    return s==="sold" ? "sold" : "available";
  }

  function renderList(){
    const q = (searchEl.value||"").trim().toLowerCase();
    const filtered = rows.filter(r=>{
      if(!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    totalEl.textContent = String(rows.length);
    countEl.textContent = String(filtered.length);

    for(const r of filtered){
      const tr = document.createElement("tr");
      if(core && core.selectedStandId === r.standId) tr.classList.add("selected");

      const tdStand = document.createElement("td");
      tdStand.textContent = r.standId;

      const tdStatus = document.createElement("td");
      tdStatus.textContent = r.status;

      const tdCompany = document.createElement("td");
      if(r.status==="sold" && settings.showNames !== false) tdCompany.textContent = r.company || "";
      else tdCompany.textContent = "";

      tr.appendChild(tdStand);
      tr.appendChild(tdStatus);
      tr.appendChild(tdCompany);

      tr.addEventListener("click", ()=>{
        markInteracting();
        core.selectStand(r.standId, {fromPlan:false});
      });

      tbody.appendChild(tr);
    }
  }

  function updateCallout(){
    if(!core || !core.selectedStandId){
      core.clearCallout();
      lozenge.style.display = "none";
      core.updateZoom(null, zoomSvgHost, zoomWrap, zoomRing);
      return;
    }
    const row = rows.find(r=>r.standId===core.selectedStandId);
    const company = (row && row.status==="sold" && settings.showNames !== false) ? (row.company||"") : "";
    core.drawCallout(core.selectedStandId, company);

    lozStand.textContent = core.selectedStandId;
    lozCompany.textContent = company;
    lozenge.style.display = "block";

    core.updateZoom(core.selectedStandId, zoomSvgHost, zoomWrap, zoomRing);
  }

  async function loadOnce({isPoll=false}={}){
    const [newSettings, newRows] = await Promise.all([
      fetchJson("/settings"),
      fetchJson("/stands")
    ]);

    settings = newSettings || settings;
    if(settings.showNames === undefined) settings.showNames = true;

    eventNameTitle.textContent = settings.eventName || "Event";

    // keep selection while polling if user is interacting
    const keepSelection = core && core.selectedStandId && (shouldRespectUser() || !isPoll);
    const selected = keepSelection ? core.selectedStandId : null;

    rows = (newRows||[]).map(r=>({
      standId: String(r.standId||"").trim().toUpperCase(),
      status: normalizeStatus(r.status),
      company: r.company || ""
    }));

    core.setRows(rows);
    if(selected) core.selectedStandId = selected;

    core.applyColoursAdmin();
    renderList();
    updateCallout();
    setUpdatedAt(new Date());
  }

  async function init(){
    core = new FloorplanCore({
      svgHost,
      planWrap,
      planStack,
      calloutSvg,
      lozenge,
      lozStand,
      lozCompany,
      onSelect: (row)=>{
        markInteracting();
        core.applyColoursAdmin();
        renderList();
        updateCallout();
      },
      onClearSelection: ()=>{
        markInteracting();
        core.applyColoursAdmin();
        renderList();
        updateCallout();
      }
    });

    try{
      await core.loadSvg();
    }catch(e){
      updatedAt.textContent = "Error loading SVG";
      console.error(e);
      return;
    }

    core.enablePlanClick({ enabled:true, disableOnMobile:false, onPick:(standId)=>{
      markInteracting();
      core.selectStand(standId, {fromPlan:true});
    }});

    clearSearchBtn.addEventListener("click", ()=>{
      searchEl.value = "";
      renderList();
    });
    searchEl.addEventListener("input", renderList);

    await loadOnce({isPoll:false});
    pollingTimer = setInterval(()=> loadOnce({isPoll:true}).catch(()=>{}), 12000);
  }

  init();
})();