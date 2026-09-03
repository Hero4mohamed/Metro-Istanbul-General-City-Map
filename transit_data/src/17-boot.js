/* ===========================================================================
   9. BOOT + MAIN LOOP
   =========================================================================== */
let last=performance.now(), boardAcc=0, animOn=true, animRaf=0;
function frame(now){
  let dt=(now-last)/1000; last=now; if(dt>0.1) dt=0.1;
  updateTrains(dt);
  const target = map.getZoom()>=13 ? 1 : 0;          // fade labels in past z13
  labelAlpha += (target-labelAlpha)*Math.min(1, dt*5);
  renderOverlay(now);
  boardAcc+=dt; if(boardAcc>0.25){ if(selected) renderBoard(); boardAcc=0; }
  if(animOn) animRaf=requestAnimationFrame(frame);   // pausable so the page can reach idle for capture
}
/* ---- capture mode: freeze the animation + settle tiles so headless screenshots are stable.
   Inert until called. Usage (e.g. from automation): await captureReady({w,h,center,zoom}); then screenshot; captureEnd(); ---- */
function captureReady(opts){
  opts = opts || {};
  const w = opts.w||1200, h = opts.h||820;
  document.documentElement.style.width = document.body.style.width = w+'px';
  document.documentElement.style.height = document.body.style.height = h+'px';
  const mc = document.getElementById('map');
  mc.style.cssText = 'position:absolute;top:0;left:0;width:'+w+'px;height:'+h+'px';
  map.invalidateSize(true);
  if(opts.center && opts.zoom!=null) map.setView(opts.center, opts.zoom, {animate:false});
  else if(opts.zoom!=null) map.setZoom(opts.zoom, {animate:false});
  animOn = false; if(animRaf) cancelAnimationFrame(animRaf);   // stop the perpetual rAF loop → page can go idle
  renderOverlay(performance.now());                           // paint one last static frame
  return new Promise(res=>{
    let settled=false; const done=v=>{ if(!settled){ settled=true; res({ok:true, via:v, size:[map.getSize().x, map.getSize().y]}); } };
    if(curBase && curBase.once) curBase.once('load', ()=>setTimeout(()=>done('tileload'),120));   // fires when fresh tiles finish
    setTimeout(()=>done('idle'),   opts.settle||650);          // cached tiles paint fast
    setTimeout(()=>done('timeout'),opts.timeout||7000);        // hard cap
  });
}
function captureEnd(){ if(!animOn){ animOn=true; last=performance.now(); animRaf=requestAnimationFrame(frame); } return true; }
/* ---- Announcements: live disruptions (faults / closures) + map warning markers ---- */
const SEV_COLOR = { major:'#E5484D', partial:'#F5A623', minor:'#FFD400' };
const SEV_LABEL = { major:'Major', partial:'Partial', minor:'Minor' };
const disruptionLayer = L.layerGroup().addTo(map);   // shown on the Active tab only (setTab manages it)
const hazardRenderer = L.svg({ padding:0.5 });       // SVG so the dash animation (CSS) works
// affected coord path(s) to grey-out: a segment between two stations, or the whole line
function disruptionPaths(d){
  const line = lineByRef[d.ref]; if(!line) return [];
  if(d.scope==='segment' && d.from && d.to){
    const a = line.stations.find(s=>fold(s.name)===fold(d.from));
    const b = line.stations.find(s=>fold(s.name)===fold(d.to));
    if(a && b && a._s!=null && b._s!=null) return [ subPath(line, a._s, b._s) ];
  }
  if(d.scope==='line' && line.coords) return [ line.coords ];
  return [];
}
function disruptionPoints(d){
  const line = lineByRef[d.ref]; const pts = [];
  if(d.scope==='stations' && d.stations && line){
    d.stations.forEach(nm=>{ const st=line.stations.find(s=>fold(s.name)===fold(nm))||stationList.find(c=>fold(c.name)===fold(nm)); if(st) pts.push([st.lat,st.lng]); });
  } else if(d.scope==='segment' && d.from && d.to && line &&
            fold(d.from)===fold(d.to)){
    // Only ONE station could be identified, so there is no section to band. Mark that
    // station — the old code fell through and dropped the ⚠ at the line's midpoint, which
    // pointed at a stretch of track that was never affected.
    const st = line.stations.find(s=>fold(s.name)===fold(d.from)) ||
               stationList.find(c=>fold(c.name)===fold(d.from));
    if(st) pts.push([st.lat,st.lng]);
  } else {
    const paths = disruptionPaths(d);
    if(paths.length && paths[0].length) { const c=paths[0]; pts.push(c[Math.floor(c.length/2)]); }
    else if(line && line.coords && line.coords.length) pts.push(line.coords[Math.floor(line.coords.length/2)]);
  }
  return pts;
}
function disrTip(d){
  return `<b>⚠ ${d.ref?d.ref+' · ':''}${disTitle(d)}</b><br>${disTrTag(d)}${disMsg(d)}${d.until?'<br>⏱ '+untilText(d):''}`;
}
function openDisruption(d){
  const pts = disruptionPoints(d);
  if(pts.length) map.flyTo(pts[0], Math.max(map.getZoom(),13), { duration:0.6 });
}
function renderDisruptionMarkers(){
  disruptionLayer.clearLayers();
  const z = map.getZoom();
  const isz = Math.round(22 * Math.max(0.6, markerScale(z)));   // ⚠ shrinks a bit when zoomed out
  activeDisruptions().forEach(d=>{
    const col = SEV_COLOR[d.severity] || SEV_COLOR.major;
    const line = lineByRef[d.ref];
    /* The affected stretch is MARKED, not replaced. The old overlay was a red-cased yellow
       caution band 8.1px over a 3.5px line — 2.3x its width, fully opaque — so a disrupted B2
       stopped being blue and started being an orange line that matched nothing in the legend.
       You could see that something was wrong and no longer see what it was wrong on.
       So: a soft wash to give the section presence at any zoom, and a dashed severity stripe
       down the centre at half the line's width, leaving its own colour showing either side.
       Dashed is already this map's word for "not in normal service" (planned lines use it).
       Thin lines are hard to hit, so an invisible wide polyline carries the tooltip. */
    /* A line suspended end to end is already dashed end to end (applyServiceStyling). Running a
       stripe down the whole of it as well would double the ink and answer a question nobody
       asked: "where" is the entire line. The stripe is for SECTIONS, where the extent is the
       information; the dash is for whether the line is running at all. */
    const suspended = d.scope === 'line' && d.severity === 'major';
    const bands = suspended ? [] : disruptionPaths(d).filter(c=>c && c.length>=2);
    bands.forEach(coords=>{
      const ls   = lineScale(z);
      const base = (line && KIND[line.kind] && KIND[line.kind].weight) || 4;
      const core = Math.max(1.2, base * ls);                    // the line's own drawn width here
      const sw   = Math.max(1.3, core * 0.5);                   // stripe: half of it, never hairline
      const dash = Math.max(1.6, 2.4*ls).toFixed(1) + ',' + Math.max(2.2, 3.2*ls).toFixed(1);
      const wash  = L.polyline(coords, { renderer:hazardRenderer, color:col, weight:core+5,
                              opacity:0.14, lineCap:'round', lineJoin:'round', interactive:false });
      const stripe= L.polyline(coords, { renderer:hazardRenderer, color:col, weight:sw,
                              opacity:0.95, lineCap:'butt', lineJoin:'round',
                              dashArray:dash, interactive:false });
      const hit   = L.polyline(coords, { renderer:hazardRenderer, color:col,
                              weight:Math.max(10, core+8), opacity:0, lineCap:'round' });
      hit.bindTooltip(disrTip(d), { sticky:true, className:'lt' });
      hit.on('click', ()=> openDisruption(d));
      wash.addTo(disruptionLayer); stripe.addTo(disruptionLayer); hit.addTo(disruptionLayer);
    });
    // warning marker(s): fixed screen size, gently smaller when zoomed out
    disruptionPoints(d).forEach(p=>{
      // A line-wide or sectional fault is marked along its stripe. A fault we can only pin to
      // a single station has no stripe, so it would sit there as a flat signpost with nothing
      // around it. Give it a halo instead — visible, without inventing a length.
      if(!bands.length){
        L.circleMarker(p, { renderer:hazardRenderer, className:'disr-halo',
          radius:Math.max(10, isz*0.62), color:col, weight:2, opacity:.9,
          fillColor:col, fillOpacity:.16, interactive:false }).addTo(disruptionLayer);
      }
      const icon = L.divIcon({ className:'warn-icon',
        html:`<span style="--wc:${col};width:${isz}px;height:${isz}px;font-size:${Math.round(isz*0.55)}px">⚠</span>`,
        iconSize:[isz,isz], iconAnchor:[isz/2,isz/2] });
      const mk = L.marker(p, { icon, zIndexOffset:2000 });
      mk.bindTooltip(disrTip(d), { className:'lt', direction:'top', offset:[0,-8] });
      mk.on('click', ()=> openDisruption(d));
      mk.addTo(disruptionLayer);
    });
  });
  applyServiceStyling();     // same refresh puts a suspended line's own styling back
}
/* The stripe says WHERE a line is affected. This says WHETHER it is running at all: a line the
   operator has suspended outright goes dashed — the map's own existing word for "not in normal
   service", which is how it already draws lines that have not opened yet. Nothing is added to
   the map and nothing is hidden, so it stays thin.

   The original dash is remembered per polyline and put back verbatim, so when `until` passes or
   the entry drops out of the feed the line returns to normal on the next refresh with no
   residue. dashArray is the one style property nothing else writes: weight belongs to
   applyZoomStyling, core opacity to the intercity dim and glow opacity to the experience
   preference, and taking any of those would have started a fight over the same value.

   Out-of-hours closures are deliberately NOT included. Service ending at midnight is the
   timetable working, not a fault, and dashing the whole network every night would spend the
   signal on nothing. */
