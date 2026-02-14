(() => {
  const { el, fetchJson, getBackendUrl } = window.FloorplanShared;

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

  const tbody = el("tbody");
  const searchEl = el("search");
  const filterEl = el("filter");
  const countEl = el("count");
  const totalEl = el("total");

  const standIdEl = el("standId");
  const statusEl = el("status");
  const companyEl = el("company");
  const saveBtn = el("saveBtn");
  const markAvailBtn = el("markAvailBtn");

  const eventNameEl = el("eventName");
  const setEventBtn = el("setEventBtn");

  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const resetBtn = el("resetBtn");
  const pauseBtn = el("pauseBtn");
  const undoBtn = el("undoBtn");

  const toast = el("toast");
  const toastMsg = el("toastMsg");  const hideToastBtn = el("hideToastBtn");
  const syncedAt = el("syncedAt");

  const progressOverlay = el("progressOverlay");
  const progressTitle = el("progressTitle");
  const progressMsg = el("progressMsg");
  const progressBarFill = el("progressBarFill");

  const lockState = el("lockState");

  let core = null;
  let autoSync = true;
  let syncTimer = null;
  let selectedStandId = null;
  let rows = [];
  let isBusy = false;
  let isUserEditing = false;

  let lastChange = null; // single undo (reliable)

  const SESSION_PWD = "admin_session_pwd";
  const SESSION_PWD_UNTIL = "admin_session_pwd_until";
  const PWD_TTL_MS = 24*60*60*1000; // 24 hours


  function setUnlocked(unlocked){
    if(unlocked){
      lockState.textContent = "🔓 Unlocked";
      lockState.classList.add("unlocked");
    } else {
      lockState.textContent = "🔒 Locked";
      lockState.classList.remove("unlocked");
    }
  }
  function getPwd(){ return sessionStorage.getItem(SESSION_PWD) || ""; }
  function setPwd(p){ sessionStorage.setItem(SESSION_PWD, p); setUnlocked(true); }
  function clearPwd(){
    localStorage.removeItem(SESSION_PWD);
    localStorage.removeItem(SESSION_PWD_UNTIL);
    setUnlocked(false); }

  async function promptPassword({always=false, reason="Admin password required"}={}) {
    if(!always){
      const cached = getPwd();
      if(cached) return cached;
    }

    // Modal password prompt (masked)
    const modal = document.getElementById("pwdModal");
    const input = document.getElementById("pwdInput");
    const reasonEl = document.getElementById("pwdReason");
    const btnOk = document.getElementById("pwdOk");
    const btnCancel = document.getElementById("pwdCancel");

    if(!modal || !input || !reasonEl || !btnOk || !btnCancel){
      const entered = window.prompt(reason, "");
      if(entered === null) return null;
      const pwd = String(entered).trim();
      if(!pwd) return null;
      setPwd(pwd);
      return pwd;
    }

    reasonEl.textContent = reason;
    // If this is a mandatory prompt (page load), remove cancel option
    if(always){
      btnCancel.style.display = "none";
    } else {
      btnCancel.style.display = "";
    }

    return await new Promise((resolve)=>{
      let done=false;
      const cleanup = ()=>{
        btnOk.removeEventListener("click", onOk);
        btnCancel.removeEventListener("click", onCancel);
        input.removeEventListener("keydown", onKey);
      };
      const finish = (val)=>{
        if(done) return;
        done=true;
        modal.style.display="none";
        cleanup();
        resolve(val);
      };
      const onOk = ()=>{
        const pwd = String(input.value||"").trim();
        if(!pwd) return;
        setPwd(pwd);
        finish(pwd);
      };
      const onCancel = ()=>{ if(always){ return; } finish(null); };
      const onKey = (e)=>{
        if(e.key==="Enter"){ e.preventDefault(); onOk(); }
        if(e.key==="Escape"){ e.preventDefault(); if(!always) onCancel(); }
      };

      input.value="";
      modal.style.display="flex";
      input.focus();

      btnOk.addEventListener("click", onOk);
      btnCancel.addEventListener("click", onCancel);
      input.addEventListener("keydown", onKey);
    });
  }

  function showToast(msg){
    toastMsg.textContent = msg || "Can't reach the backend right now.";
    toast.style.display = "flex";
  }
  function hideToast(){ toast.style.display = "none"; }

    hideToastBtn.addEventListener("click", hideToast);

  function setBusyState(b){
    isBusy = b;
    saveBtn.disabled = b;
    markAvailBtn.disabled = b;
    exportBtn.disabled = b;
    importBtn.disabled = b;
    resetBtn.disabled = b;
    setEventBtn.disabled = b;
    undoBtn.disabled = b || !lastChange;
  }

  function showProgress(title, msg, pct){
    progressOverlay.style.display = "flex";
    progressTitle.textContent = title || "Updating…";
    progressMsg.textContent = msg || "Please keep this tab open.";
    progressBarFill.style.width = `${Math.max(0, Math.min(100, pct||0))}%`;
  }
  function hideProgress(){
    progressOverlay.style.display = "none";
    progressBarFill.style.width = "0%";
  }

  function renderTable(){
    const q = (searchEl.value||"").trim().toLowerCase();
    const f = filterEl.value;

    const filtered = rows.filter(r=>{
      if(f !== "all" && r.status !== f) return false;
      if(!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    filtered.forEach(r=>{
      const tr = document.createElement("tr");
      if(selectedStandId === r.standId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;

      const td2 = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + (r.status === "sold" ? "bSold" : "bAvail");
      badge.textContent = r.status === "sold" ? "Sold" : "Available";
      td2.appendChild(badge);

      const td3 = document.createElement("td"); td3.textContent = r.company || "";

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.addEventListener("click", ()=> core.selectStand(r.standId, {fromPlan:false}));
      tbody.appendChild(tr);
    });

    countEl.textContent = String(filtered.length);
    totalEl.textContent = String(rows.length);
  }

  function selectStand(id){
    selectedStandId = id || null;
    const row = rows.find(r=>r.standId === selectedStandId);

    if(!row){
      // Clear everything when clicking off plan
      standIdEl.value = "";
      statusEl.value = "available";
      companyEl.value = "";

      core.applyColoursAdmin();
      core.clearCallout();
      renderTable();
      core.updateZoom(null, zoomSvgHost, zoomWrap, zoomRing);
      return;
    }

    standIdEl.value = row.standId;
    statusEl.value = row.status;
    companyEl.value = row.company || "";

    core.applyColoursAdmin();
    core.drawCallout(
      row.standId,
      row.status==="sold" ? (row.company||"") : ""
    );

    renderTable();
    core.updateZoom(row.standId, zoomSvgHost, zoomWrap, zoomRing);
  }


  async function loadSettings(){
    try{
      const s = await fetchJson(`${getBackendUrl()}/settings?_=${Date.now()}`);
      if(s && typeof s.eventName === "string") eventNameEl.value = s.eventName;

      // Apply Viewer show/hide setting to UI
      const tgl = el("viewerNamesToggle");
      const st  = el("viewerNamesState");
      const openViewerBtn = el("openViewerBtn");
      if(tgl && typeof s.showNames !== "undefined"){
        tgl.checked = (s.showNames === true);
        if(st) st.textContent = tgl.checked ? "On" : "Off";
      }
      if(openViewerBtn){
        openViewerBtn.href = "viewer.html";
      }
    }catch(_){}
  }

  async function loadData(){
    const data = await fetchJson(`${getBackendUrl()}/stands?_=${Date.now()}`);
    rows = (Array.isArray(data)?data:[]).map(r=>({
      standId: String(r.standId||"").trim().toUpperCase(),
      status: String(r.status||"available").toLowerCase(),
      company: String(r.company||"").trim()
    })).filter(r=>r.standId);

    core.rows = rows;
    core.applyColoursAdmin();
    renderTable();
    syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    hideToast();
  }

  async function postStand(payload, pwd){
    return await fetchJson(`${getBackendUrl()}/stand`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ ...payload, adminPassword: pwd })
    });
  }

  async function postSettings(payload, pwd){
    return await fetchJson(`${getBackendUrl()}/settings`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ ...payload, adminPassword: pwd })
    });
  }

  function stopPolling(){ if(syncTimer) clearInterval(syncTimer); syncTimer=null; }
  function startPolling(){
    stopPolling();
    syncTimer = setInterval(async ()=>{
      if(!autoSync) return;
      if(isBusy || isUserEditing) return;
      try{
        await loadData();
        if(selectedStandId){
          const row = rows.find(r=>r.standId===selectedStandId);
          if(row){
            core.drawCallout(row.standId, row.status==="sold" ? (row.company||"") : "");
            core.updateZoom(row.standId, zoomSvgHost, zoomWrap, zoomRing);
          }
        }
  function handleVisibility(){
    if(document.visibilityState === "hidden"){ stopPolling(); return; }
    startPolling();
    loadData().catch(()=>{});
  }
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", ()=>{ stopPolling(); });

      }catch(_){
        showToast("Can't reach the backend right now.");
      }
    }, 8000);
  }

  pauseBtn.addEventListener("click", ()=>{
    autoSync = !autoSync;
    pauseBtn.textContent = autoSync ? "Pause sync" : "Resume sync";
    if(autoSync) startPolling(); else stopPolling();
  });

  // Pause polling while typing
  document.addEventListener("focusin", (e)=>{
    if(e.target === companyEl || e.target === eventNameEl) isUserEditing = true;
  });
  document.addEventListener("focusout", (e)=>{
    if(e.target === companyEl || e.target === eventNameEl) setTimeout(()=>{ isUserEditing=false; }, 350);
  });

  async function saveCurrent(){
    if(!selectedStandId) return;
    const row = rows.find(r=>r.standId===selectedStandId);
    if(!row) return;

    const nextStatus = statusEl.value;
    const nextCompany = (nextStatus==="sold") ? companyEl.value.trim() : "";
    const prevStatus = row.status;
    const prevCompany = row.company || "";

    const pwd = await promptPassword({always:false, reason:"Admin password (save/export):"});
    if(pwd === null) return;

    setBusyState(true);
    stopPolling();
    try{
      await postStand({ standId:selectedStandId, status:nextStatus, company:nextCompany }, pwd);
      lastChange = { standId:selectedStandId, prevStatus, prevCompany, nextStatus, nextCompany };
      undoBtn.disabled = false;

      await loadData();
      selectStand(selectedStandId);
    }catch(e){
      clearPwd();
      showToast("Save failed (password wrong or backend offline).");
    }finally{
      setBusyState(false);
      if(autoSync) startPolling();
    }
  }

  saveBtn.addEventListener("click", saveCurrent);
  companyEl.addEventListener("keydown", (e)=>{
    if(e.key==="Enter"){ e.preventDefault(); saveCurrent(); }
  });
  markAvailBtn.addEventListener("click", ()=>{
    statusEl.value = "available";
    companyEl.value = "";
    saveCurrent();
  });

  undoBtn.addEventListener("click", async ()=>{
    if(!lastChange) return;
    const pwd = await promptPassword({always:false, reason:"Admin password (save/export):"});
    if(pwd === null) return;

    setBusyState(true);
    stopPolling();
    try{
      await postStand({
        standId:lastChange.standId,
        status:lastChange.prevStatus,
        company:(lastChange.prevStatus==="sold") ? (lastChange.prevCompany||"") : ""
      }, pwd);

      lastChange = null;
      undoBtn.disabled = true;

      await loadData();
      if(selectedStandId) selectStand(selectedStandId);
    }catch(e){
      clearPwd();
      showToast("Undo failed (password wrong or backend offline).");
    }finally{
      setBusyState(false);
      if(autoSync) startPolling();
    }
  });

  setEventBtn.addEventListener("click", async ()=>{
    const pwd = await promptPassword({always:false, reason:"Admin password (save/export):"});
    if(pwd === null) return;

    setBusyState(true);
    stopPolling();
    try{
      await postSettings({ eventName: (eventNameEl.value||"").trim() || "New Event" }, pwd);
      await loadSettings();
    }catch(e){
      clearPwd();
      showToast("Could not save event name (password wrong or backend offline).");
    }finally{
      setBusyState(false);
      if(autoSync) startPolling();
    }
  });

  exportBtn.addEventListener("click", async ()=>{
    const pwd = await promptPassword({always:false, reason:"Admin password (save/export):"});
    if(pwd === null) return;

    const lines = ["standId,status,company"].concat(rows.map(r=>{
      const c = (r.company||"").replaceAll('"','""');
      return `${r.standId},${r.status},"${c}"`;
    }));
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
    const fileName = "stands.csv";

    // Best experience on phones (iOS/Android): share sheet when available
    try{
      if(navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, {type: blob.type})] })){
        const file = new File([blob], fileName, {type: blob.type});
        await navigator.share({ files: [file], title: "Export CSV" });
        return;
      }
    }catch(_){}

    // Fallback: download via temporary link (works on desktop + many Android browsers)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);

    // iOS Safari sometimes ignores download attribute; open a new tab as last resort
    if(/iPad|iPhone|iPod/.test(navigator.userAgent)){
      setTimeout(()=>{
        try{ window.open(url, "_blank"); }catch(_){}
      }, 250);
    }
  });


  importBtn.addEventListener("click", ()=>{
    // IMPORTANT: trigger file picker synchronously inside the user gesture (mobile Safari requirement)
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".csv,text/csv";
    inp.style.display = "none";
    document.body.appendChild(inp);

    inp.onchange = async ()=>{
      const f = inp.files && inp.files[0];
      if(!f){
        try{ inp.remove(); }catch(_){}
        return;
      }

      const pwd = await promptPassword({always:true, reason:"Admin password (import CSV):"});
      if(pwd === null){
        try{ inp.remove(); }catch(_){}
        return;
      }

      setBusyState(true);
      stopPolling();
      try{
        const txt = await f.text();

        // Robust CSV parsing: supports quoted/unquoted company, extra columns, and different header names
        const lines = String(txt).replaceAll("\r","").split("\n").filter(l => l && l.trim().length>0);
        const updates = [];

        const parseLine = (line) => {
          const out = [];
          let cur = "";
          let inQ = false;
          for(let i=0;i<line.length;i++){
            const ch = line[i];
            if(ch === '"'){
              if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
              else inQ = !inQ;
            }else if(ch === ',' && !inQ){
              out.push(cur);
              cur = "";
            }else{
              cur += ch;
            }
          }
          out.push(cur);
          return out.map(v => (v ?? "").trim());
        };

        // Try to detect a header row
        const header = parseLine(lines[0]).map(h => h.toLowerCase());
        const idxStand = header.findIndex(h => ["standid","stand_id","stand","id"].includes(h));
        const idxStatus = header.findIndex(h => ["status","state"].includes(h));
        const idxCompany = header.findIndex(h => ["company","exhibitor","name"].includes(h));

        const hasHeader = (idxStand !== -1 && idxStatus !== -1);

        const standCol = idxStand !== -1 ? idxStand : 0;
        const statusCol = idxStatus !== -1 ? idxStatus : 1;
        const companyCol = idxCompany !== -1 ? idxCompany : 2;

        const startRow = hasHeader ? 1 : 0;

        for(let i=startRow;i<lines.length;i++){
          const cols = parseLine(lines[i]);
          const standId = String((cols[standCol] ?? "")).trim().toUpperCase();
          if(!standId) continue;

          const s = String((cols[statusCol] ?? "")).trim().toLowerCase();
          const status = (s==="sold" || s==="s" || s==="yes" || s==="true") ? "sold" : "available";

          const company = status==="sold" ? String((cols[companyCol] ?? "")).trim() : "";
          updates.push({ standId, status, company });
        }

        const backendIds = new Set(rows.map(r=>r.standId));
        const svgIds = new Set(Array.from(core.standMap.keys()));
        const filtered = updates.filter(u=>backendIds.has(u.standId) && svgIds.has(u.standId));

        if(filtered.length===0){
          showToast("No matching stands found in CSV (must match SVG stand IDs).");
          return;
        }

        showProgress("Importing CSV…", `Updating 0 / ${filtered.length}`, 0);
        for(let i=0;i<filtered.length;i++){
          const u = filtered[i];
          showProgress("Importing CSV…", `Updating ${i+1} / ${filtered.length} (${u.standId})`, Math.round(((i+1)/filtered.length)*100));
          await postStand(u, pwd);
        }
        hideProgress();

        await loadData();
        if(selectedStandId) selectStand(selectedStandId);
      }catch(e){
        hideProgress();
        showToast("Import failed (password wrong or backend offline).");
      }finally{
        try{ inp.remove(); }catch(_){}
        setBusyState(false);
        if(autoSync) startPolling();
      }
    };

    inp.click();
  });



  resetBtn.addEventListener("click", async ()=>{
    const pwd = await promptPassword({always:true, reason:"Admin password (RESET ALL):"});
    if(pwd === null) return;

    if(!confirm("Reset all SVG stands to Available (clears company names)?")) return;

    const typed = prompt("Type RESET to confirm wiping all stands:");
    if(typed !== "RESET") { showToast("Reset cancelled."); return; }


    setBusyState(true);
    stopPolling();
    try{
      const svgIds = new Set(Array.from(core.standMap.keys()));
      const targets = rows.filter(r=>svgIds.has(r.standId));
      showProgress("Resetting…", `Updating 0 / ${targets.length}`, 0);
      for(let i=0;i<targets.length;i++){
        const r = targets[i];
        showProgress("Resetting…", `Updating ${i+1} / ${targets.length} (${r.standId})`, Math.round(((i+1)/targets.length)*100));
        await postStand({ standId:r.standId, status:"available", company:"" }, pwd);
      }
      hideProgress();
      await loadData();
      if(selectedStandId) selectStand(selectedStandId);
      showToast("Reset complete.");
      setTimeout(()=>hideToast(), 1800);
    }catch(e){
      hideProgress();
      showToast("Reset failed (password wrong or backend offline).");
    }finally{
      setBusyState(false);
      if(autoSync) startPolling();
    }
  });

  searchEl.addEventListener("input", renderTable);
  filterEl.addEventListener("change", renderTable);

  window.addEventListener("resize", ()=>{
    if(!selectedStandId) return;
    const row = rows.find(r=>r.standId===selectedStandId);
    if(row) core.drawCallout(row.standId, row.status==="sold" ? (row.company||"") : "");
  });

  async function init(){
    // Always request password on page load (masked)
    const bootPwd = await promptPassword({always:true, reason:"Admin password required"});
    if(!bootPwd){
      setUnlocked(false);
      // If user cancels/escapes, do not allow entry to admin
      location.href = "index.html";
      return;
    }

    core = new window.FloorplanCore({
      svgHost, planWrap, planStack, calloutSvg,
      lozenge, lozStand, lozCompany,
      onSelect: (row)=> selectStand(row.standId),
      onClearSelection: ()=> selectStand(null)
    });

    try{
      await core.loadSvg();
    }catch(e){
      showToast("Could not load SVG. Make sure event_plan.svg is in the same folder.");
      console.error(e);
      return;
    }

    // Enable clicking the plan (all devices)
    core.enablePlanClick({ enabled:true, disableOnMobile:false, onPick:(standId)=>{
      // Use core.selectStand so core tracks selection and miss-click clearing works
      core.selectStand(standId, {fromPlan:true});
    }});

    try{
      await loadSettings();
      await loadData();
      startPolling();
    }catch(e){
      showToast("Can't reach backend right now.");
      console.error(e);
    }

    if(getPwd()) setUnlocked(true);
  }

  
  // Viewer names toggle (requires password + typed confirm)
  const viewerNamesToggle = el("viewerNamesToggle");
  const viewerNamesState = el("viewerNamesState");
  if(viewerNamesToggle){
    viewerNamesToggle.addEventListener("change", async ()=>{
      const desired = !!viewerNamesToggle.checked;

      const openViewerBtn = el("openViewerBtn");
      if(openViewerBtn){ openViewerBtn.href = `viewer.html`; }

      const pwd = await promptPassword({always:true, reason:"Admin password required"});
      if(pwd === null){
        viewerNamesToggle.checked = !desired;
        return;
      }

      const typed = prompt('Type CONFIRM to ' + (desired ? 'SHOW' : 'HIDE') + ' company names in Viewer:');
      if(typed !== "CONFIRM"){
        viewerNamesToggle.checked = !desired;
        showToast("Cancelled.");
        return;
      }

      try{
        const current = await fetchJson(`${getBackendUrl()}/settings?_=${Date.now()}`);
        await fetchJson(`${getBackendUrl()}/settings`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ eventName: current.eventName || "", showNames: desired, adminPassword: pwd })
        });
        if(viewerNamesState) viewerNamesState.textContent = desired ? "On" : "Off";
        const openViewerBtn = el("openViewerBtn");
        if(openViewerBtn){ openViewerBtn.href = `viewer.html`; }
        showToast("Viewer setting saved.");
      }catch(e){
        showToast("Viewer link updated. (Backend may not persist this setting.)");
      }
    });
  }

  init();

})();