import {
  getBackendUrl,
  fetchJSON,
  loadSVG,
  findStandFromTarget,
  normaliseStandId,
  formatTime
} from "./shared.js";

/* ===============================
   Elements
================================ */

const svgHost = document.getElementById("svgHost");
const planStack = document.getElementById("planStack");

const lozenge = document.getElementById("lozenge");
const lozStand = document.getElementById("lozStand");
const lozCompany = document.getElementById("lozCompany");
const calloutSvg = document.getElementById("calloutSvg");

const tbody = document.getElementById("tbody");
const searchEl = document.getElementById("search");
const clearBtn = document.getElementById("clearSearchBtn");
const countEl = document.getElementById("count");
const totalEl = document.getElementById("total");
const updatedEl = document.getElementById("lastUpdated");

/* ===============================
   State
================================ */

let svgRoot = null;
let rows = [];
let selectedStand = null;
let pollTimer = null;

/* ===============================
   Init
================================ */

async function init() {
  svgRoot = await loadSVG(svgHost);

  // Desktop only plan click
  if (window.matchMedia("(pointer:fine)").matches) {
    svgRoot.addEventListener("click", onPlanClick);
  }

  searchEl.addEventListener("input", renderTable);
  clearBtn.onclick = () => {
    searchEl.value = "";
    renderTable();
  };

  await loadData();
  startPolling();
}

/* ===============================
   Data
================================ */

async function loadData() {
  rows = await fetchJSON(`${getBackendUrl()}/stands`);
  renderTable();
  updatedEl.textContent = formatTime();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(loadData, 8000);
}

/* ===============================
   Plan click
================================ */

function onPlanClick(e) {
  const standId = findStandFromTarget(e.target);
  if (!standId) return;
  selectStand(standId);
}

/* ===============================
   Selection
================================ */

function selectStand(id) {
  const sid = normaliseStandId(id);
  const row = rows.find(r => r.standId === sid);
  if (!row) return;

  selectedStand = sid;
  drawLabel(row);
  highlightRow(sid);
}

/* ===============================
   Label
================================ */

function drawLabel(row) {
  lozenge.style.display = "inline-block";
  lozStand.textContent = row.standId;
  lozCompany.textContent = row.company || "";
  lozCompany.style.display = row.company ? "block" : "none";
  calloutSvg.innerHTML = "";
}

/* ===============================
   Table
================================ */

function renderTable() {
  const q = searchEl.value.trim().toLowerCase();
  tbody.innerHTML = "";

  const filtered = rows.filter(r =>
    !q ||
    r.standId.toLowerCase().includes(q) ||
    (r.company || "").toLowerCase().includes(q)
  );

  filtered.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.standId}</td>
      <td>${r.company || ""}</td>
    `;
    tr.onclick = () => selectStand(r.standId);
    tbody.appendChild(tr);
  });

  countEl.textContent = filtered.length;
  totalEl.textContent = rows.length;
}

function highlightRow(id) {
  [...tbody.children].forEach(tr => {
    tr.classList.toggle("active", tr.firstChild.textContent === id);
  });
}

/* ===============================
   Start
================================ */

init().catch(err => {
  console.error(err);
});
