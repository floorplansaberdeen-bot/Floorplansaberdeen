/* index.js — Public page: loads SVG + exhibitors, supports desktop plan click, polls backend */
(() => {
  "use strict";
  const S = window.FloorplanShared;
  const el = (id)=>document.getElementById(id);

  const svgHost = el("svgHost");
  const planStack = el("planStack");
  const calloutSvg = el("calloutSvg");
  const lozenge = el("lozenge");
  const lozStand = el("lozStand");
  const lozCompany = el("lozCompany");

  const tbody = el("tbody");
  const searchEl = el("search");
  const clearBtn = el("clearSearchBtn");
  const countEl = el("count");
  const totalEl = el("total");

  const eventNameEl = el("eventName");
  const updatedAtEl = el("updatedAt");

  const SVG_URL = "./event_plan.svg";

  let svgRoot = null;
  let standMap = new Map();
  let rows = [];
  let selectedStandId = null;
  let pollTimer = null;
  let suspendUntil = 0;

  function normStandId(s){ return String(s||"").trim().toUpperCase(); }
  function looksLikeStandId(id){ return /^[A-Z]{1,3}\d{1,3}$/.test(normStandId(id)); }

  function buildStandMap(){
    standMap.clear();
    if (!svgRoot) return;
    svgRoot.querySelectorAll("[id]").forEach(n=>{
      const k = normStandId(n.id);
      if (looksLikeStandId(k) && !standMap.has(k)) standMap.set(k,n);
    });
    svgRoot.querySelectorAll("[data-stand]").forEach(n=>{
      const k = normStandId(n.getAttribute("data-stand"));
      if (looksLikeStandId(k) && !standMap.has(k)) standMap.set(k,n);
    });
  }
  function elementForStand(id){ return standMap.get(normStandId(id)) || null; }

  function setFillForElement(elem, color){
    if (!elem) return;
    const shapes = elem.matches("path,rect,polygon,polyline,ellipse,circle")
      ? [elem] : Array.from(elem.querySelectorAll("path,rect,polygon,polyline,ellipse,circle"));
    shapes.forEach(s=>{
      const bbox = s.getBBox ? s.getBBox() : null;
      if (bbox && (bbox.width < 6 || bbox.height < 6)) return;
      s.style.fill = color;
      s.style.fillOpacity = "1";
    });
  }

  function applyColours(){
    rows.forEach(r=>{
      const elem = elementForStand(r.standId);
      if (!elem) return;
      // Public rule: orange for all stands, red for selected only.
      const color = (selectedStandId && r.standId === selectedStandId) ? "#e63b3b" : "#f59f68";
      setFillForElement(elem, color);
    });
  }

  function clearCallout(){
    if (calloutSvg) calloutSvg.innerHTML = "";
    if (lozenge) lozenge.style.display = "none";
    if (lozStand) lozStand.textContent = "—";
    if (lozCompany){
      lozCompany.style.display="none";
      lozCompany.textContent="";
    }
  }

  function drawCallout(standId){
    const row = rows.find(r=>r.standId===standId);
    const elem = elementForStand(standId);
    if (!row || !elem) { clearCallout(); return; }

    lozStand.textContent = standId;
    const company = (row.status==="sold" ? (row.company||"") : "");
    if (company){
      lozCompany.style.display="block";
      lozCompany.textContent=company;
    } else {
      lozCompany.style.display="none";
      lozCompany.textContent="";
    }
    lozenge.style.display="inline-block";

    const standRect = elem.getBoundingClientRect();
    const standPt = { x: standRect.left + standRect.width/2, y: standRect.top + standRect.height/2 };

    const lozRect = lozenge.getBoundingClientRect();
    const lozTop = { x: lozRect.left + lozRect.width/2, y: lozRect.top };

    const stackRect = planStack.getBoundingClientRect();
    const x1 = lozTop.x - stackRect.left;
    const y1 = lozTop.y - stackRect.top;
    const x2 = standPt.x - stackRect.left;
    const y2 = standPt.y - stackRect.top;

    calloutSvg.setAttribute("viewBox", `0 0 ${stackRect.width} ${stackRect.height}`);
    calloutSvg.setAttribute("preserveAspectRatio","none");

    const r = 5;
    calloutSvg.innerHTML = `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(0,0,0,.70)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x2}" cy="${y2}" r="${r}" fill="rgba(0,0,0,.72)"/>
    `;
  }

  function renderTable(){
    const q = (searchEl.value||"").trim().toLowerCase();
    const filtered = rows.filter(r=>{
      if (!q) return true;
      return r.standId.toLowerCase().includes(q) || (r.company||"").toLowerCase().includes(q);
    });

    tbody.innerHTML="";
    filtered.forEach(r=>{
      const tr = document.createElement("tr");
      if (selectedStandId === r.standId) tr.classList.add("active");
      tr.innerHTML = `<td>${r.standId}</td><td>${r.company||""}</td>`;
      tr.addEventListener("click", ()=>selectStand(r.standId, true));
      tbody.appendChild(tr);
    });

    if (countEl) countEl.textContent = String(filtered.length);
    if (totalEl) totalEl.textContent = String(rows.length);
  }

  function beginSuspend(ms){ suspendUntil = Date.now() + (ms||0); }
  function isSuspended(){ return Date.now() < suspendUntil; }

  function selectStand(standId, fromList){
    selectedStandId = normStandId(standId);
    applyColours();
    drawCallout(selectedStandId);
    renderTable();

    // On phone: plan tap disabled (we won't bind click)
    if (fromList) beginSuspend(1200);
  }

  async function loadSvg(){
    const res = await fetch(SVG_URL, {cache:"no-store"});
    if (!res.ok) throw new Error("Could not load SVG");
    const txt = await res.text();
    svgHost.innerHTML = txt;
    svgRoot = svgHost.querySelector("svg");
    if (!svgRoot) throw new Error("SVG invalid");

    svgRoot.setAttribute("preserveAspectRatio","xMidYMid meet");
    svgRoot.style.width="100%";
    svgRoot.style.height="auto";
    svgRoot.style.display="block";

    buildStandMap();

    // Desktop only: allow plan clicks
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    if (!isPhone){
      svgRoot.addEventListener("click", (ev)=>{
        let node = ev.target;
        for (let i=0;i<10 && node;i++){
          const id = node.id ? normStandId(node.id) : "";
          if (looksLikeStandId(id)){
            const found = rows.find(r=>r.standId===id);
            if (found) selectStand(found.standId, false);
            return;
          }
          node = node.parentElement;
        }
      }, {passive:true});
    }
  }

  async function loadSettings(){
    const backend = S.getBackendUrl();
    try{
      const settings = await S.fetchJson(`${backend}/settings`);
      const name = String(settings.eventName || settings.event_name || "").trim();
      if (eventNameEl) eventNameEl.textContent = name || "—";
    }catch(_){}
  }

  async function loadData(){
    const backend = S.getBackendUrl();
    const data = await S.fetchJson(`${backend}/stands`);
    rows = (Array.isArray(data)?data:[]).map(r=>({
      standId: normStandId(r.standId ?? r.stand ?? r.id),
      status: String(r.status||"available").toLowerCase(),
      company: String(r.company||"").trim()
    })).filter(r=>r.standId);

    applyColours();
    renderTable();
    if (selectedStandId) drawCallout(selectedStandId);
    if (updatedAtEl) updatedAtEl.textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }

  function startPolling(){
    stopPolling();
    pollTimer = setInterval(async ()=>{
      if (isSuspended()) return;
      try{
        await loadSettings();
        await loadData();
      }catch(e){
        console.error(e);
      }
    }, 8000);
  }
  function stopPolling(){ if (pollTimer) clearInterval(pollTimer); pollTimer=null; }

  if (searchEl) searchEl.addEventListener("input", renderTable);
  if (clearBtn) clearBtn.addEventListener("click", ()=>{
    searchEl.value="";
    renderTable();
  });

  window.addEventListener("resize", ()=>{
    if (selectedStandId) drawCallout(selectedStandId);
  });

  (async ()=>{
    try{
      await loadSvg();
      await loadSettings();
      await loadData();
      startPolling();
    }catch(e){
      console.error(e);
    }
  })();
})();
