/* ==================================================================================
   OMNI SEARCH + MAP ASSISTANT
   Two surfaces over one engine. The engine has three sources, all real:
     • PLACES        — this map’s own stops + curated landmarks (instant, offline)
     • Photon /api   — free-text places anywhere in the city (keyless, city-clipped)
     • Photon /reverse + osm_tag — category lookup ("food", "hospital") around a point
   There is no language model behind the assistant: this is a public static site and
   an API key cannot be embedded in it. Every answer is composed from the data above,
   so it never invents a place, a fare or a route — if it cannot answer it says so.
   ================================================================================== */

/* keyword → OpenStreetMap tag. Turkish and English both matter here. */
const POI_CATS = [
  {tag:"amenity:restaurant",     ic:"🍽️", en:"Restaurants", tr:"Restoranlar", k:["food","eat","restaurant","restaurants","dinner","lunch","yemek","restoran","lokanta","yemek yeri"]},
  {tag:"amenity:cafe",           ic:"☕",  en:"Cafés",       tr:"Kafeler",     k:["cafe","cafes","coffee","kahve","kafe","kahveci"]},
  {tag:"amenity:hospital",       ic:"🏥", en:"Hospitals",   tr:"Hastaneler",  k:["hospital","hospitals","emergency","er","hastane","acil"]},
  {tag:"amenity:pharmacy",       ic:"💊", en:"Pharmacies",  tr:"Eczaneler",   k:["pharmacy","pharmacies","chemist","drugstore","eczane"]},
  {tag:"amenity:atm",            ic:"🏧", en:"ATMs",        tr:"ATM’ler",     k:["atm","atms","cashpoint","bankamatik","para"]},
  {tag:"amenity:bank",           ic:"🏦", en:"Banks",       tr:"Bankalar",    k:["bank","banks","banka"]},
  {tag:"shop:supermarket",       ic:"🛒", en:"Supermarkets",tr:"Marketler",   k:["market","markets","supermarket","grocery","groceries","bakkal","süpermarket"]},
  {tag:"tourism:hotel",          ic:"🛏️", en:"Hotels",      tr:"Oteller",     k:["hotel","hotels","stay","otel","konaklama"]},
  {tag:"amenity:toilets",        ic:"🚻", en:"Toilets",     tr:"Tuvaletler",  k:["toilet","toilets","wc","restroom","tuvalet"]},
  {tag:"amenity:police",         ic:"🚓", en:"Police",      tr:"Polis",       k:["police","polis","karakol"]},
  {tag:"amenity:fuel",           ic:"⛽", en:"Fuel",        tr:"Benzinlik",   k:["fuel","petrol","gas station","benzin","benzinlik","akaryakıt"]},
  {tag:"tourism:museum",         ic:"🖼️", en:"Museums",     tr:"Müzeler",     k:["museum","museums","müze","muze"]},
  {tag:"leisure:park",           ic:"🌳", en:"Parks",       tr:"Parklar",     k:["park","parks","garden","bahçe","yeşil alan"]},
  {tag:"amenity:place_of_worship",ic:"🕌",en:"Worship",     tr:"İbadet",      k:["mosque","mosques","cami","camii","church","kilise","synagogue"]},
  {tag:"amenity:pub",            ic:"🍺", en:"Bars",        tr:"Barlar",      k:["bar","bars","pub","pubs","meyhane"]},
];
const catLabel = c => (lang==="tr" && c.tr) ? c.tr : c.en;
/* a query is a category only when a whole word matches — "parkway" must not mean parks */
function matchCat(q){
  const f = foldQ(q).trim(); if(!f) return null;
  for(const c of POI_CATS) for(const w of c.k){ if(f === foldQ(w)) return c; }
  for(const c of POI_CATS) for(const w of c.k){
    const fw = foldQ(w);
    if(new RegExp("(^|\\s)" + fw.replace(/[.*+?^${}()|[\]\\]/g, m => "\\" + m) + "($|\\s)").test(f)) return c;
  }
  return null;
}

/* category lookup around a point. Photon reverse takes radius in KM and sorts by distance. */
const POI_CACHE = new Map();
async function poiNear(lat, lng, tag, radiusKm, limit){
  const key = tag + "@" + lat.toFixed(3) + "," + lng.toFixed(3) + "/" + (radiusKm||2);
  if(POI_CACHE.has(key)) return POI_CACHE.get(key);
  const langP = /^(en|de|fr|it)$/.test(lang) ? "&lang=" + lang : "";
  const url = "https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng +
              "&radius=" + (radiusKm||2) + "&limit=" + (limit||25) +
              "&osm_tag=" + encodeURIComponent(tag) + langP;
  const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 6000);
  try{
    const r = await fetch(url, {signal:ctrl.signal}); clearTimeout(timer);
    if(!r.ok) throw 0;
    const gj = await r.json(); const out = [];
    for(const f of (gj.features||[])){
      const c = f.geometry && f.geometry.coordinates; if(!c) continue;
      const p = f.properties || {};
      if(!p.name) continue;                       // unnamed OSM nodes are useless in a list
      const la = +c[1], ln = +c[0];
      out.push({ name:p.name, lat:la, lng:ln, poiHit:true, tag:tag,
                 ctx:p.district || p.city || p.county || "",
                 m: metersBetween([lat,lng],[la,ln]) });
    }
    out.sort((a,b)=>a.m-b.m);
    POI_CACHE.set(key, out); return out;
  }catch(e){ clearTimeout(timer); return null; }   // null = lookup failed (offline/blocked)
}

/* nearest rail/ferry stops to a point, with the lines that serve each */
function nearestStops(lat, lng, count){
  const seen = new Map();
  for(const k in nodeMeta){
    const m = nodeMeta[k]; if(!m.name || m.kind==="bus") continue;
    const d = metersBetween([lat,lng],[m.lat,m.lng]);
    const f = fold(m.name); const cur = seen.get(f);
    if(!cur || d < cur.m) seen.set(f, {name:m.name, lat:m.lat, lng:m.lng, m:d});
  }
  const arr = [...seen.values()].sort((a,b)=>a.m-b.m).slice(0, count||3);
  arr.forEach(st=>{
    const refs = new Set();
    (nameNodes[fold(st.name)]||[]).forEach(k=>{ const m=nodeMeta[k]; if(m && m.ref) refs.add(m.ref); });
    st.refs = [...refs];
  });
  return arr;
}
function walkMin(m){ return Math.max(1, Math.round(m / WALK)); }

