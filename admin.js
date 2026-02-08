
(() => {
  // Optional: lock admin behind a URL-only secret.
  // Set ADMIN_URL_KEY to a hard-to-guess string, then visit: admin.html?k=YOUR_KEY
  // If you leave it as "CHANGE_ME", the lock is disabled.
  const ADMIN_URL_KEY = "getaway_admin_abdn001";
  const ADMIN_KEY_PARAM = "k";
  if (ADMIN_URL_KEY !== "CHANGE_ME") {
    const u = new URL(location.href);
    if ((u.searchParams.get(ADMIN_KEY_PARAM) || "") !== ADMIN_URL_KEY) {
      document.body.innerHTML = `
        <div style="padding:24px;font-family:ui-sans-serif,system-ui;max-width:720px;margin:0 auto;">
          <h1 style="margin:0 0 8px 0;">Floorplan Admin</h1>
          <p style="margin:0 0 16px 0;">This page is locked. Add <code>?k=…</code> to the URL.</p>
        </div>`;
      return;
    }
  }
  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";
  // SVG file location.
  // Default: ./event_plan.svg
  // You can override via: admin.html?svg=yourfile.svg
  const SVG_URL = (() => {
    const u = new URL(window.location.href);
    const qp = (u.searchParams.get("svg") || "").trim();
    if (qp) return new URL("./" + qp.replace(/^\.\//, ""), u).href;
    return new URL("./event_plan.svg", u).href;
  })();

  const el = (id) => document.getElementById(id);

  const planWrap = el("planWrap");
  const svgHost = el("svgHost");
    const svgFallback = document.getElementById("svgFallback");
  const zoomWrap = el("zoomWrap");
  const zoomSvgHost = el("zoomSvgHost");
  const zoomRing = el("zoomRing");

  const planStack = el("planStack");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

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
  const undoBtn = el("undoBtn");
  // ---- Undo stack (stores previous stand snapshots). Max 25.
  let undoStack = loadUndoStack();
  updateUndoUi();

  async function saveCurrent(options = {}) {
    const standId = String(selectedStandId || "").trim();
    if (!standId) return;

    const desiredStatus = normalizeStatus(statusEl.value);
    const desiredCompany = desiredStatus === "sold" ? String(companyEl.value || "").trim() : "";

    await applyUpdateStand(standId, desiredStatus, desiredCompany, { skipUndo: !!options.skipUndo });
  }

  async function markAvailableSelected() {
    const standId = String(selectedStandId || "").trim();
    if (!standId) return;

    statusEl.value = "available";
    companyEl.value = "";
    await applyUpdateStand(standId, "available", "", { skipUndo: false });
  }

  async function applyUpdateStand(standId, status, company, { skipUndo } = {}) {
    // Prompt for password once before the first write action in this session.
    const adminPassword = await ensureAdminPassword("To save changes, enter the admin password.");
    if (!adminPassword) return; // user cancelled

    const idx = rows.findIndex(r => String(r.standId || "").trim() === standId);
    if (idx === -1) return toast("Stand not found: " + standId, "error");

    const prev = { standId: rows[idx].standId, status: rows[idx].status, company: rows[idx].company };

    const payload = { standId, status, company, adminPassword };

    // Optimistic UI update
    rows[idx] = { standId, status, company };
    paintSvg();
    refreshList();
    drawCallout(standId);

    try {
      await postJson(getBackendUrl() + "/stand", payload);

      if (!skipUndo) pushUndo(prev);

      toast("Saved", "success");

      // Refresh from source-of-truth after write
      await loadData(true);
    } catch (err) {
      // Revert optimistic update
      rows[idx] = prev;
      paintSvg();
      refreshList();
      drawCallout(standId);

      toast(err?.message ? String(err.message) : "Save failed", "error");
    }
  }

  // Wire buttons
  saveBtn.addEventListener("click", () => saveCurrent());
  markAvailBtn.addEventListener("click", () => markAvailableSelected());

  // Enter in company field triggers save
  companyEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveCurrent();
    }
  });

  // Undo button
  undoBtn.addEventListener("click", async () => {
    const snap = undoStack.shift();
    saveUndoStack();
    updateUndoUi();
    if (!snap) return;

    selectStand(snap.standId);
    statusEl.value = snap.status;
    companyEl.value = snap.company || "";
    await applyUpdateStand(snap.standId, snap.status, snap.company || "", { skipUndo: true });
  });

  function pushUndo(prevSnapshot) {
    if (!prevSnapshot || !prevSnapshot.standId) return;
    undoStack.unshift(prevSnapshot);
    if (undoStack.length > 25) undoStack.length = 25;
    saveUndoStack();
    updateUndoUi();
  }

  function loadUndoStack() {
    try {
      const raw = sessionStorage.getItem("floorplan_admin_undo") || "[]";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 25) : [];
    } catch {
      return [];
    }
  }

  function saveUndoStack() {
    try { sessionStorage.setItem("floorplan_admin_undo", JSON.stringify(undoStack.slice(0, 25))); } catch {}
  }

  function updateUndoUi() {
    const n = undoStack.length;
    undoBtn.textContent = `Undo (${undoStack.length})`;
    undoBtn.disabled = n === 0;
    undoBtn.style.opacity = n === 0 ? "0.45" : "1";
  }

  async function resetAll() {
  if (!rows.length) return;

  const pwd = ensureAdminPassword({force:true, reason:"Reset all"});
  if (!pwd) return;

  // Pause auto-sync while resetting to avoid clashes
  const wasAutoSync = autoSync;
  autoSync = false;
  stopPolling();

  const ok = confirm("Reset SVG stands to Available? This will overwrite sold stands on the plan.");
  if (!ok) return;

  resetBtn.disabled = true;
  const backend = getBackendUrl();

  // Only reset stands that exist in the SVG
  const targets = rows.filter(r => !!elementForStand(r.standId));
  const total = targets.length;

  try{
    for (let i=0;i<total;i++){
      const r = targets[i];
      showProgress("Resetting stands…", `Updating ${i+1} of ${total} (${r.standId})`, (i+1)/total);

      const payload = { standId: r.standId, status:"available", company:"", adminPassword: pwd };
      const resp = await fetchJson(`${backend}/stand`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });

      if (resp && resp.ok === false){
        hideProgress();
        alert(String(resp.error || "Reset failed."));
        resetBtn.disabled = false;
        return;
      }

            // small delay to avoid Apps Script rate limits
      await new Promise(r => setTimeout(r, 120));

      // update local copy
      const idx = rows.findIndex(x => x.standId === r.standId);
      if (idx >= 0) rows[idx] = { standId: r.standId, status:"available", company:"" };
    }

    hideProgress();
    resetBtn.disabled = false;

    applyColours();
    renderTable();
    updateUndoUI();
clearCallout();
    selectedStandId = null;
    standIdEl.value = "";
    statusEl.value = "available";
    companyEl.value = "";
    syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});

    flashToast("Reset complete ✅");
    autoSync = wasAutoSync;
    if (autoSync) startPolling();
  }catch(e){
    hideProgress();
    resetBtn.disabled = false;
    showToast(true);
    console.error(e);
    autoSync = wasAutoSync;
    if (autoSync) startPolling();
  }
}

  // Events
  saveBtn.addEventListener("click", saveCurrent);
  if (setEventBtn){
    setEventBtn.addEventListener("click", (e) => {
      e.preventDefault();
      saveEventName();
    });
  }
  // Press Enter in the Company field to save
  companyEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      saveCurrent();
    }
  });
  markAvailBtn.addEventListener("click", () => {
    statusEl.value = "available";
    companyEl.value = "";
    saveCurrent();
  });

  if (undoBtn) undoBtn.addEventListener("click", undoLast);
