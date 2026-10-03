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

   maxNativeZoom is not optional. Esri's tile pyramids stop carrying data at a depth the service
   metadata does not admit to — Dark Gray Canvas advertises LOD 23 and ends at z16; the Streets
   map ends at z19 — and above that they return, again with HTTP 200, a placeholder reading
   "Map data not yet available". Pinning the request depth makes Leaflet upscale the last real
   tile instead of asking for one that does not exist, which is the difference between a
   slightly soft map and the same blank-with-writing failure we just left. Measured per style
   rather than taken from the metadata, because the metadata is wrong.

   The dark and light basemaps are the SAME Esri Streets tiles, regraded two ways by AtlasTiles
   (see 08-basemap.js). Dark Gray Canvas is gone: it has no parks, no water colour and no place
   names, and dimming it with a CSS filter could not add any of them. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const ESRI_STREETS = ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = '&copy; Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors';
const BASES = {
  dark:    new AtlasTiles(ESRI_STREETS,
            Object.assign({ maxZoom:20, maxNativeZoom:19, attribution:ESRI_ATTR,
              grade:makeBasemapGrade(ATLAS_PAL.night) }, TILE_OPTS)),
  voyager: new AtlasTiles(ESRI_STREETS,
            Object.assign({ maxZoom:20, maxNativeZoom:19, attribution:ESRI_ATTR,
              grade:makeBasemapGrade(ATLAS_PAL.day) }, TILE_OPTS)),
  sat:     L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
            Object.assign({ maxZoom:20, maxNativeZoom:19,
              attribution:'&copy; Esri, Vantor, Earthstar Geographics' }, TILE_OPTS))
};
/* A tile that errors stays blank until something happens to re-create it, so one dropped
   request left a permanent hole in the map. Re-request it a few times with backoff. Leaflet
   keeps its own onload handler on the <img>, so a late success still fades in normally. */
