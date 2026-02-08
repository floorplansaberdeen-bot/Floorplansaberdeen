(() => {
  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";
  const SVG_URL = "./event_plan.svg"; // adjust if you use a different file

  const el = (id) => document.getElementById(id);
  const planWrap = el("planWrap");
  const svgHost = el("svgHost");
  const overlay = el("overlay");
  const lineEl = el("line");
  const dotEl = el("dot");
  const labelEl = el("label");
  const labelStandEl = el("labelStand");
  const labelCompanyEl = el("labelCompany");
  const selStandEl = el("selStand");
  const selCompanyEl = el("selCompany");
  const listEl = el("list");
  const searchEl = el("search");
  const errBar = el("errBar");
  const updatedAtEl = el("updatedAt");
  const readyRow = el("readyRow");
  const eventTitle = el("eventTitle");

  const exportBtn = el("exportPdfBtn");
  const clearBtn = el("clearBtn");

  function normalizeBackendUrl(input) {
  if (!input) return "";
  let s = String(input).trim();
  // If someone pastes a full endpoint (e.g. .../stands), strip it back to the base.
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

  async function fetchJson(url, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function showError(msg) {
    errBar.style.display = "block";
    errBar.textContent = msg;
  }
  function clearError() {
    errBar.style.display = "none";
    errBar.textContent = "";
  }

  function normStandId(s) {
    return String(s || "").trim().toUpperCase();
  }
  function normRow(row) {
    const standId = normStandId(row.standId ?? row.stand ?? row.id);
    const status = String(row.status || "available").toLowerCase();
    const company = String(row.company || "").trim();
    return { standId, status, company };
  }

  // ===== SVG stand mapping =====
  let svgRoot = null;
  let standMap = new Map(); // standId -> element

  function normalizeDomId(id) {
    return String(id || "")
      .trim()
      .toUpperCase()
      .replace(/^STAND[_-]?/,"")
      .replace(/^ZONE[_-]?/,"")
      .replace(/^ID[_-]?/,"")
      .replace(/[^A-Z0-9]/g,"");
  }

  function buildStandMap() {
    standMap.clear();
    if (!svgRoot) return;

    const all = svgRoot.querySelectorAll("[id]");
    all.forEach(node => {
      const key = normalizeDomId(node.id);
      if (!key) return;
      // Prefer the top-most meaningful shape/group:
      if (!standMap.has(key)) standMap.set(key, node);
    });

    // Also support explicit data-stand tags
    const ds = svgRoot.querySelectorAll("[data-stand]");
    ds.forEach(node => {
      const key = normalizeDomId(node.getAttribute("data-stand"));
      if (key && !standMap.has(key)) standMap.set(key, node);
    });
  }

  function elementForStand(standId) {
    const key = normalizeDomId(standId);
    return standMap.get(key) || null;
  }

  function setFillForElement(elem, rgba) {
    if (!elem) return;
    // If group, apply to child shapes; else apply directly.
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));

    shapes.forEach(s => {
      // Only fill areas that look like stands: skip tiny dots and outlines
      const bbox = s.getBBox ? s.getBBox() : null;
      if (bbox && (bbox.width < 8 || bbox.height < 8)) return;
      s.style.fill = rgba;
      s.style.fillOpacity = "1";
    });
  }

  function getElementCenterInPage(elem) {
    // Use bounding box in screen coords
    const r = elem.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function placeLabelSmart(standPoint) {
    const wrapRect = planWrap.getBoundingClientRect();

    // Preferred label positions outside the plan, so it never covers stands:
    const margin = 26;
    const labelW = (window.innerWidth <= 640) ? 220 : 260;
    const labelH = (window.innerWidth <= 640) ? 92 : 104;

    const standXRel = (standPoint.x - wrapRect.left) / wrapRect.width;
    const onLeft = standXRel > 0.55; // if stand right-ish, put label left
    const x = onLeft ? (wrapRect.left + margin + labelW/2) : (wrapRect.right - margin - labelW/2);

    // Vertical: align around stand, but keep within wrap and avoid header area
    const y = clamp(standPoint.y, wrapRect.top + margin + labelH/2, wrapRect.bottom - margin - labelH/2);

    return { x, y, labelW, labelH };
  }

  function updatePointer(selected) {
    if (!selected || !selected.standId) {
      lineEl.style.display = "none";
      dotEl.style.display = "none";
      labelEl.style.display = "none";
      return;
    }
    const elem = elementForStand(selected.standId);
    if (!elem) {
      updatePointer(null);
      return;
    }

    const standPt = getElementCenterInPage(elem);
    const { x: labelCx, y: labelCy } = placeLabelSmart(standPt);

    // Convert page coords -> overlay coords
    const wrapRect = planWrap.getBoundingClientRect();
    const sx = standPt.x - wrapRect.left;
    const sy = standPt.y - wrapRect.top;

    const lx = labelCx - wrapRect.left;
    const ly = labelCy - wrapRect.top;

    // line
    const dx = sx - lx;
    const dy = sy - ly;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ang = Math.atan2(dy, dx);

    lineEl.style.display = "block";
    lineEl.style.left = `${lx}px`;
    lineEl.style.top = `${ly}px`;
    lineEl.style.width = `${len}px`;
    lineEl.style.transform = `rotate(${ang}rad)`;

    dotEl.style.display = "block";
    dotEl.style.left = `${sx}px`;
    dotEl.style.top = `${sy}px`;

    labelEl.style.display = "block";
    labelEl.style.left = `${lx}px`;
    labelEl.style.top = `${ly}px`;

    labelStandEl.textContent = selected.standId;
    if (selected.company) {
      labelCompanyEl.style.display = "block";
      labelCompanyEl.textContent = selected.company;
      selCompanyEl.style.display = "block";
      selCompanyEl.textContent = selected.company;
    } else {
      labelCompanyEl.style.display = "none";
      labelCompanyEl.textContent = "";
      selCompanyEl.style.display = "none";
      selCompanyEl.textContent = "";
    }
    selStandEl.textContent = selected.standId;
  }

  // ===== Data + UI =====
  let rows = [];
  let selectedStandId = null;

  function renderList() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const sold = rows.filter(r => r.status === "sold");
    const filtered = q
      ? sold.filter(r =>
          r.standId.toLowerCase().includes(q) ||
          (r.company || "").toLowerCase().includes(q)
        )
      : sold;

    listEl.innerHTML = "";
    filtered.forEach(r => {
      const div = document.createElement("div");
      div.className = "item" + (r.standId === selectedStandId ? " active" : "");
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = r.company ? r.company : "(No company)";
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = `Stand ${r.standId}`;
      div.appendChild(name);
      div.appendChild(sub);
      div.addEventListener("click", () => selectStand(r.standId));
      listEl.appendChild(div);
    });
  }

  function applyColours() {
    if (!svgRoot) return;
    // All stands = main colour; selected = red
    rows.forEach(r => {
      const elem = elementForStand(r.standId);
      if (!elem) return;
      setFillForElement(elem, getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    });
    if (selectedStandId) {
      const elem = elementForStand(selectedStandId);
      if (elem) setFillForElement(elem, getComputedStyle(document.documentElement).getPropertyValue("--selected").trim());
    }
  }

  function selectStand(standId) {
    selectedStandId = normStandId(standId);
    const row = rows.find(r => r.standId === selectedStandId) || { standId: selectedStandId, status:"available", company:"" };
    applyColours();
    updatePointer(row);
    renderList();
  }

  function clearSelection() {
    selectedStandId = null;
    selStandEl.textContent = "None";
    selCompanyEl.style.display = "none";
    selCompanyEl.textContent = "";
    applyColours();
    updatePointer(null);
    renderList();
  }

  function isPhone() { return window.matchMedia("(max-width: 640px)").matches; }

  function attachStandClicks() {
    if (!svgRoot) return;

    // Disable stand tapping on phone (requested)
    if (isPhone()) return;

    svgRoot.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t) return;
      // climb to an id-bearing ancestor
      let node = t;
      for (let i=0; i<6 && node; i++){
        if (node.id) break;
        node = node.parentElement;
      }
      if (!node || !node.id) return;
      const key = normalizeDomId(node.id);
      if (!key) return;
      // Only select if this key exists in rows
      const found = rows.find(r => normalizeDomId(r.standId) === key);
      if (found) selectStand(found.standId);
    }, { passive:true });
  }

  async function loadSvg() {
    const res = await fetch(SVG_URL);
    if (!res.ok) throw new Error("Could not load SVG");
    const txt = await res.text();
    svgHost.innerHTML = txt;

    svgRoot = svgHost.querySelector("svg");
    if (!svgRoot) throw new Error("SVG invalid");

    // Remove any stray shapes we might have created in older versions (the “grey quarter circle”)
    // If someone left a <circle> at 0,0 with huge radius, hide it:
    svgRoot.querySelectorAll("circle").forEach(c => {
      const cx = c.getAttribute("cx"), cy = c.getAttribute("cy"), r = c.getAttribute("r");
      const rr = parseFloat(r || "0");
      if ((cx === "0" || cx === "0.0") && (cy === "0" || cy === "0.0") && rr >= 20) {
        c.style.display = "none";
      }
    });

    // Make sure SVG scales nicely
    svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svgRoot.style.width = "100%";
    svgRoot.style.height = "auto";
    svgRoot.style.display = "block";

    buildStandMap();
    attachStandClicks();
  }

  async function loadData() {
    const backend = getBackendUrl();
    const data = await fetchJson(`${backend}/stands`);
    rows = (Array.isArray(data) ? data : []).map(normRow).filter(r => r.standId);
    applyColours();
    renderList();
    readyRow.style.display = "flex";
    updatedAtEl.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    clearError();
  }

  // very lightweight "PDF export": print dialog (keeps working across browsers)
  exportBtn.addEventListener("click", () => window.print());
  clearBtn.addEventListener("click", clearSelection);

  searchEl.addEventListener("input", renderList);
  window.addEventListener("resize", () => {
    // reposition pointer after resize
    if (selectedStandId) {
      const row = rows.find(r => r.standId === selectedStandId);
      if (row) updatePointer(row);
    }
  });

  // init
  (async () => {
    try {
      await loadSvg();
    } catch (e) {
      showError("Error loading plan SVG.");
      console.error(e);
      return;
    }

    try {
      await loadData();
    } catch (e) {
      showError("Failed to fetch (backend not reachable).");
      console.error(e);
    }
  })();
})();