/* ---------------- the dropped pin ---------------- */
let pinMarker = null, pinPlace = null;
// Whether the map can be panned at all. A container that has not been laid out yet (a tab
// opened in the background, a phone rotating, a sheet covering the map) has size 0, and every
// Leaflet projection off it returns NaN — flyTo then throws "Invalid LatLng (NaN, NaN)".
function mapUsable(){
  try{ const s = map.getSize(); return !!s && s.x > 0 && s.y > 0; }catch(e){ return false; }
}
function dropPin(p, zoom){
  // Showing the pin is a courtesy; the ANSWER is the product. Nothing in here may throw, or a
  // map that simply has no size on screen would cost the user their reply.
  if(!p || !isFinite(p.lat) || !isFinite(p.lng)) return;
  try{
  if(pinMarker){ map.removeLayer(pinMarker); pinMarker = null; }
  pinPlace = p;
  pinMarker = L.marker([p.lat,p.lng], {icon:L.divIcon({className:"pin-ic",
      html:'<div class="pin-d"></div>', iconSize:[15,15], iconAnchor:[7,14]}), zIndexOffset:900}).addTo(map);
  const near = nearestStops(p.lat, p.lng, 2);
  const stopTxt = near.length
    ? near.map(st=>svgEsc(st.name) + " · " + walkMin(st.m) + " min" +
        (st.refs.length ? " (" + st.refs.slice(0,3).map(svgEsc).join(", ") + ")" : "")).join("<br>")
    : "—";
  pinMarker.bindPopup(
    '<div class="pin-pop"><b>' + svgEsc(p.name) + '</b>' +
    '<div class="sub">' + (p.ctx ? svgEsc(p.ctx) + " · " : "") + svgEsc(t("aiStops")) + ": <br>" + stopTxt + '</div>' +
    '<div class="pin-acts">' +
      '<button data-pin="O">' + svgEsc(t("routeFrom")) + '</button>' +
      '<button data-pin="D">' + svgEsc(t("routeTo")) + '</button>' +
      '<button data-pin="N">' + svgEsc(t("nearHere")) + '</button>' +
    '</div></div>', {maxWidth:250});
  if(mapUsable()){
    pinMarker.openPopup();
    map.flyTo([p.lat,p.lng], zoom || Math.max(map.getZoom(), 14), {duration:.7});
  }
  }catch(e){ /* pin is cosmetic — never let it break the answer */ }
}
/* Attraction chips are rebuilt as innerHTML all over the app and used to carry inline
   onclick handlers. A strict Content-Security-Policy forbids those, so they are delegated. */
document.addEventListener("click", e => {
  const el = e.target.closest && e.target.closest("[data-attr-go]");
  if (!el) return;
  const i = +el.getAttribute("data-attr-go");
  if (Number.isFinite(i)) goToAttraction(i);
});

/* popup buttons are re-created on every open, so delegate from the map container */
document.addEventListener("click", e=>{
  const b = e.target.closest && e.target.closest("[data-pin]"); if(!b || !pinPlace) return;
  const mode = b.getAttribute("data-pin");
  if(mode === "N"){ aiOpen(); aiAsk((lang==="tr"?"yakında ne var ":"what is nearby ") + pinPlace.name, true); return; }
  setPoint(mode, {name:pinPlace.name, lat:pinPlace.lat, lng:pinPlace.lng});
  setTab("active");
  map.closePopup();
});

/* ================================ omni search ================================ */
(function(){
  const wrap = document.getElementById("omni"), inp = document.getElementById("omniIn"),
        res  = document.getElementById("omniRes"), xb  = document.getElementById("omniX");
  if(!wrap || !inp || !res) return;
  let seq = 0, lastRows = [], selIdx = -1;

  const row = (ic, nm, sb, d) =>
    '<div class="omni-row" role="option"><span class="omni-ico">' + ic + '</span>' +
    '<span class="omni-tx"><span class="omni-nm">' + svgEsc(nm) + '</span>' +
    (sb ? '<span class="omni-sb">' + svgEsc(sb) + '</span>' : "") + '</span>' +
    (d ? '<span class="omni-d">' + d + '</span>' : "") + '</div>';

  function chips(){
    const pick = [0,2,3,1,6,4];   // food, hospital, pharmacy, café, market, ATM
    return '<div class="omni-chips">' + pick.map(i=>{ const c = POI_CATS[i];
      return '<button class="omni-chip" data-cat="' + c.tag + '">' + c.ic + " " + svgEsc(catLabel(c)) + '</button>';
    }).join("") + '</div>';
  }
  /* the results list drops straight over the left rail, so the rail steps aside while it is
     open — otherwise the buttons paint on top of the list and swallow its clicks */
  function open(){ aiShut();                       // both live in the left column — one at a time
    wrap.classList.add("open"); document.body.classList.add("omni-open");
    inp.setAttribute("aria-expanded","true"); }
  function shut(){ wrap.classList.remove("open"); document.body.classList.remove("omni-open");
    inp.setAttribute("aria-expanded","false"); selIdx=-1; }

  function paint(html){ res.innerHTML = html; open();
    lastRows = [...res.querySelectorAll(".omni-row")]; selIdx = -1; }

  async function runCat(cat){
    const c0 = map.getCenter();
    paint('<div class="omni-h">' + svgEsc(catLabel(cat)) + '</div><div class="omni-note">' + svgEsc(t("omniLook")) + "</div>");
    const hits = await poiNear(c0.lat, c0.lng, cat.tag, 3, 25);
    if(hits === null){ paint('<div class="omni-note">' + svgEsc(t("aiOffline")) + "</div>"); return; }
    if(!hits.length){ paint('<div class="omni-note">' + svgEsc(t("omniNone")) + "</div>"); return; }
    results = hits.slice(0,25);
    paint('<div class="omni-h">' + cat.ic + " " + svgEsc(catLabel(cat)) + '</div>' +
      results.map(p=>row(cat.ic, p.name, p.ctx, distStr(p.m/1000))).join(""));
  }

  let results = [];
  async function run(q){
    const my = ++seq;
    if(!q.trim()){ results=[]; paint(chips() + '<div class="omni-note">' + svgEsc(t("omniHint")||t("omniNone")) + "</div>"); return; }
    const cat = matchCat(q);
    if(cat){ await runCat(cat); return; }
    // 1 — local stops + landmarks, instantly and offline
    const local = searchPlaces(q).slice(0,8);
    results = local.slice();
    let html = local.length
      ? '<div class="omni-h">' + svgEsc(t("omniStops")) + '</div>' +
        local.map(p=>row(p.poi ? (ATTR_CAT[p.cat]||"📍") : (p.bus ? "🚌" : "🚇"), p.name, p.ref||"", "")).join("")
      : "";
    html += '<div class="omni-h">' + svgEsc(t("omniPlaces")) + '</div><div class="omni-note">' + svgEsc(t("omniLook")) + "</div>";
    paint(html);
    // 2 — anything else in the city, from OpenStreetMap
    const geo = await geocode(q);
    if(my !== seq) return;                              // a newer keystroke won
    /* Drop only genuine repeats of a local hit — same name, or the same name carrying a
       district suffix ("Galata Tower, Bereketzade") within 200 m. The planner's dedupeGeo
       drops everything within 200 m, which here would also bin the pub next door. */
    const fresh = (geo || []).filter(g => !local.some(l => {
      if(fold(l.name) === fold(g.name)) return true;
      return foldQ(g.name).startsWith(foldQ(l.name)) &&
             metersBetween([l.lat,l.lng],[g.lat,g.lng]) < 200;
    })).slice(0,8);
    results = local.concat(fresh);
    let h2 = local.length
      ? '<div class="omni-h">' + svgEsc(t("omniStops")) + '</div>' +
        local.map(p=>row(p.poi ? (ATTR_CAT[p.cat]||"📍") : (p.bus ? "🚌" : "🚇"), p.name, p.ref||"", "")).join("")
      : "";
    if(fresh.length) h2 += '<div class="omni-h">' + svgEsc(t("omniPlaces")) + '</div>' +
        fresh.map(p=>row("📍", p.name, p.ctx||"", "")).join("");
    else if(!local.length) h2 += '<div class="omni-note">' + svgEsc(geo===null ? t("omniOff") : t("omniNone")) + "</div>";
    paint(h2);
  }

  let tmr = 0;
  inp.addEventListener("input", ()=>{
    const q = inp.value;
    wrap.classList.toggle("has-q", !!q);
    clearTimeout(tmr); tmr = setTimeout(()=>run(q), q.trim() ? 300 : 0);
  });
  inp.addEventListener("focus", ()=>{ if(!inp.value.trim()) run(""); else open(); });
  xb.addEventListener("click", ()=>{ inp.value=""; wrap.classList.remove("has-q"); inp.focus(); run(""); });

  res.addEventListener("click", e=>{
    const chip = e.target.closest(".omni-chip");
    if(chip){ const c = POI_CATS.find(x=>x.tag===chip.getAttribute("data-cat")); if(c){ inp.value = catLabel(c); wrap.classList.add("has-q"); runCat(c); } return; }
    const r = e.target.closest(".omni-row"); if(!r) return;
    const i = [...res.querySelectorAll(".omni-row")].indexOf(r);
    const p = results[i]; if(!p) return;
    dropPin(p); shut(); inp.blur();
  });

  inp.addEventListener("keydown", e=>{
    if(e.key === "Escape"){ shut(); inp.blur(); return; }
    if(!lastRows.length) return;
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      selIdx = (selIdx + (e.key==="ArrowDown"?1:-1) + lastRows.length) % lastRows.length;
      lastRows.forEach((r,i)=>r.classList.toggle("sel", i===selIdx));
      lastRows[selIdx].scrollIntoView({block:"nearest"});
    } else if(e.key === "Enter"){
      e.preventDefault();
      (lastRows[selIdx>=0?selIdx:0]||{click:()=>{}}).click();
    }
  });
  document.addEventListener("click", e=>{ if(!wrap.contains(e.target)) shut(); });
})();