Object.keys(BASES).forEach(k => {
  if(BASES[k] instanceof AtlasTiles) return;   // its canvas tiles retry inside createTile
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
  applyMapTone();
}
/* What the map is drawn ON decides what is drawn over it, so everything that sits on the
   basemap — line outlines, station rings, label ink and halo — keys off the BASEMAP, not off the
   UI theme. They usually agree; they diverge when someone picks the dark map under the light
   panels, or the satellite layer under either, and drawing white text on a pale map because the
   page happens to be in dark mode would be wrong in exactly the case it was meant to help.

   'imagery' is its own tone rather than a copy of night: satellite is darkish and busy, so it
   wants light labels with a dark halo (the night treatment) but a WHITE outline under the
   lines (the day treatment), the way every imagery map draws transit. */
const MAP_TONES = {
  day:     { casing:'#FFFFFF', casingOp:.96, label:'#1B2433', labelMulti:'#0B1220', halo:'rgba(255,255,255,.95)', ring:'#1B2433', hole:'#FFFFFF' },
  night:   { casing:'#08090B', casingOp:.92, label:'#C9CCD2', labelMulti:'#FFFFFF', halo:'rgba(8,9,11,.92)',     ring:'#0A0B0D', hole:'#0A0B0D' },
  imagery: { casing:'#FFFFFF', casingOp:.92, label:'#E6ECF6', labelMulti:'#FFFFFF', halo:'rgba(8,12,20,.88)',    ring:'#0B0F19', hole:'#0B0F19' },
};
function mapTone(){ return curBaseKey === 'dark' ? 'night' : (curBaseKey === 'sat' ? 'imagery' : 'day'); }
const MAP_T = () => MAP_TONES[mapTone()];

const lineRenderer = L.canvas({ padding:0.5 });
const stationRenderer = L.canvas({ padding:0.5 });

/* The stages of a project that is not running yet. They are declared HERE, with the way each is
   drawn, rather than next to the panel that also uses them (11a-planned-panel.js): the line
   tooltips are built while the map is being constructed in this file, and a `const` in a LATER
   file is still in its temporal dead zone at that moment — which stopped the whole app booting. */
const PHASE_STATUS = { construction:'Under construction', planned:'Planned', hold:'On hold', vision:'Long-term plan' };
const PHASE_ORDER = ['construction', 'planned', 'hold', 'vision'];
/* How each stage is drawn. dw widens or thins the line; op is its opacity. */
const PHASE_LOOK = {
  construction: { dash:'11,5', dw: 1.2, op:1    },
  planned:      { dash:'5,6',  dw: 0.6, op:0.95 },
  hold:         { dash:'3,7',  dw:-0.1, op:0.7  },
  /* round dots with no outline: a 1px butt-capped dot inside a pale halo was invisible, and the halo
     alone read as a white line */
  vision:       { dash:'0.1,8', dw:0, op:0.8, cap:'round', bare:true },
};
const lineLayers = {};      // ref -> {group, on, live}
const lineByRef = {};
const linePolys = [];       // {pl, base} for zoom-responsive weight
NETWORK.forEach(line => {
  lineByRef[line.ref] = line;
  const km = KIND[line.kind];
  const live = isLive(line);
  const grp = L.layerGroup();
  /* A line that is not running says how far along it is by how it is drawn, because the map is
     where this gets read: long bold dashes for a tunnel being dug, finer dashes for a project
     that is only planned, sparse dots for one that is on hold, and the faintest dots for a
     long-term idea. The old rule gave every planned line the same dots, so a line under
     construction and a sketch from a master plan looked identical. `approx` (an alignment that
     is only an estimate) still wins, with the finest dots of all. */
  const dash = !live ? ((line.approx || (line.geometry && line.geometry.schematic)) ? '1,5' : (PHASE_LOOK[line.phase] || PHASE_LOOK.planned).dash)
                     : (km.dash || (line.branch ? '5,7' : null));
  const look = !live ? (PHASE_LOOK[line.phase] || PHASE_LOOK.planned) : null;
  const wt = live ? km.weight : Math.max(2.2, km.weight - 1 + look.dw);
  const coreOp = live ? 0.95 : look.op;
  /* Lazy, on purpose. A tooltip built here would run while the map is still being constructed,
     before the files that come after this one have initialised their `const`s, and the planned-line
     version needs helpers from them (a temporal-dead-zone crash that stopped the app booting,
     twice). Leaflet calls a content function when the tooltip opens, when everything exists. */
  const tip = () => lineTooltip(line);
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
                            opacity: coreOp, lineCap:look ? (look.cap || 'butt') : 'round', lineJoin:'round', dashArray:dash });
    [glow,core].forEach(pl => {
      pl.bindTooltip(tip, { sticky:true, className:'lt' });
      pl.on('click', e => { openLine(line); L.DomEvent.stop(e); });
      pl.addTo(grp);
    });
    /* The glow and the casing are the SAME polyline: neon wants a wide soft bloom behind the line,
       Atlas wants a narrow solid outline, and both are "the thing drawn just under the core". So
       the entry remembers both widths and applyLineStyle() decides which this experience gets —
       no second polyline per path, which on 95 lines would have doubled the canvas work. */
    const coreE = { pl:core, base:wt, baseOp:coreOp, ref:line.ref };
    const glowE = { pl:glow, base:gw, glow:true, baseOp:(live?0.16:0.10), ref:line.ref,
                    color:line.color, glowBase:gw, coreBase:wt, pair:coreE, solidCasing:!live, bare:!!(look && look.bare) };
    linePolys.push(glowE, coreE);
  });
  lineLayers[line.ref] = { group:grp, on:true, live };
});

/* A grey ghost of the live network, for geographic context behind the Vision tab. It was a fixed
   dark slate, chosen for the dark map; drawn on the light one it became the heaviest thing on
   screen and competed with the very lines the tab exists to show. Like everything else drawn on
   the map it now follows the basemap (see GHOST_LOOK / applyMapTone): a pale, thin trace by day. */
const GHOST_LOOK = {
  day:     { color:'#8C97AB', weight:1.5, opacity:0.34 },
  night:   { color:'#3b3d42', weight:2,   opacity:0.55 },
  imagery: { color:'#DDE4F0', weight:1.5, opacity:0.45 },
};
const ghostGroup = L.layerGroup();
const ghostLines = [];
liveLines.forEach(line => line.paths.forEach(path => {
  const g = L.polyline(path, Object.assign({ renderer:lineRenderer, interactive:false }, GHOST_LOOK.night));
  ghostLines.push(g); g.addTo(ghostGroup);
}));

