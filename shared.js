/* shared.js — shared helpers for Floorplan (public + admin)
   No frameworks. Designed for GitHub Pages.
*/
(function () {
  "use strict";

  const DEFAULTS = {
    defaultBackend: "https://floorplansaberdeen.floorplansaberdeen.workers.dev",
    backendKey: "floorplan_backend_url",
    eventNameKey: "floorplan_event_name",
    svgUrl: "./event_plan.svg",
  };

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function normalizeStandId(input) {
    return String(input || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/^STAND[_-]/, "")
      .replace(/^ZONE[_-]/, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  function normalizeStatus(input) {
    const s = String(input || "").trim().toLowerCase();
    if (s === "sold" || s === "marked sold" || s === "markedsold") return "sold";
    return "available";
  }

  function getBackendUrl() {
    try {
      const saved = localStorage.getItem(DEFAULTS.backendKey);
      if (saved && saved.trim()) return saved.trim();
    } catch (_) {}
    return DEFAULTS.defaultBackend;
  }

  function setBackendUrl(url) {
    localStorage.setItem(DEFAULTS.backendKey, String(url || "").trim());
  }

  function getEventName() {
    try {
      const n = localStorage.getItem(DEFAULTS.eventNameKey);
      return (n && n.trim()) || "";
    } catch (_) {
      return "";
    }
  }

  function setEventName(name) {
    try {
      localStorage.setItem(DEFAULTS.eventNameKey, String(name || "").trim());
    } catch (_) {}
  }

  async function fetchJson(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);

    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );

    try {
      const res = await fetch(url, {
        method: opts.method || "GET",
        headers,
        body: opts.body,
        signal: ctrl.signal,
        cache: "no-store",
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text();

      let data = null;
      if (text && ct.includes("application/json")) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = null;
        }
      } else if (text && text.trim().startsWith("{")) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = null;
        }
      }

      if (!res.ok) {
        const msg =
          (data && (data.error || data.message)) ||
          text ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data != null ? data : text;
    } finally {
      clearTimeout(t);
    }
  }

  async function loadSvgInline(svgUrl, hostEl) {
    const res = await fetch(svgUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load SVG");
    const svgText = await res.text();
    hostEl.innerHTML = svgText;

    // Find the injected <svg> element
    const svg = qs("svg", hostEl);
    if (!svg) throw new Error("SVG element not found after injection");

    // Make responsive
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    return svg;
  }

  function findStandElement(svgEl, standId) {
    const id = normalizeStandId(standId);
    if (!id || !svgEl) return null;

    // Try common patterns
    const candidates = [
      `#${CSS.escape(id)}`,
      `#${CSS.escape("stand_" + id)}`,
      `#${CSS.escape("stand-" + id)}`,
      `[data-stand="${CSS.escape(id)}"]`,
      `[data-stand-id="${CSS.escape(id)}"]`,
    ];

    for (const sel of candidates) {
      const el = svgEl.querySelector(sel);
      if (el) return el;
    }

    // Last resort: look for any element whose id ends with the stand id
    const any = qsa("[id]", svgEl).find((e) =>
      normalizeStandId(e.id).endsWith(id)
    );
    return any || null;
  }

  function setStandVisual(el, status, isSelected) {
    if (!el) return;

    // We set styles on the element itself; if it's a group, style children too.
    const targets =
      el.tagName.toLowerCase() === "g" ? qsa("*", el) : [el];

    const sold = normalizeStatus(status) === "sold";

    targets.forEach((t) => {
      if (
        !["path", "rect", "polygon", "polyline", "ellipse", "circle"].includes(
          t.tagName.toLowerCase()
        )
      )
        return;

      // fill is controlled but we keep outlines visible
      t.style.fill = sold ? "rgb(239,68,68)" : "rgb(241,159,104)"; // red / peach-ish
      t.style.fillOpacity = "1";
      t.style.stroke = isSelected ? "rgb(17,24,39)" : "rgba(17,24,39,0.6)";
      t.style.strokeWidth = isSelected ? "3" : "1.2";
    });
  }

  function getSvgPointFromClient(svgEl, clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return { x: p.x, y: p.y };
  }

  function clearSvgChildren(svgEl) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  }

  function drawCalloutLine(calloutSvg, fromPx, toPx) {
    if (!calloutSvg) return;
    clearSvgChildren(calloutSvg);

    // Ensure overlay is sized to its box
    const box = calloutSvg.getBoundingClientRect();
    calloutSvg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(fromPx.x));
    line.setAttribute("y1", String(fromPx.y));
    line.setAttribute("x2", String(toPx.x));
    line.setAttribute("y2", String(toPx.y));
    line.setAttribute("stroke", "rgba(17,24,39,0.85)");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    calloutSvg.appendChild(line);
  }

  function toast(msg) {
    // Minimal helper; pages may implement their own UI
    console.warn(msg);
  }

  window.FloorplanShared = {
    DEFAULTS,
    qs,
    qsa,
    normalizeStandId,
    normalizeStatus,
    getBackendUrl,
    setBackendUrl,
    getEventName,
    setEventName,
    fetchJson,
    loadSvgInline,
    findStandElement,
    setStandVisual,
    getSvgPointFromClient,
    drawCalloutLine,
    toast,
  };
})();
