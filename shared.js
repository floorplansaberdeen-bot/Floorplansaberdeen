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
    const s = String(t).trim().toUpperCase();
    // common patterns: A1, AB12, AD19, C4, AA2 etc.
    const m = s.match(/^[A-Z]{1,3}\d{1,3}$/);
    return m ? m[0] : "";
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

  function setFillForElement(el, fill){
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (isShapeTag(tag)){
      el.style.fill = fill;
      el.style.fillOpacity = "1";
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
      this.standElements.clear();
      if (!this.svgEl) return;

      // Heuristic: any <g> that contains a <text> with a standId is a stand group.
      const groups = this.svgEl.querySelectorAll("g");
      for (const g of groups){
        const texts = g.querySelectorAll("text");
        let id = "";
        for (const t of texts){
          id = extractStandIdFromText(t.textContent);
          if (id) break;
        }
        if (!id) continue;

        // shapes to color: shapes inside this group excluding very tiny ones
        const shapes = [];
        const nodes = g.querySelectorAll("path,rect,polygon,polyline,ellipse,circle");
        for (const n of nodes){
          // ignore shapes that are likely text outlines? (very small bbox)
          try{
            const bb = n.getBBox();
            if (bb.width < 2 && bb.height < 2) continue;
          }catch(_){}
          shapes.push(n);
        }
        if (shapes.length){
          this.standElements.set(id, {group:g, shapes});
        }
      }

      // Fallback: elements with id=data-stand attribute
      const candidates = this.svgEl.querySelectorAll("[data-stand],[data-stand-id],[data-standid],[id]");
      for (const el of candidates){
        const id = findStandIdFromElement(el);
        if (!id) continue;
        if (this.standElements.has(id)) continue;
        const shapes = [];
        if (isShapeTag((el.tagName||"").toLowerCase())) shapes.push(el);
        if (!shapes.length){
          const nodes = el.querySelectorAll ? el.querySelectorAll("path,rect,polygon,polyline,ellipse,circle") : [];
          for (const n of nodes) shapes.push(n);
        }
        if (shapes.length){
          this.standElements.set(id, {group: el, shapes});
        }
      }
    }

    async loadStands(){
      const url = this.backend() + "/stands?ts=" + Date.now();
      const js = await fetchJson(url);
      const arr = Array.isArray(js) ? js : (Array.isArray(js.rows) ? js.rows : []);
      this.rows = arr.map(r=>({
        standId: normStandId(r.standId || r.stand || r.id),
        status: statusNorm(r.status),
        company: String(r.company||"").trim()
      })).filter(r=>r.standId);
      // keep stable sort
      this.rows.sort((a,b)=>a.standId.localeCompare(b.standId, undefined, {numeric:true, sensitivity:"base"}));
      return this.rows;
    }

    rowById(id){
      const sid = normStandId(id);
      return this.rows.find(r=>r.standId === sid) || null;
    }

    applyColoursPublic(){
      this.applyColours({mode:"public"});
    }

    applyColoursAdmin(){
      this.applyColours({mode:"admin"});
    }

    applyColours(opts){
      if (!this.svgEl) return;
      const soldFill = getComputedStyle(document.documentElement).getPropertyValue("--sold").trim() || "#e74c3c";
      const availFill = getComputedStyle(document.documentElement).getPropertyValue("--avail").trim() || "#e0a070";
      const defaultFill = ""; // leave as-is when unknown

      const statusMap = new Map(this.rows.map(r=>[r.standId, r.status]));
      for (const [id, obj] of this.standElements.entries()){
        const st = statusMap.get(id);
        const fill = st === "sold" ? soldFill : (st === "available" ? availFill : defaultFill);
        if (!fill) continue;
        for (const sh of obj.shapes) setFillForElement(sh, fill);
      }
    }

    clearCallout(){
      if (this.calloutSvg) this.calloutSvg.innerHTML = "";
      if (this.lozenge) this.lozenge.style.display = "none";
      if (this.lozCompany) this.lozCompany.style.display = "none";
    }

    drawCallout(standId, company){
      if (!this.svgEl || !this.calloutSvg || !this.planWrap) return;
      const sid = normStandId(standId);
      const obj = this.standElements.get(sid);
      if (!obj) return;

      // find bbox for group
      let bbox = null;
      try{
        bbox = obj.group.getBBox();
      }catch(e){
        // try shapes
        for (const sh of obj.shapes){
          try{ bbox = sh.getBBox(); break; }catch(_){}
        }
      }
      if (!bbox) return;

      const wrapRect = this.planWrap.getBoundingClientRect();
      const svgRect = this.svgEl.getBoundingClientRect();

      // map svg coords -> screen coords
      const pt = this.svgEl.createSVGPoint();
      const ctm = this.svgEl.getScreenCTM();
      if (!ctm) return;

      const centerSvg = {x: bbox.x + bbox.width/2, y: bbox.y + bbox.height/2};
      pt.x = centerSvg.x; pt.y = centerSvg.y;
      const centerScreen = pt.matrixTransform(ctm);

      // compute relative position inside planWrap
      const cx = centerScreen.x - wrapRect.left;
      const cy = centerScreen.y - wrapRect.top;

      // label target: bottom-left label bay
      const labelX = 24;
      const labelY = wrapRect.height - 24;

      this.calloutSvg.setAttribute("viewBox", `0 0 ${wrapRect.width} ${wrapRect.height}`);
      this.calloutSvg.innerHTML = "";

      const ns = "http://www.w3.org/2000/svg";
      const line = document.createElementNS(ns,"line");
      line.setAttribute("x1", String(cx));
      line.setAttribute("y1", String(cy));
      line.setAttribute("x2", String(labelX));
      line.setAttribute("y2", String(labelY));
      line.setAttribute("stroke", "#333");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-linecap","round");
      this.calloutSvg.appendChild(line);

      if (this.lozenge){
        this.lozenge.style.display = "block";
      }
      if (this.lozStand) this.lozStand.textContent = sid;
      if (this.lozCompany){
        const txt = String(company||"").trim();
        if (txt){
          this.lozCompany.style.display = "block";
          this.lozCompany.textContent = txt;
        }else{
          this.lozCompany.style.display = "none";
        }
      }
    }

    selectStand(id, opts){
      const sid = normStandId(id);
      const row = this.rowById(sid) || {standId:sid, status:"available", company:""};
      this.selectedStandId = sid;
      this.selectionNonce++;
      if (this.opts.onSelect) this.opts.onSelect(row);
      // callout + colours
      if (this.opts.onBeforeSelect) this.opts.onBeforeSelect(row, opts||{});
      this.applyColoursPublic();
      this.drawCallout(row.standId, row.company||"");
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
        const target = ev.target;
        const sid = findStandIdFromElement(target);
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

    async updateStand(standId, status, company){
      const payload = { standId: normStandId(standId), status: statusNorm(status), company: String(company||"").trim() };
      return await fetchJson(this.backend() + "/stand", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
    }
  }

  window.FloorplanCore = FloorplanCore;
  window.__floorplanShared = { DEFAULTS, normalizeBackendUrl };

})();
