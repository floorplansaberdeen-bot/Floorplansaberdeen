(() => {
  const { el, fetchJson, getBackendUrl } = window.FloorplanShared;

  const svgHost = el("svgHost");
  const planWrap = el("planWrap");
  const planStack = el("planStack");
  const labelBay = el("labelBay");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");
  const calloutSvg = el("calloutSvg");

  const zoomWrap = el("zoomWrap");
  const zoomSvgHost = el("zoomSvgHost");
  const zoomRing = el("zoomRing");

  const eventNameTitle = el("eventNameTitle");
  const updatedAt = el("updatedAt");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearBtn = el("clearBtn");
  const countEl = el("count");
  const totalEl = el("total");

  let rows = [];
  let settings = { eventName:"Event", showNames:true };
  let userInteractingUntil = 0;

  const core = new FloorplanCore({
    svgHost,
    planWrap,
    planStack,
    labelBay,
    lozenge,
    lozStand,
    lozCompany,
    calloutSvg,
    zoomSvgHost,
    zoomWrap,
    zoomRing,
    onSelect: ()=> { markInteracting(); refreshUI(); },
    onClearSelection: ()=> { markInteracting(); refreshUI(); }
  });

  function pad(n){ return String(n).padStart(2,"0"); }
  function setUpdatedAt(){
    const d = new Date();
    updatedAt.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function now(){ return Date.now(); }
  function markInteracting(){ userInteractingUntil = now() + 1200; }
  function shouldRespectUser(){ return now() < userInteractingUntil; }

  function normalizeRows(raw){
    return (raw||[]).map(r=>({
      standId: String(r.standId||"").trim().toUpperCase(),
      status: (String(r.status||"").toLowerCase()==="sold") ? "sold" : "available",
      company: r.company || ""
    }));
  }

  function renderTable(){
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
      if(core.selectedStandId === r.standId) tr.classList.add("rowSel");
      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.status;
      const td3 = document.createElement("td");
      td3.textContent = (r.status==="sold" && settings.showNames !== false) ? (r.company||"") : "";
      tr.append(td1, td2, td3);
      tr.addEventListener("click", ()=>{
        markInteracting();
        core.selectStand(r.standId, {fromPlan:false});
      });
      tbody.appendChild(tr);
    }
  }

  function refreshUI(){
    core.applyColoursAdmin();
    renderTable();

    if(!core.selectedStandId){
      core.clearCallout();
      lozenge.style.display = "none";
      core.updateZoom(null, zoomSvgHost, zoomWrap, zoomRing);
      return;
    }

    const row = rows.find(r=>r.standId===core.selectedStandId);
    const company = (row && row.status==="sold" && settings.showNames !== false) ? (row.company||"") : "";
    core.drawCallout(core.selectedStandId, company);
    lozStand.textContent = core.selectedStandId;
    if(company){
      lozCompany.style.display = "";
      lozCompany.textContent = company;
    }else{
      lozCompany.style.display = "none";
      lozCompany.textContent = "";
    }
    lozenge.style.display = "flex";
    core.updateZoom(core.selectedStandId, zoomSvgHost, zoomWrap, zoomRing);
  }

  async function loadAll({isPoll=false}={}){
    // Fetch settings first so the title always updates even if stands fail
    try{
      const s = await fetchJson(`${core.backend()}/settings?_=${Date.now()}`);
      settings = s || settings;
      if(settings.showNames === undefined) settings.showNames = true;
      eventNameTitle.textContent = settings.eventName || "Event";
    }catch(e){
      // keep previous settings
      console.error("Viewer settings fetch failed", e);
    }

    const keep = core.selectedStandId && (shouldRespectUser() || !isPoll);
    const prevSel = keep ? core.selectedStandId : null;

    try{
      await core.loadData();
      rows = core.rows || [];
      if(prevSel) core.selectedStandId = prevSel;
      refreshUI();
      setUpdatedAt();
    }catch(e){
      console.error("Viewer stands load failed", e);
      updatedAt.textContent = "Offline";
      // show backend URL for debugging
      const b = (core && core.backend) ? core.backend() : (getBackendUrl ? getBackendUrl() : "");
      console.warn("Viewer backend:", b);
    }
  }

  async function init(){
    await core.loadSvg();
    core.enablePlanClick({ enabled:true, disableOnMobile:false, onPick:(standId)=>{
      markInteracting();
      core.selectStand(standId, {fromPlan:true});
    }});

    clearBtn.addEventListener("click", ()=>{ searchEl.value=""; renderTable(); });
    searchEl.addEventListener("input", renderTable);

    await loadAll({isPoll:false});
    setInterval(()=> loadAll({isPoll:true}).catch(()=>{}), 12000);
  }

  init().catch(err=>console.error(err));
})();