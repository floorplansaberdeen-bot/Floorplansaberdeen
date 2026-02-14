(function(){
  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";
  const SVG_URL = "./event_plan.svg";

  function el(id){ return document.getElementById(id); }

  function normalizeBackendUrl(input){
    if (!input) return "";
    let s = String(input).trim();
    try{
      const u = new URL(s);
      let p = u.pathname.replace(/\/+$/,"");
      p = p.replace(/\/(api\/stands|stands|stand|settings)$/i, "");
      p = p.replace(/\/+$/,"");
      u.pathname = p ? p : "/";
      u.search=""; u.hash="";
      const base = u.origin + (u.pathname === "/" ? "" : u.pathname);
      return base.replace(/\/+$/,"");
    }catch(_){
      s = s.replace(/\/+$/,"");
      s = s.replace(/\/(api\/stands|stands|stand|settings)$/i,"");
      return s.replace(/\/+$/,"");
    }
  }

  function getBackendUrl(){
    const saved = localStorage.getItem(BACKEND_KEY);
    const base = (saved && saved.startsWith("http")) ? saved : DEFAULT_BACKEND;
    return normalizeBackendUrl(base);
  }

  async function fetchJson(url, opts={}){
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 15000);
    try{
      const res = await fetch(url, { ...opts, signal: controller.signal, cache:"no-store" });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function standIdFromString(s){ return String(s||"").trim().toUpperCase(); }
  function normalizeDomId(id){ return String(id||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,""); }
  function isStandIdLike(id){ return /^[A-Z]{1,3}\d{1,3}$/.test(id); }

  function buildStandMap(svgRoot){
    const map = new Map();
    if(!svgRoot) return map;
    svgRoot.querySelectorAll("[id]").forEach(node=>{
      const raw = standIdFromString(node.id);
      if(!raw) return;
      const cleaned = normalizeDomId(raw);
      if(!isStandIdLike(cleaned)) return;
      if(!map.has(cleaned)) map.set(cleaned, node);
    });
    svgRoot.querySelectorAll("[data-stand]").forEach(node=>{
      const cleaned = normalizeDomId(node.getAttribute("data-stand"));
      if(isStandIdLike(cleaned) && !map.has(cleaned)) map.set(cleaned, node);
    });
    return map;
  }

  // The SVG contains many IDs that are NOT stands (e.g. background shapes).
  // To avoid colouring/clicking those, we whitelist against the stand IDs returned by /stands.
  function filterStandMapToAllowedIds(map, allowedIds){
    if(!allowedIds || allowedIds.size===0) return map;
    const out = new Map();
    allowedIds.forEach(id=>{
      const el = map.get(id);
      if(el) out.set(id, el);
    });
    return out;
  }

  function elementCenterInPage(elem){
    const r = elem.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }

  function setFillForElement(elem, rgba){
    if(!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));
    shapes.forEach(s=>{
      const bb = s.getBBox ? s.getBBox() : null;
      if(bb && (bb.width < 8 || bb.height < 8)) return;
      s.style.fill = rgba;
      s.style.fillOpacity = "1";
    });
  }

  function hideHugeCircleAtOrigin(svgRoot){
    if(!svgRoot) return;
    svgRoot.querySelectorAll("circle").forEach(c=>{
      const cx=c.getAttribute("cx"), cy=c.getAttribute("cy");
      const r=parseFloat(c.getAttribute("r")||"0");
      if((cx==="0"||cx==="0.0") && (cy==="0"||cy==="0.0") && r>=20) c.style.display="none";
    });
  }

  class FloorplanCore{
    constructor(opts){
      this.opts = opts;
      this.rows = [];
      this.selectedStandId = null;
      this.selectionNonce = 0;
      this.svgRoot = null;
      this.zoomSvgRoot = null;
      this.standMap = new Map();
    }
    backend(){ return getBackendUrl(); }

    async loadSvg(){
      const res = await fetch(SVG_URL, { cache:"no-store" });
      if(!res.ok) throw new Error("Could not load SVG");
      const txt = await res.text();
      this.opts.svgHost.innerHTML = txt;
      this.svgRoot = this.opts.svgHost.querySelector("svg");
      if(!this.svgRoot) throw new Error("SVG invalid");

      hideHugeCircleAtOrigin(this.svgRoot);
      this.svgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
      this.svgRoot.style.width="100%";
      this.svgRoot.style.height="auto";
      this.svgRoot.style.display="block";

      this.standMap = buildStandMap(this.svgRoot);
    }

    async loadStands(){
      const data = await fetchJson(`${this.backend()}/stands?_=${Date.now()}`);
      this.rows = (Array.isArray(data) ? data : []).map(r=>({
        standId: standIdFromString(r.standId ?? r.stand ?? r.id),
        status: String(r.status||"available").toLowerCase(),
        company: String(r.company||"").trim()
      })).filter(r=>r.standId);

      // After we know the canonical stand IDs, restrict the standMap to ONLY those.
      // This prevents background elements (e.g. X301) being treated as stands.
      if(this.svgRoot && this.standMap && this.standMap.size){
        const allowed = new Set(this.rows.map(r=>normalizeDomId(r.standId)));
        this.standMap = filterStandMapToAllowedIds(this.standMap, allowed);
      }
      return this.rows;
    }

    standElement(standId){
      const key = normalizeDomId(standId);
      return this.standMap.get(key) || null;
    }

    enablePlanClick({enabled=true, disableOnMobile=false, onPick=null}={}){
      if(!this.svgRoot) return;
      const isMobile = matchMedia("(max-width: 640px)").matches;
      const active = enabled && !(disableOnMobile && isMobile);

      const handler = (ev)=>{
        if(!active) return;
        let n = ev.target;
        for(let i=0;i<7 && n;i++){
          if(n.id){
            const cleaned = normalizeDomId(n.id);
            if(isStandIdLike(cleaned) && this.standMap.has(cleaned)){
              if(onPick) onPick(cleaned);
              else this.selectStand(cleaned, {fromPlan:true});
              return;
            }
          }
          n = n.parentElement;
        }

        // Clicked outside any stand -> clear selection
        this.clearSelection({fromPlan:true});
      };
      this.svgRoot.addEventListener("click", handler);
      this._planClickHandler = handler;
    }

    clearCallout(){
      this.opts.calloutSvg.innerHTML = "";
      this.opts.lozenge.style.display = "none";
      this.opts.lozStand.textContent = "—";
      this.opts.lozCompany.style.display = "none";
      this.opts.lozCompany.textContent = "";
    }

    drawCallout(standId, company){
      const elem = this.standElement(standId);
      if(!elem){ this.clearCallout(); return; }

      this.opts.lozStand.textContent = standId;
      if(company){
        this.opts.lozCompany.style.display="block";
        this.opts.lozCompany.textContent = company;
      } else {
        this.opts.lozCompany.style.display="none";
        this.opts.lozCompany.textContent = "";
      }
      this.opts.lozenge.style.display="inline-block";

      const standPt = elementCenterInPage(elem);
      const lozRect = this.opts.lozenge.getBoundingClientRect();
      const lozTop = { x: lozRect.left + lozRect.width/2, y: lozRect.top };

      const stackRect = this.opts.planStack.getBoundingClientRect();
      const x1 = lozTop.x - stackRect.left;
      const y1 = lozTop.y - stackRect.top;
      const x2 = standPt.x - stackRect.left;
      const y2 = standPt.y - stackRect.top;

      const w = stackRect.width, h = stackRect.height;
      this.opts.calloutSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      this.opts.calloutSvg.setAttribute("preserveAspectRatio","none");

      const dotPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dot")) || 10;
      const r = dotPx/2;

      this.opts.calloutSvg.innerHTML = `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(110,110,110,.9)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(110,110,110,.95)"/>
      `;
    }

    applyColoursAdmin(){
      const sold = getComputedStyle(document.documentElement).getPropertyValue("--sold").trim();
      const avail = getComputedStyle(document.documentElement).getPropertyValue("--avail").trim();
      this.rows.forEach(r=>{
        const elem = this.standElement(r.standId);
        if(elem) setFillForElement(elem, (r.status==="sold") ? sold : avail);
      });
    }

    applyColoursPublic(){
      const orange = "rgba(213,109,50,0.75)";
      const red = "rgba(230,59,59,0.75)";

      // Paint ONLY real stands from backend rows
      this.rows.forEach(r=>{
        const elem = this.standElement(r.standId);
        if(!elem) return;

        const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
          ? [elem]
          : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));

        shapes.forEach(s=>{
          s.style.fill = orange;
          s.style.fillOpacity = "";
        });
      });

      // Selected stand turns red
      if(this.selectedStandId){
        const elem = this.standElement(this.selectedStandId);
        if(elem){
          const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
            ? [elem]
            : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));
          shapes.forEach(s=>{
            s.style.fill = red;
            s.style.fillOpacity = "";
          });
        }
      }
    }

    selectStand(standId, {fromPlan=false}={}){
      const id = standIdFromString(standId);
      const row = this.rows.find(r=>normalizeDomId(r.standId)===normalizeDomId(id));
      if(!row) return;
      this.selectedStandId = row.standId;
      this.selectionNonce++;
      if(this.opts.onSelect) this.opts.onSelect(row, {fromPlan});
    }


    clearSelection({fromPlan=false}={}){
      const had = this.selectedStandId != null;
      this.selectedStandId = null;
      if(had) this.selectionNonce++;
      if(this.opts.onClearSelection) this.opts.onClearSelection({fromPlan});
    }

    forceZoomBlackAndWhite(svg){
      const all = svg.querySelectorAll("*");
      all.forEach(n=>{
        if(n.hasAttribute("style")) n.removeAttribute("style");
        const tag = n.tagName.toLowerCase();
        if(tag==="text"){
          n.setAttribute("fill","black");
          n.removeAttribute("stroke");
        } else if(["path","rect","polygon","polyline","ellipse","circle","line"].includes(tag)){
          n.setAttribute("fill","none");
          n.setAttribute("stroke","black");
          n.setAttribute("stroke-width","1");
        }
      });
    }

    updateZoom(standId, zoomSvgHost, zoomWrap, zoomRing){
      zoomSvgHost.innerHTML="";
      zoomRing.style.display="none";
      if(!standId || !this.svgRoot) return;

      const clone = this.svgRoot.cloneNode(true);
      // Keep raw SVG styling in zoom (no black/white override)
      zoomSvgHost.appendChild(clone);
      this.zoomSvgRoot = clone;

      const target = this.zoomSvgRoot.querySelector("#"+CSS.escape(standId));
      let resolved = target;
      if(!resolved){
        const key = normalizeDomId(standId);
        resolved = Array.from(this.zoomSvgRoot.querySelectorAll("[id]")).find(n=>normalizeDomId(n.id)===key);
      }
      if(!resolved || !resolved.getBBox) return;

      const bbox = resolved.getBBox();
      const pad = Math.max(80, Math.max(bbox.width, bbox.height) * 1.3);
      const vx = bbox.x - pad, vy = bbox.y - pad, vw = bbox.width + pad*2, vh = bbox.height + pad*2;

      this.zoomSvgRoot.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
      this.zoomSvgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
      this.zoomSvgRoot.style.width="100%";
      this.zoomSvgRoot.style.height="auto";
      this.zoomSvgRoot.style.display="block";

      requestAnimationFrame(()=>{
        const r = resolved.getBoundingClientRect();
        const zw = zoomWrap.getBoundingClientRect();
        const cx = (r.left + r.right)/2 - zw.left;
        const cy = (r.top + r.bottom)/2 - zw.top;
        const radius = Math.max(22, Math.min(72, Math.max(r.width, r.height) * 0.85));
        zoomRing.style.display="block";
        zoomRing.style.width = `${radius*2}px`;
        zoomRing.style.height = `${radius*2}px`;
        zoomRing.style.left = `${cx - radius}px`;
        zoomRing.style.top = `${cy - radius}px`;
      });
    }
  }

  window.FloorplanCore = FloorplanCore;
  window.FloorplanShared = { el, fetchJson, getBackendUrl, normalizeBackendUrl, BACKEND_KEY };
})();