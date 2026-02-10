(function(){
  const el = (id)=>document.getElementById(id);

  const syncedAt = el("syncedAt");
  const eventNameEl = el("eventName");
  const setEventBtn = el("setEventBtn");
  const pauseBtn = el("pauseBtn");
  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const resetBtn = el("resetBtn");

  const planStack = el("planStack");
  const planWrap = el("planWrap");
  const svgHost = el("svgHost");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

  const zoomSvgHost = el("zoomSvgHost");

  const tbody = el("tbody");
  const searchEl = el("search");
  const filterEl = el("filter");
  const countEl = el("count");
  const totalEl = el("total");

  const selectedStandIdEl = el("selectedStandId");
  const statusEl = el("status");
  const companyEl = el("company");
  const saveBtn = el("saveBtn");
  const markAvailBtn = el("markAvailBtn");
  const undoBtn = el("undoBtn");

  const progressOverlay = el("progressOverlay");
  const progressTitle = el("progressTitle");
  const progressMsg = el("progressMsg");
  const progressBarFill = el("progressBarFill");
  const csvFile = el("csvFile");

  let core = null;
  let pollTimer = null;
  let paused = false;

  // --- Password (per-session) ---
  let sessionPasswordOk = false;
  async function ensurePassword(){
    if (sessionPasswordOk) return true;
    const pw = prompt("To save changes, enter the admin password:");
    if (pw === null) return false;
    // NOTE: password check is currently client-side placeholder.
    // If you have server-side auth, validate here.
    if (String(pw).trim().length < 1){
      alert("Password required.");
      return false;
    }
    sessionPasswordOk = true;
    return true;
  }

  // --- Undo stack ---
  const UNDO_KEY = "floorplan_admin_undo_v1";
  function loadUndoStack(){
    try{
      const raw = localStorage.getItem(UNDO_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){
      return [];
    }
  }
  function saveUndoStack(arr){
    localStorage.setItem(UNDO_KEY, JSON.stringify(arr.slice(-25)));
    updateUndoBtn();
  }
  function pushUndo(snapshot){
    const stack = loadUndoStack();
    stack.push(snapshot);
    saveUndoStack(stack);
  }
  function popUndo(){
    const stack = loadUndoStack();
    const item = stack.pop();
    saveUndoStack(stack);
    return item;
  }
  function updateUndoBtn(){
    const stack = loadUndoStack();
    undoBtn.disabled = stack.length === 0;
    undoBtn.textContent = "Undo (" + stack.length + ")";
  }

  // --- Progress overlay helpers ---
  function showProgress(title, msg){
    progressTitle.textContent = title || "Working…";
    progressMsg.textContent = msg || "Please keep this tab open.";
    progressBarFill.style.width = "0%";
    progressOverlay.style.display = "flex";
  }
  function setProgress(pct){
    const p = Math.max(0, Math.min(100, pct));
    progressBarFill.style.width = p + "%";
  }
  function hideProgress(){
    progressOverlay.style.display = "none";
  }

  // --- List rendering ---
  function renderTable(){
    const q = (searchEl.value || "").trim().toLowerCase();
    const f = (filterEl.value || "all");
    const filtered = core.rows.filter(r=>{
      if (f !== "all" && r.status !== f) return false;
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    for (const r of filtered){
      const tr = document.createElement("tr");
      if (core.selectedStandId === r.standId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;
      const td2 = document.createElement("td"); td2.textContent = r.status;
      const td3 = document.createElement("td"); td3.textContent = r.company || "";
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);

      tr.addEventListener("click", ()=> selectRow(r.standId, {fromPlan:false}));
      tbody.appendChild(tr);
    }

    countEl.textContent = String(filtered.length);
    totalEl.textContent = String(core.rows.length);
  }

  function selectRow(standId, meta){
    core.selectStand(standId, meta||{});
    const row = core.rowById(core.selectedStandId);
    selectedStandIdEl.value = row ? row.standId : "";
    statusEl.value = row ? row.status : "available";
    companyEl.value = row ? (row.company||"") : "";
    core.drawCallout(row.standId, row.company||"");
    core.applyColoursAdmin();
    renderTable();
    renderZoom(row ? row.standId : null);
  }

  // --- Zoom rendering (raw SVG, just viewBox) ---
  function renderZoom(standId){
    if (!zoomSvgHost || !core || !core.svgEl){
      if (zoomSvgHost) zoomSvgHost.innerHTML = "";
      return;
    }
    if (!standId){
      zoomSvgHost.innerHTML = "";
      return;
    }
    const obj = core.standElements.get(standId);
    if (!obj){ zoomSvgHost.innerHTML = ""; return; }

    // Clone SVG
    const clone = core.svgEl.cloneNode(true);
    clone.style.pointerEvents = "none";
    // compute bbox
    let bb = null;
    try{ bb = obj.group.getBBox(); }catch(e){}
    if (!bb){
      try{ bb = obj.shapes[0].getBBox(); }catch(_){}
    }
    if (!bb){ zoomSvgHost.innerHTML = ""; return; }

    // padding + less zoom (bigger view)
    const pad = Math.max(bb.width, bb.height) * 0.9;
    const x = bb.x - pad;
    const y = bb.y - pad;
    const w = bb.width + pad*2;
    const h = bb.height + pad*2;

    clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    clone.setAttribute("preserveAspectRatio","xMidYMid meet");

    zoomSvgHost.innerHTML = "";
    zoomSvgHost.appendChild(clone);
  }

  // --- Polling ---
  async function pollOnce(){
    if (paused) return;
    try{
      await core.loadStands();
      core.applyColoursAdmin();
      renderTable();
      const sel = core.selectedStandId;
      if (sel){
        const row = core.rowById(sel);
        if (row) core.drawCallout(row.standId, row.company||"");
      }
      syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    }catch(e){
      syncedAt.textContent = "Offline";
      console.error(e);
    }
  }
  function startPolling(){
    stopPolling();
    pollTimer = setInterval(pollOnce, 9000);
  }
  function stopPolling(){
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  pauseBtn.addEventListener("click", ()=>{
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume sync" : "Pause sync";
    if (!paused){ pollOnce(); startPolling(); }
    else stopPolling();
  });

  // --- Event name ---
  setEventBtn.addEventListener("click", async ()=>{
    const name = (eventNameEl.value || "").trim();
    try{
      await core.setSettings({eventName: name});
      alert("Event name saved.");
    }catch(e){
      alert("Couldn't save event name. Check backend.");
      console.error(e);
    }
  });

  // --- Save stand ---
  async function saveCurrent(opts){
    if (!core) return;
    const standId = (selectedStandIdEl.value || "").trim().toUpperCase();
    if (!standId){ alert("Select a stand first."); return; }
    const status = (opts && opts.forceAvailable) ? "available" : statusEl.value;
    const company = (status === "sold") ? (companyEl.value || "").trim() : "";

    const before = core.rowById(standId) || {standId, status:"available", company:""};
    // if switching to sold, ensure company (optional but encouraged)
    if (status === "sold" && !company){
      if (!confirm("No company name entered. Mark as sold anyway?")) return;
    }

    if (!(await ensurePassword())) return;

    try{
      showProgress("Saving…", "Updating stand " + standId);
      await core.updateStand(standId, status, company);
      pushUndo({standId, prevStatus: before.status, prevCompany: before.company});
      await core.loadStands();
      hideProgress();
      core.applyColoursAdmin();
      selectRow(standId, {fromPlan:false});
      syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    }catch(e){
      hideProgress();
      alert("Save failed. Check backend and try again.");
      console.error(e);
    }
  }

  saveBtn.addEventListener("click", ()=>saveCurrent({}));
  markAvailBtn.addEventListener("click", ()=>{
    statusEl.value = "available";
    companyEl.value = "";
    saveCurrent({forceAvailable:true});
  });

  // --- Undo ---
  async function undoLast(){
    const last = popUndo();
    if (!last) return;
    try{
      showProgress("Undoing…", "Restoring " + last.standId);
      await core.updateStand(last.standId, last.prevStatus, last.prevCompany);
      await core.loadStands();
      hideProgress();
      core.applyColoursAdmin();
      selectRow(last.standId, {fromPlan:false});
    }catch(e){
      hideProgress();
      alert("Undo failed.");
      console.error(e);
    }
  }
  undoBtn.addEventListener("click", undoLast);

  // --- CSV Export/Import ---
  function toCsv(rows){
    const cols = ["standId","status","company"];
    const out = [cols.join(",")];
    for (const r of rows){
      const line = [
        r.standId,
        r.status,
        (r.company||"").replace(/"/g,'""')
      ];
      out.push(line.map(v=> (/[,"\n]/.test(v) ? `"${v}"` : v)).join(","));
    }
    return out.join("\n");
  }

  exportBtn.addEventListener("click", ()=>{
    const csv = toCsv(core.rows);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stands.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener("click", ()=>{
    csvFile.value = "";
    csvFile.click();
  });

  function parseCsv(text){
    // simple CSV parser for 3 columns
    const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
    if (!lines.length) return [];
    const header = lines[0].toLowerCase();
    const start = header.includes("stand") ? 1 : 0;
    const rows = [];
    for (let i=start;i<lines.length;i++){
      const line = lines[i];
      const cells = [];
      let cur = "", inQ = false;
      for (let j=0;j<line.length;j++){
        const ch = line[j];
        if (ch === '"' ){
          if (inQ && line[j+1] === '"'){ cur += '"'; j++; }
          else inQ = !inQ;
        } else if (ch === "," && !inQ){
          cells.push(cur); cur="";
        } else cur += ch;
      }
      cells.push(cur);
      const standId = (cells[0]||"").trim().toUpperCase();
      if (!standId) continue;
      const status = (cells[1]||"available").trim().toLowerCase();
      const company = (cells[2]||"").trim();
      rows.push({standId, status: (status==="sold"?"sold":"available"), company});
    }
    return rows;
  }

  csvFile.addEventListener("change", async ()=>{
    const f = csvFile.files && csvFile.files[0];
    if (!f) return;
    if (!(await ensurePassword())) return;

    const text = await f.text();
    const rows = parseCsv(text);
    if (!rows.length){
      alert("No rows found in CSV.");
      return;
    }

    paused = true;
    pauseBtn.textContent = "Resume sync";
    stopPolling();

    try{
      showProgress("Importing CSV…", "Uploading rows");
      for (let i=0;i<rows.length;i++){
        const r = rows[i];
        await core.updateStand(r.standId, r.status, r.status==="sold"?r.company:"");
        setProgress(Math.round(((i+1)/rows.length)*100));
      }
      hideProgress();
      await core.loadStands();
      core.applyColoursAdmin();
      renderTable();
      alert("Import complete.");
    }catch(e){
      hideProgress();
      alert("Import failed. Some rows may have been applied.");
      console.error(e);
    } finally {
      // resume
      paused = false;
      pauseBtn.textContent = "Pause sync";
      pollOnce();
      startPolling();
    }
  });

  // --- Reset all ---
  resetBtn.addEventListener("click", async ()=>{
    if (!confirm("Reset ALL stands to Available and clear companies?")) return;
    if (!(await ensurePassword())) return;

    paused = true;
    pauseBtn.textContent = "Resume sync";
    stopPolling();

    try{
      showProgress("Resetting…", "Marking all stands as available");
      // fetch latest
      await core.loadStands();
      const rows = core.rows.slice();
      for (let i=0;i<rows.length;i++){
        const r = rows[i];
        await core.updateStand(r.standId, "available", "");
        setProgress(Math.round(((i+1)/rows.length)*100));
      }
      hideProgress();
      await core.loadStands();
      core.applyColoursAdmin();
      renderTable();
      alert("Reset complete.");
    }catch(e){
      hideProgress();
      alert("Reset failed.");
      console.error(e);
    } finally {
      paused = false;
      pauseBtn.textContent = "Pause sync";
      pollOnce();
      startPolling();
    }
  });

  // --- Wire up search/filter ---
  searchEl.addEventListener("input", renderTable);
  filterEl.addEventListener("change", renderTable);

  // --- Init ---
  (async ()=>{
    core = new window.FloorplanCore({
      allowBackendOverride: true,
      svgHost, planWrap, planStack, calloutSvg,
      lozenge, lozStand, lozCompany,
      onSelect: (row)=>{
        // also reflect in fields if selection came from plan
        selectedStandIdEl.value = row.standId;
        statusEl.value = row.status;
        companyEl.value = row.company || "";
      }
    });

    await core.loadSvg();
    await core.loadStands();
    core.applyColoursAdmin();
    core.enablePlanClick({enabled:true, disableOnMobile:false});
    renderTable();
    updateUndoBtn();

    // load settings
    try{
      const s = await core.getSettings();
      if (s && typeof s.eventName === "string") eventNameEl.value = s.eventName;
    }catch(e){}

    syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    startPolling();
    console.log("admin loaded");
  })().catch(err=>{
    console.error(err);
    alert("Admin failed to start. Open DevTools Console for details.");
  });

})();