const SUSP_DASH = '3,6';
function applyServiceStyling(){
  if(typeof linePolys === 'undefined') return;
  const susp = new Set();
  activeDisruptions().forEach(d=>{
    if(d.scope === 'line' && d.severity === 'major' && d.ref) susp.add(d.ref);
  });
  linePolys.forEach(o=>{
    if(o.glow) return;                                        // the halo keeps its own styling
    if(o._normDash === undefined) o._normDash = o.pl.options.dashArray || null;
    const want = susp.has(o.ref) ? SUSP_DASH : o._normDash;
    if((o.pl.options.dashArray || null) === (want || null)) return;
    o.pl.setStyle({ dashArray: want });
    o.pl.redraw();          // canvas only repaints on its own when the weight changes
  });
}
map.on('zoomend', renderDisruptionMarkers);   // re-size overlays + warnings on zoom
function untilText(d){
  if(!d.until) return '';
  const days = Math.ceil((Date.parse(d.until+'T23:59:59') - Date.now())/86400000);
  const rel = days>0 ? ` · ${days} ${t('daysLeft')}` : (days===0?' · '+t('endsToday'):' · '+t('ended'));
  return t('until') + ' ' + fmtLaunch(d.until) + rel;
}
// upcoming line openings: keep visible until ~3 days past the projected date, soonest first
function openIso(o){ return o.open.length===7 ? o.open+'-01' : o.open; }
function upcomingOpenings(){
  const now = Date.now();
  return OPENINGS.filter(o => Date.parse(openIso(o)+'T00:00:00') > now - 3*86400000)
                 .sort((a,b) => openIso(a) < openIso(b) ? -1 : 1);
}
function opensRel(o){
  const days = Math.ceil((Date.parse(openIso(o)+'T00:00:00') - Date.now())/86400000);
  if(days<=0) return '';
  if(days>=60) return t('inMonths').replace('{n}', Math.round(days/30));
  if(days>=14) return t('inWeeks').replace('{n}', Math.round(days/7));
  return t('inDays').replace('{n}', Math.max(1,days));
}
function openOpening(o){
  setTab('vision');                                   // upcoming lines live on the Vision map
  const line = lineByRef[o.ref];
  if(line) openLine(line);                             // focus it if we already draw it (M12/M10…)
}
function renderAnnouncements(){
  const ops = upcomingOpenings();
  // the same list the map marks: a fault whose `until` has passed is over, and a badge counting
  // it kept sending people to an entry that read "ended" and to a line that was running fine
  const live = activeDisruptions();
  document.getElementById('annCount').textContent = live.length + ops.length;
  const rows = live.map(d=>{
    const col = SEV_COLOR[d.severity] || SEV_COLOR.major;
    return `<div class="ann-item" data-id="${d.id}" style="border-left-color:${col};cursor:pointer">
      <div class="ann-row1">
        <span class="ann-line" style="background:${colorForLine(d.ref)}">${d.ref||'📣'}</span>
        <span class="ann-sev" style="background:${col}">${sevLabel(d.severity)}</span>
        <span class="ann-ttl">${disTitle(d)}</span>
      </div>
      <div class="ann-msg">${disTrTag(d)}${disMsg(d)}</div>
      ${d.until?`<div class="ann-until">⏱ ${untilText(d)}</div>`:''}</div>`;
  }).join('');
  const opRows = ops.map((o,i)=>{
    const col = o.color || colorForLine(o.ref);
    const rel = opensRel(o);
    return `<div class="ann-item ann-open" data-open="${i}">
      <div class="ann-row1">
        <span class="ann-line" style="background:${col}">${o.ref}</span>
        <span class="ann-sev ann-soon">${t('openSoon')}</span>
        <span class="ann-ttl">🚈 ${t('openTtl')}</span>
      </div>
      <div class="ann-msg">${o.name} · ${o.km} ${t('kmU')} · ${o.stations} ${t('stnU')}</div>
      <div class="ann-until">🗓 ${t('opensOn')} ${o.disp}${rel?' · '+rel:''}</div></div>`;
  }).join('');
  const body = document.getElementById('annBody');
  body.innerHTML = (live.length ? rows : `<div class="ann-none">${t('annNone')}</div>`)
    + (opRows ? `<div class="ann-sub">🚈 ${t('openHdr')}</div>${opRows}<div class="ann-note">${t('openFoot')}</div>` : '')
    + `<div class="ann-foot">${t('annFoot')} <a href="https://www.metro.istanbul/SeferDurumlari/SeferDetaylari" target="_blank" rel="noopener">metro.istanbul ↗</a>
       · <a href="https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map/issues/new" target="_blank" rel="noopener">🐞 ${t('reportProblem')}</a></div>`;
  body.querySelectorAll('.ann-item[data-id]').forEach(el => el.addEventListener('click', ()=>{
    const d = live.find(x=>x.id===el.dataset.id); if(d) openDisruption(d);
  }));
  body.querySelectorAll('.ann-open').forEach(el => el.addEventListener('click', ()=>{
    const o = ops[+el.dataset.open]; if(o) openOpening(o);
  }));
}
document.getElementById('annHead').addEventListener('click', ()=>
  document.getElementById('announce').classList.toggle('collapsed'));

