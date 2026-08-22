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
  DISRUPTIONS.forEach(d=>{
    const col = SEV_COLOR[d.severity] || SEV_COLOR.major;
    const line = lineByRef[d.ref];
    // "out of service" section — clean solid caution band: a red outline (casing) with a
    // yellow infill and a thin dark centre-seam so it reads as a crisp boxed hazard line.
    // Static, no dots / animation. The ⚠ signage plate marks the affected stations.
    const bands = disruptionPaths(d).filter(c=>c && c.length>=2);
    bands.forEach(coords=>{
      const base = (line && KIND[line.kind] && KIND[line.kind].weight) || 4;
      const gw = Math.max(3, (base+1.4) * lineScale(z));
      const red    = L.polyline(coords, { renderer:hazardRenderer, color:'#D42A2A', weight:gw+3.4,
                              opacity:0.97, lineCap:'round', lineJoin:'round', interactive:false });   // red outline
      const yellow = L.polyline(coords, { renderer:hazardRenderer, color:'#F5C518', weight:gw,
                              opacity:1, lineCap:'round', lineJoin:'round' });                          // yellow infill
      const seam   = L.polyline(coords, { renderer:hazardRenderer, color:'#7a5c00', weight:Math.max(1,gw*0.18),
                              opacity:0.55, lineCap:'round', lineJoin:'round', interactive:false });    // subtle centre seam
      yellow.bindTooltip(disrTip(d), { sticky:true, className:'lt' });
      yellow.on('click', ()=> openDisruption(d));
      red.addTo(disruptionLayer); yellow.addTo(disruptionLayer); seam.addTo(disruptionLayer);
    });
    // warning marker(s): fixed screen size, gently smaller when zoomed out
    disruptionPoints(d).forEach(p=>{
      // A line-wide or sectional fault glows through its caution band. A fault we can only
      // pin to a single station has no band, so it would sit there as a flat signpost while
      // its neighbours pulse. Give it a halo instead — visible, without inventing a length.
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
}
map.on('zoomend', renderDisruptionMarkers);   // re-size grey overlays + warnings on zoom
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
  document.getElementById('annCount').textContent = DISRUPTIONS.length + ops.length;
  const rows = DISRUPTIONS.map(d=>{
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
  body.innerHTML = (DISRUPTIONS.length ? rows : `<div class="ann-none">${t('annNone')}</div>`)
    + (opRows ? `<div class="ann-sub">🚈 ${t('openHdr')}</div>${opRows}<div class="ann-note">${t('openFoot')}</div>` : '')
    + `<div class="ann-foot">${t('annFoot')} <a href="https://www.metro.istanbul/SeferDurumlari/SeferDetaylari" target="_blank" rel="noopener">metro.istanbul ↗</a>
       · <a href="https://github.com/Hero4mohamed/Metro-Istanbul-General-City-Map/issues/new" target="_blank" rel="noopener">🐞 ${t('reportProblem')}</a></div>`;
  body.querySelectorAll('.ann-item[data-id]').forEach(el => el.addEventListener('click', ()=>{
    const d = DISRUPTIONS.find(x=>x.id===el.dataset.id); if(d) openDisruption(d);
  }));
  body.querySelectorAll('.ann-open').forEach(el => el.addEventListener('click', ()=>{
    const o = ops[+el.dataset.open]; if(o) openOpening(o);
  }));
}
document.getElementById('annHead').addEventListener('click', ()=>
  document.getElementById('announce').classList.toggle('collapsed'));