/* ONE station dot, on every line and every tab: a white disc with a thick black outline. Stations used
   to be drawn four ways — a disc in the line's own colour, a white disc in a coloured ring, a hollow
   ring for planned lines, a dark disc for intercity — so the same kind of place looked like four
   different things depending on which line it was on. The line's colour already says which line;
   the dot only has to say "a station is here", the same way everywhere. */
const STATION_RING = 2.4;
const stationDot = extra => Object.assign({ color:'#05070A', fillColor:'#FFFFFF', fillOpacity:1, weight:STATION_RING }, extra || {});
// station markers (merged registry)
const stationGroup = L.layerGroup();
const stationMarkers = {};
const stationMarkersArr = [];   // {m, base} for zoom-responsive radius
stationList.forEach(r => {
  const ix = r.lines.size>1;
  const col = ix ? "#ffffff" : lineByRef[[...r.lines][0]].color;
  const base = ix?6.2:4.6;          // big enough that the white shows inside the thick black ring
  const m = L.circleMarker([r.lat, r.lng], {
    renderer:stationRenderer, radius: base, color:'#05070A', weight:STATION_RING, fillColor:'#FFFFFF', fillOpacity:1
  });
  m.on('click', (e) => { openStation(r); L.DomEvent.stop(e); });
  m.addTo(stationGroup);
  stationMarkers[fold(r.name)] = m;
  stationMarkersArr.push({ m, base, refs:r.lines, ix, color:lineByRef[[...r.lines][0]].color });
});

