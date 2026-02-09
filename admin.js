/* admin.js — Floorplan Admin (zoom + event name + password + stable save)
   Backend: Cloudflare Worker routes:
   GET  /stands
   GET  /settings
   POST /stand      JSON: {standId,status,company,adminPassword}
   POST /settings   JSON: {eventName,adminPassword}
*/
(() => {
  "use strict";

  const BACKEND_DEFAULT = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";
  const AUTH_KEY = "floorplan_admin_authed_pwd";
  const SVG_URL = "./event_plan.svg";

  const el = (id) => document.getElementById(id);

  // iOS Safari can be flaky with SVG/table "click". Use a lightweight tap helper.
  function onTap(node, handler) {
    if (!node) return;
    node.addEventListener("click", handler, { passive: true });
    node.addEventListener(
      "touchend",
      (e) => {
        try {
          e.preventDefault();
        } catch (_) {}
        handler(e);
      },
      { passive: false }
    );
  }

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

  const syncedAt = el("syncedAt");
  const pauseBtn = el("pauseBtn");

  const eventNameEl = el("eventName");
  const setEventBtn = el("setEventBtn");

  const toast = el("toast");
  const toastMsg = el("toastMsg");
  const setBackendBtn = el("setBackendBtn");
  const hideToastBtn = el("hideToastBtn");

  let svgRoot = null;
  let standMap = new Map();
  let rows = [];
  let selectedStandId = null;

  let autoSync = true;
  let syncTimer = null;
  let suspendUntil = 0;
  let isEditing = false;

  function showToast(show, msg){
    if (!toast) return;
    toast.style.display = show ? "flex" : "none";
    if (msg && toastMsg) toastMsg.textContent = msg;
  }

  function normalizeBackendUrl(input) {
    if (!input) return "";
    let s = String(input).trim();
    try {
      const u = new URL(s);
      u.search = "";
      u.hash = "";
      u.pathname = u.pathname.replace(/\/+$/,"");
      return (u.origin + u.pathname).replace(/\/+$/,"");
    } catch {
      return s.replace(/\/+$/,"");
    }
  }

  function getBackendUrl() {
    const saved = localStorage.getItem(BACKEND_KEY);
    const base = (saved && saved.startsWith("http")) ? saved : BACKEND_DEFAULT;
    return normalizeBackendUrl(base);
  }

  async function fetchJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal, cache:"no-store" });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || text || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  function normStandId(s){ return String(s||"").trim().toUpperCase(); }

  function looksLikeStandId(id){
    const s = normStandId(id);
    return /^[A-Z]{1,3}\d{1,3}$/.test(s);
  }

  function buildStandMap() {
    standMap.clear();
    if (!svgRoot) return;
    svgRoot.querySelectorAll("[id]").forEach(node => {
      const key = normStandId(node.id);
      if (looksLikeStandId(key) && !standMap.has(key)) standMap.set(key, node);
    });
    svgRoot.querySelectorAll("[data-stand]").forEach(node => {
      const key = normStandId(node.getAttribute("data-stand"));
      if (looksLikeStandId(key) && !standMap.has(key)) standMap.set(key, node);
    });
  }

  function elementForStand(standId){
    const k = normStandId(standId);
    return standMap.get(k) || null;
  }

  function setFillForElement(elem, rgba) {
    if (!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));

    shapes.forEach(s => {
      const bbox = s.getBBox ? s.getBBox() : null;
      if (bbox && (bbox.width < 6 || bbox.height < 6)) return;
      s.style.fill = rgba;
      s.style.fillOpacity = "1";
    });
  }

  function applyColours() {
    const sold = getComputedStyle(document.documentElement).getPropertyValue("--sold").trim() || "#e63b3b";
    const avail = getComputedStyle(document.documentElement).getPropertyValue("--avail").trim() || "rgba(213,109,50,0.75)";
    rows.forEach(r => {
      const elem = elementForStand(r.standId);
      if (!elem) return;
      setFillForElement(elem, r.status === "sold" ? sold : avail);
    });
  }

  function clearCallout(){
    if (calloutSvg) calloutSvg.innerHTML = "";
    if (lozenge) lozenge.style.display = "none";
    if (lozStand) lozStand.textContent = "—";
    if (lozCompany){
      lozCompany.style.display = "none";
      lozCompany.textContent = "";
    }
  }

  function drawCallout(standId, company){
    const elem = elementForStand(standId);
    if (!elem) { clearCallout(); return; }

    lozStand.textContent = standId;
    if (company){
      lozCompany.style.display = "block";
      lozCompany.textContent = company;
    } else {
      lozCompany.style.display = "none";
      lozCompany.textContent = "";
    }
    lozenge.style.display = "inline-block";

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

    const dotPx = 10;
    const r = dotPx/2;

    calloutSvg.innerHTML = `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,.70)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(0,0,0,.72)"/>
    `;
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

      tr.innerHTML = `<td>${r.standId}</td><td>${r.status === "sold" ? "Sold" : "Available"}</td><td>${r.company || ""}</td>`;
      onTap(tr, () => selectStand(r.standId));
      tbody.appendChild(tr);
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (totalEl) totalEl.textContent = String(rows.length);
  }

  function setSyncedNow(){
    if (!syncedAt) return;
    syncedAt.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }

  function beginSuspend(ms){
    suspendUntil = Date.now() + (ms||0);
  }

  function isSuspended(){
    return Date.now() < suspendUntil || isEditing;
  }

  async function ensureAdminPassword(){
    const cached = sessionStorage.getItem(AUTH_KEY);
    if (cached && cached.trim()) return cached.trim();
    const entered = prompt("Admin password:", "");
    if (entered === null) return null;
    const pwd = String(entered).trim();
    if (!pwd) return null;
    sessionStorage.setItem(AUTH_KEY, pwd);
    return pwd;
  }

  function forceBlackAndWhite(svg){
    const all = svg.querySelectorAll("*");
    all.forEach(n=>{
      if (n.hasAttribute("style")) n.removeAttribute("style");
      if (n.tagName !== "text"){
        n.setAttribute("fill","none");
        n.setAttribute("stroke","black");
        n.setAttribute("stroke-width","1");
      } else {
        n.setAttribute("fill","black");
      }
    });
  }

  function updateZoom(standId){
    if (!zoomSvgHost || !zoomRing) return;
    zoomSvgHost.innerHTML = "";
    zoomRing.style.display = "none";
    if (!standId || !svgRoot) return;

    const clone = svgRoot.cloneNode(true);
        zoomSvgHost.appendChild(clone);

    // Find element in clone by exact ID
    const target = clone.querySelector("#"+CSS.escape(standId));
    let resolved = target;
    if (!resolved){
      resolved = Array.from(clone.querySelectorAll("[id]")).find(n => normStandId(n.id) === standId);
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

  function selectStand(standId) {
    selectedStandId = normStandId(standId);
    const row = rows.find(r => r.standId === selectedStandId);
    if (!row) return;

    standIdEl.value = row.standId;
    statusEl.value = row.status;
    companyEl.value = row.company || "";

    applyColours();
    drawCallout(row.standId, (row.status === "sold") ? (row.company||"") : "");
    renderTable();
    updateZoom(row.standId);
  }

  async function loadSvg() {
    const res = await fetch(SVG_URL, { cache:"no-store" });
    if (!res.ok) throw new Error("Could not load SVG");
    const txt = await res.text();
    svgHost.innerHTML = txt;
    svgRoot = svgHost.querySelector("svg");
    if (!svgRoot) throw new Error("SVG invalid");

    svgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
    svgRoot.style.width = "100%";
    svgRoot.style.height = "auto";
    svgRoot.style.display = "block";

    buildStandMap();

    onTap(svgRoot, (ev) => {
      let node = ev.target;
      for (let i=0; i<10 && node; i++){
        const id = node.id ? normStandId(node.id) : "";
        if (looksLikeStandId(id)) {
          const found = rows.find(r => r.standId === id);
          if (found) selectStand(found.standId);
          return;
        }
        node = node.parentElement;
      }
    });
  }

  async function loadSettings(){
    const backend = getBackendUrl();
    try{
      const settings = await fetchJson(`${backend}/settings`);
      const name = String(settings.eventName || settings.event_name || "").trim();
      if (eventNameEl) eventNameEl.value = name || "";
    }catch(_){}
  }

  async function saveEventName(){
    const name = String(eventNameEl.value || "").trim();
    if (!name) return;
    const pwd = await ensureAdminPassword();
    if (!pwd) return;
    const backend = getBackendUrl();
    beginSuspend(6000);
    try{
      const res = await fetchJson(`${backend}/settings`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ eventName: name, adminPassword: pwd })
      });
      if (res && res.ok === false) throw new Error(res.error || "Save failed");
      await loadSettings();
      setSyncedNow();
    }catch(e){
      const msg = String(e.message||e);
      if (msg.toLowerCase().includes("password")){
        sessionStorage.removeItem(AUTH_KEY);
        showToast(true, "Password rejected. Try again.");
      } else {
        showToast(true, "Couldn't save event name.");
      }
    }
  }

  async function loadData() {
    const backend = getBackendUrl();
    const data = await fetchJson(`${backend}/stands`);
    rows = (Array.isArray(data) ? data : []).map(r => ({
      standId: normStandId(r.standId ?? r.stand ?? r.id),
      status: String(r.status || "available").toLowerCase(),
      company: String(r.company || "").trim()
    })).filter(r => r.standId);

    applyColours();
    renderTable();
    setSyncedNow();
    showToast(false);

    if (selectedStandId) {
      const row = rows.find(r => r.standId === selectedStandId);
      if (row) {
        drawCallout(row.standId, row.status==="sold" ? (row.company||"") : "");
        updateZoom(row.standId);
      }
    }
  }

  async function saveCurrent() {
    if (!selectedStandId) return;
    const backend = getBackendUrl();
    let pwd = sessionStorage.getItem(AUTH_KEY) || "";
    if (!pwd) {
      pwd = await ensureAdminPassword();
      if (!pwd) return;
    }

    const payload = {
      standId: selectedStandId,
      status: statusEl.value,
      company: (statusEl.value === "sold") ? companyEl.value.trim() : "",
      adminPassword: pwd
    };

    beginSuspend(6000);

    try{
      const res = await fetchJson(`${backend}/stand`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if (res && res.ok === false) throw new Error(res.error || "Save failed");
    }catch(e){
      const msg = String(e.message || e);
      if (msg.toLowerCase().includes("password")){
        sessionStorage.removeItem(AUTH_KEY);
        showToast(true, "Password rejected. Try again.");
      } else {
        showToast(true, "Can't reach backend or save failed.");
      }
      return;
    }

    // reload from backend (source of truth)
    try{ await loadData(); }catch(_){}
    selectStand(selectedStandId);
  }

  function wireEditingPause(){
    [companyEl, statusEl, eventNameEl].forEach(inp => {
      if (!inp) return;
      inp.addEventListener("focus", () => { isEditing = true; });
      inp.addEventListener("blur",  () => { isEditing = false; beginSuspend(1500); });
      inp.addEventListener("input", () => { isEditing = true; });
    });
  }

  function startPolling(){
    stopPolling();
    syncTimer = setInterval(async () => {
      if (!autoSync) return;
      if (isSuspended()) return;
      try { await loadData(); } catch(e){ showToast(true, "Can't reach backend right now."); }
    }, 8000);
  }
  function stopPolling(){
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  if (setBackendBtn){
    setBackendBtn.addEventListener("click", () => {
      const current = getBackendUrl();
      const v = prompt("Paste your backend URL:", current);
      if (v && v.trim().startsWith("http")) {
        localStorage.setItem(BACKEND_KEY, v.trim().replace(/\/+$/,""));
        location.reload();
      }
    });
  }
  if (hideToastBtn) hideToastBtn.addEventListener("click", () => showToast(false));

  if (saveBtn) saveBtn.addEventListener("click", saveCurrent);
  if (markAvailBtn) markAvailBtn.addEventListener("click", () => {
    statusEl.value = "available";
    companyEl.value = "";
    saveCurrent();
  });
  if (pauseBtn) pauseBtn.addEventListener("click", () => {
    autoSync = !autoSync;
    pauseBtn.textContent = autoSync ? "Pause sync" : "Resume sync";
    if (autoSync) startPolling(); else stopPolling();
  });

  if (searchEl) searchEl.addEventListener("input", renderTable);
  if (filterEl) filterEl.addEventListener("change", renderTable);
  if (setEventBtn) setEventBtn.addEventListener("click", saveEventName);

  window.addEventListener("resize", () => {
    if (selectedStandId) {
      const row = rows.find(r => r.standId === selectedStandId);
      if (row) {
        drawCallout(row.standId, row.status==="sold" ? (row.company||"") : "");
        updateZoom(row.standId);
      }
    }
  });

  (async () => {
    try {
      await loadSvg();
      wireEditingPause();
      await loadSettings();
      await loadData();
      startPolling();
    } catch(e) {
      console.error(e);
      showToast(true, "Failed to load SVG or backend.");
    }
  })();
})();
