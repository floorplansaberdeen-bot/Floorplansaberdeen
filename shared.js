/* shared.js — shared helpers */
(() => {
  const DEFAULT_BACKEND = "https://floorplansaberdeen.floorplansaberdeen.workers.dev";
  const BACKEND_KEY = "floorplan_backend_url";

  function normalizeBackendUrl(input){
    if (!input) return "";
    let s = String(input).trim();
    try{
      const u = new URL(s);
      u.search=""; u.hash="";
      u.pathname = u.pathname.replace(/\/+$/,"");
      return (u.origin + u.pathname).replace(/\/+$/,"");
    }catch{
      return s.replace(/\/+$/,"");
    }
  }

  function getBackendUrl(){
    const saved = localStorage.getItem(BACKEND_KEY);
    const base = (saved && saved.startsWith("http")) ? saved : DEFAULT_BACKEND;
    return normalizeBackendUrl(base);
  }

  async function fetchJson(url, opts = {}){
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    try{
      const res = await fetch(url, {...opts, signal: controller.signal, cache:"no-store"});
      const text = await res.text();
      let data = null;
      try{ data = text ? JSON.parse(text) : null; }catch{ data = null; }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || text || ("HTTP "+res.status));
      return data;
    }finally{
      clearTimeout(t);
    }
  }

  window.FloorplanShared = { getBackendUrl, fetchJson, BACKEND_KEY };
})();