/* ---- Putting the network back online -------------------------------------------------------
   Faults end in two ways, and neither of them was reaching the map.

   The feed is fetched once, at boot. An `until` date that passes while the page is open changed
   nothing: the stripe, the dashed line and the announcement all outlived the fault, and a page
   left open overnight kept showing a closure that had lifted hours earlier.

   And lineHours() memoises whether a line is suspended. Its own comment says the memo is
   "invalidated by clearTimingMemo() when the disruption feed refreshes" — but nothing ever
   called clearTimingMemo, in either direction. The router, the arrivals board and the carriage
   sim answered from the boot-time feed for the life of the tab: a new suspension was routed
   straight through, and a lifted one stayed unroutable.

   So derive the whole thing from one signature of the active set, on the cadence the closure
   cache already runs at. No fetch, no clock arithmetic scattered around — when the set changes,
   for whatever reason, everything that depends on it is rebuilt. */
function disrSignature(){ return activeDisruptions().map(d => d.id+':'+d.scope+':'+d.severity).join('|'); }
let _disrSig = disrSignature();
function applyDisruptionFeed(){
  _disrSig = disrSignature();
  clearTimingMemo();              // the suspension answer the router and the sim cache
  refreshClosed();
  renderAnnouncements();
  renderDisruptionMarkers();      // marking, warning pins, and the suspended line's own dash
}
setInterval(()=>{ if(disrSignature() !== _disrSig) applyDisruptionFeed(); }, 30000);

