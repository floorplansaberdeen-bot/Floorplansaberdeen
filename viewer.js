
(async function(){
  const { el, fetchJson } = window.FloorplanShared;
  const svgHost = el("svgHost");
  const zoomSvgHost = el("zoomSvgHost");
  const zoomWrap = el("zoomWrap");
  const zoomRing = el("zoomRing");
  const listEl = el("list");
  const searchEl = el("search");
  const eventNameEl = el("eventName");

  let rows = [];
  let selectedStandId = null;
  let showNames = true;

  const core = new FloorplanCore({
    svgHost,
    zoomSvgHost,
    zoomWrap,
    zoomRing,
    onSelect: (row)=> selectStand(row.standId),
    onClearSelection: ()=> selectStand(null)
  });

  async function load(){
    const settings = await fetchJson("/settings");
    eventNameEl.textContent = settings.eventName || "Event";
    showNames = settings.showNames !== false;

    rows = await fetchJson("/stands");
    core.setRows(rows);
    renderList();
    core.applyColoursAdmin();
  }

  function renderList(){
    const q = (searchEl.value||"").toLowerCase();
    listEl.innerHTML = "";
    rows
      .filter(r=>{
        if(!q) return true;
        return r.standId.toLowerCase().includes(q) ||
               (r.company||"").toLowerCase().includes(q);
      })
      .forEach(r=>{
        const div = document.createElement("div");
        div.className = "list-row";
        const namePart = (r.status==="sold" && showNames) ? ` – ${r.company||""}` : "";
        div.textContent = `${r.standId} (${r.status})${namePart}`;
        div.onclick = ()=> core.selectStand(r.standId);
        listEl.appendChild(div);
      });
  }

  function selectStand(id){
    selectedStandId = id || null;
    core.applyColoursAdmin();
    if(!id) return;
    const row = rows.find(r=>r.standId===id);
    core.drawCallout(id,
      (row?.status==="sold" && showNames)
        ? (row.company||"")
        : ""
    );
  }

  searchEl.addEventListener("input", renderList);
  await load();
})();
