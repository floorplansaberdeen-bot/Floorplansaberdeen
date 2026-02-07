
(() => {
  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";
  const SVG_URL = new URL("./event_plan.svg", window.location.href).href;

  const el = (id) => document.getElementById(id);

  const planWrap = el("planWrap");
  const svgHost = el("svgHost");
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

  const toast = el("toast");
  const toastMsg = el("toastMsg");
  const toastActions = toast ? toast.querySelector(".actions") : null;
  const progressOverlay = el("progressOverlay");
  const progressTitle = el("progressTitle");
  const progressMsg = el("progressMsg");
  const progressBarFill = el("progressBarFill");
  const setBackendBtn = el("setBackendBtn");
  const hideToastBtn = el("hideToastBtn");
  const syncedAt = el("syncedAt");

  const eventNameEl = el("eventName");
  const setEventBtn = el("setEventBtn");
  const pauseBtn = el("pauseBtn");
  const exportBtn = el("exportBtn");
  const importBtn = el("importBtn");
  const resetBtn = el("resetBtn");

  let svgRoot = null;
  let standMap = new Map();

  let rows = [];
  let selectedStandId = null;

  
  // ---- Undo stack (up to 25) ----
  const UNDO_KEY = "fp_admin_undo_stack_v1";
  function loadUndoStack(){ try{ return JSON.parse(localStorage.getItem(UNDO_KEY)||"[]")||[]; }catch(_){ return []; } }
  function saveUndoStack(stack){ localStorage.setItem(UNDO_KEY, JSON.stringify(stack.slice(-25))); }
  function pushUndo(entry){
    const stack = loadUndoStack();
    stack.push(entry);
    saveUndoStack(stack);
    updateUndoButton();
  }
  function popUndo(){
    const stack = loadUndoStack();
    const entry = stack.pop();
    saveUndoStack(stack);
    updateUndoButton();
    return entry;
  }
  function updateUndoButton(){
    const btn = document.getElementById("undoBtn");
    if(!btn) return;
    const stack = loadUndoStack();
    btn.disabled = stack.length === 0;
    btn.textContent = `Undo (${stack.length})`;
  }
  async function doUndo(){
    const entry = popUndo();
    if(!entry) return;
    selectStand(entry.standId);
    statusEl.value = entry.prevStatus;
    companyEl.value = entry.prevCompany || "";
    await saveCurrent({ skipUndo:true, silent:true, reason:"Undo" });
    toast(`Undone: ${entry.standId}`, "ok");
  }

let autoSync = true;
  let syncTimer = null;
  let adminPassword = sessionStorage.getItem('admin_pwd') || '';
  let saveInFlight = false;

  // Pause auto-refresh while the user is editing fields (prevents resets mid-typing)
  function isEditing(){
    const ae = document.activeElement;
    return ae === companyEl || ae === statusEl || ae === eventNameEl;
  }

  function normalizeBackendUrl(input) {
    if (!input) return "";
    let s = String(input).trim();
    try {
      const u = new URL(s);
      let p = u.pathname.replace(/\/+$/,"");
      p = p.replace(/\/(api\/stands|stands)$/i, "");
      p = p.replace(/\/+$/,"");
      u.pathname = p ? p : "/";
      u.search = "";
      u.hash = "";
      const base = u.origin + (u.pathname === "/" ? "" : u.pathname);
      return base.replace(/\/+$/,"");
    } catch (e) {
      s = s.replace(/\/+$/,"");
      s = s.replace(/\/(api\/stands|stands)$/i, "");
      return s.replace(/\/+$/,"");
    }
  }

  function getBackendUrl() {
    const saved = localStorage.getItem(BACKEND_KEY);
    const base = (saved && saved.startsWith("http")) ? saved : DEFAULT_BACKEND;
    return normalizeBackendUrl(base);
  }

function showProgress(title, msg, frac){
  if (!progressOverlay) return;
  if (progressTitle) progressTitle.textContent = title || "Updating…";
  if (progressMsg) progressMsg.textContent = msg || "Please keep this tab open.";
  const f = Math.max(0, Math.min(1, Number(frac || 0)));
  if (progressBarFill) progressBarFill.style.width = `${Math.round(f*100)}%`;
  progressOverlay.style.display = "flex";
}
function hideProgress(){
  if (!progressOverlay) return;
  progressOverlay.style.display = "none";
  if (progressBarFill) progressBarFill.style.width = "0%";
}

function flashToast(message){
  if (!toast) return;
  if (toastMsg) toastMsg.textContent = message || "";
  if (toastActions) toastActions.style.display = "none";
  toast.style.display = "flex";
  setTimeout(() => {
    toast.style.display = "none";
    if (toastActions) toastActions.style.display = "";
  }, 1800);
}

function showToast(show) {
    toast.style.display = show ? "flex" : "none";
  }

  setBackendBtn.addEventListener("click", () => {
    const current = getBackendUrl();
    const v = prompt("Paste your backend URL (Cloudflare Worker or Google Apps Script Web App):", current);
    if (v && v.trim().startsWith("http")) {
      localStorage.setItem(BACKEND_KEY, v.trim().replace(/\/+$/,""));
      location.reload();
    }
  });
  hideToastBtn.addEventListener("click", () => showToast(false));

  async function fetchJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }
  function ensureAdminPassword(opts = {}){
  const force = !!opts.force; // if true, always ask again
  if (!force && adminPassword && adminPassword.trim()) return adminPassword;

  const entered = prompt(`Admin password${opts && opts.reason ? " ("+opts.reason+")" : ""}:`, "");
  if (entered === null) return null; // cancelled

  const v = String(entered || "").trim();
  if (!v) return null;

  adminPassword = v;
  sessionStorage.setItem("admin_pwd", adminPassword);
  return adminPassword;
}

  function clearAdminPassword(){
    adminPassword = "";
    sessionStorage.removeItem("admin_pwd");
  }


  function normStandId(s){ return String(s||"").trim().toUpperCase(); }
  function normRow(row) {
    return {
      standId: normStandId(row.standId ?? row.stand ?? row.id),
      status: String(row.status || "available").toLowerCase(),
      company: String(row.company || "").trim()
    };
  }

  function normalizeDomId(id) {
    return String(id || "")
      .trim()
      .toUpperCase()
      .replace(/^STAND[_-]?/,"")
      .replace(/^ZONE[_-]?/,"")
      .replace(/^ID[_-]?/,"")
      .replace(/[^A-Z0-9]/g,"");
  }

  
function hitTestStandAtClient(clientX, clientY){
  if (!svgRoot) return null;
  const svg = svgRoot;
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const sp = pt.matrixTransform(ctm.inverse());

  // Try geometry hit-test
  for (const [key, elem] of standMap.entries()){
    const geoms = [];
    if (elem instanceof SVGGeometryElement) geoms.push(elem);
    else geoms.push(...Array.from(elem.querySelectorAll("path,rect,polygon,polyline,circle,ellipse")));
    for (const g of geoms){
      try{
        if (typeof g.isPointInFill === "function" && g.isPointInFill(sp)) return key;
        if (typeof g.isPointInStroke === "function" && g.isPointInStroke(sp)) return key;
      }catch(e){}
    }
  }
  // Fallback bbox
  for (const [key, elem] of standMap.entries()){
    let bb=null;
    try{ bb = (elem.getBBox ? elem.getBBox() : null); }catch(e){ bb=null; }
    if (!bb) continue;
    if (sp.x >= bb.x && sp.x <= bb.x+bb.width && sp.y >= bb.y && sp.y <= bb.y+bb.height) return key;
  }
  return null;
}

function buildStandMap() {
    standMap.clear();
    if (!svgRoot) return;
    svgRoot.querySelectorAll("[id]").forEach(node => {
      const key = normalizeDomId(node.id);
      if (key && !standMap.has(key)) standMap.set(key, node);
    });
    svgRoot.querySelectorAll("[data-stand]").forEach(node => {
      const key = normalizeDomId(node.getAttribute("data-stand"));
      if (key && !standMap.has(key)) standMap.set(key, node);
    });
  }

  function elementForStand(standId){
    return standMap.get(normalizeDomId(standId)) || null;
  }

  function setFillForElement(elem, rgba) {
    if (!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));

    shapes.forEach(s => {
      const bbox = s.getBBox ? s.getBBox() : null;
      if (bbox && (bbox.width < 8 || bbox.height < 8)) return;
      s.style.fill = rgba;
      s.style.fillOpacity = "1";
    });
  }

  function clearCallout(){
    while (calloutSvg.firstChild) calloutSvg.removeChild(calloutSvg.firstChild);
    calloutSvg.style.display = "none";
    lozenge.style.display = "none";
    lozStand.textContent = "—";
    lozCompany.style.display = "none";
    lozCompany.textContent = "";
  }

  function drawCallout(standId){
    const row = rows.find(r => r.standId === normStandId(standId));
    const elem = row ? elementForStand(row.standId) : elementForStand(standId);
    if (!elem) { clearCallout(); return; }

    // Update lozenge content
    lozStand.textContent = row ? row.standId : standId;
    const company = (row && row.status === "sold") ? (row.company || "") : "";
    if (company){
      lozCompany.style.display = "block";
      lozCompany.textContent = company;
    } else {
      lozCompany.style.display = "none";
      lozCompany.textContent = "";
    }
    lozenge.style.display = "inline-block";
    planStack.classList.remove("noSel");

    // Force layout so getBoundingClientRect is accurate
    void lozenge.offsetWidth;

    requestAnimationFrame(() => {
      const standRect = elem.getBoundingClientRect();
      const standPt = { x: standRect.left + standRect.width/2, y: standRect.top + standRect.height/2 };

      const lozRect = lozenge.getBoundingClientRect();
      const lozTop = { x: lozRect.left + lozRect.width/2, y: lozRect.top };

      const stackRect = planStack.getBoundingClientRect();
      const x1 = lozTop.x - stackRect.left;
      const y1 = lozTop.y - stackRect.top;
      const x2 = standPt.x - stackRect.left;
      const y2 = standPt.y - stackRect.top;

      calloutSvg.setAttribute("viewBox", `0 0 ${stackRect.width} ${stackRect.height}`);
      calloutSvg.setAttribute("preserveAspectRatio", "none");
      calloutSvg.setAttribute("width", String(stackRect.width));
      calloutSvg.setAttribute("height", String(stackRect.height));
      calloutSvg.style.display = "block";

      const dotPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dot")) || 10;
      const r = dotPx / 2;

      const NS = "http://www.w3.org/2000/svg";
      while (calloutSvg.firstChild) calloutSvg.removeChild(calloutSvg.firstChild);

      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "rgba(0,0,0,.70)");
      line.setAttribute("stroke-width", "3");
      line.setAttribute("stroke-linecap", "round");

      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(x2));
      dot.setAttribute("cy", String(y2));
      dot.setAttribute("r", String(r));
      dot.setAttribute("fill", "rgba(0,0,0,.72)");

      calloutSvg.appendChild(line);
      calloutSvg.appendChild(dot);
    });
  }

  function applyColours() {
    const sold = getComputedStyle(document.documentElement).getPropertyValue("--sold").trim();
    const avail = getComputedStyle(document.documentElement).getPropertyValue("--avail").trim();
    rows.forEach(r => {
      const elem = elementForStand(r.standId);
      if (!elem) return;
      setFillForElement(elem, r.status === "sold" ? sold : avail);
    });
  }

  function renderTable() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const f = filterEl.value;

    const filtered = rows.filter(r => {
      if (f !== "all" && r.status !== f) return false;
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML = "";
    filtered.forEach(r => {
      const tr = document.createElement("tr");
      if (r.standId === selectedStandId) tr.classList.add("active");

      const td1 = document.createElement("td");
      td1.textContent = r.standId;

      const td2 = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + (r.status === "sold" ? "bSold" : "bAvail");
      badge.textContent = r.status === "sold" ? "Sold" : "Available";
      td2.appendChild(badge);

      const td3 = document.createElement("td");
      td3.textContent = r.company || "";

      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.addEventListener("click", () => selectStand(r.standId));
      tbody.appendChild(tr);
    });

    countEl.textContent = String(filtered.length);
    totalEl.textContent = String(rows.length);
  }

  function selectStand(standId) {
    selectedStandId = normStandId(standId);
    const row = rows.find(r => r.standId === selectedStandId);
    if (!row) return;

    standIdEl.value = row.standId;
    statusEl.value = row.status;
    companyEl.value = row.company || "";

    drawCallout(row.standId);
    renderTable();
    updateUndoButton();
updateZoom(row.standId);
  }

  function forceBlackAndWhite(svg){
    // Remove any embedded images (logos) so the zoom is clean
    svg.querySelectorAll("image").forEach(img => img.remove());

    const shapesSel = "path,rect,polygon,polyline,ellipse,circle,line";
    svg.querySelectorAll("*").forEach(n => {
      if (n.hasAttribute("style")) n.removeAttribute("style");

      // Keep text readable: black fill, no stroke
      if (n.tagName && n.tagName.toLowerCase() === "text"){
        n.setAttribute("fill","black");
        n.removeAttribute("stroke");
        n.removeAttribute("stroke-width");
        return;
      }

      // Only force B/W on actual drawable shapes
      if (n.matches && n.matches(shapesSel)){
        n.setAttribute("fill","none");
        n.setAttribute("stroke","black");
        n.setAttribute("stroke-width","1");
      }
    });
  }

  function updateZoom(standId) {
    zoomSvgHost.innerHTML = "";
    zoomRing.style.display = "none";
    if (!standId || !svgRoot) return;

    const clone = svgRoot.cloneNode(true);
    forceBlackAndWhite(clone);
    zoomSvgHost.appendChild(clone);

    let resolved = clone.querySelector("#"+CSS.escape(standId));
    if (!resolved){
      const key = normalizeDomId(standId);
      resolved = Array.from(clone.querySelectorAll("[id]")).find(n => normalizeDomId(n.id) === key);
    }
    if (!resolved || !resolved.getBBox) return;

    const bbox = resolved.getBBox();
    const pad = Math.max(40, Math.max(bbox.width, bbox.height) * 0.9);
    const vx = bbox.x - pad;
    const vy = bbox.y - pad;
    const vw = bbox.width + pad*2;
    const vh = bbox.height + pad*2;

    clone.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    clone.setAttribute("preserveAspectRatio","xMidYMid meet");
    clone.style.width = "100%";
    clone.style.height = "auto";
    clone.style.display = "block";

    requestAnimationFrame(() => {
      const r = resolved.getBoundingClientRect();
      const zw = zoomWrap.getBoundingClientRect();
      const cx = (r.left + r.right)/2 - zw.left;
      const cy = (r.top + r.bottom)/2 - zw.top;
      const radius = Math.max(18, Math.min(60, Math.max(r.width, r.height) * 0.9));

      zoomRing.style.display = "block";
      zoomRing.style.width = `${radius*2}px`;
      zoomRing.style.height = `${radius*2}px`;
      zoomRing.style.left = `${cx - radius}px`;
      zoomRing.style.top = `${cy - radius}px`;
    });
  }

  async function requireAdminPassword(){
  const backend = getBackendUrl();
  let settings = null;
  try{
    settings = await fetchJson(`${backend}/settings`);
  }catch(e){
    // If settings route fails, allow access (but admin actions may still fail)
    return true;
  }

  const pwd = (settings && (settings.adminPassword || settings.password || settings.admin_pass || settings.admin_password)) || "";
  const required = String(pwd || "").trim();
  if (!required) return true;

  // If we already have a password cached for this session, accept it
  if (adminPassword && adminPassword.trim()) return true;

  const entered = prompt(`Admin password${opts && opts.reason ? " ("+opts.reason+")" : ""}:`, "");
  if (entered === null) return false; // cancelled

  const v = String(entered || "").trim();
  if (!v) return false;

  // Store entered password for subsequent actions (actual validation happens on save/reset/etc)
  adminPassword = v;
  sessionStorage.setItem("admin_pwd", adminPassword);
  return true;
}
  async function loadSettings(){
    const backend = getBackendUrl();
    let settings = null;
    try{
      settings = await fetchJson(`${backend}/settings`);
    }catch(e){
      return;
    }
    const name = (settings && (settings.eventName || settings.name || settings.event || settings.title)) || "";
    if (name && eventNameEl) eventNameEl.value = String(name);
  }

  async function saveEventName(){
    if (!eventNameEl) return;
    const name = String(eventNameEl.value || "").trim();
    if (!name) { alert("Please enter an event name."); return; }

    // Must be user-triggered (Set button) so prompt works on iOS Safari
    ensureAdminPassword();

    const backend = getBackendUrl();
    let resp = null;
    try{
      resp = await fetchJson(`${backend}/settings`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ eventName: name, adminPassword })
      });
    }catch(e){
      showToast(true);
      alert("Could not save event name (backend unreachable).");
      return;
    }

    if (resp && resp.ok === false){
      const msg = String(resp.error || "Event name save failed.");
      if (/invalid admin password/i.test(msg)){
        clearAdminPassword();
        alert("Incorrect admin password. Please try again.");
      } else {
        alert(msg);
      }
      return;
    }

    // Re-read settings to confirm (source of truth)
    await loadSettings();
    const after = String(eventNameEl.value || "").trim();
    if (after !== name){
      alert('Event name did not update on the backend (it reverted to: "' + after + '").');
    } else {
      syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    }
  }


  let settingsSaveTimer = null;
  function scheduleSaveEventName(){
    if (!eventNameEl) return;
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(async () => {
      const backend = getBackendUrl();
      const payload = { eventName: eventNameEl.value.trim() };
      try{
        await fetchJson(`${backend}/settings`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify(payload)
        });
        syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
      }catch(e){
        showToast(true);
      }
    }, 600);
  }

  async function loadSvg() {
    const res = await fetch(SVG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load SVG");
    const txt = await res.text();
    svgHost.innerHTML = txt;
    svgRoot = svgHost.querySelector("svg");
    if (!svgRoot) throw new Error("SVG invalid");

    // Hide any stray huge circle at 0,0 (artifact)
    svgRoot.querySelectorAll("circle").forEach(c => {
      const cx = c.getAttribute("cx"), cy = c.getAttribute("cy"), r = parseFloat(c.getAttribute("r") || "0");
      if ((cx === "0" || cx === "0.0") && (cy === "0" || cy === "0.0") && r >= 20) {
        c.style.display = "none";
      }
    });

    svgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
    svgRoot.style.width = "100%";
    svgRoot.style.height = "auto";
    svgRoot.style.display = "block";

    // If stand numbers/text are on a separate layer, they can block clicks.
    // Make text/images ignore pointer events so clicks reach the stand shapes.
    svgRoot.querySelectorAll("text,image").forEach(n => {
      try{ n.style.pointerEvents = "none"; }catch(e){}
    });

    buildStandMap();
    // Visual hint: stands are clickable on desktop
    standMap.forEach((node) => { try{ node.style.cursor = "pointer"; }catch(e){} });

    // click-to-select
    svgRoot.style.pointerEvents = "auto";
    svgRoot.style.pointerEvents = "auto";
    // Ensure shapes receive pointer events (some SVGs disable this)
    svgRoot.querySelectorAll("path,rect,polygon,polyline,ellipse,circle,g").forEach(n => {
      try{ n.style.pointerEvents = "all"; }catch(e){}
    });

    
svgRoot.addEventListener("click", (ev) => {
  // First: try direct id in composed path / ancestors
  const path = (typeof ev.composedPath === "function") ? ev.composedPath() : null;
  const candidates = path && path.length ? path : [ev.target];

  for (const c of candidates){
    if (!c || !c.id) continue;
    const key = normalizeDomId(c.id);
    const found = rows.find(r => normalizeDomId(r.standId) === key);
    if (found){ selectStand(found.standId); return; }
  }

  // Second: robust hit test (fixes A2)
  const hitKey = hitTestStandAtClient(ev.clientX, ev.clientY);
  if (!hitKey) return;
  const found = rows.find(r => normalizeDomId(r.standId) === hitKey);
  if (found) selectStand(found.standId);
}, { passive:true });
  }

  async function loadData() {
    const backend = getBackendUrl();
    const data = await fetchJson(`${backend}/stands?ts=${Date.now()}`);
    rows = (Array.isArray(data) ? data : []).map(normRow).filter(r => r.standId);

    applyColours();
    renderTable();
    updateUndoButton();
syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    showToast(false);

    // keep selection after refresh
    if (selectedStandId) {
      const row = rows.find(r => r.standId === selectedStandId);
      if (row) {
        statusEl.value = row.status;
        companyEl.value = row.company || "";
        drawCallout(row.standId);
      }
    }
  }

  async function saveCurrent(opts = {}) {
    await ensureAdminPassword();
    saveInFlight = true;
    if (!selectedStandId) { saveInFlight = false; return; }
    const backend = getBackendUrl();
    const payload = {
      standId: selectedStandId,
      status: statusEl.value,
      company: (statusEl.value === "sold") ? companyEl.value.trim() : "",
      adminPassword: adminPassword
    };

    try{
      const resp = await fetchJson(`${backend}/stand`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
    
      if (resp && resp.ok === false){
        const msg = String(resp.error || "Save failed.");
        if (/invalid admin password/i.test(msg)){
          clearAdminPassword();
          alert("Incorrect admin password. Please try again.");
        } else {
          alert(msg);
        }
        return;
      }
}catch(e){
      showToast(true);
      return;
    }finally{
      saveInFlight = false;
    }

    const idx = rows.findIndex(r => r.standId === selectedStandId);
    if (idx >= 0) rows[idx] = payload;

    applyColours();
    renderTable();
    updateUndoButton();
drawCallout(selectedStandId);

    // Pull fresh data back from backend (authoritative) to prevent reverts
    try{ await loadData(); }catch(e){}
    syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
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
    updateUndoButton();
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

  
  undoBtn.addEventListener("click", doUndo);
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
      showToast(true);
      console.error(e);
      return;
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


