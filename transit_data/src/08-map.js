/* ===========================================================================
   4. LEAFLET MAP + LAYERS
   =========================================================================== */
// minZoom 6 (not 9) so the Intercity tab can show the whole country — Ankara–Kars is 1,300 km
const map = L.map('map', { zoomControl:true, preferCanvas:true, minZoom:6, maxZoom:18 })
             .setView(CITY.center, CITY.zoom);
L.control.zoom({ position:'bottomright' });

/* crossOrigin makes Leaflet request tiles with CORS, so Cache Storage holds REAL responses
   rather than opaque ones. Opaque entries are padded by the browser to stop size-probing:
   342 cached tiles were being reported as 4.8 GB against a 4.8 GB quota, which both
   mis-reports usage and would exhaust a phone's storage quota within a few hundred tiles.
   Esri sends Access-Control-Allow-Origin, so this costs nothing. */
/* keepBuffer holds a wider ring of tiles around the view so panning does not expose bare
   background, and updateWhenZooming stops us queueing tiles mid-animation that are stale
   before they arrive — fewer requests in flight at once, which is also why they land faster. */
const TILE_OPTS = { crossOrigin:'anonymous', keepBuffer:3, updateWhenZooming:false };
/* Keyless basemaps only. This is a public static site: a key written into the page is a key
   given away, so a provider that requires one cannot be used here at all.

   CARTO withdrew unauthenticated access to its basemaps. It did not start returning errors —
   it started returning HTTP 200 carrying a tile whose entire content is the words "API KEY
   REQUIRED". That is worse than a failure: the tileerror retry below never fires, the service
   worker happily caches it, and the map goes on "working" while showing no map. Esri serves
   equivalent styles without a key, and the satellite layer already came from there.

   maxNativeZoom is not optional. Dark Gray Canvas advertises LOD 23 in its own service
   metadata but its tile pyramid stops carrying data at z16 — above that it returns, again with
   HTTP 200, a placeholder reading "Map data not yet available". Pinning the request depth makes
   Leaflet upscale the last real tile instead of asking for one that does not exist, which is
   the difference between a slightly soft map and the same blank-with-writing failure we just
   left. Measured per style rather than taken from the metadata, because the metadata is wrong. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const BASES = {
  dark:    L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            Object.assign({ maxZoom:20, maxNativeZoom:16, className:'base-dim',
              attribution:'&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }, TILE_OPTS)),
  voyager: L.tileLayer(ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}',
            Object.assign({ maxZoom:20, maxNativeZoom:19,
              attribution:'&copy; Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors' }, TILE_OPTS)),
  sat:     L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
            Object.assign({ maxZoom:20, maxNativeZoom:19,
              attribution:'&copy; Esri, Vantor, Earthstar Geographics' }, TILE_OPTS))
};
/* A tile that errors stays blank until something happens to re-create it, so one dropped
   request left a permanent hole in the map. Re-request it a few times with backoff. Leaflet
   keeps its own onload handler on the <img>, so a late success still fades in normally. */
Object.keys(BASES).forEach(k => {
  const tries = new WeakMap();
  BASES[k].on('tileerror', ev => {
    const img = ev.tile; if(!img || !img.src) return;
    const n = (tries.get(img) || 0) + 1;
    if(n > 3) return;                       // give up rather than hammer the provider
    tries.set(img, n);
    const src = img.src;
    setTimeout(() => { if(img.parentNode) img.src = src; }, 400 * n);
  });
});
let curBase = BASES.dark.addTo(map);
let curBaseKey = 'dark';
function setBase(b){
  if(!BASES[b] || b===curBaseKey) return;
  map.removeLayer(curBase); curBase=BASES[b].addTo(map); curBase.bringToBack(); curBaseKey=b;
  const seg=document.getElementById('baseSeg'); if(seg)[...seg.children].forEach(x=>x.classList.toggle('active', x.dataset.b===b));
}

const lineRenderer = L.canvas({ padding:0.5 });
const stationRenderer = L.canvas({ padding:0.5 });

const lineLayers = {};      // ref -> {group, on, live}
const lineByRef = {};
const linePolys = [];       // {pl, base} for zoom-responsive weight
NETWORK.forEach(line => {
  lineByRef[line.ref] = line;
  const km = KIND[line.kind];
  const live = isLive(line);
  const grp = L.layerGroup();
  // planned lines dashed; hand-placed "approximate" lines use a finer dotted style
  const dash = !live ? (line.approx ? '1,5' : '2,8') : (km.dash || (line.branch ? '5,7' : null));
  const wt = live ? km.weight : Math.max(2.2, km.weight-1);
  const tip = lineTooltip(line);
  const isFerry = line.kind === 'ferry';
  line.paths.forEach(path => {
    if(isFerry){
      // subtle: no glow; thin low-opacity dotted core + an invisible wide click target
      const hit = L.polyline(path, { renderer:lineRenderer, color:line.color, weight:9, opacity:0, lineCap:'round' });
      const core = L.polyline(path, { renderer:lineRenderer, color:line.color, weight:wt,
                              opacity:0.62, lineCap:'round', lineJoin:'round', dashArray:dash });
      [hit,core].forEach(pl => { pl.bindTooltip(tip,{sticky:true,className:'lt'}); pl.on('click', e=>{ openLine(line); L.DomEvent.stop(e); }); pl.addTo(grp); });
      linePolys.push({ pl:core, base:wt, baseOp:0.62, ref:line.ref });
      return;
    }
    const gw = wt + (live?7:4);
    const glow = L.polyline(path, { renderer:lineRenderer, color:line.color, weight:gw,
                            opacity: live?0.16:0.10, lineCap:'round', lineJoin:'round' });
    const core = L.polyline(path, { renderer:lineRenderer, color:line.color, weight:wt,
                            opacity: live?0.95:0.9, lineCap:'round', lineJoin:'round', dashArray:dash });
    [glow,core].forEach(pl => {
      pl.bindTooltip(tip, { sticky:true, className:'lt' });
      pl.on('click', e => { openLine(line); L.DomEvent.stop(e); });
      pl.addTo(grp);
    });
    linePolys.push({ pl:glow, base:gw, glow:true, baseOp:(live?0.16:0.10), ref:line.ref },
                   { pl:core, base:wt, baseOp:(live?0.95:0.9), ref:line.ref });
  });
  lineLayers[line.ref] = { group:grp, on:true, live };
});