/* ================================ assistant ================================ */
function aiOpen(){
  const om=document.getElementById("omni");       // the search list shares this column
  if(om) om.classList.remove("open");
  document.body.classList.remove("omni-open");
  document.body.classList.add("ai-open");
  const o=document.getElementById("aiOrb"); if(o){ o.classList.add("on"); o.setAttribute("aria-expanded","true"); }
  const i=document.getElementById("aiIn"); if(i) setTimeout(()=>i.focus(),60); }
function aiShut(){ document.body.classList.remove("ai-open");
  const o=document.getElementById("aiOrb"); if(o){ o.classList.remove("on"); o.setAttribute("aria-expanded","false"); } }
function aiSay(html, who){
  const log = document.getElementById("aiLog"); if(!log) return null;
  const d = document.createElement("div"); d.className = "ai-msg " + (who||"bot"); d.innerHTML = html;
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
let aiAsk = async function(){};
(function(){
  const orb = document.getElementById("aiOrb"), pan = document.getElementById("aiPanel"),
        inp = document.getElementById("aiIn"), snd = document.getElementById("aiSend"),
        sug = document.getElementById("aiSug"), xb  = document.getElementById("aiX");
  if(!orb || !pan) return;
  let greeted = false;

  const SUGS = () => lang==="tr"
    ? ["Taksim’de yemek", "En yakın hastane", "Taksim Kadıköy", "Levent otobüs"]
    : ["Food near Taksim", "Nearest hospital", "Taksim to Kadıköy", "Buses at Levent"];
  function paintSugs(){ if(!sug) return;
    sug.innerHTML = SUGS().map(x=>'<button class="omni-chip">' + svgEsc(x) + "</button>").join(""); }

  orb.addEventListener("click", ()=>{
    if(document.body.classList.contains("ai-open")) return aiShut();
    aiOpen();
    if(!greeted){ greeted = true; aiSay(svgEsc(t("aiHello"))); paintSugs(); }
  });
  if(xb) xb.addEventListener("click", aiShut);
  if(sug) sug.addEventListener("click", e=>{ const b=e.target.closest("button"); if(b) ask(b.textContent); });
  if(snd) snd.addEventListener("click", ()=>ask(inp.value));
  if(inp) inp.addEventListener("keydown", e=>{ if(e.key==="Enter") ask(inp.value); });

  /* resolve a phrase to a real point: our own stops first, then the geocoder */
  async function resolve(txt){
    if(!txt || !txt.trim()) return null;
    const f = foldQ(txt);
    if(/^(here|me|my location|burada|buradan|yakinimda|yakınımda|benim konumum)$/.test(f)){
      if(geoPos) return {name: lang==="tr"?"Konumunuz":"Your location", lat:geoPos.lat, lng:geoPos.lng};
      const c = map.getCenter(); return {name: lang==="tr"?"Harita merkezi":"Map centre", lat:c.lat, lng:c.lng};
    }
    const loc = searchPlaces(txt)[0];
    if(loc) return {name:loc.name, lat:loc.lat, lng:loc.lng};
    const g = await geocode(txt);
    return (g && g[0]) ? {name:g[0].name, lat:g[0].lat, lng:g[0].lng, ctx:g[0].ctx} : null;
  }
  const hitRow = p => '<div class="ai-hit" data-lat="' + p.lat + '" data-lng="' + p.lng +
    '" data-nm="' + attrEsc(p.name) + '"><span class="n">' + svgEsc(p.name) + '</span>' +
    '<span class="d">' + (p.m!=null ? distStr(p.m/1000) : "") + "</span></div>";

  async function ask(raw){
    const q = (raw||"").trim(); if(!q) return;
    if(inp) inp.value = "";
    aiSay(svgEsc(q), "me");
    orb.classList.add("busy");
    try{ await answer(q); }
    catch(e){ aiSay(svgEsc(t("aiNoIdea"))); }
    orb.classList.remove("busy");
  }
  aiAsk = ask;

  /* ===== optional LLM layer =============================================================
     With a key in Settings the question goes to Claude — but Claude may only speak through
     the tools below, every one of which returns data this app already holds or fetches from
     OpenStreetMap. It therefore cannot invent a place, a fare, a line or a journey time; the
     worst it can do is fail, and failure falls through to the local parser. ===== */
  const AI_MODEL = "claude-sonnet-5";
  // İstanbul weekday/Saturday/Sunday — bus timetables are published per day type
  function istDayType(){
    const d = new Date(new Date().toLocaleString("en-US", { timeZone:"Europe/Istanbul" }));
    const n = d.getDay();
    return n === 0 ? "sun" : n === 6 ? "sat" : "wd";
  }
  /* Everything the app knows about one line. Buses carry a REAL operator timetable
     (first/last/headway per day type, from GTFS), so "when is the last one today" is exact.
     Rail publishes an operating-hours window rather than a per-station timetable, so that is
     what is returned — labelled as such, so the model does not present it as a departure. */
  function lineFacts(ref){
    const ln = lineByRef[ref], out = { ref };
    if(ln){
      const st = ln.stations || ln.stops || [];
      out.name = ln.name || ""; out.mode = kindLabel(ln.kind) || ln.kind;
      out.from = st[0] && st[0].name; out.to = st[st.length-1] && st[st.length-1].name;
      out.stations = st.length;
      const tm = lineTiming(ref);
      out.service_hours = tm.hours; out.frequency = tm.freq;
      out.hours_note = "published operating window for the line, not a per-station timetable";
      const c = lineClosedAt(ref, nowIstanbulMin());
      out.running_now = !c;
      if(c) out.not_running_because = c.why === "susp" ? "suspended by a service alert"
                                                       : "outside service hours " + c.hours;
    }
    const bs = BUS_SCHED[ref];
    if(bs && bs.length){
      const dt = istDayType();
      out.is_bus = true;
      out.day_type = dt === "wd" ? "weekday" : dt === "sat" ? "Saturday" : "Sunday";
      out.today = bs.map(d => ({ towards:d.head, first:d[dt] && d[dt].first, last:d[dt] && d[dt].last,
                                 every_minutes:d[dt] && d[dt].hw, departures:d[dt] && d[dt].n }))
                    .filter(x => x.first || x.last);
      out.timetable_source = "operator timetable (exact)";
      if(!ln){ const bd = BUS_DIR.find(x => x.ref === ref);
               if(bd){ out.from = bd.from; out.to = bd.to; out.operator = bd.op || BUS_OPERATOR; } }
    }
    const al = (DISRUPTIONS||[]).filter(x => x.ref === ref);
    if(al.length) out.alerts = al.map(a => ({ severity:a.severity, title:a.title,
                                              detail:a.message, until:a.until || null }));
    if(!ln && !out.is_bus) return { ref, found:false };
    return out;
  }
  const AI_TOOLS = [
    { name:"search_place", description:"Resolve a place, landmark, street or district in this city to coordinates. Use this before tools that need a location.",
      input_schema:{ type:"object", properties:{ query:{type:"string"} }, required:["query"] } },
    { name:"find_nearby", description:"Real places of a category near a location, nearest first. category must be one of: food, cafe, hospital, pharmacy, atm, bank, market, hotel, toilets, police, fuel, museum, park, worship, bar.",
      input_schema:{ type:"object", properties:{ category:{type:"string"}, place:{type:"string", description:"omit to use the map centre or the user location"} }, required:["category"] } },
    { name:"nearest_stops", description:"Nearest transit stops to a place, with the lines serving each and the walk in minutes.",
      input_schema:{ type:"object", properties:{ place:{type:"string"} }, required:["place"] } },
    { name:"plan_route", description:"Plan a journey between two places and draw it on the map. Returns duration, transfers, lines and clock times.",
      input_schema:{ type:"object", properties:{ from:{type:"string"}, to:{type:"string"} }, required:["from","to"] } },
    { name:"bus_routes_at", description:"Bus routes serving a stop.",
      input_schema:{ type:"object", properties:{ place:{type:"string"} }, required:["place"] } },
    { name:"fare_info", description:"Current published fares for this city.",
      input_schema:{ type:"object", properties:{} } },
    { name:"line_info", description:"Everything known about one line by its ref (M2, T1, Marmaray, 500T, …): route, number of stations, operating hours, frequency, whether it is running right now, any service alert, and for buses the EXACT first and last departure today with the interval. Use this for questions like \"when is the last ride today\".",
      input_schema:{ type:"object", properties:{ ref:{type:"string"} }, required:["ref"] } },
    { name:"list_lines", description:"Every line in this city with its ref, mode and end points. Use it to find a line when the user describes it instead of naming it, or to answer \"which lines are there\".",
      input_schema:{ type:"object", properties:{ mode:{type:"string", description:"optional filter: metro, tram, ferry, funicular, cable, marmaray, suburban, metrobus, bus"} } } },
    { name:"station_info", description:"A station: which lines serve it, whether it is an interchange, step-free access, lifts and escalators where known.",
      input_schema:{ type:"object", properties:{ name:{type:"string"} }, required:["name"] } },
    { name:"service_alerts", description:"Current service disruptions, closures and suspensions for this city.",
      input_schema:{ type:"object", properties:{} } },
    { name:"city_info", description:"Which city is loaded, what modes it has, how big the network is, and the CURRENT local date and time in that city. Call this whenever the question involves today, now, or the time.",
      input_schema:{ type:"object", properties:{} } }
  ];
  /* Find a line ref inside a free-text question. Token-based rather than substring, so "29"
     cannot match inside "129"; two-token joins are tried first so "500 T" finds 500T. */
  function findRef(q){
    const toks = String(q || "").toUpperCase().match(/[A-ZÇĞİıÖŞÜ0-9]+/g) || [];
    const set = new Map();
    NETWORK.forEach(l => set.set(String(l.ref).toUpperCase(), String(l.ref)));
    BUS_DIR.forEach(b => set.set(String(b.ref).toUpperCase(), String(b.ref)));
    for(let i = 0; i < toks.length - 1; i++){
      const j = toks[i] + toks[i+1]; if(set.has(j)) return set.get(j);
    }
    for(const tk of toks) if(set.has(tk)) return set.get(tk);
    return null;
  }
  /* First/last service for one line, from the SAME lineFacts the AI tool uses — so this
     answer needs no key and no network. Buses carry an exact operator timetable; rail only
     publishes an operating window, so the two are worded differently rather than blurred. */
  function lineTimesHTML(ref){
    const f = lineFacts(ref);
    if(f.found === false) return null;
    let h = "<b>" + svgEsc(ref) + "</b>" + (f.name ? " " + svgEsc(f.name) : "");
    if(f.from && f.to) h += '<span class="tt-est"> · ' + svgEsc(f.from) + " → " + svgEsc(f.to) + "</span>";
    if(f.today && f.today.length){
      h += "<br>" + svgEsc(t("lrToday").replace("{d}", f.day_type));
      f.today.forEach(d => {
        h += '<div class="ai-hit"><span class="n">→ ' + svgEsc(d.towards || "") + "</span>" +
             '<span class="d">' + svgEsc((d.first || "?") + " – " + (d.last || "?")) + "</span></div>";
      });
      const hw = f.today[0] && f.today[0].every_minutes;
      if(hw) h += '<div class="tt-est" style="margin-top:4px">' + svgEsc(t("lrEvery").replace("{n}", hw)) + "</div>";
      h += '<div class="tt-est">' + svgEsc(t("lrExact")) + "</div>";
    } else if(f.service_hours){
      h += "<br>" + svgEsc(t("lrHours")) + " <b>" + svgEsc(f.service_hours) + "</b>" +
           (f.frequency ? '<span class="tt-est"> · ' + svgEsc(f.frequency) + "</span>" : "");
      h += '<div class="tt-est">' + svgEsc(t("lrWindow")) + "</div>";
    } else if(f.is_bus){
      h += "<br>" + svgEsc(t("lrNoTimes"));
    } else return null;
    if(f.running_now === false && f.not_running_because)
      h += '<div class="lr-warn">⚠ ' + svgEsc(f.not_running_because) + "</div>";
    (f.alerts || []).forEach(a => {
      h += '<div class="lr-warn">⚠ ' + svgEsc(a.title || "") + (a.until ? " · " + svgEsc(a.until) : "") + "</div>";
    });
    return h;
  }

  async function runAiTool(name, a){
    a = a || {};
    if(name === "search_place"){
      const p = await resolve(a.query);
      if(!p) return { found:false };
      dropPin(p);
      return { found:true, name:p.name, lat:+p.lat.toFixed(5), lng:+p.lng.toFixed(5) };
    }
    if(name === "find_nearby"){
      const cat = matchCat(a.category) || POI_CATS[0];
      const anchor = await resolve(a.place || "here");
      if(!anchor) return { error:"could not resolve " + (a.place||"") };
      const hits = await poiNear(anchor.lat, anchor.lng, cat.tag, 3, 12);
      if(hits === null) return { error:"place lookup unavailable (offline)" };
      if(hits.length) dropPin(hits[0]);
      return { near:anchor.name, category:catLabel(cat),
               results:hits.slice(0,8).map(h=>({ name:h.name, metres:Math.round(h.m), area:h.ctx })) };
    }
    if(name === "nearest_stops"){
      const p = await resolve(a.place);
      if(!p) return { error:"could not resolve " + a.place };
      dropPin(p);
      return { place:p.name, stops:nearestStops(p.lat, p.lng, 4)
        .map(st=>({ name:st.name, lines:st.refs, walk_min:walkMin(st.m) })) };
    }
    if(name === "plan_route"){
      const o = await resolve(a.from), d = await resolve(a.to);
      if(!o || !d) return { error:"could not resolve " + (!o ? a.from : a.to) };
      setPoint("O", o); setPoint("D", d); setTab("active");
      const btn = document.getElementById("route"); if(btn) btn.click();
      await new Promise(r=>setTimeout(r, 2600));
      if(!goCurrent) return { planned:false, note:"no route found between those points" };
      const it = goCurrent.it, pl = itinPlan(it, plannedStart(it));
      return { planned:true, from:o.name, to:d.name, minutes:Math.round(it.total),
               transfers:it.transfers, lines:(it.steps||[]).filter(x=>x.type==="ride").map(x=>x.ref),
               depart:fmtMinOfDay(pl.start), arrive:fmtMinOfDay(pl.end) };
    }
    if(name === "bus_routes_at"){
      const p = await resolve(a.place);
      if(!p) return { error:"could not resolve " + a.place };
      const refs = new Set();
      for(const k in nodeMeta){ const nm = nodeMeta[k];
        if(nm.kind !== "bus" || !nm.ref) continue;
        if(metersBetween([p.lat,p.lng],[nm.lat,nm.lng]) < 350) refs.add(nm.ref); }
      return { place:p.name, buses:[...refs].sort(trCmp) };
    }
    if(name === "fare_info"){
      return { card:CITY.card || "", per_boarding:FARE && FARE.base, currency:"TRY",
               transfers:(FARE && FARE.xfer) || [], note:t(FARE && FARE.noteKey || "fareNote") };
    }
    if(name === "line_info"){
      const want = String(a.ref || "").trim();
      if(!want) return { error:"no ref given" };
      // tolerate case and spacing: "marmaray" → "Marmaray", "500 t" → "500T"
      const all = NETWORK.map(l => l.ref).concat(BUS_DIR.map(b => b.ref));
      const hit = all.find(r => String(r).toLowerCase() === want.toLowerCase()) ||
                  all.find(r => String(r).toLowerCase().replace(/\s+/g,"") === want.toLowerCase().replace(/\s+/g,""));
      if(!hit) return { found:false, ref:want, hint:"call list_lines to see the refs this city uses" };
      return lineFacts(hit);
    }
    if(name === "list_lines"){
      const want = (a.mode || "").toLowerCase();
      const rail = NETWORK.filter(l => !want || (l.kind||"").toLowerCase().includes(want) ||
                                       (kindLabel(l.kind)||"").toLowerCase().includes(want))
        .map(l => { const st = l.stations || l.stops || [];
                    return { ref:l.ref, mode:kindLabel(l.kind)||l.kind,
                             from:st[0] && st[0].name, to:st[st.length-1] && st[st.length-1].name }; });
      const out = { lines:rail };
      if(!want || want === "bus"){
        out.bus_lines = BUS_DIR.length;
        out.bus_sample = BUS_DIR.slice(0, 40).map(b => b.ref);
        if(BUS_DIR.length > 40) out.bus_note = "only the first 40 refs are listed; ask bus_routes_at for a place, or line_info for one ref";
      }
      return out;
    }
    if(name === "station_info"){
      const f = fold(String(a.name || ""));
      let keys = nameNodes[f];
      if(!keys){ const p = searchPlaces(a.name)[0]; if(p) keys = nameNodes[fold(p.name)]; }
      if(!keys || !keys.length) return { found:false, name:a.name };
      const m0 = nodeMeta[keys[0]];
      const refs = [...new Set(keys.map(k => nodeMeta[k] && nodeMeta[k].ref).filter(Boolean))];
      const acc = (ACCESS_RAW||[]).find(x => fold(x.name) === fold(m0.name));
      return { found:true, name:m0.name, lines:refs, interchange:refs.length > 1,
               lat:+m0.lat.toFixed(5), lng:+m0.lng.toFixed(5),
               step_free: acc ? acc.stepFree : null,
               lifts: acc ? acc.elevators : null, escalators: acc ? acc.escalators : null,
               district: acc ? acc.district : null,
               accessibility_known: !!acc };
    }
    if(name === "service_alerts"){
      return { count:(DISRUPTIONS||[]).length,
               alerts:(DISRUPTIONS||[]).map(d => ({ line:d.ref, scope:d.scope, severity:d.severity,
                 title:d.title, detail:d.message, until:d.until || null })) };
    }
    if(name === "city_info"){
      const now = new Date();
      const local = now.toLocaleString("en-GB", { timeZone:"Europe/Istanbul", weekday:"long",
                      year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" });
      const dt = istDayType();
      return { city:CITY.label || CITY.name, local_datetime:local,
               day_type: dt === "wd" ? "weekday" : dt === "sat" ? "Saturday" : "Sunday",
               rail_lines:NETWORK.length, stations:stationList.length,
               bus_lines:BUS_DIR.length, bus_timetables:Object.keys(BUS_SCHED).length > 0,
               modes:[...new Set(NETWORK.map(l => kindLabel(l.kind) || l.kind))],
               fare_card:CITY.card || null };
    }
    return { error:"unknown tool" };
  }
  async function aiLLM(question){
    const key = aiKey(); if(!key) return null;
    const sys = [
      "You are the assistant inside a live public-transport map of " + (CITY.label||CITY.name||"this city") + ".",
      "Answer the user's question directly and helpfully — including follow-ups, comparisons and",
      "practical advice. Do not refuse a question just because it is phrased unusually.",
      "",
      "The one hard rule is sourcing. Any concrete fact about this city's transport — a line, a stop,",
      "a place, a fare, a departure, a duration, a service alert — must come from a tool call. Never",
      "state one from memory or guess it, and never round a tool's number into a different one.",
      "If a tool returns nothing, say plainly that you could not find it and suggest what would help.",
      "",
      "Reach for tools freely; several in one turn is normal. city_info for anything involving today,",
      "now or the time. line_info for a specific line, including first and last departures — for buses",
      "those are exact operator times, while rail returns an operating-hours window, so word it that",
      "way rather than presenting a window as a departure. list_lines when the user describes a line",
      "instead of naming it. plan_route for journeys. service_alerts before reassuring anyone that",
      "something is running.",
      "",
      "General knowledge unrelated to this map (etiquette, what a district is like, travel tips) you",
      "may answer normally, but say when you are speaking generally rather than from the map.",
      "Be concise — usually two or three sentences. Plain text, no markdown headings.",
      "Reply in the language of the question."
    ].join(" ");
    const msgs = [{ role:"user", content:question }];
    for(let turn=0; turn<6; turn++){          // several tool calls per answer is normal
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "content-type":"application/json", "x-api-key":key,
                  "anthropic-version":"2023-06-01",
                  "anthropic-dangerous-direct-browser-access":"true" },
        body: JSON.stringify({ model:AI_MODEL, max_tokens:1200, system:sys, tools:AI_TOOLS, messages:msgs })
      });
      if(!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      msgs.push({ role:"assistant", content:data.content });
      const calls = (data.content||[]).filter(c=>c.type === "tool_use");
      if(!calls.length){
        return (data.content||[]).filter(c=>c.type === "text").map(c=>c.text).join("\n").trim() || null;
      }
      const results = [];
      for(const c of calls){
        let outp; try{ outp = await runAiTool(c.name, c.input); }
        catch(e){ outp = { error:String((e && e.message) || e) }; }
        results.push({ type:"tool_result", tool_use_id:c.id,
                       content: JSON.stringify(outp).slice(0, 4000) });
      }
      msgs.push({ role:"user", content:results });
    }
    return null;                                   // ran out of turns — fall back
  }

  async function answer(q){
    // A key in Settings routes the question through Claude first; no key, a failed call or an
    // empty reply all fall through to the local parser, which needs no network at all.
    if(aiKey()){
      try{
        const said = await aiLLM(q);
        if(said){ aiSay(svgEsc(said).replace(/\n/g, "<br>")); return; }
      }catch(e){
        aiSay('<span style="color:var(--dim)">' + svgEsc(t("aiKeyFail")) + "</span>");
      }
    }
    const f = foldQ(q);

    /* --- fares --- */
    if(/(fare|ticket|how much|price|cost|ucret|ücret|ne kadar|bilet|fiyat)/.test(f)){
      if(FARE && FARE.base != null){
        const card = CITY.card || "";
        let txt = "<b>" + svgEsc(card) + "</b> — " + FARE.base + "₺ " +
                  (lang==="tr" ? "biniş başına" : "per boarding");
        if(Array.isArray(FARE.xfer) && FARE.xfer.length)
          txt += "<br>" + (lang==="tr" ? "Aktarmalar: " : "Transfers: ") +
                 FARE.xfer.map(v=>v + "₺").join(" → ");
        txt += '<br><span style="font-size:9px;color:var(--dim)">' +
               svgEsc(t(FARE.noteKey || "fareNote")) + "</span>";
        aiSay(txt); return;
      }
    }

    /* --- service alerts ("any disruptions today?", "is M2 running?", "M2 aksaklık var mı") --
       The LLM path has had a service_alerts tool all along; without this branch the offline
       parser answered "is M2 running" with a route summary, which reads like a yes. Must sit
       before the line-ref branch for that reason. */
    if(/\b(disruption|disruptions|delay|delays|alert|alerts|closure|closed|suspended|outage|service status|running|works)\b/i.test(q) ||
       /(aksakl|arıza|ariza|gecikme|kapalı|kapali|çalışıyor mu|calisiyor mu|sefer var m|sorun var m)/i.test(q)){
      const all = DISRUPTIONS || [];
      const ref = findRef(q);
      const mine = ref ? all.filter(d => String(d.ref).toUpperCase() === ref.toUpperCase()) : all;
      if(!mine.length){
        aiSay(svgEsc(t(ref ? "aiAlertsLineOk" : "aiAlertsNone")) +
              (ref ? ' <b>' + svgEsc(ref) + '</b>' : ''));
        return;
      }
      const rows = mine.map(d => {
        const msg = (lang === "tr" && d.messageTr) ? d.messageTr : d.message;
        return '<div class="ai-hit"><span class="n"><b>' + svgEsc(d.ref || "") + "</b> " +
               svgEsc(d.title || "") + "<br>" + svgEsc(msg || "") +
               (d.until ? ' <span style="color:var(--dim)">(' + svgEsc(t("aiAlertsUntil")) + " " +
                 svgEsc(d.until) + ")</span>" : "") + "</span></div>";
      }).join("");
      aiSay("<b>" + svgEsc(t("aiAlertsSome")) + "</b>" + (ref ? " — " + svgEsc(ref) : "") + rows);
      return;
    }

    /* --- accessibility ("is Levent step free?", "Levent asansör var mı") -----------------
       Answers from the İBB lift/escalator data already shipped, and says plainly when a
       station has no record rather than implying it is inaccessible. */
    if(/\b(step.?free|wheelchair|elevator|lift|lifts|escalator|accessible|accessibility)\b/i.test(q) ||
       /(asansör|asansor|yürüyen merdiven|yuruyen merdiven|engelli|erişilebilir|erisilebilir|tekerlekli)/i.test(q)){
      const bare = f
        .replace(/\b(is|are|does|do|has|have|there|any|the|a|an|at|in|on|of|to|var|mi|mı|mu|mü|midir|mıdır)\b/g, " ")
        .replace(/(step.?free|wheelchair|elevator|lifts?|escalators?|accessible|accessibility|asansor|yuruyen merdiven|engelli|erisilebilir|tekerlekli sandalye|tekerlekli)/g, " ")
        .replace(/\s+/g, " ").trim();
      const st = bare ? await resolve(bare) : null;
      if(!st){ aiSay(svgEsc(t("aiNoPlace")) + " “" + svgEsc(bare || q) + "”."); return; }
      const acc = (typeof accFor === "function") ? accFor(st.name) : undefined;
      if(!acc){
        aiSay("<b>" + svgEsc(st.name) + "</b><br>" + svgEsc(t("aiAccUnknown")) +
              '<br><span style="font-size:9px;color:var(--dim)">' + svgEsc(t("aiAccCityOnly")) + "</span>");
        dropPin(st); return;
      }
      const bits = [];
      if(acc.elevators != null) bits.push(acc.elevators + " " + t("accLifts"));
      if(acc.escalators != null) bits.push(acc.escalators + " " + t("accEscalators"));
      aiSay("<b>" + svgEsc(st.name) + "</b><br>" +
            (acc.stepFree ? "♿ " + svgEsc(t("aiAccStepFree")) : svgEsc(t("aiAccNot"))) +
            (bits.length ? " · " + svgEsc(bits.join(" · ")) : "") +
            '<br><span style="font-size:9px;color:var(--dim)">' + svgEsc(t("accSource")) +
            " İBB + OpenStreetMap</span>");
      dropPin(st); return;
    }

    /* --- which lines serve a station ("what lines stop at Yenikapı?") -------------------
       "buses at X" already existed; this is the rail half of the same question. */
    let lq = f.match(/^(?:which|what)\s+(?:lines?|trains?|metros?|hatlar|hat)\s*(?:stop|serve|serves|go|goes|run|pass|are)?\s*(?:at|through|from|in|on)?\s+(.+)$/) ||
             f.match(/^(.+?)\s+(?:hangi hatlar|hatlar[iı]|hangi hat)$/);
    if(lq && lq[1]){
      const st = await resolve(lq[1].trim());
      if(!st){ aiSay(svgEsc(t("aiNoPlace")) + " “" + svgEsc(lq[1].trim()) + "”."); return; }
      const keys = nameNodes[fold(st.name)] || [];
      const refs = [...new Set(keys.map(k => nodeMeta[k] && nodeMeta[k].ref).filter(Boolean))].sort(trCmp);
      if(!refs.length){ aiSay(svgEsc(t("aiLinesNone"))); return; }
      aiSay("<b>" + svgEsc(t("aiLinesAt")) + "</b> " + svgEsc(st.name) + "<br>" +
            refs.map(svgEsc).join(", "));
      dropPin(st); return;
    }

    /* --- first / last service for a line ("when is the last ride today?") --------------
       Placed before the generic line branch, which would otherwise answer a timing question
       with a route summary. Requires a first/last word, so "buses at Levent" is unaffected. */
    if(/\b(first|last|final|earliest|latest|closing|opening)\b/i.test(q) ||
       /\b(ilk|son)\s*(sefer|otob|tren|vapur|metro|araç)/i.test(q) ||
       /kaçta|saat kaç|çalışma saat|operating hours|service hours/i.test(q)){
      const ref = findRef(q);
      if(ref){
        // bus timetables arrive with the lazy per-city dataset; wait briefly if it is in flight
        if(!lineByRef[ref] && !busReady){
          await Promise.race([busDataPromise, new Promise(r => setTimeout(r, 4000))]);
        }
        const html = lineTimesHTML(ref);
        if(html){ aiSay(html); return; }
      }
      aiSay(svgEsc(t("lrWhich")));
      return;
    }

    /* --- buses at a stop --- */
    let m = f.match(/^(?:which |what )?(?:buses?|bus routes?|otobus|otobüs|otobusler)\s*(?:at|near|serve|serving|from|de|da)?\s*(.+)$/) ||
            f.match(/^(.+?)\s+(?:buses?|bus routes?|otobus|otobüs)$/);
    if(m && m[1]){
      const place = await resolve(m[1].trim());
      if(!place){ aiSay(svgEsc(t("aiNoPlace")) + " “" + svgEsc(m[1].trim()) + "”."); return; }
      const refs = new Set();
      for(const k in nodeMeta){ const nm = nodeMeta[k];
        if(nm.kind !== "bus" || !nm.ref) continue;
        if(metersBetween([place.lat,place.lng],[nm.lat,nm.lng]) < 350) refs.add(nm.ref); }
      const list = [...refs].sort(trCmp);
      if(!list.length){ aiSay(svgEsc(t("aiNoBus"))); return; }
      aiSay("<b>" + svgEsc(t("aiBusAt")) + "</b> — " + svgEsc(place.name) + "<br>" +
            list.map(svgEsc).join(", "));
      dropPin(place); return;
    }

    /* --- directions: "A to B" --- */
    /* "how long from Taksim to Kadıköy" used to resolve the whole phrase as a place name and
       fail on "how long from taksim". A duration question about two points is the same request
       as a route between them — the plan already reports the time. */
    m = f.match(/^(?:how (?:do i get|to get|long(?: does it take)?|far)\s*|get me |directions |route |yol tarifi |nasil giderim |ne kadar (?:surer|sürer)\s*)?(?:from )?(.+?)\s+(?:to|->|→|until|-)\s+(.+)$/);
    if(m && m[1] && m[2] && !matchCat(m[1])){
      const a = await resolve(m[1].trim()), b = await resolve(m[2].trim());
      if(!a || !b){ aiSay(svgEsc(t("aiNoPlace")) + " “" + svgEsc((!a?m[1]:m[2]).trim()) + "”."); return; }
      setPoint("O", a); setPoint("D", b); setTab("active");
      aiSay(svgEsc(t("aiRouting")) + "<br><b>" + svgEsc(a.name) + "</b> → <b>" + svgEsc(b.name) + "</b>");
      const btn = document.getElementById("route"); if(btn) btn.click();
      return;
    }

    /* --- category near somewhere ("food near Taksim", "nearest hospital") --- */
    let cat = matchCat(q), where = null;
    if(!cat){
      m = f.match(/^(?:where can i |where to |find |show me |bul |nerede )?(?:the )?(?:nearest|closest|nearby|near|en yakin|en yakın|yakin|yakın)?\s*(.+?)\s+(?:nearby|near|around|close to|by|in|at|yakininda|yakınında|civarinda|civarında|de|da)\s+(.+)$/);
      if(m){ cat = matchCat(m[1]); if(cat) where = m[2].trim(); }
    }
    if(!cat){
      m = f.match(/^(?:the )?(?:nearest|closest|en yakin|en yakın)\s+(.+)$/);
      if(m) cat = matchCat(m[1]);
    }
    if(!cat){
      m = f.match(/^(?:where can i |where to )?(?:eat|yemek yiyebilirim)\b.*$/);
      if(m) cat = POI_CATS[0];
    }
    if(cat){
      let anchor = where ? await resolve(where) : null;
      if(!anchor){
        /* Turkish puts the place BEFORE the postposition — "Beşiktaş yakınında eczane" —
           the mirror of English "pharmacy near Beşiktaş", so it needs its own pattern. */
        const tm = f.match(/(?:^|\s)(.+?)\s+(?:yakininda|yakınında|yakinlarinda|yakınlarında|civarinda|civarında)\b/);
        if(tm) anchor = await resolve(tm[1].trim());
      }
      if(!anchor){
        const wm = f.match(/\b(?:near|around|in|at)\s+(.+)$/);
        if(wm) anchor = await resolve(wm[1].trim());
      }
      if(!anchor) anchor = await resolve("here");
      const hits = await poiNear(anchor.lat, anchor.lng, cat.tag, 3, 20);
      if(hits === null){ aiSay(svgEsc(t("aiOffline"))); return; }
      if(!hits.length){ aiSay(svgEsc(t("omniNone"))); return; }
      const top = hits.slice(0,6);
      aiSay("<b>" + cat.ic + " " + svgEsc(catLabel(cat)) + "</b> — " + svgEsc(anchor.name) +
            top.map(hitRow).join(""));
      dropPin(top[0]);
      return;
    }

    /* --- what is nearby --- */
    /* longest alternative first, or "nearby X" matches "near" and leaves "by X" as the place */
    m = f.match(/^(?:what(?:\047s| is)? |whats )?(?:nearby|near|around|close to|yakininda|yakınında|civarinda|civarında|yakinda|yakında)\b\s*(?:me|here|is)?\s*(.*)$/);
    if(m){
      const anchor = await resolve((m[1]||"").trim() || "here");
      if(!anchor){ aiSay(svgEsc(t("aiNoIdea"))); return; }
      const stops = nearestStops(anchor.lat, anchor.lng, 4);
      let html = "<b>" + svgEsc(t("aiStops")) + "</b> — " + svgEsc(anchor.name);
      html += stops.map(st=>'<div class="ai-hit" data-lat="' + st.lat + '" data-lng="' + st.lng +
        '" data-nm="' + attrEsc(st.name) + '"><span class="n">' + svgEsc(st.name) +
        (st.refs.length ? " · " + svgEsc(st.refs.slice(0,4).join(", ")) : "") +
        '</span><span class="d">' + walkMin(st.m) + " min</span></div>").join("");
      aiSay(html); dropPin(anchor); return;
    }

    /* --- a line by ref ("M2", "where does M4 go") --- */
    const lm = q.toUpperCase().match(/\b([A-Z]{1,3}\d{1,2}[A-Z]?)\b/);
    if(lm){
      const ln = NETWORK.find(l=>String(l.ref).toUpperCase() === lm[1]);
      if(ln){
        const st = ln.stations || ln.stops || [];
        aiSay("<b>" + svgEsc(ln.ref) + "</b> " + svgEsc(ln.name||"") + "<br>" +
          (st.length ? svgEsc(st[0].name) + " → " + svgEsc(st[st.length-1].name) +
            " · " + st.length + " " + svgEsc(t("stations")).toLowerCase() : ""));
        if(st.length && mapUsable()){
          try{ map.flyToBounds(L.latLngBounds(st.map(x=>[x.lat,x.lng])), {padding:[60,60], duration:.8}); }catch(e){}
        }
        return;
      }
    }

    /* --- last resort: treat it as a place --- */
    const p = await resolve(q);
    if(p){ dropPin(p);
      const stops = nearestStops(p.lat, p.lng, 3);
      aiSay("<b>" + svgEsc(p.name) + "</b>" + (p.ctx ? " · " + svgEsc(p.ctx) : "") +
        (stops.length ? "<br>" + svgEsc(t("aiStops")) + ": " +
          stops.map(st=>svgEsc(st.name) + " (" + walkMin(st.m) + " min)").join(", ") : ""));
      return; }
    aiSay(svgEsc(t("aiNoIdea")));
  }

  /* clicking a result row in the transcript drops the pin there */
  document.getElementById("aiLog").addEventListener("click", e=>{
    const h = e.target.closest(".ai-hit"); if(!h) return;
    dropPin({name:h.getAttribute("data-nm"), lat:+h.getAttribute("data-lat"), lng:+h.getAttribute("data-lng")});
  });
})();

/* ---- data sources: what is shipped, from where, and how old ------------------------
   The app already refuses to invent data; this makes the same honesty inspectable. Sorted
   oldest first, because staleness is the thing worth noticing. */
function ageText(iso){
  if(!iso) return t('provUnknown');
  const d = (Date.now() - Date.parse(iso)) / 86400000;
  if(d < 1) return t('provToday');
  if(d < 2) return t('provYesterday');
  return t('provDays').replace('{n}', Math.round(d));
}
function renderProvenance(){
  const box = document.getElementById('provList');
  if(!box || !window.PROVENANCE_READY) return;
  const rows = Object.entries(PROVENANCE.datasets)
    .filter(([, m]) => m.present)
    .sort((a, b) => Date.parse(a[1].updated || 0) - Date.parse(b[1].updated || 0));
  box.innerHTML = rows.map(([file, m]) => {
    const cls = m.kind === 'operator' ? 'pv-ok' : m.kind === 'official' ? 'pv-ok'
              : m.kind === 'community' ? 'pv-warn' : m.kind === 'scraped' ? 'pv-warn' : 'pv-dim';
    return '<div class="pv-row">' +
      '<span class="pv-k ' + cls + '">' + svgEsc(t('provKind_' + m.kind) || m.kind) + '</span>' +
      '<span class="pv-t"><b>' + svgEsc(m.covers || file) + '</b>' +
      '<span class="pv-s">' + svgEsc(m.source) + '</span></span>' +
      '<span class="pv-a">' + svgEsc(ageText(m.updated)) + '</span></div>';
  }).join('');
}
window.PROVENANCE_READY = true;
renderProvenance();

/* ---- diagnostics: show what was recorded, and let the user send it if they choose ---- */
function diagReportText(){
  const env = [
    "build: " + BUILD,
    "city: " + CITY_ID,
    "lang: " + lang,
    "screen: " + innerWidth + "x" + innerHeight + " dpr" + (devicePixelRatio || 1),
    "online: " + navigator.onLine,
    "standalone: " + (isStandalone ? isStandalone() : "?"),
    "sw: " + (navigator.serviceWorker && navigator.serviceWorker.controller ? "active" : "none"),
    "ua: " + navigator.userAgent,
  ].join("\n");
  const faults = DIAG.length
    ? DIAG.map(d => "- [" + d.t + "] " + d.kind + (d.n > 1 ? " (x" + d.n + ")" : "") +
        ": " + d.msg + (d.at ? "\n      " + d.at : "")).join("\n")
    : "(no faults recorded)";
  return "### What happened\n\n<!-- what were you doing? -->\n\n### Faults recorded\n\n" +
         faults + "\n\n### Environment\n\n```\n" + env + "\n```\n";
}
function refreshDiagRow(){
  const note = document.getElementById("diagNote");
  if (!note) return;
  note.textContent = DIAG.length
    ? t("diagSome").replace("{n}", DIAG.length).replace("{m}", DIAG[DIAG.length - 1].msg.slice(0, 80))
    : t("diagNone");
}
(function(){
  const rep = document.getElementById("diagReport"),
        cp  = document.getElementById("diagCopy"),
        cl  = document.getElementById("diagClear");
  if (!rep) return;
  const REPO = "https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map";
  rep.addEventListener("click", () => {
    // GitHub caps the URL; the body is trimmed and the full text stays copyable
    const body = diagReportText().slice(0, 5500);
    const url = REPO + "/issues/new?title=" + encodeURIComponent("Problem report" +
      (DIAG.length ? ": " + DIAG[DIAG.length - 1].msg.slice(0, 60) : "")) +
      "&body=" + encodeURIComponent(body);
    window.open(url, "_blank", "noopener");
  });
  if (cp) cp.addEventListener("click", async () => {
    const txt = diagReportText();
    try { await navigator.clipboard.writeText(txt); cp.textContent = t("diagCopied"); }
    catch (e) { window.prompt(t("diagCopy"), txt); }
    setTimeout(() => { cp.textContent = t("diagCopy"); }, 1800);
  });
  if (cl) cl.addEventListener("click", () => {
    DIAG = []; diagSave(); refreshDiagRow();
  });
  refreshDiagRow();
})();

/* ---- optional Anthropic key, kept ONLY in this browser ---------------------------------
   A public static site cannot ship a key, so the assistant is local by default. If you paste
   your own key it is written to localStorage on this device and sent to api.anthropic.com and
   nowhere else — it is never committed, never bundled, and never reaches this repo. */
function aiKey(){ try{ return localStorage.getItem("irn_ai_key") || ""; }catch(e){ return ""; } }
function refreshAiKeyRow(){
  const inp=document.getElementById("aiKeyIn"), note=document.getElementById("aiKeyNote");
  if(!inp || !note) return;
  const k=aiKey();
  inp.value = k ? "\u2022".repeat(18) : "";
  note.textContent = k ? t("aiKeyOn") : t("aiKeyOff");
}
(function(){
  const inp=document.getElementById("aiKeyIn"), save=document.getElementById("aiKeySave"),
        clr=document.getElementById("aiKeyClear");
  if(!inp || !save) return;
  save.addEventListener("click", ()=>{
    const v=inp.value.trim();
    if(!v || /^\u2022+$/.test(v)) return;            // untouched mask → leave the stored key alone
    try{ localStorage.setItem("irn_ai_key", v); }catch(e){}
    refreshAiKeyRow();
  });
  if(clr) clr.addEventListener("click", ()=>{
    try{ localStorage.removeItem("irn_ai_key"); }catch(e){}
    refreshAiKeyRow();
  });
  inp.addEventListener("focus", ()=>{ if(/^\u2022+$/.test(inp.value)) inp.value=""; });
  refreshAiKeyRow();
})();

/* Now / Depart / Arrive. Changing any of it re-renders the itinerary that is already on
   screen, so the times follow the choice without needing the route recomputed. */
(function(){
  const seg = document.getElementById('whenSeg'), inp = document.getElementById('whenTime');
  if(!seg || !inp) return;
  const reflow = () => { if(goCurrent) showItinerary(goCurrent.res, goCurrent.it); };
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-when]'); if(!b) return;
    planWhen.mode = b.getAttribute('data-when');
    [...seg.children].forEach(x => x.classList.toggle('active', x === b));
    inp.disabled = planWhen.mode === 'now';
    if(planWhen.mode !== 'now' && !inp.value){
      // default to half an hour out, rounded to 5 — a usable starting point, not 00:00
      const m = Math.ceil((nowIstanbulMin() + 30) / 5) * 5;
      inp.value = String(Math.floor((m % 1440) / 60)).padStart(2,'0') + ':' +
                  String(m % 60).padStart(2,'0');
    }
    const p = (inp.value || '').split(':');
    planWhen.min = p.length === 2 ? (+p[0] * 60 + +p[1]) : null;
    reflow();
  });
  inp.addEventListener('change', () => {
    const p = (inp.value || '').split(':');
    planWhen.min = p.length === 2 ? (+p[0] * 60 + +p[1]) : null;
    reflow();
  });
})();

/* the left rail hangs off the real header height, so it can never ride up into it */
(function(){
  const tb = document.querySelector(".topbar"); if(!tb) return;
  const set = ()=> document.documentElement.style.setProperty("--topbar-h",
                    Math.round(tb.getBoundingClientRect().height) + "px");
  set();
  if(window.ResizeObserver) new ResizeObserver(set).observe(tb); else window.addEventListener("resize", set);
})();

init();
