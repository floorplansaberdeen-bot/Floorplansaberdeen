/* shared.js - Shared helpers + FloorplanCore (public + admin)
   No frameworks. Works on GitHub Pages.
*/
(function(){
  const DEFAULTS = {
    defaultBackend: "https://floorplansaberdeen.floorplansaberdeen.workers.dev",
    backendKey: "floorplan_backend_url",
    svgUrl: "./event_plan.svg",
    dotCssVar: "--dot"
  };

  function normalizeBackendUrl(input){
    if (!input) return "";
    let s = String(input).trim();
    if (!s) return "";
    try{
      const u = new URL(s);
      // strip trailing slash
      u.pathname = u.pathname.replace(/\/+$/,"");
      u.search = ""; u.hash = "";
      return u.toString();
    }catch(e){
      // allow raw host without protocol
      if (!/^https?:\/\//i.test(s)) s = "https://" + s;
      try{
        const u = new URL(s);
        u.pathname = u.pathname.replace(/\/+$/,"");
        u.search=""; u.hash="";
        return u.toString();
      }catch(_){
        return "";
      }
    }
  }

  function getBackendUrl(opts){
    const allow = !!(opts && opts.allowBackendOverride);
    if (allow){
      const saved = localStorage.getItem(DEFAULTS.backendKey);
      const norm = normalizeBackendUrl(saved);
      if (norm) return norm;
    }
    return DEFAULTS.defaultBackend;
  }

  async function fetchJson(url, options){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 15000);
    try{
      const res = await fetch(url, Object.assign({cache:"no-store", signal: ctrl.signal}, options||{}));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function normStandId(s){
    return String(s||"").trim().toUpperCase();
  }

  function statusNorm(s){
    const v = String(s||"").trim().toLowerCase();
    if (v === "sold") return "sold";
    return "available";
  }

function extractStandIdFromText(t){
  if (!t) return "";
  const s = String(t).toUpperCase();
  // Look for tokens like A1, B12, AA2, AD19 embedded in IDs like "stand_A1".
  // Restrict to 1-2 letters followed by 1-3 digits, with non-alnum boundaries.
  const m = s.match(/(?:^|[^A-Z0-9])([A-Z]{1,2}\d{1,3})(?:$|[^A-Z0-9])/);
  return m ? m[1] : "";
}

  function findStandIdFromElement(el){
    if (!el) return "";
    // direct attributes
    const attrs = ["data-stand","data-stand-id","data-standid","id"];
    for (const a of attrs){
      const v = el.getAttribute && el.getAttribute(a);
      const id = extractStandIdFromText(v);
      if (id) return id;
    }
    // title element
    const title = el.querySelector && el.querySelector("title");
    if (title){
      const id = extractStandIdFromText(title.textContent);
      if (id) return id;
    }
    // text content
    if (el.tagName && el.tagName.toLowerCase() === "text"){
      const id = extractStandIdFromText(el.textContent);
      if (id) return id;
    }
    // search within same group for text
    let g = el;
    for (let i=0;i<6 && g;i++){
      if (g.tagName && g.tagName.toLowerCase() === "g"){
        const texts = g.querySelectorAll("text");
        for (const tx of texts){
          const id = extractStandIdFromText(tx.textContent);
          if (id) return id;
        }
      }
      g = g.parentNode;
    }
    return "";
  }

  function isShapeTag(tag){
    return ["path","rect","polygon","polyline","ellipse","circle"].includes(tag);
  }

  function setFillForElement(el, fill, opacity){
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (isShapeTag(tag)){
      el.style.fill = fill;
      el.style.fillOpacity = String(opacity == null ? 1 : opacity);
    }
  }

  class FloorplanCore{
    constructor(opts){
      this.opts = opts || {};
      this.rows = [];
      this.selectedStandId = null;
      this.selectionNonce = 0;

      // DOM hooks
      this.svgHost = this.opts.svgHost;
      this.planWrap = this.opts.planWrap;
      this.planStack = this.opts.planStack;
      this.calloutSvg = this.opts.calloutSvg;
      this.lozenge = this.opts.lozenge;
      this.lozStand = this.opts.lozStand;
      this.lozCompany = this.opts.lozCompany;

      this.svgEl = null;
      this.standElements = new Map(); // standId -> {group, shapes[]}

      // Admin auth (URL key + optional password)
      try{
        const usp = new URLSearchParams(window.location.search || "");
        this.adminKey = usp.get("k") || "";
      }catch(e){ this.adminKey = ""; }
      this.adminPassword = sessionStorage.getItem("floorplan_admin_pass") || "";
    }

    backend(){
      return getBackendUrl(this.opts);
    }

    svgUrl(){
      return (this.opts.svgUrl || DEFAULTS.svgUrl);
    }

    async loadSvg(){
      if (!this.svgHost) throw new Error("svgHost missing");
      const url = this.svgUrl();
      const res = await fetch(url, {cache:"no-store"});
      if (!res.ok) throw new Error("SVG HTTP " + res.status);
      const txt = await res.text();
      // inject inline SVG
      this.svgHost.innerHTML = txt;
      const svg = this.svgHost.querySelector("svg");
      if (!svg) throw new Error("No <svg> found in " + url);
      this.svgEl = svg;
      // Ensure responsive sizing
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.display = "block";
      svg.style.userSelect = "none";
      svg.setAttribute("preserveAspectRatio","xMidYMid meet");
      // Build stand index
      this.indexStandsFromSvg();
    }

  indexStandsFromSvg(){
    // Build a robust index:
    // 1) Prefer mapping from stand-number TEXT -> nearest enclosing shape (smallest bbox that contains text center)
    // 2) Fallback to any element with data-stand/id that parses like a stand id
    this.standElements = new Map();
    this.standHits = []; // {standId, el, bbox, area}

    if (!this.svgEl) return;

    const isShape = (el)=> el && el.matches && el.matches("path,rect,polygon,polyline,ellipse,circle");
    const safeBBox = (el)=>{
      try{ return el.getBBox(); }catch(e){ return null; }
    };
    const bboxArea = (b)=> (b ? Math.max(0,b.width) * Math.max(0,b.height) : Infinity);
    const contains = (b, x, y)=> !!b && x >= b.x && x <= (b.x + b.width) && y >= b.y && y <= (b.y + b.height);

    const pickBestShapeForText = (textEl)=>{
      const tb = safeBBox(textEl);
      if (!tb) return null;
      const cx = tb.x + tb.width/2;
      const cy = tb.y + tb.height/2;

      let best = null;
      let bestArea = Infinity;

      // Walk up a few levels to find shapes "near" the text.
      let p = textEl;
      for (let depth=0; depth<4 && p && p.parentElement; depth++){
        p = p.parentElement;
        const shapes = p.querySelectorAll("path,rect,polygon,polyline,ellipse,circle");
        shapes.forEach(sh=>{
          const b = safeBBox(sh);
          if (!b) return;
          const a = bboxArea(b);
          if (a < 50) return; // ignore tiny glyph paths
          if (!contains(b, cx, cy)) return;
          if (a < bestArea){
            best = sh;
            bestArea = a;
          }
        });
        if (best) break;
      }
      return best;
    };

    // First pass: stand IDs from visible text
    const texts = this.svgEl.querySelectorAll("text, tspan");
    texts.forEach(t=>{
      const sid = extractStandIdFromText(t.textContent || "");
      if (!sid) return;
      if (this.standElements.has(sid)) return;
      const shape = pickBestShapeForText(t);
      if (shape){
        this.standElements.set(sid, [shape]);
        const b = safeBBox(shape);
        if (b) this.standHits.push({ standId: sid, el: shape, bbox: b, area: bboxArea(b) });
      }
    });

    // Fallback: data-stand / id based
    const candidates = this.svgEl.querySelectorAll("[data-stand],[id]");
    candidates.forEach(el=>{
      const sid = findStandIdFromElement(el);
      if (!sid) return;
      if (this.standElements.has(sid)) return;
      if (isShape(el)){
        this.standElements.set(sid, [el]);
        const b = safeBBox(el);
        if (b) this.standHits.push({ standId: sid, el, bbox: b, area: bboxArea(b) });
      }
    });

    // Sort hits smallest first (helps point hit-testing)
    this.standHits.sort((a,b)=>a.area-b.area);
  }

  standIdAtClientPoint(clientX, clientY){
    if (!this.svgEl || !this.standHits || !this.standHits.length) return "";
    let pt = null;
    try{
      pt = this.svgEl.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      const ctm = this.svgEl.getScreenCTM();
      if (!ctm) return "";
      const inv = ctm.inverse();
      pt = pt.matrixTransform(inv);
    }catch(e){
      return "";
    }

    const x = pt.x, y = pt.y;
    for (const h of this.standHits){
      const b = h.bbox;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height){
        return h.standId;
      }
    }
    return "";
  }


  enablePlanClick(config){
      if (!this.svgEl) return;
      const enabled = !!(config && config.enabled);
      const disableOnMobile = !!(config && config.disableOnMobile);
      const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
      if (!enabled || (disableOnMobile && isMobile)){
        this.svgEl.style.pointerEvents = "none";
        return;
      }
      this.svgEl.style.pointerEvents = "auto";

      const handler = (ev)=>{
        const sid = this.standIdAtClientPoint(ev.clientX, ev.clientY) || findStandIdFromElement(ev.target);
        if (!sid) return;
        ev.preventDefault();
        this.selectStand(sid, {fromPlan:true});
      };
      // remove existing
      if (this._planClickHandler){
        this.svgEl.removeEventListener("click", this._planClickHandler);
      }
      this._planClickHandler = handler;
      this.svgEl.addEventListener("click", handler);
    }

    // Settings
    async getSettings(){
      return await fetchJson(this.backend() + "/settings?ts=" + Date.now());
    }
    async setSettings(patch){
      return await fetchJson(this.backend() + "/settings", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(patch || {})
      });
    }


    getAuthHeaders(){
      const h = {};
      if (this.adminKey) h["x-admin-key"] = this.adminKey;
      if (this.adminPassword) h["x-admin-pass"] = this.adminPassword;
      return h;
    }

    async ensureAdminPassword(){
      // Only prompt if we don't already have a password
      if (this.adminPassword) return this.adminPassword;
      const pw = window.prompt("Enter admin password to save changes:");
      if (pw && String(pw).trim()){
        this.adminPassword = String(pw).trim();
        sessionStorage.setItem("floorplan_admin_pass", this.adminPassword);
        return this.adminPassword;
      }
      return "";
    }

    async updateStand(standId, status, company){
      // Ensure we have a password before writing (backend may require it)
      await this.ensureAdminPassword();

      const payload = { standId: normStandId(standId), status: statusNorm(status), company: String(company||"").trim() };

      try{
        return await fetchJson(this.backend() + "/stand", {
          method:"POST",
          headers: Object.assign({"Content-Type":"application/json"}, this.getAuthHeaders()),
          body: JSON.stringify(payload)
        });
      }catch(err){
        // If auth failed, clear saved password and retry once
        const msg = String(err && err.message ? err.message : err || "");
        if (msg.includes("401") || msg.includes("403")){
          this.adminPassword = "";
          sessionStorage.removeItem("floorplan_admin_pass");
          await this.ensureAdminPassword();
          return await fetchJson(this.backend() + "/stand", {
            method:"POST",
            headers: Object.assign({"Content-Type":"application/json"}, this.getAuthHeaders()),
            body: JSON.stringify(payload)
          });
        }
        throw err;
      }
    }
  }

  window.FloorplanCore = FloorplanCore;
  window.__floorplanShared = { DEFAULTS, normalizeBackendUrl };

})();
