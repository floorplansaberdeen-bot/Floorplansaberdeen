/* index.js — Public page logic */
(function () {
  "use strict";

  const S = window.FloorplanShared;
  if (!S) {
    console.error("shared.js missing");
    return;
  }

  // Elements (must exist in index.html)
  const planStack = document.getElementById("planStack");
  const svgHost = document.getElementById("svgHost");
  const calloutSvg = document.getElementById("calloutSvg");
  const lozenge = document.getElementById("lozenge");
  const lozStand = document.getElementById("lozStand");
  const lozCompany = document.getElementById("lozCompany");

  const tbody = document.getElementById("tbody");
  const searchEl = document.getElementById("search");
  const clearSearchBtn = document.getElementById("clearSearchBtn");

  const countEl = document.getElementById("count");
  const totalEl = document.getElementById("total");

  const updatedAtEl = document.getElementById("updatedAt");
  const eventNameEl = document.getElementById("eventName");

  const clearBtn = document.getElementById("clearBtn");

  let coreSvg = null;
  let rows = [];
  let selectedStandId = "";
  let selectedCompany = "";

  function setHeaderMeta(meta) {
    // Event name
    const localName = S.getEventName();
    const name = (meta && meta.eventName) || localName || "";
    if (eventNameEl) eventNameEl.textContent = name || "—";

    // Updated at
    const updated =
      (meta && (meta.updatedAt || meta.updated_at)) || "";
    if (updatedAtEl) updatedAtEl.textContent = updated || "—";
  }

  function renderList() {
    if (!tbody) return;

    const q = String(searchEl?.value || "")
      .trim()
      .toLowerCase();

    const filtered = rows.filter((r) => {
      const stand = (r.stand || "").toLowerCase();
      const company = (r.company || "").toLowerCase();
      return !q || stand.includes(q) || company.includes(q);
    });

    tbody.innerHTML = "";

    filtered.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.stand = r.stand;

      if (selectedStandId && r.stand === selectedStandId) {
        tr.classList.add("active");
      }

      const td1 = document.createElement("td");
      td1.textContent = r.stand;

      const td2 = document.createElement("td");
      td2.textContent = r.company || "";

      tr.appendChild(td1);
      tr.appendChild(td2);

      tr.addEventListener("click", () => {
        selectStand(r.stand, r.company || "");
      });

      tbody.appendChild(tr);
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (totalEl) totalEl.textContent = String(rows.length);
  }

  function updatePlanColors() {
    if (!coreSvg) return;
    rows.forEach((r) => {
      const el = S.findStandElement(coreSvg, r.stand);
      S.setStandVisual(el, r.status, r.stand === selectedStandId);
    });
  }

  function updateCallout() {
    if (!planStack || !calloutSvg || !lozenge) return;

    if (!selectedStandId) {
      lozenge.style.display = "none";
      S.drawCalloutLine(calloutSvg, { x: 0, y: 0 }, { x: 0, y: 0 });
      return;
    }

    lozenge.style.display = "block";
    lozStand.textContent = selectedStandId;
    lozCompany.textContent = selectedCompany || "";
    lozCompany.style.display = selectedCompany ? "block" : "none";

    // Compute positions in planStack local pixel coords
    const stackRect = planStack.getBoundingClientRect();

    // Stand point from SVG bounding box in screen coords
    const standEl = S.findStandElement(coreSvg, selectedStandId);
    if (!standEl) return;
    const bb = standEl.getBoundingClientRect();
    const standPx = {
      x: bb.left + bb.width / 2 - stackRect.left,
      y: bb.top + bb.height / 2 - stackRect.top,
    };

    // Target point: top-center of lozenge
    const lozRect = lozenge.getBoundingClientRect();
    const lozPx = {
      x: lozRect.left + lozRect.width / 2 - stackRect.left,
      y: lozRect.top - stackRect.top, // top edge
    };

    S.drawCalloutLine(calloutSvg, standPx, lozPx);
  }

  function selectStand(standId, company) {
    selectedStandId = S.normalizeStandId(standId);
    selectedCompany = company || "";

    renderList();
    updatePlanColors();
    updateCallout();
  }

  async function loadDataAndRender() {
    const backend = S.getBackendUrl();

    // Try meta (safe if backend supports it)
    let meta = null;
    try {
      meta = await S.fetchJson(`${backend}/api/meta`);
    } catch (_) {
      meta = null;
    }
    setHeaderMeta(meta);

    // Load stands
    const data = await S.fetchJson(`${backend}/api/stands`);
    const list = Array.isArray(data) ? data : (data && data.rows) || [];
    rows = list.map((r) => ({
      stand: S.normalizeStandId(r.stand || r.standId || r.id),
      status: S.normalizeStatus(r.status),
      company: String(r.company || ""),
    }));

    // Remove empties
    rows = rows.filter((r) => r.stand);

    // Keep stable sorting
    rows.sort((a, b) => a.stand.localeCompare(b.stand, undefined, { numeric: true }));

    renderList();
    updatePlanColors();
    updateCallout();
  }

  async function init() {
    if (!svgHost) return;

    try {
      coreSvg = await S.loadSvgInline(S.DEFAULTS.svgUrl, svgHost);
    } catch (e) {
      console.error(e);
      S.toast("SVG failed to load");
      return;
    }

    // Click on plan selects stand (desktop only works best)
    if (coreSvg) {
      coreSvg.addEventListener("click", (ev) => {
        const target = ev.target;
        if (!target) return;

        // Walk up to find an element that looks like a stand
        let el = target;
        for (let i = 0; i < 6 && el; i++) {
          const id = el.getAttribute && el.getAttribute("id");
          const ds = el.getAttribute && (el.getAttribute("data-stand") || el.getAttribute("data-stand-id"));
          const guess = S.normalizeStandId(ds || id || "");
          if (guess) {
            // Lookup company in rows if available
            const row = rows.find((r) => r.stand === guess);
            selectStand(guess, row ? row.company : "");
            return;
          }
          el = el.parentNode;
        }
      });
    }

    // Search
    if (searchEl) searchEl.addEventListener("input", renderList);
    if (clearSearchBtn)
      clearSearchBtn.addEventListener("click", () => {
        if (searchEl) searchEl.value = "";
        renderList();
      });

    // Clear selection
    if (clearBtn)
      clearBtn.addEventListener("click", () => {
        selectedStandId = "";
        selectedCompany = "";
        renderList();
        updatePlanColors();
        updateCallout();
      });

    // Keep callout line correct on resize/scroll
    window.addEventListener("resize", updateCallout);
    window.addEventListener("scroll", updateCallout, true);

    // Load data
    try {
      await loadDataAndRender();
    } catch (e) {
      console.error(e);
      S.toast("Could not load data from backend");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