searchEl.addEventListener("input", renderTable);
  filterEl.addEventListener("change", renderTable);
  pauseBtn.addEventListener("click", () => {
    autoSync = !autoSync;
    pauseBtn.textContent = autoSync ? "Pause sync" : "Resume sync";
    if (autoSync) startPolling(); else stopPolling();
  });

  exportBtn.addEventListener("click", () => {
    const _pwd = ensureAdminPassword({force:true, reason:"Export CSV"});
    if (!_pwd) return;

    const lines = ["standId,status,company"].concat(rows.map(r => {
      const c = (r.company||"").replaceAll('"','""');
      return `${r.standId},${r.status},"${c}"`;
    }));
    const blob = new Blob([lines.join("\n")], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stands.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  
importBtn.addEventListener("click", () => {
  // Pick file first, then ask for password (so Cancel doesn't still open Finder)
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".csv,text/csv";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;

    const _pwd = ensureAdminPassword({ force:true, reason:"Import CSV" });
    if (!_pwd) return;

    const backend = getBackendUrl();

    // Stop polling while we apply a batch update (otherwise it will overwrite the imported changes)
    const wasAuto = autoSync;
    autoSync = false;
    stopPolling();
    pauseBtn.textContent = "Resume sync";

    try{
      const txt = await f.text();
      const lines = txt.split(/\r?\n/).filter(Boolean);
      const out = [];
      for (let i=1;i<lines.length;i++){
        const line = lines[i];
        const m = line.match(/^([^,]+),([^,]+),"(.*)"$/);
        if (!m) continue;
        out.push({
          standId: normStandId(m[1]),
          status: String(m[2]||"").trim().toLowerCase(),
          company: (m[3]||"").replaceAll('""','"')
        });
      }

      if (!out.length){
        flashToast("CSV had no rows to import.");
        return;
      }

      showProgress("Importing CSV to Google Sheet…", 0, out.length);

      // Apply each row to the backend (Google Sheet is source of truth)
      for (let i=0;i<out.length;i++){
        const r = out[i];
        const payload = {
          standId: r.standId,
          status: (r.status === "sold") ? "sold" : "available",
          company: (r.status === "sold") ? (r.company||"").trim() : "",
          adminPassword: _pwd
        };

        await fetchJson(`${backend}/stand`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify(payload)
        });

        // progress
        showProgress("Importing CSV to Google Sheet…", i+1, out.length);

        // tiny yield keeps UI responsive on big imports
        await new Promise(res => setTimeout(res, 30));
      }

      hideProgress();
      flashToast("Import complete.");

      // Reload from backend (source of truth)
      await loadData();

    }catch(e){
      console.error(e);
      hideProgress();
      showToast(true);
      flashToast("Import failed (check password / backend).");
    }finally{
      // Restore polling state to what it was
      autoSync = wasAuto;
      pauseBtn.textContent = autoSync ? "Pause sync" : "Resume sync";
      if (autoSync) startPolling();
    }
  };
  inp.click();
});


resetBtn.addEventListener("click", resetAll);

  window.addEventListener("scroll", () => { if (selectedStandId) drawCallout(selectedStandId); }, { passive:true });
  window.addEventListener("resize", () => { if (selectedStandId) drawCallout(selectedStandId); });

  function startPolling(){
    stopPolling();
    syncTimer = setInterval(async () => {
      if (!autoSync) return;
      if (isEditing()) return; // don't refresh while typing/choosing
      if (saveInFlight) return; // don't refresh while saving
      try { await loadData(); await loadSettings(); } catch(e){ showToast(true); }
    }, 8000);
  }
  function stopPolling(){
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  // init
  (async () => {
    try{
      const ok = await requireAdminPassword();
      if (!ok) { setStatus('Password required.'); return; }
      await loadSettings();
      await loadSvg();
      layoutMobile();
      await loadSettings();
    }catch(e){
      // Don't abort the whole page if SVG fails (still allow list + editing)
      showToast(true);
      console.error(e);
    }
    try{
      if (!isEditing()) await loadData();
      startPolling();
    }catch(e){
      showToast(true);
      console.error(e);
    }
  })();
})();

  function layoutMobile(){
    // Only on small screens
    if (window.matchMedia && !window.matchMedia('(max-width: 640px)').matches) return;
    const plan = document.querySelector('.planCard');
    const selected = document.getElementById('selectedCard');
    const tableWrap = document.getElementById('tableWrap');
    if (!plan || !selected || !tableWrap) return;

    // Compute top offset for selected card just below plan card
    const planRect = plan.getBoundingClientRect();
    // planRect.top should be 0 when sticky; use its height
    const top = Math.round(planRect.height + 12); // small gap
    selected.style.top = top + 'px';

    // Compute available height for tableWrap (viewport minus header minus sticky blocks)
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 0;

    // Heights of sticky blocks (planCard includes its own header, plan, label bay, legend)
    const planH = plan ? plan.getBoundingClientRect().height : 0;
    const selectedH = selected ? selected.getBoundingClientRect().height : 0;

    // Leave a little breathing room
    const available = Math.max(200, window.innerHeight - headerH - planH - selectedH - 24);

    tableWrap.style.maxHeight = available + 'px';
  }


