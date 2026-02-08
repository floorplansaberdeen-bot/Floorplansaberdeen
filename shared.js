// shared.js — Phase A: label / callout system (Admin + Index)

// CONFIG
const LABEL_DOT_DIAMETER = 10;
const LABEL_LINE_WIDTH = 3;

// State
let currentSelectedStandId = null;

// Utility
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

// PUBLIC API
window.renderCallout = function({
  standElem,
  standId,
  company,
  planStack,
  calloutSvg,
  lozenge,
  lozStand,
  lozCompany
}) {
  if (!standElem || !planStack) return clearCallout(calloutSvg, lozenge, lozStand, lozCompany);

  currentSelectedStandId = standId;

  // Update lozenge
  lozStand.textContent = standId;
  if (company) {
    lozCompany.textContent = company;
    lozCompany.style.display = "block";
  } else {
    lozCompany.textContent = "";
    lozCompany.style.display = "none";
  }
  lozenge.style.display = "inline-block";

  // Geometry
  const standRect = standElem.getBoundingClientRect();
  const stackRect = planStack.getBoundingClientRect();
  const lozRect = lozenge.getBoundingClientRect();

  const standCx = standRect.left + standRect.width / 2;
  const standCy = standRect.top + standRect.height / 2;

  const lozCx = lozRect.left + lozRect.width / 2;
  const lozTop = lozRect.top;

  const x1 = lozCx - stackRect.left;
  const y1 = lozTop - stackRect.top;
  const x2 = standCx - stackRect.left;
  const y2 = standCy - stackRect.top;

  const w = stackRect.width;
  const h = stackRect.height;

  calloutSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  calloutSvg.setAttribute("preserveAspectRatio", "none");

  const r = LABEL_DOT_DIAMETER / 2;

  calloutSvg.innerHTML = `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
          stroke="rgba(0,0,0,.7)"
          stroke-width="${LABEL_LINE_WIDTH}"
          stroke-linecap="round"/>
    <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(0,0,0,.72)"/>
  `;
};

window.clearCallout = function(calloutSvg, lozenge, lozStand, lozCompany){
  if (calloutSvg) calloutSvg.innerHTML = "";
  if (lozenge) lozenge.style.display = "none";
  if (lozStand) lozStand.textContent = "—";
  if (lozCompany){
    lozCompany.textContent = "";
    lozCompany.style.display = "none";
  }
};
