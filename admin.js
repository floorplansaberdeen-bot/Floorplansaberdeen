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

const zoomSvgHost = document.getElementById("zoomSvgHost");
const zoomRing = document.getElementById("zoomRing");

const tbody = document.getElementById("tbody");
const standIdEl = document.getElementById("standId");
const statusEl = document.getElementById("status");
const companyEl = document.getElementById("company");

const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");

const syncedAt = document.getElementById("syncedAt");

/* ===============================
   State
================================ */

let svgRoot = null;
let rows = [];
let selectedStand = null;
let adminPassword = null;

/* ===============================
   Password
================================ */

function requirePassword() {
  if (adminPassword) return adminPassword;
  const p = prompt("Admin password:");
  if (!p) throw new Error("Password required");
  adminPassword = p;
  return p;
}

/* ===============================
   Load SVG + data
================================ */

async function init() {
  svgRoot = await loadSVG(svgHost);
  svgRoot.addEventListener("click", onPlanClick);

  await loadData();
}

async function loadData() {
  rows = await fetchJSON(`${getBackendUrl()}/stands`);
  renderTable();
  syncedAt.textContent = formatTime();
}

/* ===============================
   Plan interaction
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

  standIdEl.value = sid;
  statusEl.value = row.status;
  companyEl.value = row.company || "";

  drawLabel(row);
  updateZoom(sid);
  highlightRow(sid);
}

/* ===============================
   Label + callout
================================ */

function drawLabel(row) {
  lozenge.style.display = "inline-block";
  lozStand.textContent = row.standId;

  if (row.company) {
    lozCompany.style.display = "block";
    lozCompany.textContent = row.company;
  } else {
    lozCompany.style.display = "none";
  }

  calloutSvg.innerHTML = "";
}

/* ===============================
   Zoom (RAW SVG ONLY)
================================ */

function updateZoom(standId) {
  zoomSvgHost.innerHTML = "";
  zoomRing.style.display = "none";

  const clone = svgRoot.cloneNode(true);
  clone.removeAttribute("style");

  zoomSvgHost.appendChild(clone);

  const target = clone.querySelector(`#${CSS.escape(standId)}`);
  if (!target || !target.getBBox) return;

  const box = target.getBBox();
  const pad = Math.max(box.width, box.height) * 1.4;

  clone.setAttribute(
    "viewBox",
    `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`
  );

  requestAnimationFrame(() => {
    zoomRing.style.display = "block";
  });
}

/* ===============================
   Table
================================ */

function renderTable() {
  tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.standId}</td>
      <td>${r.status}</td>
      <td>${r.company || ""}</td>
    `;
    tr.onclick = () => selectStand(r.standId);
    tbody.appendChild(tr);
  });
}

function highlightRow(id) {
  [...tbody.children].forEach(tr => {
    tr.classList.toggle("active", tr.firstChild.textContent === id);
  });
}

/* ===============================
   Save / Reset / CSV
================================ */

saveBtn.onclick = async () => {
  if (!selectedStand) return;
  const pwd = requirePassword();

  await fetchJSON(`${getBackendUrl()}/stand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      standId: selectedStand,
      status: statusEl.value,
      company: companyEl.value,
      adminPassword: pwd
    })
  });

  await loadData();
};

resetBtn.onclick = async () => {
  if (!confirm("Reset all stands to available?")) return;
  const pwd = requirePassword();

  for (const r of rows) {
    await fetchJSON(`${getBackendUrl()}/stand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        standId: r.standId,
        status: "available",
        company: "",
        adminPassword: pwd
      })
    });
  }
  await loadData();
};

exportBtn.onclick = () => {
  requirePassword();
  const csv = ["standId,status,company"]
    .concat(rows.map(r => `${r.standId},${r.status},"${r.company || ""}"`))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stands.csv";
  a.click();
};

importBtn.onclick = () => {
  requirePassword();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv";
  input.onchange = async () => {
    const text = await input.files[0].text();
    const lines = text.split(/\r?\n/).slice(1);

    for (const line of lines) {
      if (!line.trim()) continue;
      const [id, status, company] = line.split(",");
      await fetchJSON(`${getBackendUrl()}/stand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standId: id,
          status,
          company: company?.replace(/"/g, ""),
          adminPassword
        })
      });
    }
    await loadData();
  };
  input.click();
};

/* ===============================
   Init
================================ */

init().catch(err => {
  console.error(err);
  alert(err.message);
});
