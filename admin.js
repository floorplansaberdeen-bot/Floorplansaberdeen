/* admin.js — Admin page logic (includes URL key lock, password prompt, undo stack up to 25) */
(function () {
  "use strict";

  const S = window.FloorplanShared;
  if (!S) {
    console.error("shared.js missing");
    return;
  }

  // ========= SECURITY SETTINGS (YOU EDIT THESE) =========
  // 1) URL-only secret. If left as "CHANGE_ME", lock is disabled.
  //    If you set a real value, you must open:
  //    admin.html?k=YOUR_KEY
  const ADMIN_URL_KEY = "CHANGE_ME";

  // 2) Password prompt before the FIRST change (per browser tab session).
  //    Change this to something only you know.
  const ADMIN_PASSWORD = "CHANGE_ME_PASSWORD";
  // =====================================================

  const ADMIN_KEY_PARAM = "k";
  const AUTH_SESSION_KEY = "floorplan_admin_authed";

  // HTML elements expected in admin.html
  const planStack = document.getElementById("planStack");
  const svgHost = document.getElementById("svgHost");
  const svgFallback = document.getElementById("svgFallback");
  const calloutSvg = document.getElementById("calloutSvg");

  const zoomSvgHost = document.getElementById("zoomSvgHost");

  const syncedAtEl = document.getElementById("syncedAt");
  const eventNameInput = document.getElementById("eventName");
  const setEventBtn = document.getElementById("setEventBtn");

  const pauseBtn = document.getElementById("pauseBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const resetBtn = document.getElementById("resetBtn");

  const selectedStandIdEl = document.getElementById("selectedStandId");
  const statusEl = document.getElementById("status");
  const companyEl = document.getElementById("company");

  const saveBtn = document.getElementById("saveBtn");
  const markAvailBtn = document.getElementById("markAvailBtn");

  const undoBtn = document.getElementById("undoBtn"); // button text should show count
  const searchEl = document.getElementById("search");
  const filterEl = document.getElementById("filter");
  const tbody = document.getElementById("tbody");
  const countEl = document.getElementById("count");
  const totalEl = document.getElementById("total");

  // Undo stack (max 25)
  const UNDO_MAX = 25;
  const UNDO_KEY = "floorplan_undo_stack_v1";

  let coreSvg = null;
  let rows = [];
  let selectedStandId = "";
  let paused = false;

  // --------- URL KEY LOCK ----------
  function enforceUrlKeyLock() {
    if (ADMIN_URL_KEY === "CHANGE_ME") return; // disabled
    const u = new URL(window.location.href);
    const got = (u.searchParams.get(ADMIN_KEY_PARAM) || "").trim();
    if (got !== ADMIN_URL_KEY) {
      document.body.innerHTML = `
        <div style="padding:24px;font-family:ui-sans-serif,system-ui;max-width:760px;margin:0 auto;">
          <h1 style="margin:0 0 8px;">Floorplan Admin</h1>
          <p style="margin:0 0 12px;">This page is locked. Add <code>?k=…</code> to the URL.</p>
        </div>
      `;
      throw new Error("Admin locked");
    }
  }

  // --------- PASSWORD PROMPT ----------
  async function ensurePasswordOnce() {
    // If password left as default, don’t block you
    if (ADMIN_PASSWORD === "CHANGE_ME_PASSWORD") return true;

    try {
      if (sessionStorage.getItem(AUTH_SESSION_KEY) === "1") return true;
    } catch (_) {}

    const pw = prompt("To save changes, enter the admin password:");
    if (!pw) return false;
    if (pw !== ADMIN_PASSWORD) {
      alert("Incorrect password.");
      return false;
    }
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    } catch (_) {}
    return true;
  }

  // --------- UNDO HELPERS ----------
  function loadUndoStack() {
    try {
      const raw = localStorage.getItem(UNDO_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveUndoStack(stack) {
    try {
      localStorage.setItem(UNDO_KEY, JSON.stringify(stack));
    } catch (_) {}
  }

  function pushUndo(entry) {
    const stack = loadUndoStack();
    stack.unshift(entry);
    while (stack.length > UNDO_MAX) stack.pop();
    saveUndoStack(stack);
    updateUndoUi();
  }

  function popUndo() {
    const stack = loadUndoStack();
    const entry = stack.shift();
    saveUndoStack(stack);
    updateUndoUi();
    return entry || null;
  }

  function updateUndoUi() {
    if (!undoBtn) return;
    const n = loadUndoStack().length;
    undoBtn.textContent = `Undo (${n})`;
    undoBtn.disabled = n === 0;
  }

  // --------- RENDERING ----------
  function setSyncedAt(val) {
    if (syncedAtEl) syncedAtEl.textContent = val || "—";
  }

  function renderTable() {
    if (!tbody) return;

    const q = String(searchEl?.value || "")
      .trim()
      .toLowerCase();

    const filter = String(filterEl?.value || "all").toLowerCase();

    let filtered = rows.slice();

    if (filter === "sold") filtered = filtered.filter((r) => r.status === "sold");
    if (filter === "available")
      filtered = filtered.filter((r) => r.status !== "sold");

    if (q) {
      filtered = filtered.filter((r) => {
        const s = (r.stand || "").toLowerCase();
        const c = (r.company || "").toLowerCase();
        return s.includes(q) || c.includes(q);
      });
    }

    tbody.innerHTML = "";
    filtered.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.stand = r.stand;
      if (selectedStandId && r.stand === selectedStandId) tr.classList.add("active");

      const td1 = document.createElement("td");
      td1.textContent = r.stand;

      const td2 = document.createElement("td");
      td2.textContent = r.status === "sold" ? "Sold" : "Available";
      td2.className = r.status === "sold" ? "badge sold" : "badge avail";

      const td3 = document.createElement("td");
      td3.textContent = r.company || "";

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);

      tr.addEventListener("click", () => selectStand(r.stand));

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

  function updateCalloutLine() {
    if (!planStack || !calloutSvg || !selectedStandId) {
      if (calloutSvg) S.drawCalloutLine(calloutSvg, { x: 0, y: 0 }, { x: 0, y: 0 });
      return;
    }

    const standEl = S.findStandElement(coreSvg, selectedStandId);
    if (!standEl) return;

    const stackRect = planStack.getBoundingClientRect();
    const bb = standEl.getBoundingClientRect();
    const fromPx = {
      x: bb.left + bb.width / 2 - stackRect.left,
      y: bb.top + bb.height / 2 - stackRect.top,
    };

    // target: top-middle of the labelBay lozenge if present; else just bottom-left area
    const lozenge = document.getElementById("lozenge");
    if (!lozenge || lozenge.style.display === "none") return;

    const lozRect = lozenge.getBoundingClientRect();
    const toPx = { x: lozRect.left + lozRect.width / 2 - stackRect.left, y: lozRect.top - stackRect.top };

    S.drawCalloutLine(calloutSvg, fromPx, toPx);
  }

  function selectStand(standId) {
    selectedStandId = S.normalizeStandId(standId);
    const row = rows.find((r) => r.stand === selectedStandId);

    if (selectedStandIdEl) selectedStandIdEl.value = selectedStandId || "";
    if (statusEl) statusEl.value = row?.status === "sold" ? "sold" : "available";
    if (companyEl) companyEl.value = row?.company || "";

    // Update lozenge if exists
    const lozenge = document.getElementById("lozenge");
    const lozStand = document.getElementById("lozStand");
    const lozCompany = document.getElementById("lozCompany");
    if (lozenge && lozStand && lozCompany) {
      lozenge.style.display = selectedStandId ? "block" : "none";
      lozStand.textContent = selectedStandId || "—";
      lozCompany.textContent = row?.company || "";
      lozCompany.style.display = row?.company ? "block" : "none";
    }

    renderTable();
    updatePlanColors();
    updateCalloutLine();
  }

  // --------- BACKEND IO ----------
  async function loadMeta() {
    const backend = S.getBackendUrl();
    try {
      const meta = await S.fetchJson(`${backend}/api/meta`);
      const name = (meta && meta.eventName) || S.getEventName() || "";
      if (eventNameInput) eventNameInput.value = name || "";
    } catch (_) {
      // fall back to local only
      if (eventNameInput) eventNameInput.value = S.getEventName() || "";
    }
  }

  async function loadStands() {
    const backend = S.getBackendUrl();
    const data = await S.fetchJson(`${backend}/api/stands`);
    const list = Array.isArray(data) ? data : (data && data.rows) || [];

    rows = list
      .map((r) => ({
        stand: S.normalizeStandId(r.stand || r.standId || r.id),
        status: S.normalizeStatus(r.status),
        company: String(r.company || ""),
      }))
      .filter((r) => r.stand)
      .sort((a, b) => a.stand.localeCompare(b.stand, undefined, { numeric: true }));

    renderTable();
    updatePlanColors();
  }

  async function tryUpdateEndpoints(standId, payload) {
    const backend = S.getBackendUrl();
    const id = encodeURIComponent(standId);

    // We try common patterns (because backends differ):
    const attempts = [
      { method: "PUT", url: `${backend}/api/stands/${id}` },
      { method: "POST", url: `${backend}/api/stands/${id}` },
      { method: "POST", url: `${backend}/api/stand` },
      { method: "POST", url: `${backend}/api/stands` },
    ];

    let lastErr = null;
    for (const a of attempts) {
      try {
        const body =
          a.url.endsWith("/api/stand") || a.url.endsWith("/api/stands")
            ? JSON.stringify(Object.assign({ stand: standId }, payload))
            : JSON.stringify(payload);

        const res = await S.fetchJson(a.url, { method: a.method, body });
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Update failed");
  }

  async function applyUpdate(standId, newStatus, newCompany, opts = {}) {
    if (!standId) return;

    // password once per session for any write
    if (!opts.skipPassword) {
      const ok = await ensurePasswordOnce();
      if (!ok) return;
    }

    // record previous state for undo
    const prev = rows.find((r) => r.stand === standId);
    if (prev && !opts.skipUndo) {
      pushUndo({
        stand: standId,
        status: prev.status,
        company: prev.company || "",
        ts: Date.now(),
      });
    }

    await tryUpdateEndpoints(standId, {
      status: newStatus,
      company: newCompany || "",
    });

    // local update
    const idx = rows.findIndex((r) => r.stand === standId);
    if (idx !== -1) {
      rows[idx] = { stand: standId, status: newStatus, company: newCompany || "" };
    }

    setSyncedAt(new Date().toLocaleTimeString());
    renderTable();
    updatePlanColors();
    selectStand(standId);
  }

  // --------- CSV (simple) ----------
  function toCsv() {
    const lines = [["Stand", "Status", "Company"]];
    rows.forEach((r) => {
      lines.push([r.stand, r.status, r.company || ""]);
    });
    return lines
      .map((row) =>
        row
          .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  async function importCsvFile(file) {
    const ok = await ensurePasswordOnce();
    if (!ok) return;

    const text = await file.text();
    (text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(1) // skip header
      .forEach((line) => {
        const parts = line
          .split(",")
          .map((p) => p.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
        const stand = S.normalizeStandId(parts[0] || "");
        const status = S.normalizeStatus(parts[1] || "");
        const company = parts.slice(2).join(",") || "";
        if (!stand) return;
        const idx = rows.findIndex((r) => r.stand === stand);
        if (idx !== -1) rows[idx] = { stand, status, company };
      });

    // Push each changed stand to backend (sequential, safer)
    for (const r of rows) {
      await tryUpdateEndpoints(r.stand, { status: r.status, company: r.company || "" });
    }

    setSyncedAt(new Date().toLocaleTimeString());
    renderTable();
    updatePlanColors();
    updateUndoUi();
    alert("CSV imported.");
  }

  // --------- INIT ----------
  async function init() {
    enforceUrlKeyLock();

    updateUndoUi();

    // Pre-fill event name from backend/local
    await loadMeta();

    // Load SVG inline
    try {
      if (svgHost) {
        coreSvg = await S.loadSvgInline(S.DEFAULTS.svgUrl, svgHost);
      }
    } catch (e) {
      console.error(e);
      // fallback to <img> if present
      if (svgFallback) svgFallback.style.display = "block";
      return;
    }

    // Click plan to select
    if (coreSvg) {
      coreSvg.addEventListener("click", (ev) => {
        let el = ev.target;
        for (let i = 0; i < 6 && el; i++) {
          const id = el.getAttribute && el.getAttribute("id");
          const ds =
            el.getAttribute &&
            (el.getAttribute("data-stand") || el.getAttribute("data-stand-id"));
          const guess = S.normalizeStandId(ds || id || "");
          if (guess) {
            selectStand(guess);
            return;
          }
          el = el.parentNode;
        }
      });
    }

    // Data load
    await loadStands();
    setSyncedAt("—");

    // Search / filter
    if (searchEl) searchEl.addEventListener("input", renderTable);
    if (filterEl) filterEl.addEventListener("change", renderTable);

    // Buttons
    if (setEventBtn && eventNameInput) {
      setEventBtn.addEventListener("click", async () => {
        const ok = await ensurePasswordOnce();
        if (!ok) return;

        const name = String(eventNameInput.value || "").trim();
        S.setEventName(name);

        // Try to persist to backend if supported
        const backend = S.getBackendUrl();
        try {
          await S.fetchJson(`${backend}/api/meta`, {
            method: "POST",
            body: JSON.stringify({ eventName: name }),
          });
        } catch (_) {
          // ok if backend doesn't support meta write
        }
        alert("Event name saved.");
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        paused = !paused;
        pauseBtn.textContent = paused ? "Resume sync" : "Pause sync";
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        download("floorplan.csv", toCsv());
      });
    }

    if (importBtn) {
      importBtn.addEventListener("click", async () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,text/csv";
        input.onchange = async () => {
          if (!input.files || !input.files[0]) return;
          await importCsvFile(input.files[0]);
        };
        input.click();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        const ok = await ensurePasswordOnce();
        if (!ok) return;
        if (!confirm("Reset ALL stands to Available?")) return;

        // Build a batch reset (best-effort)
        for (const r of rows) {
          // store undo snapshots (but cap)
          pushUndo({ stand: r.stand, status: r.status, company: r.company || "", ts: Date.now() });
          await tryUpdateEndpoints(r.stand, { status: "available", company: "" });
          r.status = "available";
          r.company = "";
        }

        setSyncedAt(new Date().toLocaleTimeString());
        renderTable();
        updatePlanColors();
        updateUndoUi();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const stand = S.normalizeStandId(selectedStandIdEl?.value || selectedStandId);
        if (!stand) return alert("Select a stand first.");
        const status = S.normalizeStatus(statusEl?.value || "available");
        const company =
          status === "sold" ? String(companyEl?.value || "").trim() : "";
        await applyUpdate(stand, status, company);
      });
    }

    if (markAvailBtn) {
      markAvailBtn.addEventListener("click", async () => {
        const stand = S.normalizeStandId(selectedStandIdEl?.value || selectedStandId);
        if (!stand) return alert("Select a stand first.");
        if (statusEl) statusEl.value = "available";
        if (companyEl) companyEl.value = "";
        await applyUpdate(stand, "available", "");
      });
    }

    if (undoBtn) {
      undoBtn.addEventListener("click", async () => {
        const entry = popUndo();
        if (!entry) return;
        // Undo should not re-prompt password (already authed usually),
        // but to be safe we still require once per session for writes.
        await applyUpdate(entry.stand, entry.status, entry.company || "", { skipUndo: true });
      });
    }

    // Keep callout line correct
    window.addEventListener("resize", updateCalloutLine);
    window.addEventListener("scroll", updateCalloutLine, true);

    updateUndoUi();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => {
      // If locked, we already replaced body. Otherwise log.
      console.error(e);
    });
  });
})();
