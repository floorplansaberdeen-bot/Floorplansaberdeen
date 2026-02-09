/* ===============================
   Floorplan – Shared Helpers
   =============================== */

const DEFAULT_BACKEND =
  "https://floorplansaberdeen.floorplansaberdeen.workers.dev";

const BACKEND_KEY = "floorplan_backend_url";
const SVG_PATH = "./event_plan.svg";

/* -------------------------------
   Backend helpers
-------------------------------- */

export function getBackendUrl() {
  const stored = localStorage.getItem(BACKEND_KEY);
  return (stored && stored.startsWith("http")) ? stored : DEFAULT_BACKEND;
}

export async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/* -------------------------------
   SVG loading
-------------------------------- */

export async function loadSVG(intoEl) {
  const res = await fetch(SVG_PATH);
  if (!res.ok) throw new Error("SVG failed to load");
  const text = await res.text();
  intoEl.innerHTML = text;

  const svg = intoEl.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG");

  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  return svg;
}

/* -------------------------------
   Stand ID logic
-------------------------------- */

/**
 * Accept ONLY real stand IDs like:
 * A1, AA12, SB3, AD27
 * Reject CAD junk like LWPOLYLINE117
 */
export function isValidStandId(id) {
  if (!id) return false;
  const s = String(id).trim().toUpperCase();
  return /^[A-Z]{1,3}[0-9]{1,3}$/.test(s);
}

export function normaliseStandId(id) {
  return String(id || "").trim().toUpperCase();
}

/* Walk up DOM tree to find a valid stand */
export function findStandFromTarget(target) {
  let el = target;
  for (let i = 0; i < 6 && el; i++) {
    if (el.id && isValidStandId(el.id)) return el.id;
    el = el.parentElement;
  }
  return null;
}

/* -------------------------------
   Time helpers
-------------------------------- */

export function formatTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
