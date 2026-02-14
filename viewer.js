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
  const offlineBanner = el("offlineBanner");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearBtn = el("clearBtn");
  const countEl = el("count");
  const totalEl = el("total");

  let rows = [];
  let settings = { eventName:"Event", showNames:true };


  function normShowNames(v){
    if(v === undefined || v === null) return true;
    if(typeof v === "string"){
      const s = v.trim().toLowerCase();
      if(s === "false" || s === "0" || s === "no" || s === "off") return false;
      if(s === "true" || s === "1" || s === "yes" || s === "on") return true;
    }
    if(v === false || v === 0) return false;
    if(v === true || v === 1) return true;
    return !!v;
  }

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
      tr.style.cursor = "pointer";
      tr.style.userSelect = "none";
      if(core.selectedStandId === r.standId){
        tr.classList.add("rowSel");
        tr.style.background = "rgba(0,0,0,0.06)";
        tr.style.outline = "2px solid rgba(0,0,0,0.12)";
      }
      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.status;
      const td3 = document.createElement("td");
      td3.textContent = (r.status==="sold" && settings.showNames === true) ? (r.company||"") : "";
      tr.append(td1, td2, td3);
      tr.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();
        markInteracting();
        latestUserSelection = r.standId;
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
    const company = (row && row.status==="sold" && settings.showNames === true) ? (row.company||"") : "";
    core.drawCallout(core.selectedStandId, company);
    lozStand.textContent = core.selectedStandId;
    if(company){
      lozCompany.style.display = "";
      lozCompany.textContent = company;
    }else{
      lozCompany.style.display = "none";
      lozCompany.textContent = "";
    }
    lozenge.style.display = "block";
    core.updateZoom(core.selectedStandId, zoomSvgHost, zoomWrap, zoomRing);
  }

  async function loadAll({isPoll=false}={}){
    // Settings first so title updates even if stands fail
    try{
      const s = await fetchJson(`${getBackendUrl()}/settings?_=${Date.now()}`);
      settings = s || settings;
      settings.showNames = normShowNames(settings.showNames);
      
      eventNameTitle.textContent = settings.eventName || "Exhibitors";
    }catch(e){
      console.warn("Viewer settings fetch failed", e);
    }

    const prevSel = (core && core.selectedStandId) ? core.selectedStandId : null;

    try{
      await core.loadStands();
      rows = core.rows || [];
      // Prevent poll races from reverting selection
      if(latestUserSelection) core.selectedStandId = latestUserSelection;
      // rows live on core.rows
      refreshUI();
      setUpdatedAt();
      if(offlineBanner) offlineBanner.style.display = "none";
    }catch(e){
      console.error("Viewer stands fetch failed", e);
      updatedAt.textContent = "Offline";
      // Keep last known rows visible (don't wipe UI)
      refreshUI();
    }
  }

  async function init(){
    await core.loadSvg();
    core.enablePlanClick({ enabled:true, disableOnMobile:false, onPick:(standId)=>{
      // Ignore clicks on non-stand SVG elements
      if(!(core.rows||[]).some(r=>r.standId===standId)) return;
      markInteracting();
      latestUserSelection = standId;
      core.selectStand(standId, {fromPlan:true});
    }});

    clearBtn.addEventListener("click", ()=>{ searchEl.value=""; renderTable(); });
    searchEl.addEventListener("input", renderTable);

    await loadAll({isPoll:false});

    let pollTimer = null;
    function stopPolling(){ if(pollTimer) clearInterval(pollTimer); pollTimer=null; }
    function startPolling(){
      stopPolling();
      pollTimer = setInterval(()=> loadAll({isPoll:true}).catch(()=>{}), 12000);
    }
    startPolling();

    function handleVisibility(){
      if(document.visibilityState === "hidden"){ stopPolling(); return; }
      startPolling();
      loadAll({isPoll:true}).catch(()=>{});
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", ()=>{ stopPolling(); });
  }

  init().catch(err=>console.error(err));
})();