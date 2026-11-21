/* ===========================================================================
   ENVIRONMENT (V4.9): real topography and 3D buildings
   The owner asked for the hills and slopes of Türkiye "as if it were Google Earth", with 3D buildings, in a tab of their own.
   The main map is Leaflet and Leaflet cannot tilt, so this is a SEPARATE 3D view on MapLibre GL JS 4.7.1, the engine the basemap
   already uses; nothing about the main map changes. Only one heavy map runs at a time: opening the tab takes the main basemap
   (two GL maps) off and pauses the train animation; leaving frees the 3D map and brings both back.
     - terrain: AWS Terrain Tiles (Terrarium PNG, keyless, a public dataset), with the full credit its maker asks for;
     - buildings: the OpenFreeMap tiles we already use carry heights (OpenMapTiles `render_height`); exactly 5 m is that schema's
       default when OpenStreetMap has no height or floor count, so those are drawn muted and say so when tapped;
     - the city's lines are drawn over the terrain; "Sun lighting" lights hills and buildings from where the sun is (MapLibre 4.7.1
       casts no shadows, so it is never called that);
     - presets Light (flat + hill shading), Standard (3D terrain), Full (+ 3D buildings); relief 1× or 1.5× (badged).
   Design: docs/superpowers/specs/2026-11-19-v4.9-design.md
   =========================================================================== */
/* ==ENV-PURE-START== */
const ENV_DEM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
/* the tile maker's required credit, every source (the tiles blend them; tilezen/joerd docs/attribution.md, read 19 Nov 2026) */
const ENV_CREDIT = 'Terrain: Mapzen / AWS Terrain Tiles. ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under ' +
  'National Science Foundation awards 1043681, 1559691, and 1542736; Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017; ' +
  'Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich; Canada terrain data contains information licensed under ' +
  'the Open Government Licence – Canada; Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers; ' +
  'Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration; Mexico terrain data source: INEGI, Continental relief, 2016; ' +
  'New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved); ' +
  'Norway terrain data © Kartverket; United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved; ' +
  'United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.';
const ENV_PRESETS = ['light', 'standard', 'full'];
/* the terrain stops where the street tiles stop (OpenFreeMap's planet TileJSON says maxzoom 14, read 19 Nov 2026): MapLibre cannot line
   deeper terrain up under stretched street tiles, and Türkiye's height data (EU-DEM / SRTM, 25-30 m) has nothing finer to give anyway */
const ENV_DEM_MAXZOOM = 14;
/* Where the sun is, from the time and place (the standard low-precision solar formulas, as used by SunCalc).
   az: degrees from north, clockwise; alt: degrees above the horizon (negative below it). */
function envSunPosition(ms, lat, lng){
  const rad = Math.PI / 180, d = ms / 864e5 - 0.5 + 2440588 - 2451545, e = rad * 23.4397;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const Lm = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(Lm)), ra = Math.atan2(Math.sin(Lm) * Math.cos(e), Math.cos(Lm));
  const lw = rad * -lng, phi = rad * lat, H = rad * (280.16 + 360.9856235 * d) - lw - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));   // from south, westward
  return { az: ((azS / rad + 180) % 360 + 360) % 360, alt: alt / rad };
}
/* the sun as MapLibre light: the hill shading's light direction, and the 3D light (azimuth from north, polar angle from overhead) */
function envLight(sun){
  const day = sun.alt > 0, az = Math.round(sun.az);
  return { hillshadeDir: az, hillshadeExag: day ? 0.5 : 0.2,
           light: { anchor: 'map', position: [1.15, az, Math.max(0, Math.min(90, Math.round(90 - Math.max(sun.alt, 5))))],
                    intensity: day ? 0.5 : 0.15, color: day ? '#ffffff' : '#9fb4d8' } };
}
/* what a tapped building can honestly say about its height */
function envBuildingInfo(h){ return h === 5 ? { key: 'envBldDefault' } : { key: 'envBldEst', n: Math.round(h) }; }
/* the city's lines as GeoJSON (lng,lat), with their colour; ferries flagged to be drawn dashed */
function envLinesFC(lines){
  const features = [];
  (lines || []).forEach(l => (l.paths || []).forEach(p => {
    if(!p || p.length < 2) return;
    features.push({ type: 'Feature', properties: { ref: l.ref, color: l.color || '#888', ferry: l.kind === 'ferry' },
                    geometry: { type: 'LineString', coordinates: p.map(q => [q[1], q[0]]) } });
  }));
  return { type: 'FeatureCollection', features: features };
}
/* The 3D view's style: the app's own basemap style (vecStyle) plus terrain, hill shading, 3D buildings and the lines.
   o: { preset, exag, tone, lines, stops, route, sun } */