// hollow markers for planned-line stops (Vision tab only)
const plannedStationGroup = L.layerGroup();
plannedStationList.forEach(r => {
  const m = L.circleMarker([r.lat, r.lng], {
    renderer:stationRenderer, radius:4.6, color:'#05070A', weight:STATION_RING, fillColor:'#FFFFFF', fillOpacity:1
  });
  m.on('click', (e) => { openLine(lineByRef[r.ref]); L.DomEvent.stop(e); });
  m.addTo(plannedStationGroup);
  stationMarkersArr.push({ m, base:4.6, refs:new Set([r.ref]), planned:true, color:r.color });
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
  // the black ring shrinks with the dot, or a tiny zoomed-out station would be nothing but ring
  stationMarkersArr.forEach(o => { o.m.setRadius(Math.max(1, o.base*ms)); o.m.setStyle({ weight: Math.max(1, STATION_RING*ms) }); });
}
map.on('zoomend', applyZoomStyling);

/* Line outlines. Only the Atlas experience uses them; the others keep their own bloom (neon),
   faint bloom (calm) or none (paper). Called whenever either input changes — the experience, or
   the basemap the lines sit on — and cheap enough to call freely: setStyle on ~140 polylines,
   no redraw until the weight changes, which applyZoomStyling does at the end anyway. */
const _casingCache = new Map();
function casingFor(color, tone){
  const k = color + '|' + tone;
  let v = _casingCache.get(k);
  if(!v){ v = (tone === 'imagery') ? '#FFFFFF' : lineCasing(color, tone); _casingCache.set(k, v); }
  return v;
}
const CASING_PAD = 3.0;       // total extra width: 1.5px of outline each side of the core
/* A line that is not running is DASHED, and the outline under dashes has to be slimmer than the
   outline under a solid line: at city scale a full-width halo is wider than the thin dashes it
   frames and swallows their colour, which is how the first version of this looked — a pale,
   broken scribble. A slim halo keeps the dashes legible on a busy map without hiding them. */
const CASING_PAD_PLANNED = 1.6;
function applyLineStyle(){
  const atlas = (typeof uiStyle !== 'undefined' && uiStyle === 'atlas');
  const tone = mapTone(), T = MAP_TONES[tone];
  const glowOp = (typeof uiStyle !== 'undefined') ? (uiStyle === 'calm' ? 0.07 : (uiStyle === 'paper' ? 0 : null)) : null;
  linePolys.forEach(o => {
    if(!o.glow) return;
    if(atlas){
      o.base = o.coreBase + (o.solidCasing ? CASING_PAD_PLANNED : CASING_PAD);
      // a dashed line (planned, branch, suspended) gets a dashed outline, or the solid outline
      // under it would turn "not in normal service" back into an ordinary line
      /* A live line that has been suspended is dashed, and its outline must follow the dash or the
         solid halo would turn it back into an ordinary line. A line that is NOT YET RUNNING is
         dashed by design and has no such ambiguity, so its outline stays continuous: dashes drawn
         straight on a busy map are hard to follow, dashes on a continuous halo are not. */
      o.pl.setStyle({ color:casingFor(o.color, tone), opacity:o.bare ? 0 : (o.solidCasing ? T.casingOp * .6 : T.casingOp),
                      dashArray:o.solidCasing ? null : ((o.pair && o.pair.pl.options.dashArray) || null) });
    } else {
      o.base = o.glowBase;
      o.pl.setStyle({ color:o.color, opacity: glowOp == null ? o.baseOp : glowOp, dashArray:null });
    }
  });
  applyZoomStyling();
}
/* Station dots are ONE style everywhere (see STATION_RING): a white disc with a thick black outline,
   whatever the line, the tab or the basemap. This runs on every tone change only to put that style
   back after anything restyled a marker — it no longer varies with the tone. */
function applyStationStyle(){
  stationMarkersArr.forEach(o => o.m.setStyle({ color:'#05070A', fillColor:'#FFFFFF', fillOpacity:1 }));
  applyZoomStyling();
}
// everything that depends on what the map is drawn on, in one call
function applyMapTone(){
  const tone = mapTone(), pal = tone === 'night' ? ATLAS_PAL.night : (tone === 'day' ? ATLAS_PAL.day : null);
  // the colour the page shows through a tile seam — if it is not the land colour, every tile
  // edge draws a faint hairline across the whole map
  const c = map.getContainer();
  if(c) c.style.background = pal ? 'rgb(' + pal.ground.join(',') + ')' : '';
  applyLineStyle();
  applyStationStyle();
  const gl = GHOST_LOOK[tone];
  ghostLines.forEach(g => g.setStyle(gl));
}

let routeLayer = L.layerGroup().addTo(map);
applyMapTone();   // the first paint already matches the basemap it is on

/* Named entry point for the browser smoke suite, in the spirit of simCars() and disruptionProbe():
   the page's state lives in script-scoped bindings that are not properties of window, and the
   CSP rules out eval, so what a test needs to read has to be published on purpose.

   `tile` is the most common NON-WHITE colour across the loaded canvas tiles — on a map that is
   mostly land, that is the land colour, which is exactly what the regrade is supposed to have set.
   White is excluded because in a dense district the road fill outnumbers any single shade of
   land, and the first version of this reported (252,252,252) by day: a reading that an
   un-regraded tile would have produced too, so it proved nothing. */
/* Move the map from outside this script's scope. `map` is a script-level const, so it is not a
   property of window, and the CSP forbids the eval that would otherwise reach it; the smoke
   suite and the screenshot harness both need to point the map at something. */
function viewMap(lat, lng, z){ map.setView([lat, lng], z, { animate:false }); return map.getZoom(); }
// Open a line's panel by ref, for the same reason: `lineByRef` is not reachable from outside.
function viewLine(ref){ const l = lineByRef[ref]; if(l) openLine(l); return !!l; }
function atlasProbe(){
  const cs = [...map.getContainer().querySelectorAll('.leaflet-tile-pane canvas')].filter(c => c.width > 0);
  const m = new Map();
  cs.forEach(c => {
    try{
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for(let i = 0; i < d.length; i += 64){
        if(d[i+3] < 200) continue;                                     // not painted yet: a fresh canvas reads as transparent black
        if(d[i] >= 246 && d[i+1] >= 246 && d[i+2] >= 246) continue;     // road fill, not ground
        const k = ((d[i] >> 3) << 10) | ((d[i+1] >> 3) << 5) | (d[i+2] >> 3); m.set(k, (m.get(k) || 0) + 1);
      }
    }catch(e){}
  });
  const ranked = [...m].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const rgb = k => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
  const gl = linePolys.filter(o => o.glow)[0];
  return { style: uiStyle, base: curBaseKey, tone: mapTone(),
           ground: map.getContainer().style.background,
           canvasTiles: cs.length,
           tile: top ? rgb(top[0]) : null,
           common: ranked.slice(0, 5).map(e => rgb(e[0])),     // the five most common colours: on a map half sea, the land is second
           outline: gl ? { color: gl.pl.options.color, opacity: gl.pl.options.opacity, base: gl.base,
                           coreBase: gl.coreBase, glowBase: gl.glowBase } : null };
}