// grey ghost of the live network for geographic context behind the Vision tab
const ghostGroup = L.layerGroup();
liveLines.forEach(line => line.paths.forEach(path =>
  L.polyline(path, { renderer:lineRenderer, color:'#39414f', weight:2, opacity:0.55, interactive:false }).addTo(ghostGroup)));

// station markers (merged registry)
const stationGroup = L.layerGroup();
const stationMarkers = {};
const stationMarkersArr = [];   // {m, base} for zoom-responsive radius
stationList.forEach(r => {
  const ix = r.lines.size>1;
  const col = ix ? "#ffffff" : lineByRef[[...r.lines][0]].color;
  const base = ix?5:3.4;
  const m = L.circleMarker([r.lat, r.lng], {
    renderer:stationRenderer, radius: base,
    color:"#0B0F19", weight: ix?2:1.2, fillColor: col, fillOpacity:1
  });
  m.on('click', (e) => { openStation(r); L.DomEvent.stop(e); });
  m.addTo(stationGroup);
  stationMarkers[fold(r.name)] = m;
  stationMarkersArr.push({ m, base, refs:r.lines });
});

// hollow markers for planned-line stops (Vision tab only)
const plannedStationGroup = L.layerGroup();
plannedStationList.forEach(r => {
  const m = L.circleMarker([r.lat, r.lng], {
    renderer:stationRenderer, radius:3.6, color:r.color, weight:1.6, fillColor:"#0B0F19", fillOpacity:1
  });
  m.on('click', (e) => { openLine(lineByRef[r.ref]); L.DomEvent.stop(e); });
  m.addTo(plannedStationGroup);
  stationMarkersArr.push({ m, base:3.6, refs:new Set([r.ref]) });
});

// zoom-responsive sizing: thin lines & small dots when zoomed out (de-clutter)
const busLayer = L.layerGroup().addTo(map);   // holds the selected bus route
function lineScale(z){ return z>=14 ? 1 : z<=9 ? 0.34 : 0.34 + (z-9)*0.132; }
function markerScale(z){ return z>=14 ? 1 : z<=10 ? 0.42 : 0.42 + (z-10)*0.145; }
/* Route focus: while a planned route is selected the rest of the network comes OFF the map,
   leaving only the journey drawn in routeLayer — which is already just the ridden section,
   not the whole of every line it uses. Carriages, station dots and labels, and the disruption
   overlays go with it: the point is to look at one journey without competition.

   Coming back needs no saved snapshot. setTab() recomputes map contents from the current tab
   and the user's own Show-on-map toggles, so replaying it restores exactly the right state. */
let focusRefs = null;                 // null = normal; otherwise the refs the route uses
function setRouteFocus(refs){
  focusRefs = (refs && refs.size) ? refs : null;
  if(focusRefs){
    NETWORK.forEach(l => { const g = lineLayers[l.ref] && lineLayers[l.ref].group;
                           if(g && map.hasLayer(g)) map.removeLayer(g); });
    [ghostGroup, stationGroup, plannedStationGroup, disruptionLayer, weatherLayer]
      .forEach(g => { if(g && map.hasLayer(g)) map.removeLayer(g); });
  }
  document.body.classList.toggle("focus-route", !!focusRefs);
  const mc=document.querySelector(".leaflet-container");
  if(mc) mc.setAttribute("data-focus-note", focusRefs ? t("focusNote") : "");
  renderOverlay(performance.now());   // repaint at once so carriages/labels vanish immediately
}
// Drop the focus STATE only. Kept separate from clearRouteFocus so setTab can reset it without
// calling back into setTab — otherwise the two bounce off each other and setTab runs twice.
function focusStateOff(){
  focusRefs = null;
  document.body.classList.remove("focus-route");
  const mc=document.querySelector(".leaflet-container");
  if(mc) mc.setAttribute("data-focus-note", "");
}
function clearRouteFocus(){
  if(!focusRefs) return;
  focusStateOff();
  setTab(currentTab);                 // rebuilds the map from the tab + the user's toggles
}
function applyZoomStyling(){
  const z = map.getZoom(), ls = lineScale(z), ms = markerScale(z);
  linePolys.forEach(o => o.pl.setStyle({ weight: Math.max(0.5, o.base*ls) }));
  stationMarkersArr.forEach(o => o.m.setRadius(Math.max(1, o.base*ms)));
}
map.on('zoomend', applyZoomStyling);

let routeLayer = L.layerGroup().addTo(map);