function envStyle(base, o){
  const s = JSON.parse(JSON.stringify(base)), night = o.tone === 'night', sun = envLight(o.sun || { az: 180, alt: 45 });
  s.sources.dem = { type: 'raster-dem', tiles: [ENV_DEM], encoding: 'terrarium', tileSize: 256, maxzoom: ENV_DEM_MAXZOOM, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' };
  s.sources['dem-hs'] = { type: 'raster-dem', tiles: [ENV_DEM], encoding: 'terrarium', tileSize: 256, maxzoom: ENV_DEM_MAXZOOM };   // same tiles (the browser caches them); MapLibre draws better hill shading from a source the terrain does not use
  s.sources['env-lines'] = { type: 'geojson', data: o.lines };
  s.sources['env-stops'] = { type: 'geojson', data: o.stops };
  s.sources['env-route'] = { type: 'geojson', data: o.route };
  let hsAt = s.layers.findIndex(l => l.type === 'line');                     // over the ground, under the roads and rivers
  if(hsAt < 0) hsAt = s.layers.findIndex(l => l.type === 'symbol');
  if(hsAt < 0) hsAt = s.layers.length;
  s.layers.splice(hsAt, 0, { id: 'env-hillshade', type: 'hillshade', source: 'dem-hs',
    paint: { 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': sun.hillshadeDir, 'hillshade-exaggeration': sun.hillshadeExag,
             'hillshade-shadow-color': night ? '#05070b' : '#4a4436', 'hillshade-highlight-color': night ? '#2a3140' : '#fff8ea', 'hillshade-accent-color': night ? '#0c0f15' : '#6b6250' } });
  const bi = s.layers.findIndex(l => l.id === 'building');
  if(bi >= 0) s.layers[bi].layout = Object.assign({}, s.layers[bi].layout, { visibility: o.preset === 'full' ? 'none' : 'visible' });
  const muted = night ? '#2a2f3a' : '#cfc8bb', real = night ? '#5b6478' : '#e8e1d2';
  const b3 = { id: 'env-building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
    filter: ['!=', ['get', 'hide_3d'], true], layout: { visibility: o.preset === 'full' ? 'visible' : 'none' },
    paint: { 'fill-extrusion-color': ['case', ['==', ['get', 'render_height'], 5], muted, real],
             'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
             'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true } };
  let symAt = s.layers.findIndex(l => l.type === 'symbol'); if(symAt < 0) symAt = s.layers.length;
  s.layers.splice(symAt, 0, b3,
    { id: 'env-lines-casing', type: 'line', source: 'env-lines', filter: ['!', ['get', 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': night ? '#05070b' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 13, 5, 16, 9], 'line-opacity': 0.85 } },
    { id: 'env-lines', type: 'line', source: 'env-lines', filter: ['!', ['get', 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 13, 3, 16, 6] } },
    { id: 'env-ferries', type: 'line', source: 'env-lines', filter: ['get', 'ferry'],
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2.2], 'line-dasharray': [1, 2], 'line-opacity': 0.8 } },
    { id: 'env-route', type: 'line', source: 'env-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7CF0BE', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 8], 'line-opacity': 0.9 } },
    { id: 'env-stops', type: 'circle', source: 'env-stops', minzoom: 11,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 5], 'circle-color': '#ffffff', 'circle-stroke-color': '#05070a', 'circle-stroke-width': 1.2 } });
  if(o.preset !== 'light') s.terrain = { source: 'dem', exaggeration: o.exag || 1 };
  s.light = sun.light;
  return s;
}
/* ==ENV-PURE-END== */