/* Named entry points for the browser smoke suite, in the same spirit as simCars() and
   busDirs(): the page's state lives in script-scoped const/let bindings, which are NOT
   properties of window, and the CSP rules out eval — so anything a test needs to reach has to
   be published on purpose. This one reports what is actually DRAWN, in pixels, because the
   width of the marking relative to the line under it was the whole defect. Called with no ref
   it names a line worth testing, so the suite does not hard-code one that may be withdrawn. */
function disruptionProbe(ref){
  if(!ref){
    const l = (typeof liveLines !== 'undefined' ? liveLines : [])
      .find(x => x.coords && x.coords.length > 1 && (x.stations||[]).length >= 3);
    return l ? { ref:l.ref, from:l.stations[0].name, to:l.stations[l.stations.length-1].name } : null;
  }
  const core = linePolys.filter(p => p.ref === ref && !p.glow)[0];
  const marks = [];
  disruptionLayer.eachLayer(l => {
    if(l.options && l.options.weight != null && l.options.opacity > 0.5) marks.push(l.options.weight);
  });
  return { lineWeight: core ? core.pl.options.weight : null,
           lineDash:   core ? (core.pl.options.dashArray || null) : null,
           marks, suspended:[...suspendedRefs()], active:activeDisruptions().map(d=>d.id) };
}
// Swap the feed and re-derive everything from it. Client-side only and gone on reload — the
// same kind of hook updateTrains() already is, and the only way to test a fault the city is
// not currently having.
function setDisruptions(list){
  if(Array.isArray(list)){ DISRUPTIONS = list; applyDisruptionFeed(); }
  return DISRUPTIONS.length;
}

