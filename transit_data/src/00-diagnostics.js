/* ===== DIAGNOSTICS ========================================================================
   Installed before anything else, so a fault during boot is recorded rather than lost.

   This is deliberately NOT automatic remote telemetry. There is no server to send to, and
   the strongest thing this app has is that nothing about where you are or where you go ever
   leaves the device. Silently posting stack traces to a third party would trade that away
   for the developer's convenience. So: faults are kept locally, the user can see exactly
   what would be shared, and reporting is one tap that they initiate.

   The report carries the fault, the build, the city, the language and the browser. It never
   carries location, saved places, trip history or the API key. ===== */
const BUILD = "__BUILD__";
const DIAG_MAX = 20;
let DIAG = [];
try { DIAG = JSON.parse(localStorage.getItem("irn_diag") || "[]"); } catch (e) { DIAG = []; }
function diagSave(){ try { localStorage.setItem("irn_diag", JSON.stringify(DIAG.slice(-DIAG_MAX))); } catch (e) {} }
function diagRecord(kind, message, stack){
  const entry = {
    t: new Date().toISOString(),
    kind: kind,
    msg: String(message || "").slice(0, 300),
    // a stack can be long and can contain the full URL; keep the useful head only
    at: String(stack || "").split("\n").slice(0, 4).join(" | ").slice(0, 500),
    build: BUILD,
  };
  const last = DIAG[DIAG.length - 1];
  if (last && last.msg === entry.msg && last.kind === entry.kind) { last.n = (last.n || 1) + 1; last.t = entry.t; }
  else DIAG.push(entry);
  if (DIAG.length > DIAG_MAX) DIAG = DIAG.slice(-DIAG_MAX);
  diagSave();
  try { if (typeof refreshDiagRow === "function") refreshDiagRow(); } catch (e) {}
}
window.addEventListener("error", e => {
  if (e && e.target && e.target !== window && e.target.tagName) {
    // a failed image or stylesheet, not a script fault — worth knowing, not worth alarming
    diagRecord("resource", (e.target.tagName || "").toLowerCase() + " failed to load: " +
      String(e.target.src || e.target.href || "").slice(0, 120), "");
    return;
  }
  diagRecord("error", e && e.message, e && e.error && e.error.stack);
}, true);
window.addEventListener("unhandledrejection", e => {
  const r = e && e.reason;
  diagRecord("promise", (r && r.message) || String(r), r && r.stack);
});

/* ---------------------------------------------------------------------------
   CITY SELECTION. Every city ships its own line set + centre, fare table,
   districts (weather), landmarks and feature flags. The chosen city is picked
   BEFORE any derived structure is built, so the station registry, routing
   graph, carriage sim, legend, stats, weather, fares and search all come from
   it — switching city reloads the page so nothing can be left half-updated.
   Intercity (TCDD) rail is national and is appended for every city.
   --------------------------------------------------------------------------- */
const CITIES = __CITIES_JSON__;
const INTERCITY_LINES_JSON = __INTERCITY_JSON__;
const CITY_IDS = Object.keys(CITIES);
function pickCityId(){
  try{
    const q = new URLSearchParams(location.search).get('city');
    if(q && CITIES[q]) { localStorage.setItem('irn_city', q); return q; }
    const s = localStorage.getItem('irn_city');
    if(s && CITIES[s]) return s;
  }catch(e){}
  return 'istanbul';
}
const CITY_ID = pickCityId();
const CITY = CITIES[CITY_ID];
const HAS = CITY.has || {};                       // per-city feature flags (bus, ferries, live disruptions…)
function switchCity(id){
  if(!CITIES[id] || id===CITY_ID) return;
  try{ localStorage.setItem('irn_city', id); }catch(e){}
  const u = new URL(location.href); u.searchParams.set('city', id); location.replace(u.toString());
}
"use strict";