/* ==ENV-CORE-START== */
const ENV_KEY = 'irn_env';
var envMapGL = null, envBase = null, envOpenedAt = 0, envFrames = [], envLoadMs = null;
var envPrefs = (function(){ const v = lsJSON(ENV_KEY) || {}; return { preset: ENV_PRESETS.indexOf(v.preset) >= 0 ? v.preset : 'standard', exag: v.exag === 1.5 ? 1.5 : 1, hour: typeof v.hour === 'number' ? v.hour : null }; })();
function envSavePrefs(){ try{ localStorage.setItem(ENV_KEY, JSON.stringify(envPrefs)); }catch(e){} }
/* the time the sun is shown for: now, or the hour on the slider (today) */
function envSunNow(){
  const c = envMapGL ? envMapGL.getCenter() : map.getCenter(), lat = c.lat, lng = c.lng;
  let ms = Date.now();
  if(envPrefs.hour !== null){ const d = new Date(); d.setHours(Math.floor(envPrefs.hour), Math.round((envPrefs.hour % 1) * 60), 0, 0); ms = d.getTime(); }
  return envSunPosition(ms, lat, lng);
}
function envStopsFC(){
  return { type: 'FeatureCollection', features: (typeof stationList !== 'undefined' ? stationList : []).map(r => ({ type: 'Feature', properties: { n: r.name },
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] } })) };
}
/* the planned route on the main map, if one is shown, as GeoJSON */
function envRouteFC(){
  const features = [];
  try{ routeLayer.eachLayer(l => { if(!l.getLatLngs) return; const ll = l.getLatLngs().flat(2); if(ll.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ll.map(p => [p.lng, p.lat]) } }); }); }catch(e){}
  return { type: 'FeatureCollection', features: features };
}
function envOpen(){
  if(envMapGL || typeof maplibregl === 'undefined') { envRenderCard(); return; }
  const box = document.getElementById('envMap'); if(!box) return;
  /* one heavy map at a time: the main basemap's two GL maps come off, the train animation pauses */
  envBase = curBase;
  try{ map.removeLayer(curBase); }catch(e){}
  animOn = false; if(animRaf) cancelAnimationFrame(animRaf);
  box.hidden = false; document.body.classList.add('env-on');
  const c = map.getCenter(), tone = mapTone();
  const style = envStyle(vecStyle(tone, lang, VEC_GLYPHS_ABS), { preset: envPrefs.preset, exag: envPrefs.exag, tone: tone,
    lines: envLinesFC(liveLines), stops: envStopsFC(), route: envRouteFC(), sun: envSunPosition(Date.now(), c.lat, c.lng) });
  envOpenedAt = performance.now(); envLoadMs = null; envFrames = [];
  envMapGL = new maplibregl.Map({ container: box, style: style, center: [c.lng, c.lat], zoom: Math.max(0, map.getZoom() - 1),
    pitch: envPrefs.preset === 'light' ? 0 : 55, bearing: -(typeof map.getRotation === 'function' ? map.getRotation() : 0), maxPitch: 75,
    attributionControl: { compact: true }, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
  envMapGL.once('load', () => { envLoadMs = Math.round(performance.now() - envOpenedAt); envApplySun(); envRenderCard(); });
  envMapGL.on('render', () => { const now = performance.now(); envFrames.push(now); while(envFrames.length && now - envFrames[0] > 2000) envFrames.shift(); });
  envMapGL.on('error', e => { if(e && (e.sourceId === 'dem' || e.sourceId === 'dem-hs')) envNoNet(true); });
  envMapGL.on('click', 'env-building-3d', e => {
    const f = e.features && e.features[0]; if(!f) return;
    const i = envBuildingInfo(f.properties.render_height);
    new maplibregl.Popup({ closeButton: false, className: 'env-pop' }).setLngLat(e.lngLat).setText(t(i.key).replace('{n}', i.n)).addTo(envMapGL);
  });
  envNoNet(navigator.onLine === false);
  envRenderCard();
}
function envClose(){
  if(!envMapGL) return;
  try{ envMapGL.remove(); }catch(e){}
  envMapGL = null;
  const box = document.getElementById('envMap'); if(box){ box.hidden = true; box.innerHTML = ''; }
  document.body.classList.remove('env-on');
  if(envBase && !map.hasLayer(envBase)){ envBase.addTo(map); if(envBase.bringToBack) envBase.bringToBack(); }
  envBase = null;
  captureEnd();                                  // the train animation runs again
}
function envNoNet(on){ const n = document.getElementById('envNoNet'); if(n) n.hidden = !on; }
function envApplySun(){
  if(!envMapGL || !envMapGL.isStyleLoaded()) return;
  const L = envLight(envSunNow());
  try{
    envMapGL.setPaintProperty('env-hillshade', 'hillshade-illumination-direction', L.hillshadeDir);
    envMapGL.setPaintProperty('env-hillshade', 'hillshade-exaggeration', L.hillshadeExag);
    envMapGL.setLight(L.light);
  }catch(e){}
}
function envApplyPreset(){
  if(!envMapGL) return;
  const full = envPrefs.preset === 'full', light = envPrefs.preset === 'light';
  try{
    envMapGL.setTerrain(light ? null : { source: 'dem', exaggeration: envPrefs.exag });
    envMapGL.setLayoutProperty('env-building-3d', 'visibility', full ? 'visible' : 'none');
    if(envMapGL.getLayer('building')) envMapGL.setLayoutProperty('building', 'visibility', full ? 'none' : 'visible');
    envMapGL.easeTo({ pitch: light ? 0 : Math.max(envMapGL.getPitch(), 45), duration: 600 });
  }catch(e){}
}
/* a row of choice buttons in the card */
function envSeg(name, items, on){
  return '<div class="seg" data-envseg="' + name + '">' + items.map(it =>
    '<button type="button" data-v="' + attrEsc(String(it[0])) + '"' + (on(it[0]) ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"') + '>' + svgEsc(it[1]) + '</button>').join('') + '</div>';
}
/* the speed readout, so it can be measured on the owner's phone without cables: how long the view took to open, and frames drawn per
   second over the last 2 s (MapLibre draws only while something moves, so it reads highest while the map is being moved) */
function envPerfText(){
  const n = envFrames.length, fps = n > 1 ? Math.round((n - 1) / (((envFrames[n - 1] - envFrames[0]) / 1000) || 1)) : null;
  return t('envPerf').replace('{ms}', envLoadMs === null ? '…' : (envLoadMs / 1000).toFixed(1)).replace('{fps}', fps === null ? '…' : String(fps));
}
function envRenderCard(){
  const box = document.getElementById('envBody'); if(!box) return;
  const h = envPrefs.hour, hh = h === null ? null : String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
  box.innerHTML =
    envSeg('preset', [['light', t('envLight')], ['standard', t('envStandard')], ['full', t('envFull')]], v => v === envPrefs.preset)
    + '<div class="env-row"><span>' + svgEsc(t('envRelief')) + '</span>' + envSeg('exag', [[1, '1×'], [1.5, '1.5×']], v => v === envPrefs.exag) + '</div>'
    + (envPrefs.exag === 1.5 ? '<div class="env-badge">' + svgEsc(t('envExag')) + '</div>' : '')
    + '<div class="env-row"><span>' + svgEsc(t('envSun')) + ' <b>' + svgEsc(hh || t('envSunNow')) + '</b></span>'
    + '<button type="button" class="mini" data-envnow' + (h === null ? ' disabled' : '') + '>' + svgEsc(t('envSunNow')) + '</button></div>'
    + '<input type="range" id="envHour" min="0" max="23.75" step="0.25" value="' + (h === null ? new Date().getHours() + new Date().getMinutes() / 60 : h) + '" aria-label="' + attrEsc(t('envSun')) + '">'
    + '<div class="sp-hint" id="envNoNet" hidden>' + svgEsc(t('envNoNet')) + '</div>'
    + '<div class="sp-hint env-perf">' + svgEsc(envPerfText()) + '</div>'
    + '<div class="sp-hint">' + svgEsc(t('envCreditNote')) + '</div>'
    + '<details class="env-credit"><summary>Terrain credit</summary><small>' + svgEsc(ENV_CREDIT) + '</small></details>';
  envNoNet(navigator.onLine === false);
}
(function(){
  const card = document.getElementById('cardEnv'); if(!card) return;
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-envseg] button');
    if(b){
      const name = b.parentElement.dataset.envseg, v = b.dataset.v;
      if(name === 'preset'){ envPrefs.preset = v; envApplyPreset(); }
      if(name === 'exag'){ envPrefs.exag = +v; if(envMapGL && envPrefs.preset !== 'light') try{ envMapGL.setTerrain({ source: 'dem', exaggeration: envPrefs.exag }); }catch(err){} }
      envSavePrefs(); envRenderCard(); return;
    }
    if(e.target.closest('[data-envnow]')){ envPrefs.hour = null; envSavePrefs(); envApplySun(); envRenderCard(); }
  });
  card.addEventListener('input', e => {
    if(e.target.id !== 'envHour') return;
    envPrefs.hour = +e.target.value; envSavePrefs(); envApplySun();
    const lbl = card.querySelector('.env-row b'); if(lbl){ const h = envPrefs.hour; lbl.textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0'); }
  });
  setInterval(() => { if(envMapGL && !document.hidden){ if(envPrefs.hour === null) envApplySun(); const p = card.querySelector('.env-perf'); if(p) p.textContent = envPerfText(); } }, 2000);
  window.addEventListener('online', () => envNoNet(false)); window.addEventListener('offline', () => envNoNet(true));
})();
/* ==ENV-CORE-END== */
