
/* shared.js - Floorplan shared core (Public uses this; Admin can adopt later)
   No frameworks. Works on GitHub Pages.
*/
(function(){
  const DEFAULTS = {
    defaultBackend: "https://floorplansaberdeen.floorplansaberdeen.workers.dev",
    backendKey: "floorplan_backend_url",
    svgUrl: "./event_plan.svg",
    dotCssVar: "--dot",
  };

  function normalizeBackendUrl(input){
    if (!input) return "";
    let s = String(input).trim();
    try{
      const u = new URL(s);
      let p = u.pathname.replace(/\/+$/,"");
      p = p.replace(/\/(api\/stands|stands)$/i, "");
      p = p.replace(/\/+$/,"");
      u.pathname = p ? p : "/";
      u.search = ""; u.hash = "";
      const base = u.origin + (u.pathname === "/" ? "" : u.pathname);
      return base.replace(/\/+$/,"");
    }catch(e){
      s = s.replace(/\/+$/,"");
      s = s.replace(/\/(api\/stands|stands)$/i, "");
      return s.replace(/\/+$/,"");
    }
  }

  function getBackendUrl(opts){
    const allow = (opts.allowBackendOverride !== false);
    const saved = allow ? localStorage.getItem(opts.backendKey) : null;
    const base = (saved && saved.startsWith("http")) ? saved : opts.defaultBackend;
    return normalizeBackendUrl(base);
  }

  async function fetchJson(url, opts={}){
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 12000);
    try{
      const res = await fetch(url, { ...opts, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function normStandId(s){ return String(s||"").trim().toUpperCase(); }
  function normRow(row){
    return {
      standId: normStandId(row.standId ?? row.stand ?? row.id),
      status: String(row.status || "available").toLowerCase(),
      company: String(row.company || "").trim()
    };
  }

  function normalizeDomId(id){
    return String(id || "")
      .trim()
      .toUpperCase()
      .replace(/^STAND[_-]?/,"")
      .replace(/^ZONE[_-]?/,"")
      .replace(/^ID[_-]?/,"")
      .replace(/[^A-Z0-9]/g,"");
  }

  function setFillForElement(elem, rgba){
    if (!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));
    shapes.forEach(s=>{
      const bbox = s.getBBox ? s.getBBox() : null;
      if (bbox && (bbox.width < 8 || bbox.height < 8)) return;
      s.style.fill = rgba;
      s.style.fillOpacity = "1";
    });
  }

  class FloorplanCore{
    constructor(options){
      this.opts = Object.assign({}, DEFAULTS, options||{});
      this.svgRoot = null;
      this.zoomSvgRoot = null;
      this.standMap = new Map();
      this.rows = [];
      this.selectedStandId = null;

      // DOM
      this.svgHost = this.opts.svgHost;
      this.planWrap = this.opts.planWrap;
      this.planStack = this.opts.planStack;
      this.calloutSvg = this.opts.calloutSvg;
      this.lozenge = this.opts.lozenge;
      this.lozStand = this.opts.lozStand;
      this.lozCompany = this.opts.lozCompany;

      // callbacks
      this.onSelect = this.opts.onSelect || function(){};
      this.onSvgReady = this.opts.onSvgReady || function(){};
    }

    backend(){ return getBackendUrl(this.opts); }

    buildStandMap(){
      this.standMap.clear();
      if (!this.svgRoot) return;
      this.svgRoot.querySelectorAll("[id]").forEach(node=>{
        const key = normalizeDomId(node.id);
        if (key && !this.standMap.has(key)) this.standMap.set(key, node);
      });
      this.svgRoot.querySelectorAll("[data-stand]").forEach(node=>{
        const key = normalizeDomId(node.getAttribute("data-stand"));
        if (key && !this.standMap.has(key)) this.standMap.set(key, node);
      });
    }

    elementForStand(standId){
      return this.standMap.get(normalizeDomId(standId)) || null;
    }

    clearCallout(){
      if (this.calloutSvg) this.calloutSvg.innerHTML = "";
      if (this.lozenge) this.lozenge.style.display = "none";
      if (this.lozStand) this.lozStand.textContent = "—";
      if (this.lozCompany){
        this.lozCompany.style.display = "none";
        this.lozCompany.textContent = "";
      }
    }

    drawCallout(standId, company){
      if (!this.calloutSvg || !this.planStack) return;
      const elem = this.elementForStand(standId);
      if (!elem) { this.clearCallout(); return; }

      // update lozenge
      if (this.lozStand) this.lozStand.textContent = standId;
      if (this.lozCompany){
        if (company){
          this.lozCompany.style.display = "block";
          this.lozCompany.textContent = company;
        } else {
          this.lozCompany.style.display = "none";
          this.lozCompany.textContent = "";
        }
      }
      if (this.lozenge) this.lozenge.style.display = "inline-block";

      const standRect = elem.getBoundingClientRect();
      const standPt = { x: standRect.left + standRect.width/2, y: standRect.top + standRect.height/2 };

      const lozRect = this.lozenge.getBoundingClientRect();
      const lozTop = { x: lozRect.left + lozRect.width/2, y: lozRect.top };

      const stackRect = this.planStack.getBoundingClientRect();
      const x1 = lozTop.x - stackRect.left;
      const y1 = lozTop.y - stackRect.top;
      const x2 = standPt.x - stackRect.left;
      const y2 = standPt.y - stackRect.top;

      this.calloutSvg.setAttribute("viewBox", `0 0 ${stackRect.width} ${stackRect.height}`);
      this.calloutSvg.setAttribute("preserveAspectRatio", "none");

      const dotPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(this.opts.dotCssVar)) || 10;
      const r = dotPx/2;

      this.calloutSvg.innerHTML = `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,.70)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(0,0,0,.72)"/>
      `;
    }

    applyColoursPublic(){
      const orange = getComputedStyle(document.documentElement).getPropertyValue("--avail").trim() || "rgba(213,109,50,0.75)";
      const red = getComputedStyle(document.documentElement).getPropertyValue("--sold").trim() || "#e63b3b";

      this.rows.forEach(r=>{
        const elem = this.elementForStand(r.standId);
        if (!elem) return;
        setFillForElement(elem, (this.selectedStandId && r.standId === this.selectedStandId) ? red : orange);
      });
    }

    async loadSvg(){
      const res = await fetch(this.opts.svgUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load SVG");
      const txt = await res.text();
      this.svgHost.innerHTML = txt;
      this.svgRoot = this.svgHost.querySelector("svg");
      if (!this.svgRoot) throw new Error("SVG invalid");

      // hide any stray huge circle at 0,0
      this.svgRoot.querySelectorAll("circle").forEach(c=>{
        const cx=c.getAttribute("cx"), cy=c.getAttribute("cy"), r=parseFloat(c.getAttribute("r")||"0");
        if ((cx==="0"||cx==="0.0") && (cy==="0"||cy==="0.0") && r>=20) c.style.display="none";
      });

      this.svgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
      this.svgRoot.style.width="100%";
      this.svgRoot.style.height="auto";
      this.svgRoot.style.display="block";

      this.buildStandMap();
      this.onSvgReady(this.svgRoot);
      return this.svgRoot;
    }

    async loadStands(){
      const data = await fetchJson(`${this.backend()}/stands`);
      this.rows = (Array.isArray(data) ? data : []).map(normRow).filter(r=>r.standId);
      return this.rows;
    }

    selectStand(standId, {fromPlan=false}={}){
      this.selectedStandId = normStandId(standId);
      const row = this.rows.find(r=>r.standId === this.selectedStandId);
      if (!row) return;

      this.applyColoursPublic();
      this.drawCallout(row.standId, (row.status === "sold") ? (row.company||"") : "");
      this.onSelect(row, {fromPlan});
    }

    enablePlanClick({enabled=true, disableOnMobile=true}={}){
      if (!this.svgRoot) return;
      // "Phone" detection: disable plan tapping for small screens OR coarse pointers.
      // This keeps desktop click enabled while preventing accidental taps on phones.
      const isMobile = () => {
        const mm = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
        return mm("(max-width: 760px)") || mm("(pointer: coarse)");
      };
      const shouldDisable = () => disableOnMobile && isMobile();

      const handler = (ev)=>{
        if (!enabled) return;
        if (shouldDisable()) return;
        let node = ev.target;
        for (let i=0;i<8 && node;i++){
          if (node.id) break;
          node = node.parentElement;
        }
        if (!node || !node.id) return;
        const key = normalizeDomId(node.id);
        const found = this.rows.find(r => normalizeDomId(r.standId) === key);
        if (found) this.selectStand(found.standId, {fromPlan:true});
      };

      // Remove previous by cloning? We'll just add once; safe in our pages.
      this.svgRoot.addEventListener("click", handler, { passive:true });

      // Also hard-disable pointer events on mobile if requested
      const applyPe = ()=>{
        if (shouldDisable()) this.svgRoot.style.pointerEvents = "none";
        else this.svgRoot.style.pointerEvents = "auto";
      };
      window.addEventListener("resize", applyPe);
      applyPe();
    }
  }

  window.FloorplanCore = FloorplanCore;
})();
