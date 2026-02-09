/* admin.js — Clean, stable admin (backend critical)
   - GET /stands, GET /settings, POST /stand, POST /settings
   - password comes from backend /settings (if provided) OR prompts each session before first write
*/
(() => {
  "use strict";
  const F = window.Floorplan;

  // OPTIONAL: URL-only secret lock (set to "" to disable)
  const ADMIN_URL_KEY = "CHANGE_ME"; // set to same secret you use in URL: admin.html?k=SECRET
  const URL_PARAM = "k";

  const SVG_URL = "./event_plan.svg";
  const SESSION_AUThed = "floorplan_admin_authed_pwd";

  const el = F.$;
  const svgHost = el("svgHost");
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

  const eventNameEl = el("eventName");
  const setEventBtn = el("setEventBtn");

  const pauseBtn = el("pauseBtn");
  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const resetBtn = el("resetBtn");

  const toast = el("toast");
  const toastMsg = el("toastMsg");
  const setBackendBtn = el("setBackendBtn");
  const hideToastBtn = el("hideToastBtn");
  const syncedAt = el("syncedAt");

  let svgRoot = null;
  let standMap = new Map();
  let rows = [];
  let selectedStandId = null;
  let autoSync = true;
  let syncTimer = null;
  let settings = null;
  let isEditing = false;

  function showToast(show, msg) {
    if (toastMsg && msg) toastMsg.textContent = msg;
    if (toast) toast.style.display = show ? "flex" : "none";
  }

  function enforceUrlLock() {
    if (!ADMIN_URL_KEY || ADMIN_URL_KEY === "CHANGE_ME") return;
    const u = new URL(location.href);
    const got = (u.searchParams.get(URL_PARAM) || "").trim();
    if (got !== ADMIN_URL_KEY) {
      document.body.innerHTML = `
        <div style="padding:24px;font-family:ui-sans-serif,system-ui;max-width:720px;margin:0 auto;">
          <div style="font-weight:900;font-size:20px;margin-bottom:8px;">Floorplan Admin</div>
          <div>This page is locked. Add <code>?k=…</code> to the URL.</div>
        </div>`;
      throw new Error("Admin locked");
    }
  }

  function fmtTime() {
    return new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }

  async function loadSettings() {
    const backend = F.getBackendUrl();
    try {
      settings = await F.fetchJson(`${backend}/settings`);
      if (eventNameEl) eventNameEl.value = (settings && settings.eventName) ? String(settings.eventName) : "";
    } catch (e) {
      settings = null;
      // keep going (stands may still load)
    }
  }

  function getAdminPasswordFromSettings() {
    if (!settings) return "";
    const pwd =
      settings.adminPassword ||
      settings.password ||
      settings.admin_pass ||
      settings.admin_password ||
      "";
    return String(pwd || "").trim();
  }

  async function ensurePasswordOnce() {
    const required = getAdminPasswordFromSettings();
    if (!required) return true; // no password configured upstream
    if (sessionStorage.getItem(SESSION_AUThed) === "1") return true;

    const entered = prompt("Admin password required:", "");
    if (entered === null) return false;
    if (String(entered) !== required) {
      alert("Incorrect password.");
      return false;
    }
    sessionStorage.setItem(SESSION_AUThed, "1");
    return true;
  }

  async function loadSvg() {
    const svg = await F.loadSvgInline(SVG_URL, svgHost);
    svgRoot = svg;
    standMap = F.buildStandMap(svgRoot);

    svgRoot.addEventListener("click", (ev) => {
      const standId = F.findClickedStandId(ev.target, rows);
      if (standId) selectStand(standId);
    }, { passive:true });
  }

  function normRow(row){
    return {
      standId: String(row.standId ?? row.stand ?? row.id ?? "").trim().toUpperCase(),
      status: String(row.status || "available").toLowerCase(),
      company: String(row.company || "").trim()
    };
  }

  async function loadData() {
    const backend = F.getBackendUrl();
    const data = await F.fetchJson(`${backend}/stands`);
    rows = (Array.isArray(data) ? data : []).map(normRow).filter(r => r.standId);
    F.applyColoursAdmin(rows, standMap, getComputedStyle(document.documentElement));
    renderTable();
    if (syncedAt) syncedAt.textContent = fmtTime();
    showToast(false);
  }

  function renderTable(){
    const q = (searchEl?.value || "").trim().toLowerCase();
    const f = (filterEl?.value || "all").toLowerCase();

    const filtered = rows.filter(r => {
      if (f !== "all" && r.status !== f) return false;
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    filtered.forEach(r => {
      const tr = document.createElement("tr");
      if (selectedStandId && r.standId === selectedStandId) tr.classList.add("active");

      const td1 = document.createElement("td"); td1.textContent = r.standId;

      const td2 = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + (r.status === "sold" ? "bSold" : "bAvail");
      badge.textContent = r.status === "sold" ? "Sold" : "Available";
      td2.appendChild(badge);

      const td3 = document.createElement("td"); td3.textContent = r.company || "";

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.addEventListener("click", () => selectStand(r.standId));
      tbody.appendChild(tr);
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (totalEl) totalEl.textContent = String(rows.length);
  }

  function selectStand(standId){
    selectedStandId = String(standId||"").trim().toUpperCase();
    const row = rows.find(r => r.standId === selectedStandId);

    if (standIdEl) standIdEl.value = selectedStandId;
    if (statusEl) statusEl.value = row ? row.status : "available";
    if (companyEl) companyEl.value = row ? (row.company||"") : "";

    F.applyColoursAdmin(rows, standMap, getComputedStyle(document.documentElement));

    const elStand = F.elementForStand(standMap, selectedStandId);
    const company = (row && row.status === "sold") ? (row.company||"") : "";
    F.drawCallout({
      standElem: elStand,
      standId: selectedStandId,
      company,
      planStack,
      calloutSvg,
      lozenge,
      lozStand,
      lozCompany
    });

    renderTable();
  }

  async function saveCurrent(nextStatusOverride=null){
    if (!selectedStandId) return;
    const ok = await ensurePasswordOnce();
    if (!ok) return;

    const backend = F.getBackendUrl();
    const status = nextStatusOverride || (statusEl?.value || "available");
    const company = (status === "sold") ? String(companyEl?.value || "").trim() : "";

    try {
      await F.fetchJson(`${backend}/stand`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          standId: selectedStandId,
          status,
          company,
          adminPassword: getAdminPasswordFromSettings()
        })
      });
    } catch (e) {
      showToast(true, "Can't reach the backend right now.");
      console.error(e);
      return;
    }

    // Update local
    const idx = rows.findIndex(r => r.standId === selectedStandId);
    if (idx >= 0) rows[idx] = { standId: selectedStandId, status, company };
    F.applyColoursAdmin(rows, standMap, getComputedStyle(document.documentElement));
    renderTable();
    selectStand(selectedStandId);
    if (syncedAt) syncedAt.textContent = fmtTime();
  }

  async function setEventName(){
    const ok = await ensurePasswordOnce();
    if (!ok) return;
    const backend = F.getBackendUrl();
    const name = String(eventNameEl?.value || "").trim();
    try{
      await F.fetchJson(`${backend}/settings`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ eventName: name, adminPassword: getAdminPasswordFromSettings() })
      });
    }catch(e){
      showToast(true, "Can't reach backend to save event name.");
      console.error(e);
      return;
    }
    // refresh settings
    await loadSettings();
  }

  function startPolling(){
    stopPolling();
    syncTimer = setInterval(async () => {
      if (!autoSync || isEditing) return;
      try { await loadData(); } catch(e){ showToast(true, "Can't reach backend."); }
    }, 8000);
  }
  function stopPolling(){
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  function exportCsv(){
    const ok = sessionStorage.getItem(SESSION_AUThed) === "1" || !getAdminPasswordFromSettings();
    if (!ok) { // require prompt now
      ensurePasswordOnce().then(passed => { if (passed) exportCsv(); });
      return;
    }
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
  }

  function importCsv(){
    const ok = sessionStorage.getItem(SESSION_AUThed) === "1" || !getAdminPasswordFromSettings();
    const go = async () => {
      const inp = document.createElement("input");
      inp.type="file";
      inp.accept=".csv,text/csv";
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const txt = await f.text();
        const lines = txt.split(/\r?\n/).filter(Boolean);
        const updates = [];
        for (let i=1;i<lines.length;i++){
          const line = lines[i];
          const m = line.match(/^([^,]+),([^,]+),"(.*)"$/);
          if (!m) continue;
          updates.push({ standId: String(m[1]).trim().toUpperCase(), status: String(m[2]).trim().toLowerCase(), company: m[3].replaceAll('""','"') });
        }
        // push updates to sheet via backend
        for (const u of updates){
          try{
            await F.fetchJson(`${F.getBackendUrl()}/stand`, {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ standId:u.standId, status:u.status, company:u.status==="sold"?u.company:"", adminPassword: getAdminPasswordFromSettings() })
            });
          }catch(e){
            showToast(true, "Import failed to reach backend.");
            console.error(e);
            return;
          }
        }
        await loadData();
      };
      inp.click();
    };

    if (ok) { go(); return; }
    ensurePasswordOnce().then(passed => { if (passed) go(); });
  }

  async function resetAll(){
    const ok = await ensurePasswordOnce();
    if (!ok) return;
    if (!confirm("Reset ALL stands to Available?")) return;

    // Reset only stands that exist in rows (and map). This keeps it safe.
    for (const r of rows){
      try{
        await F.fetchJson(`${F.getBackendUrl()}/stand`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ standId:r.standId, status:"available", company:"", adminPassword: getAdminPasswordFromSettings() })
        });
      }catch(e){
        showToast(true, "Reset failed to reach backend.");
        console.error(e);
        return;
      }
    }
    await loadData();
    alert("Reset complete.");
  }

  function wireEditingPause(){
    const on = () => { isEditing = true; };
    const off = () => { isEditing = false; };
    [companyEl, eventNameEl, searchEl].forEach(inp => {
      if (!inp) return;
      inp.addEventListener("focus", on);
      inp.addEventListener("input", on);
      inp.addEventListener("blur", off);
    });
  }

  // Backend URL setter
  setBackendBtn?.addEventListener("click", () => {
    const current = F.getBackendUrl();
    const v = prompt("Paste your backend base URL:", current);
    if (v && v.trim().startsWith("http")) {
      F.setBackendUrl(v.trim());
      location.reload();
    }
  });
  hideToastBtn?.addEventListener("click", () => showToast(false));

  // init
  (async () => {
    try { enforceUrlLock(); } catch { return; }

    try {
      await loadSettings();
      await loadSvg();
    } catch (e) {
      console.error(e);
      showToast(true, "Couldn't load SVG. Is event_plan.svg in the same folder?");
      return;
    }

    try {
      await loadData();
      startPolling();
    } catch (e) {
      console.error(e);
      showToast(true, "Couldn't load data from backend.");
    }

    wireEditingPause();

    // UI wiring
    searchEl?.addEventListener("input", renderTable);
    filterEl?.addEventListener("change", renderTable);

    saveBtn?.addEventListener("click", () => saveCurrent());
    // Enter on company saves
    companyEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); saveCurrent(); }
    });
    markAvailBtn?.addEventListener("click", () => saveCurrent("available"));

    setEventBtn?.addEventListener("click", setEventName);

    pauseBtn?.addEventListener("click", () => {
      autoSync = !autoSync;
      pauseBtn.textContent = autoSync ? "Pause sync" : "Resume sync";
    });

    exportBtn?.addEventListener("click", exportCsv);
    importBtn?.addEventListener("click", importCsv);
    resetBtn?.addEventListener("click", resetAll);

    // keep callout correct on resize/scroll
    const redraw = () => {
      if (!selectedStandId) return;
      const row = rows.find(r => r.standId === selectedStandId);
      const elStand = F.elementForStand(standMap, selectedStandId);
      const company = (row && row.status === "sold") ? (row.company||"") : "";
      F.drawCallout({ standElem: elStand, standId: selectedStandId, company, planStack, calloutSvg, lozenge, lozStand, lozCompany });
    };
    window.addEventListener("resize", redraw);
    window.addEventListener("scroll", redraw, true);
  })();
})();
