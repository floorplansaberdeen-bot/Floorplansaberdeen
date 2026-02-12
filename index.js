(() => {
  const { el, fetchJson, getBackendUrl } = window.FloorplanShared;

  const svgHost = el("svgHost");
  const planWrap = el("planWrap");
  const planStack = el("planStack");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

  const eventNameTitle = el("eventNameTitle");
  const updatedAt = el("updatedAt");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearSearchBtn = el("clearSearchBtn");
  const countEl = el("count");
  const totalEl = el("total");

  let core = null;
  let soldRows = [];
  let pollTimer = null;
  let isPolling = false;

  function renderList(){
    const q = (searchEl.value||"").trim().toLowerCase();
    const filtered = soldRows.filter(r=>{
      if(!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    filtered.forEach(r=>{
      const tr = document.createElement("tr");
      if(core && core.selectedStandId === r.standId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.company || "";
      tr.appendChild(td1); tr.appendChild(td2);

      tr.addEventListener("click", ()=>{
        core.selectStand(r.standId, {fromPlan:false});
        core.applyColoursPublic();
        core.drawCallout(r.standId, r.company||"");
        renderList();
      });
      tbody.appendChild(tr);
    });

    countEl.textContent = String(filtered.length);
    totalEl.textContent = String(soldRows.length);
  }

  clearSearchBtn.addEventListener("click", ()=>{
    searchEl.value = "";
    clearSearchBtn.disabled = true;
    renderList();
    searchEl.focus();
  });
  searchEl.addEventListener("input", ()=>{
    clearSearchBtn.disabled = !searchEl.value;
    renderList();
  });

  async function pollSettings(){
    try{
      const s = await fetchJson(`${getBackendUrl()}/settings?_=${Date.now()}`);
      if(s && typeof s.eventName === "string" && s.eventName.trim()){
        eventNameTitle.textContent = s.eventName.trim();
      }
    }catch(_){}
  }

  async function pollOnce(){
    if(isPolling) return;
    isPolling = true;
    const nonceAtStart = core ? core.selectionNonce : 0;

    try{
      await pollSettings();
      await core.loadStands();

      soldRows = core.rows.filter(r=>r.status==="sold");
      renderList();

      // Avoid "jump" by refusing to restore selection if user clicked during polling
      if(core.selectionNonce !== nonceAtStart){
        core.applyColoursPublic();
        if(core.selectedStandId){
          const row = core.rows.find(r=>r.standId===core.selectedStandId);
          if(row) core.drawCallout(row.standId, row.company||"");
        }
      } else {
        core.applyColoursPublic();
        if(core.selectedStandId){
          const row = core.rows.find(r=>r.standId===core.selectedStandId);
          if(row) core.drawCallout(row.standId, row.company||"");
          else core.clearCallout();
        }
      }

      updatedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    }catch(e){
      updatedAt.textContent = "Offline";
      console.error(e);
    } finally {
      isPolling = false;
    }
  }

  function startPolling(){ stopPolling(); pollTimer = setInterval(pollOnce, 12000); }
  function stopPolling(){ if(pollTimer) clearInterval(pollTimer); pollTimer=null; }

  window.addEventListener("resize", ()=>{
    if(!core || !core.selectedStandId) return;
    const row = core.rows.find(r=>r.standId===core.selectedStandId);
    if(row) core.drawCallout(row.standId, row.company||"");
  });

  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden) stopPolling();
    else { pollOnce(); startPolling(); }
  });

  async function init(){
    core = new window.FloorplanCore({
      svgHost, planWrap, planStack, calloutSvg,
      lozenge, lozStand, lozCompany,
      onSelect: (row)=>{
        core.applyColoursPublic();
        core.drawCallout(row.standId, row.company||"");
        renderList();
      },
      onClearSelection: ()=>{
        core.applyColoursPublic();
        core.clearCallout();
        renderList();
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
      core.selectStand(standId, {fromPlan:true});
      core.applyColoursPublic();
      const row = core.rows.find(r=>r.standId===standId);
      core.drawCallout(standId, row ? (row.company||"") : "");
      renderList();
    }});

    await pollOnce();
    startPolling();
  }

  init();
})();