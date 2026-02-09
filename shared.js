/* shared.js — Floorplan shared logic (Admin + Public)
   - Loads SVG inline (GitHub Pages friendly)
   - Fetches backend JSON with timeout
   - Stand element mapping by ID (normalized)
   - Callout lozenge line + dot (pixel-perfect, same on both pages)
*/
(() => {
  "use strict";

  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";

  const S = {};

  S.$ = (id) => document.getElementById(id);

  S.normalizeBackendUrl = (input) => {
    if (!input) return "";
    let s = String(input).trim();
    try {
      const u = new URL(s);
      u.hash = "";
      u.search = "";
      // strip trailing /stands or /settings etc
      u.pathname = (u.pathname || "/").replace(/\/+$/,"").replace(/\/(stands|settings|stand)$/i,"");
      const out = (u.origin + (u.pathname && u.pathname !== "/" ? u.pathname : "")).replace(/\/+$/,"");
      return out;
    } catch {
      s = s.replace(/\/+$/,"").replace(/\/(stands|settings|stand)$/i,"");
      return s.replace(/\/+$/,"");
    }
  };

  S.getBackendUrl = () => {
    const saved = (() => {
      try { return localStorage.getItem(BACKEND_KEY) || ""; } catch { return ""; }
    })();
    const base = (saved && saved.startsWith("http")) ? saved : DEFAULT_BACKEND;
    return S.normalizeBackendUrl(base);
  };

  S.setBackendUrl = (url) => {
    try { localStorage.setItem(BACKEND_KEY, S.normalizeBackendUrl(url)); } catch {}
  };

  S.fetchJson = async (url, opts = {}) => {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 12000;
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: opts.method || "GET",
        headers: opts.headers || {},
        body: opts.body,
        signal: controller.signal,
        cache: "no-store"
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = null; }

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || text || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data ?? text;
    } finally {
      clearTimeout(t);
    }
  };

  S.loadSvgInline = async (svgUrl, hostEl) => {
    const res = await fetch(svgUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load SVG");
    const txt = await res.text();
    hostEl.innerHTML = txt;
    const svg = hostEl.querySelector("svg");
    if (!svg) throw new Error("SVG invalid");
    svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
    return svg;
  };

  S.normId = (id) => String(id||"")
    .trim()
    .toUpperCase()
    .replace(/^STAND[_-]?/,"")
    .replace(/^ZONE[_-]?/,"")
    .replace(/^ID[_-]?/,"")
    .replace(/[^A-Z0-9]/g,"");

  S.buildStandMap = (svgRoot) => {
    const map = new Map();
    if (!svgRoot) return map;

    svgRoot.querySelectorAll("[id]").forEach(node => {
      const k = S.normId(node.id);
      if (k && !map.has(k)) map.set(k, node);
    });
    svgRoot.querySelectorAll("[data-stand]").forEach(node => {
      const k = S.normId(node.getAttribute("data-stand"));
      if (k && !map.has(k)) map.set(k, node);
    });
    svgRoot.querySelectorAll("[data-stand-id]").forEach(node => {
      const k = S.normId(node.getAttribute("data-stand-id"));
      if (k && !map.has(k)) map.set(k, node);
    });
    return map;
  };

  S.elementForStand = (standMap, standId) => standMap.get(S.normId(standId)) || null;

  S.setFill = (elem, fill) => {
    if (!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem]
      : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));

    shapes.forEach(s => {
      // ignore tiny items (usually labels)
      let bbox = null;
      try { bbox = s.getBBox(); } catch {}
      if (bbox && (bbox.width < 8 || bbox.height < 8)) return;
      s.style.fill = fill;
      s.style.fillOpacity = "1";
    });
  };

  S.applyColoursAdmin = (rows, standMap, css) => {
    const sold = css.getPropertyValue("--sold").trim() || "#e63b3b";
    const avail = css.getPropertyValue("--avail").trim() || "rgba(213,109,50,0.75)";
    rows.forEach(r => {
      const el = S.elementForStand(standMap, r.standId);
      if (!el) return;
      S.setFill(el, r.status === "sold" ? sold : avail);
    });
  };

  // Public: all orange, selected red
  S.applyColoursPublic = (rows, standMap, css, selectedStandId) => {
    const orange = css.getPropertyValue("--avail").trim() || "rgba(213,109,50,0.75)";
    const red = css.getPropertyValue("--sold").trim() || "#e63b3b";
    rows.forEach(r => {
      const el = S.elementForStand(standMap, r.standId);
      if (!el) return;
      S.setFill(el, (selectedStandId && S.normId(r.standId) === S.normId(selectedStandId)) ? red : orange);
    });
  };

  S.findClickedStandId = (evTarget, rows) => {
    let node = evTarget;
    for (let i=0;i<7 && node;i++){
      const id = node.id || node.getAttribute?.("data-stand") || node.getAttribute?.("data-stand-id") || "";
      const guess = S.normId(id);
      if (guess) {
        const found = rows.find(r => S.normId(r.standId) === guess);
        if (found) return found.standId;
        // if SVG contains stand not in data, still allow selecting
        return guess;
      }
      node = node.parentElement;
    }
    return null;
  };

  S.clearCallout = (calloutSvg, lozenge, lozStand, lozCompany) => {
    if (calloutSvg) calloutSvg.innerHTML = "";
    if (lozenge) lozenge.style.display = "none";
    if (lozStand) lozStand.textContent = "—";
    if (lozCompany) { lozCompany.textContent = ""; lozCompany.style.display = "none"; }
  };

  // Draw line from lozenge top-center to stand center; dot at stand end.
  S.drawCallout = (opts) => {
    const { standElem, standId, company, planStack, calloutSvg, lozenge, lozStand, lozCompany } = opts || {};
    if (!standElem || !planStack || !calloutSvg || !lozenge) {
      S.clearCallout(calloutSvg, lozenge, lozStand, lozCompany);
      return;
    }

    lozStand.textContent = standId || "—";
    if (company) {
      lozCompany.textContent = company;
      lozCompany.style.display = "block";
    } else {
      lozCompany.textContent = "";
      lozCompany.style.display = "none";
    }
    lozenge.style.display = "inline-block";

    const standRect = standElem.getBoundingClientRect();
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

    const dotPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dot")) || 10;
    const r = dotPx / 2;

    calloutSvg.innerHTML = `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
            stroke="rgba(0,0,0,.70)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(0,0,0,.72)"/>
    `;
  };

  window.Floorplan = S;
})();
