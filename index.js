(function(){
  const el = (id)=>document.getElementById(id);

  const updatedAt = el("updatedAt");
  const eventNameEl = el("eventName");
  const clearBtn = el("clearBtn");

  const planWrap = el("planWrap");
  const svgHost = el("svgHost");
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
  let exhibitorRows = [];
  let pollTimer = null;

  function renderList(){
    const q = (searchEl.value || "").trim().toLowerCase();
    const filtered = exhibitorRows.filter(r=>{
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    for (const r of filtered){
      const tr = document.createElement("tr");
      if (core && core.selectedStandId === r.standId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.company || "";
      tr.appendChild(td1); tr.appendChild(td2);

      tr.addEventListener("click", ()=> selectStand(r.standId, {fromPlan:false}));
      tbody.appendChild(tr);
    }

    countEl.textContent = String(filtered.length);
    totalEl.textContent = String(exhibitorRows.length);
  }

  function clearSelection(){
    if (!core) return;
    core.selectedStandId = null;
    core.clearCallout();
    selStand.textContent = "None";
    selCompany.textContent = "Desktop: click a stand or choose from the list. Phone: use the list (plan tapping is disabled).";
    renderList();
  }

  function selectStand(id, meta){
    if (!core) return;
    core.selectStand(id, meta||{});
    const row = core.rowById(core.selectedStandId);
    if (!row){
      clearSelection();
      return;
    }
    selStand.textContent = row.standId;
    selCompany.textContent = row.company ? row.company : "(No company name set)";
    core.drawCallout(row.standId, row.company||"");
    renderList();
  }

  clearBtn.addEventListener("click", clearSelection);
  searchEl.addEventListener("input", ()=>{
    renderList();
    clearSearchBtn.disabled = !(searchEl.value||"").trim();
  });
  clearSearchBtn.addEventListener("click", ()=>{
    searchEl.value = "";
    clearSearchBtn.disabled = true;
    renderList();
    searchEl.focus();
  });

  async function pollSettings(){
    try{
      const s = await core.getSettings();
      if (s && typeof s.eventName === "string" && s.eventName.trim()){
        eventNameEl.textContent = s.eventName.trim();
      }
    }catch(e){}
  }

  async function pollOnce(){
    try{
      const prevSel = core.selectedStandId;
      await pollSettings();
      await core.loadStands();

      // list: sold stands with company, plus available with company if you want (keep simple: company non-empty)
      exhibitorRows = core.rows.filter(r=> (r.company||"").trim().length > 0);
      exhibitorRows.sort((a,b)=>a.standId.localeCompare(b.standId, undefined, {numeric:true, sensitivity:"base"}));
      renderList();
      core.applyColoursPublic();

      if (prevSel){
        const still = core.rowById(prevSel);
        if (still){
          core.selectedStandId = prevSel;
          core.drawCallout(still.standId, still.company||"");
          selStand.textContent = still.standId;
          selCompany.textContent = still.company ? still.company : "(No company name set)";
        } else {
          clearSelection();
        }
      }

      updatedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    }catch(e){
      updatedAt.textContent = "Offline";
      console.error(e);
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

  document.addEventListener("visibilitychange", ()=>{
    if (document.hidden) stopPolling();
    else { pollOnce(); startPolling(); }
  });

  window.addEventListener("resize", ()=>{
    if (!core || !core.selectedStandId) return;
    const row = core.rowById(core.selectedStandId);
    if (row) core.drawCallout(row.standId, row.company || "");
  });

  (async ()=>{
    core = new window.FloorplanCore({
      allowBackendOverride: false,
      svgHost, planWrap,
      calloutSvg,
      lozenge, lozStand, lozCompany,
      onSelect: (row)=>{
        selStand.textContent = row.standId;
        selCompany.textContent = row.company ? row.company : "(No company name set)";
      }
    });

    await core.loadSvg();
    await pollOnce();

    // Desktop: allow plan click; Mobile: disable plan tapping
    core.enablePlanClick({enabled:true, disableOnMobile:true});

    clearSearchBtn.disabled = true;
    startPolling();
  })().catch(err=>{
    console.error(err);
    updatedAt.textContent = "Error";
    alert("Public page failed to start. Open DevTools Console for details.");
  });

})();
