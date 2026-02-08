/* index.js – Public floorplan page (clean rebuild) */
/* Requires shared.js to be loaded first */

(function () {
  const $ = (id) => document.getElementById(id);

  const svgHost = $("svgHost");
  const selStand = $("selStand");
  const selCompany = $("selCompany");
  const tbody = $("tbody");
  const search = $("search");
  const clearBtn = $("clearSearchBtn");
  const countEl = $("count");
  const totalEl = $("total");
  const clearSelBtn = $("clearBtn");

  let svgDoc = null;
  let rows = [];
  let selectedId = null;

  /* ---------------- SVG LOAD ---------------- */

  fetch("./event_plan.svg")
    .then((r) => r.text())
    .then((svgText) => {
      svgHost.innerHTML = svgText;
      svgDoc = svgHost.querySelector("svg");

      if (!svgDoc) {
        console.error("SVG not found inside event_plan.svg");
        return;
      }

      svgDoc.querySelectorAll("[id]").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => selectStand(el.id));
      });
    })
    .catch((err) => {
      console.error("Failed to load SVG:", err);
    });

  /* ---------------- DATA LOAD ---------------- */

  fetch(getBackendUrl() + "/stands")
    .then((r) => r.json())
    .then((data) => {
      rows = data || [];
      renderTable();
    })
    .catch(() => {
      rows = [];
      renderTable();
    });

  /* ---------------- RENDER ---------------- */

  function renderTable() {
    tbody.innerHTML = "";

    const q = (search.value || "").toLowerCase();
    const filtered = rows.filter(
      (r) =>
        r.stand.toLowerCase().includes(q) ||
        (r.company || "").toLowerCase().includes(q)
    );

    filtered.forEach((r) => {
      const tr = document.createElement("tr");
      if (r.stand === selectedId) tr.classList.add("active");

      tr.innerHTML = `
        <td>${r.stand}</td>
        <td>${r.company || ""}</td>
      `;

      tr.addEventListener("click", () => selectStand(r.stand));
      tbody.appendChild(tr);
    });

    countEl.textContent = filtered.length;
    totalEl.textContent = rows.length;
  }

  /* ---------------- SELECTION ---------------- */

  function selectStand(id) {
    selectedId = id;

    const row = rows.find((r) => r.stand === id);

    selStand.textContent = id || "None";
    selCompany.textContent =
      row && row.company
        ? row.company
        : "Desktop: click a stand or choose from the list. Phone: use the list.";

    // Highlight SVG
    if (svgDoc) {
      svgDoc.querySelectorAll("[id]").forEach((el) => {
        el.style.opacity = el.id === id ? "1" : "0.35";
      });
    }

    renderTable();
  }

  function clearSelection() {
    selectedId = null;
    selStand.textContent = "None";
    selCompany.textContent =
      "Desktop: click a stand or choose from the list. Phone: use the list.";

    if (svgDoc) {
      svgDoc.querySelectorAll("[id]").forEach((el) => {
        el.style.opacity = "1";
      });
    }

    renderTable();
  }

  /* ---------------- EVENTS ---------------- */

  search.addEventListener("input", renderTable);
  clearBtn.addEventListener("click", () => {
    search.value = "";
    renderTable();
  });

  if (clearSelBtn) {
    clearSelBtn.addEventListener("click", clearSelection);
  }
})();
