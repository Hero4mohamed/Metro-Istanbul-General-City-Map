/* ===========================================================================
   INTERCITY RAIL (TCDD) — national YHT + Ana Hat services on their own tab.
   Separate scope from the İstanbul network: own station layer, own list card,
   own map framing. Fares/times are curated published figures (see the card
   footer for the tariff date) and every row links out to TCDD for live booking.
   =========================================================================== */
let icReturn = null, icListBuilt = false, icMode = 'all', icSelected = null;
const intercityStationGroup = L.layerGroup();
const intercityHi = L.layerGroup();                          // bold overlay for the selected route
intercityLines.forEach(line => line.stations.forEach(st => {
  L.circleMarker([st.lat, st.lng], { renderer:lineRenderer, radius:3.4, color:line.color,
      weight:1.6, fillColor:'#0b0f16', fillOpacity:1 })
    .bindTooltip(`${svgEsc(st.name)} · ${svgEsc(line.ref)}`, { className:'lt', direction:'top' })
    .on('click', ()=> openLine(line))
    .addTo(intercityStationGroup);
}));
function fitIntercity(lines){
  const src = (lines && lines.length) ? lines : intercityLines;
  const pts = [];
  src.forEach(l => l.paths.forEach(p => { for(let i=0;i<p.length;i+=Math.max(1,(p.length/12|0))) pts.push(p[i]); pts.push(p[p.length-1]); }));
  if(pts.length) map.fitBounds(L.latLngBounds(pts).pad(src===intercityLines?0.05:0.14), { animate:false });
}
function icDur(m){
  if(m==null) return '—';
  const h=Math.floor(m/60), mm=m%60;
  return h ? (h+'h'+(mm?' '+mm+'m':'')) : mm+'m';
}
// dim (or restore) all base intercity lines + station dots so the selected route stands out —
// the same clarity the metro tab gets. Opacity only (weight stays owned by applyZoomStyling).
function dimIntercityBase(dim){
  intercityLines.forEach(l => {
    const g = lineLayers[l.ref] && lineLayers[l.ref].group; if(!g) return;
    g.eachLayer(pl => { if(!pl.setStyle) return;
      if(pl._baseOp==null) pl._baseOp = pl.options.opacity;
      pl.setStyle({ opacity: dim ? Math.min(pl._baseOp, 0.1) : pl._baseOp }); });
  });
  intercityStationGroup.eachLayer(m => { if(m.setStyle) m.setStyle({ opacity: dim?0.1:1, fillOpacity: dim?0.1:1 }); });
}
// the two termini = farthest-apart station pair (member order can start mid-route on sleepers)
function routeTermini(l){
  const s = l.stations; if(s.length < 2) return s.slice();
  let a=0, b=1, best=-1;
  for(let i=0;i<s.length;i++) for(let j=i+1;j<s.length;j++){
    const d=(s[i].lat-s[j].lat)**2+(s[i].lng-s[j].lng)**2; if(d>best){ best=d; a=i; b=j; } }
  return [s[a], s[b]];
}
// terminus CITY names come from the route's official title ("… · İstanbul – Bükreş"), positioned
// at the geographic extremes — so labels read the advertised termini, not an intermediate stop
function routeEndpoints(l){
  const parts = (l.official.split('·').pop()||'').split(/[–—-]/).map(s=>s.trim()).filter(Boolean);
  const term = routeTermini(l);
  const cityA = parts[0] || (term[0]&&term[0].name) || '';
  const cityB = parts[1] || (term[1]&&term[1].name) || '';
  const hit = (city,st) => { const f=fold(city), n=st?fold(st.name):''; return f&&n&&(n.includes(f)||f.includes(n)); };
  let pA = term.find(s=>hit(cityA,s)), pB = term.find(s=>hit(cityB,s));
  const H=[41.0184,28.7663], dist=s=>metersBetween([s.lat,s.lng],H);
  if(!pA && !pB){ const near = dist(term[0])<=dist(term[1])?term[0]:term[1];   // cityA is usually the origin
    pA = near; pB = near===term[0]?term[1]:term[0]; }
  else { if(!pA) pA = term.find(s=>s!==pB)||term[0]; if(!pB) pB = term.find(s=>s!==pA)||term[1]; }
  return [{city:cityA, st:pA}, {city:cityB, st:pB}];
}
// select a route → highlight it boldly on the map (glow+core), label its two termini,
// dim the rest, frame it, and open its detail panel. Passing null shows all routes again.
function selectIntercity(l, openPanel){
  intercityHi.clearLayers();
  if(!l){ icSelected=null; dimIntercityBase(false); if(map.hasLayer(intercityHi)) map.removeLayer(intercityHi);
    renderIntercityList(); fitIntercity(); return; }
  icSelected = l.ref;
  dimIntercityBase(true);
  l.paths.forEach(p => {
    L.polyline(p, { renderer:lineRenderer, color:l.color, weight:11, opacity:0.22, lineCap:'round', lineJoin:'round', interactive:false }).addTo(intercityHi);
    L.polyline(p, { renderer:lineRenderer, color:l.color, weight:4.5, opacity:1, lineCap:'round', lineJoin:'round' })
      .bindTooltip(l.official, { sticky:true, className:'lt' }).on('click', ()=> openLine(l)).addTo(intercityHi);
  });
  l.stations.forEach(st => L.circleMarker([st.lat, st.lng], { renderer:lineRenderer, radius:4, color:l.color,
      weight:2, fillColor:'#080c14', fillOpacity:1 })
      .bindTooltip(svgEsc(st.name), { direction:'top', className:'lt' }).addTo(intercityHi));
  // labelled terminus markers: the route's advertised city names at the two geographic extremes.
  // Label pushed outward (west→left, east→right); flag on the end farther from İstanbul (the
  // foreign destination on int'l routes) so it never sits over the line.
  const ends = routeEndpoints(l), HALK = [41.0184, 28.7663];
  ends.forEach((e, idx) => { const st = e.st, other = (ends[1-idx]||e).st; if(!st||!other) return;
    const dir = st.lng <= other.lng ? 'left' : 'right';
    const foreign = l.intl && metersBetween([st.lat,st.lng],HALK) > metersBetween([other.lat,other.lng],HALK);
    const flag = (foreign && l.flag) ? l.flag+' ' : '';
    L.circleMarker([st.lat, st.lng], { renderer:lineRenderer, radius:6.5, color:l.color, weight:3, fillColor:'#fff', fillOpacity:1 })
      .bindTooltip(`${flag}${svgEsc(e.city)}`, { permanent:true, direction:dir, className:'ic-lbl' }).addTo(intercityHi); });
  intercityHi.addTo(map);
  fitIntercity([l]);
  renderIntercityList();
  if(openPanel!==false) openLine(l);
}
function icRows(){
  return intercityLines.filter(l => icMode==='all' ? true
        : icMode==='yht'  ? l.mode==='yht'
        : icMode==='intl' ? l.mode==='intl'
        : (l.mode==='mainline' || l.mode==='regional'));   // 'anahat' = domestic long-distance + regional
}
function modeBadge(l){
  if(l.mode==='yht') return `<span class="ic-mode yht">YHT</span>`;
  if(l.mode==='intl') return `<span class="ic-mode intl">${t('icIntl')}</span>`;
  if(l.mode==='regional') return `<span class="ic-mode">${t('icRegional')}</span>`;
  return `<span class="ic-mode">Ana Hat</span>`;
}
function renderIntercityList(){
  const el = document.getElementById('icList'); if(!el) return;
  const rows = icRows();
  const showAll = icSelected
    ? `<button class="ic-all" id="icShowAll">↺ ${t('icShowAll')}</button>` : '';
  el.innerHTML = showAll + (rows.map((l,i)=>{
    const ends = l.official.split('·').pop().trim();
    const bits = [];
    if(l.mins)  bits.push(`<span class="ic-b">⏱ ${icDur(l.mins)}</span>`);
    if(l.fare)  bits.push(`<span class="ic-b ic-fare">🎫 ${l.fare} ₺</span>`);
    if(l.daily) bits.push(`<span class="ic-b">${l.daily}×/${t('icPerDay')}</span>`);
    if(l.km)    bits.push(`<span class="ic-b">${distNum(l.km).toFixed(0)} ${distUnit()}</span>`);
    if(l.sleeper) bits.push(`<span class="ic-b">🌙 ${t('icSleeper')}</span>`);
    if(l.border) bits.push(`<span class="ic-b ic-border">🛂 ${svgEsc(l.border)}</span>`);
    const when = (l.first) ? `<div class="ic-when">🕑 ${l.first}${l.last?' – '+l.last:' '+t('icDep')}</div>` : '';
    const appx = l.approx ? `<div class="ic-appx">⚠ ${t('icApprox')}</div>` : '';
    return `<div class="ic-row${icSelected===l.ref?' sel':''}" data-i="${i}">
      <div class="ic-head"><span class="ic-dot" style="background:${l.color}"></span>
        <span class="ic-nm">${l.flag?l.flag+' ':''}${svgEsc(ends)}</span>${modeBadge(l)}</div>
      <div class="ic-bits">${bits.join('')}</div>${when}${appx}
      <div class="ic-stops">${l.stations.length} ${t('stationsLower')} · ${svgEsc(l.operator)}</div></div>`;
  }).join('') || `<div class="none">${t('noLines')}</div>`);
  const sa = document.getElementById('icShowAll'); if(sa) sa.addEventListener('click', ()=> selectIntercity(null));
  el.querySelectorAll('.ic-row').forEach(r => r.addEventListener('click', ()=>{
    const l = rows[+r.dataset.i]; if(l) selectIntercity(l);
  }));
}
document.getElementById('icModeSeg').addEventListener('click', e=>{
  const b = e.target.closest('button[data-icm]'); if(!b) return;
  icMode = b.dataset.icm;
  document.querySelectorAll('#icModeSeg button').forEach(x=>x.classList.toggle('active', x===b));
  renderIntercityList();
});

/* ---- Weather & time per belediye (39 ilçe) — Open-Meteo, keyless + CORS-open ---- */
const DISTRICTS = CITY.districts || [
  ['Adalar',40.8760,29.0891],['Arnavutköy',41.1840,28.7400],['Ataşehir',40.9923,29.1274],
  ['Avcılar',40.9800,28.7170],['Bağcılar',41.0340,28.8560],['Bahçelievler',41.0020,28.8600],
  ['Bakırköy',40.9820,28.8720],['Başakşehir',41.0930,28.8020],['Bayrampaşa',41.0460,28.9020],
  ['Beşiktaş',41.0430,29.0090],['Beykoz',41.1340,29.0920],['Beylikdüzü',41.0010,28.6420],
  ['Beyoğlu',41.0370,28.9770],['Büyükçekmece',41.0200,28.5850],['Çatalca',41.1430,28.4610],
  ['Çekmeköy',41.0360,29.1770],['Esenler',41.0430,28.8760],['Esenyurt',41.0340,28.6800],
  ['Eyüpsultan',41.0480,28.9340],['Fatih',41.0190,28.9400],['Gaziosmanpaşa',41.0580,28.9120],
  ['Güngören',41.0190,28.8820],['Kadıköy',40.9900,29.0300],['Kağıthane',41.0860,28.9710],
  ['Kartal',40.9060,29.1900],['Küçükçekmece',40.9990,28.7760],['Maltepe',40.9350,29.1300],
  ['Pendik',40.8780,29.2510],['Sancaktepe',41.0020,29.2310],['Sarıyer',41.1670,29.0570],
  ['Silivri',41.0730,28.2460],['Sultanbeyli',40.9600,29.2710],['Sultangazi',41.1060,28.8680],
  ['Şile',41.1760,29.6130],['Şişli',41.0600,28.9870],['Tuzla',40.8160,29.3000],
  ['Ümraniye',41.0250,29.0960],['Üsküdar',41.0230,29.0150],['Zeytinburnu',40.9940,28.9050]
];
const weatherLayer = L.layerGroup();
let wxData=null, wxFetchedAt=0, wxLoading=false;
// WMO weather code → emoji + i18n label key
function wmo(code){
  if(code===0) return ['☀️','wx0']; if(code===1) return ['🌤️','wx1']; if(code===2) return ['⛅','wx2'];
  if(code===3) return ['☁️','wx3']; if(code===45||code===48) return ['🌫️','wx45'];
  if(code>=51&&code<=57) return ['🌦️','wx51']; if(code>=61&&code<=67) return ['🌧️','wx61'];
  if(code>=71&&code<=77) return ['🌨️','wx71']; if(code>=80&&code<=82) return ['🌧️','wx80'];
  if(code===85||code===86) return ['🌨️','wx71']; if(code>=95) return ['⛈️','wx95'];
  return ['🌡️','wx1'];
}
function ensureWeather(){
  if(wxData && Date.now()-wxFetchedAt < 10*60*1000){ renderWeather(); return; }
  fetchWeather();
}
async function fetchWeather(){
  if(wxLoading) return; wxLoading=true;
  const list=document.getElementById('wxList');
  if(!wxData) list.innerHTML=`<div class="none">${t('wxLoading')}</div>`;
  try{
    const lats=DISTRICTS.map(d=>d[1]).join(','), lngs=DISTRICTS.map(d=>d[2]).join(',');
    const u=`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}`+
            `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Europe%2FIstanbul`;
    const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    wxData=(Array.isArray(j)?j:[j]).map(x=>x.current);
    wxFetchedAt=Date.now();
    renderWeather();
  }catch(e){ if(!wxData) list.innerHTML=`<div class="none">${t('wxFail')}</div>`; }
  wxLoading=false;
}
function renderWeather(){
  if(!wxData) return;
  const list=document.getElementById('wxList');
  const q=fold(document.getElementById('wxSearch').value||'');
  const rows=DISTRICTS.map((d,i)=>({ name:d[0], lat:d[1], lng:d[2], c:wxData[i] }))
    .filter(x=>x.c && (!q || fold(x.name).includes(q)));
  list.innerHTML = rows.map(x=>{
    const [emo,key]=wmo(x.c.weather_code);
    return `<div class="wx-row" data-lat="${x.lat}" data-lng="${x.lng}">
      <span class="wx-emo">${emo}</span>
      <span class="wx-nm">${x.name}<small>${t(key)}</small></span>
      <span class="wx-t">${Math.round(x.c.temperature_2m)}°</span>
      <span class="wx-sub">💨 ${Math.round(x.c.wind_speed_10m)} km/h<br>💧 ${x.c.relative_humidity_2m}%</span></div>`;
  }).join('') || `<div class="none">${t('noLines')}</div>`;
  list.querySelectorAll('.wx-row').forEach(row=> row.addEventListener('click', ()=>
    map.flyTo([+row.dataset.lat, +row.dataset.lng], Math.max(map.getZoom(),12), {duration:.6})));
  const upd=document.getElementById('wxUpd');
  if(upd) upd.textContent = t('wxUpdated')+' '+new Intl.DateTimeFormat(LOCALE[lang]||'en-GB',
    timeOpts({hour:'2-digit',minute:'2-digit'})).format(new Date(wxFetchedAt));
  // map badges: temp + emoji at each district centre
  weatherLayer.clearLayers();
  DISTRICTS.forEach((d,i)=>{
    const c=wxData[i]; if(!c) return;
    const [emo,key]=wmo(c.weather_code);
    const icon=L.divIcon({ className:'wx-icon',
      html:`<div class="wx-badge">${emo} ${Math.round(c.temperature_2m)}°</div>`, iconSize:[54,20], iconAnchor:[27,10] });
    const mk=L.marker([d[1],d[2]],{icon, zIndexOffset:900});
    mk.bindTooltip(`<b>${d[0]}</b><br>${t(key)} · ${Math.round(c.temperature_2m)}°C<br>💨 ${Math.round(c.wind_speed_10m)} km/h · 💧 ${c.relative_humidity_2m}%`,
      {className:'lt', direction:'top', offset:[0,-8]});
    mk.addTo(weatherLayer);
  });
}
// live İstanbul clock (header of the weather card)
setInterval(()=>{
  const el=document.getElementById('wxClock'); if(!el || currentTab!=='weather') return;
  const now=new Date();
  el.textContent=new Intl.DateTimeFormat(LOCALE[lang]||'en-GB',
    timeOpts({hour:'2-digit',minute:'2-digit',second:'2-digit'})).format(now);
  const de=document.getElementById('wxDate');
  if(de) de.textContent=new Intl.DateTimeFormat(LOCALE[lang]||'en-GB',
    {timeZone:'Europe/Istanbul',weekday:'long',day:'numeric',month:'long'}).format(now);
}, 1000);

/* ---- Bus directory (855 İETT lines; geometry fetched from OSM on click) ---- */
function renderBusList(q){
  q = fold(q||'');
  let res = BUS_DIR;
  if(q){
    // build the searchable text once per route, not once per route per keystroke
    if(!BUS_DIR._indexed){
      BUS_DIR.forEach(d => { d._s = fold((d.ref||'')+' '+(d.from||'')+' '+(d.to||'')); });
      Object.defineProperty(BUS_DIR, "_indexed", { value:true });
    }
    res = BUS_DIR.filter(d => d._s.includes(q));
  }
  const shown = res.slice(0, 150);
  document.getElementById('busCount').innerHTML =
    svgEsc(res.length + ' ' + (res.length!==1?t('busLinesMany'):t('busLines')) +
           (res.length>shown.length ? ' · '+t('showingFirst')+' '+shown.length : '')) +
    /* Ankara and İzmir routes are community-mapped in OpenStreetMap, not an operator feed.
       Say so, rather than let a partial directory read as the whole network. */
    (CITY.busSource === 'osm'
      ? '<div class="sp-note" style="margin-top:5px">' + svgEsc(t('busOsmNote')) + '</div>' : '');
  document.getElementById('busList').innerHTML = shown.length
    ? shown.map(d => `<div class="bus-row" data-id="${d.id}" data-ref="${(d.ref||'').replace(/"/g,'&quot;')}">
        <span class="bn">${d.ref}</span><span class="br">${d.from} <small>↔</small> ${d.to}${d.op?` <small>· ${d.op}</small>`:''}</span></div>`).join('')
    : `<div class="none">${t('noLines')}</div>`;
  document.querySelectorAll('#busList .bus-row').forEach(row =>
    row.addEventListener('click', () => selectBus(row.dataset.id, row)));
}
// real OSM route geometry (per direction, road-following) for a line ref — cached; null if Overpass can't answer
let busSelToken = 0;
const busShapeCache = {};
async function busOsmShapes(ref){
  if(ref in busShapeCache) return busShapeCache[ref];
  await ensureBusGeom();
  if(BUS_GEOM && BUS_GEOM[ref]) return busShapeCache[ref]=[BUS_GEOM[ref]];   // baked road shape
  try{
    const q = `[out:json][timeout:60];relation[route="bus"]["ref"="${(ref||'').replace(/["\\]/g,'')}"];out geom;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:q });
    if(!resp.ok) throw 0;
    const data = await resp.json();
    const shapes = (data.elements||[]).filter(e=>e.type==='relation')
      .map(rel => (rel.members||[]).filter(m=>m.type==='way'&&m.geometry).map(m=>m.geometry.map(g=>[g.lat,g.lon])))
      .filter(ways => ways.length);
    return busShapeCache[ref] = shapes.length ? shapes : null;
  }catch(e){ return busShapeCache[ref] = null; }
}
// draw a bus line: real OSM road geometry when available, else straight GTFS stop-lines; always the GTFS stop dots
const BUS_DIR_COLOR = ['#E8A33D', '#5BA8E8'];      // outbound amber, return blue — so the two are told apart
// Build ONE direction's road-following path: walk its GTFS stop list and, for each consecutive
// pair, slice the matching baked road chain. A pair with no covering chain falls back to a short
// straight hop between just those two stops — never a city-crossing chord, and never a gap.
// nearest point on a polyline → {i:segment, t:0..1 along it, d:metres away}
function _snapToPath(poly, pt){
  let best={i:0,t:0,d:Infinity};
  for(let i=0;i<poly.length-1;i++){
    const a=poly[i], b=poly[i+1];
    const dy=b[0]-a[0], dx=b[1]-a[1], L2=dy*dy+dx*dx;
    let t = L2 ? ((pt[0]-a[0])*dy + (pt[1]-a[1])*dx)/L2 : 0;
    t = t<0?0:(t>1?1:t);
    const d = metersBetween(pt, [a[0]+dy*t, a[1]+dx*t]);
    if(d<best.d) best={i,t,d};
  }
  return best;
}
const _posOf = sn => sn.i + sn.t;                 // monotone position along the polyline
function _sliceBetween(poly, p0, p1){             // fractional positions, p0 < p1
  const i0=Math.floor(p0), i1=Math.floor(p1);
  const at=(i,t)=>{ const a=poly[i], b=poly[Math.min(i+1,poly.length-1)];
                    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; };
  const out=[at(i0,p0-i0)];
  for(let i=i0+1;i<=i1 && i<poly.length;i++) out.push(poly[i]);
  out.push(at(i1,p1-i1));
  return out;
}
const _pathLen = p => { let L=0; for(let i=1;i<p.length;i++) L+=metersBetween(p[i-1],p[i]); return L; };
const SNAP_MAX_M = 260;     // a stop further than this from a shape is not on it
const DETOUR_MAX = 3.0;     // a hop drawn >3x its straight distance went the wrong way round
/* Build one direction along the road.

   Chains stay per-hop: a route's baked geometry is legitimately split into disconnected
   pieces, and forcing the whole direction onto a single chain just pushes the uncovered
   hops into straight links, which makes MORE visual noise, not less. What the old builder
   actually lacked were two guards, and those are what is added here:
     • forward-only progress within a chain, so a route that doubles back can no longer snap
       the next stop BEHIND the current one and draw the slice as a backwards spike;
     • a detour ceiling, so a hop that snapped to the wrong side of a loop is dropped instead
       of being drawn as a kilometre-long excursion.
   Endpoints are also projected onto the nearest point of a SEGMENT rather than snapped to the
   nearest vertex, which removes the small hooks where stops sit between two shape points. */
function busDirPath(d, chains){
  const stops=d.stops.map(s=>[s[0],s[1]]);
  if(!chains || !chains.length || stops.length<2) return stops;
  const paths = (Array.isArray(chains[0]) && Array.isArray(chains[0][0])) ? chains : [chains];
  const usable = paths.filter(p=>p && p.length>1);
  if(!usable.length) return stops;
  const out=[]; let lastPoly=-1, cursor=-1;
  const pushPt=p=>{ if(!out.length || metersBetween(out[out.length-1],p)>1) out.push(p); };
  for(let i=0;i<stops.length-1;i++){
    const A=stops[i], B=stops[i+1];
    const straight=metersBetween(A,B);
    // the chain that covers THIS hop most tightly
    let pi=-1, sa=null, sb=null, best=Infinity;
    for(let k=0;k<usable.length;k++){
      const ka=_snapToPath(usable[k],A), kb=_snapToPath(usable[k],B);
      const sc=ka.d+kb.d;
      if(sc<best){ best=sc; pi=k; sa=ka; sb=kb; }
    }
    let seg=null;
    if(pi>=0 && sa.d<=SNAP_MAX_M && sb.d<=SNAP_MAX_M){
      const poly=usable[pi];
      let pa=_posOf(sa), pb=_posOf(sb);
      let rev=false;
      if(pb<pa){ rev=true; const t=pa; pa=pb; pb=t; }        // shape stored the other way round
      if(pi===lastPoly && !rev && cursor>=0 && pa<cursor) pa=cursor;   // no backwards travel
      if(pb>pa){
        seg=_sliceBetween(poly, pa, pb);
        if(rev) seg=seg.reverse();
        if(_pathLen(seg) > Math.max(straight*DETOUR_MAX, straight+400)) seg=null;
      }
      if(seg){ lastPoly=pi; cursor=rev?-1:pb; }              // a reversed hop cannot seed a cursor
    }
    // the slice already begins and ends at the projections of A and B, so pushing the raw
    // stops around it just adds a small out-and-back at every single stop
    if(seg && seg.length>1){ for(const p of seg) pushPt(p); }
    else { pushPt(A); pushPt(B); lastPoly=-1; cursor=-1; }   // honest short link
  }
  pushPt(stops[stops.length-1]);
  return out.length>1 ? out : stops;
}
function drawBusDirs(dirs, chains){
  busLayer.clearLayers(); const all=[];
  dirs.forEach((d, di)=>{
    const col = BUS_DIR_COLOR[di % BUS_DIR_COLOR.length];
    const pts = busDirPath(d, chains);
    L.polyline(pts,{color:'#fff',weight:7,opacity:.35,lineCap:'round',lineJoin:'round'}).addTo(busLayer);
    L.polyline(pts,{color:col,weight:3.6,opacity:.97,lineCap:'round',lineJoin:'round',
                    dashArray: di>0?'9,6':null})
      .bindTooltip((d.ref||'')+' → '+(d.head||''),{sticky:true,className:'lt'}).addTo(busLayer);
    for(const p of pts) all.push(p);
  });
  dirs.forEach((d, di)=> d.stops.forEach(s=> L.circleMarker([s[0],s[1]],
      {radius:2.8,color:BUS_DIR_COLOR[di % BUS_DIR_COLOR.length],weight:1.5,fillColor:'#12161f',fillOpacity:1})
      .bindTooltip(svgEsc(s[2]||''),{className:'lt',direction:'top'}).addTo(busLayer)));
  return all;
}
// the stop list for each direction, so a route's own stations are readable in the catalogue
function busStopsHTML(dirs){
  if(!dirs || !dirs.length) return '';
  return dirs.map((d,di)=>{
    const col=BUS_DIR_COLOR[di % BUS_DIR_COLOR.length];
    return '<details class="bd-stops"'+(di===0?' open':'')+'>'+
      '<summary><span class="bd-sw" style="background:'+col+'"></span>'+
        (di===0?t('busOutbound'):t('busReturn'))+' → '+svgEsc(d.head||'')+
        '<b>'+d.stops.length+' '+t('stopsWord')+'</b></summary>'+
      '<ol class="bd-ol">'+d.stops.map(function(s){
        return '<li>'+svgEsc(s[2]||'')+'</li>'; }).join('')+'</ol></details>';
  }).join('');
}
const fmtSchedBucket = b => (!b||!b.first) ? '—' : (b.first+'–'+b.last + (b.hw?` · ~${b.hw} ${t('minUnit')}`:'') + (b.n?` · ${b.n}/${t('perDay')}`:''));
// One boarding on this line, priced on the card you hold. Routed through the same fare engine
// as a trip, so a city with its own bus tariff or no transfer right stays correct, and the
// card comparison behaves here exactly as it does in the trip results.
function busFareHTML(ref){
  if(!FARE || !FARE.cards) return '';
  const one = { steps:[{ type:'ride', ref, bus:true, stops:[{},{}] }] };
  let fe; try{ fe=estimateFare(one); }catch(e){ return ''; }
  if(!fe || !fe.taps) return '';
  return `<div class="bd-h">${t('fareApprox')}</div>` + fareRowHTML(fe, compareCards(()=>estimateFare(one)));
}
function busScheduleHTML(ref){
  const s = BUS_SCHED[ref]; if(!s || !s.length) return '';
  // credit whoever actually runs THIS route: Kocaeli mixes UlaşımPark, ÖHO and KBB on one
  // network, and İstanbul's directory carries no per-route operator, so fall back to the city's
  const op = (BUS_DIR.find(x => x.ref === ref) || {}).op || BUS_OPERATOR;
  let h = `<div class="bd-h">${t('departures')}${op ? ' · ' + svgEsc(op) : ''}</div>`;
  for(const d of s){
    h += `<div class="bd-dir"><span class="bd-arr">→</span>${svgEsc(d.head||'')}</div><div class="bd-rows">`
       + `<div class="bd-r"><span>${t('dayWd')}</span><b>${fmtSchedBucket(d.wd)}</b></div>`
       + `<div class="bd-r"><span>${t('daySat')}</span><b>${fmtSchedBucket(d.sat)}</b></div>`
       + `<div class="bd-r"><span>${t('daySun')}</span><b>${fmtSchedBucket(d.sun)}</b></div></div>`;
  }
  return h + `<div class="bd-src">${t('accSource')} İETT GTFS · ${t('schedNote')}</div>`;
}
async function selectBus(id, row){
  document.querySelectorAll('#busList .bus-row').forEach(r=>r.classList.remove('sel'));
  if(row) row.classList.add('sel');
  busLayer.clearLayers();
  const countEl=document.getElementById('busCount'), detail=document.getElementById('busDetail');
  const ref = row ? row.dataset.ref : null;
  const tok = ++busSelToken;
  if(ref && !busReady){                         // clicked before the lazy GTFS data landed:
    countEl.textContent = t('loadingGeom');     // wait briefly for it (usually <2s on first load)
    await Promise.race([busDataPromise, new Promise(res=>setTimeout(res, 5000))]);
    if(tok!==busSelToken) return;               // another line selected while waiting
  }
  const dirs = ref ? busDirs(ref) : [];
  if(dirs.length){
    const dl = dirs.length+' '+(dirs.length===1?t('direction1'):t('directionN'));
    // baked road chains are already in memory → draw the real shape immediately, no "loading"
    await ensureBusGeom();
    const chains = (BUS_GEOM && BUS_GEOM[ref]) ? BUS_GEOM[ref] : null;
    let all = drawBusDirs(dirs, chains);
    detail.innerHTML = busFareHTML(ref) + busScheduleHTML(ref) + busStopsHTML(dirs);
    countEl.textContent = ref+' · '+dl;
    if(all.length) map.fitBounds(L.latLngBounds(all).pad(0.2));
    if(!chains){                                 // no baked shape (2 of 855) → try Overpass once
      countEl.textContent = ref+' · '+dl+' · '+t('loadingGeom');
      const shapes = await busOsmShapes(ref);
      if(tok!==busSelToken) return;
      if(shapes && shapes[0]){ all = drawBusDirs(dirs, shapes[0]);
        if(all.length) map.fitBounds(L.latLngBounds(all).pad(0.2)); }
      countEl.textContent = ref+' · '+dl;
    }
    // bring the selection and its details into view inside the catalogue
    try{ if(row) row.scrollIntoView({block:'nearest', behavior:'smooth'});
         detail.scrollIntoView({block:'nearest', behavior:'smooth'}); }catch(e){}
    return;
  }
  detail.innerHTML='';                          // fallback: OSM road geometry for lines not in the GTFS feed
  countEl.textContent = t('loadingGeom');
  try{
    const q = `[out:json][timeout:60];relation(${id});out geom;`;
    const resp = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:q });
    const data = await resp.json();
    const rel = (data.elements||[]).find(e=>e.type==='relation');
    let pts = [];
    (rel ? rel.members : []).filter(m=>m.type==='way'&&m.geometry).forEach(m=>{
      const seg = m.geometry.map(g=>[g.lat,g.lon]);
      L.polyline(seg, { color:'#E8A33D', weight:9, opacity:0.18, lineCap:'round' }).addTo(busLayer);
      L.polyline(seg, { color:'#E8A33D', weight:3.5, opacity:0.95, lineCap:'round' }).addTo(busLayer);
      pts = pts.concat(seg);
    });
    if(pts.length){ map.fitBounds(L.latLngBounds(pts).pad(0.2)); countEl.textContent = (row?row.dataset.ref:'')+' · '+t('routeDrawn')+' ('+pts.length+' pts)'; }
    else countEl.textContent = t('noGeom');
  }catch(e){ countEl.textContent = t('needNet'); }
}

// legend grouped by kind, scoped to the active tab
function buildLegend(){
  const el = document.getElementById('legend');
  const set = tabLines();
  let html="";
  GROUP_ORDER.forEach(kind=>{
    const lines = set.filter(l=>l.kind===kind && !l.partOf);   // partOf lines fold into their parent
    if(!lines.length) return;
    html += `<div class="grp"><div class="grp-h" data-kind="${kind}">${kindLabel(kind)}<span>toggle</span></div><div class="lines-wrap">`;
    lines.forEach(l=>{
      html += `<div class="lchip${lineLayers[l.ref].on?'':' off'}" data-ref="${l.ref}" title="${attrEsc(t('openLineMap'))}"><span class="sw" style="background:${l.color}" title="${attrEsc(t('showHide'))}"></span>${l.ref}</div>`;
    });
    html += `</div></div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.lchip').forEach(ch=>{
    const ref=ch.dataset.ref, ln=lineByRef[ref];
    // chip body → open the line's strip-map panel (turning the line on if it was hidden)
    ch.addEventListener('click', ()=>{ if(!ln) return; if(!lineLayers[ref].on) setLine(ref,true);
      if(typeof IS_MOBILE!=='undefined' && IS_MOBILE && typeof openSheet==='function') openSheet(null);  // close the Layers sheet so the panel shows
      openLine(ln); });
    // the colored dot keeps the show/hide toggle
    const sw=ch.querySelector('.sw');
    if(sw) sw.addEventListener('click', e=>{ e.stopPropagation(); toggleLine(ref); });
  });
  el.querySelectorAll('.grp-h').forEach(h=>{
    h.addEventListener('click', ()=>{
      const refs = set.filter(l=>l.kind===h.dataset.kind && !l.partOf).map(l=>l.ref);
      const anyOn = refs.some(r=>lineLayers[r].on);
      refs.forEach(r=>setLine(r, !anyOn));
    });
  });
}
function setLine(ref, on){
  const L_=lineLayers[ref]; if(!L_ || L_.on===on) return;
  L_.on=on;
  if(on) L_.group.addTo(map); else map.removeLayer(L_.group);
  const chip=document.querySelector(`.lchip[data-ref="${CSS.escape(ref)}"]`);
  if(chip) chip.classList.toggle('off', !on);
  // keep integrated sub-lines (M2S→M2, M11X→M11) in sync with their parent
  NETWORK.forEach(l => { if(l.partOf===ref) setLine(l.ref, on); });
}
function toggleLine(ref){ setLine(ref, !lineLayers[ref].on); }

function populateSelects(){
  // searchable autocomplete over every stop (PLACES) + 📍 map-pick buttons
  ['O','D'].forEach(which=>{
    const inp=document.getElementById(which==='O'?'selO':'selD');
    const listEl=document.getElementById(which==='O'?'acO':'acD');
    inp.addEventListener('input', ()=>{ if(which==='O') originPt=null; else destPt=null; acRender(which, inp.value); });
    inp.addEventListener('focus', ()=>{ if(inp.value.trim()) acRender(which, inp.value); });
    inp.addEventListener('blur',  ()=> setTimeout(()=>listEl.classList.remove('show'), 150));
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ listEl.classList.remove('show'); runRoute(); } });
  });
  document.querySelectorAll('.ac-pin').forEach(b=> b.addEventListener('click', ()=> armPick(b.dataset.for)));
  document.querySelectorAll('.ac-geo').forEach(b=> b.addEventListener('click', ()=> useMyLocation(b.dataset.for, b)));
}

document.getElementById('baseSeg').addEventListener('click', e=>{
  const b=e.target.dataset.b; if(!b) return;
  setBase(b);
});
// settings panel wiring
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsX').addEventListener('click', closeSettings);
document.getElementById('settingsOverlay').addEventListener('click', closeSettings);
document.getElementById('themeSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.theme) applyTheme(b.dataset.theme, true); });
document.getElementById('prefSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.pref) setRoutePref(b.dataset.pref, true); });
document.getElementById('textSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.ts) setTextSize(b.dataset.ts); });
document.getElementById('styleSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.uis) setUiStyle(b.dataset.uis, true); });
document.getElementById('cardSel').addEventListener('change', e=> setFareCard(e.target.value, true));
// switch card straight from the comparison in the results
['rFare','aFare','busDetail'].forEach(id=>{ const el=document.getElementById(id); if(!el) return;
  el.addEventListener('click', e=>{ const b=e.target.closest('.fc-row[data-card]');
    if(b){ e.preventDefault(); setFareCard(b.dataset.card, true); } }); });
document.getElementById('paceSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.pace) setWalkPace(b.dataset.pace, true); });
document.getElementById('unitSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.u) setUnits(b.dataset.u); });
document.getElementById('clockSeg').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b&&b.dataset.ck) setClock(b.dataset.ck); });
document.getElementById('swMotion').addEventListener('click', ()=> setReduceMotion(!reduceMotionPref));
document.getElementById('swContrast').addEventListener('click', ()=> setHighContrast(!highContrastPref));
document.getElementById('swAvoidFerry').addEventListener('click', ()=> setAvoid('ferry', !avoidModes.has('ferry'), true));
document.getElementById('swAvoidBus').addEventListener('click', ()=> setAvoid('bus', !avoidModes.has('bus'), true));
document.getElementById('swStepFree').addEventListener('click', ()=> setStepFree(!stepFreePref, true));
document.getElementById('placesGroup').addEventListener('click', e=>{ const b=e.target.closest('button[data-place]'); if(!b) return;
  if(b.dataset.act==='set') setPlaceFromOrigin(b.dataset.place); else clearPlace(b.dataset.place); });
document.getElementById('placeChips').addEventListener('click', e=>{ const b=e.target.closest('.pchip'); if(b) useSavedPlace(b.dataset.place); });
document.getElementById('modeChips').addEventListener('click', e=>{ const b=e.target.closest('.mchip'); if(b) toggleTripMode(b.dataset.mode); });
document.getElementById('avoidRow').addEventListener('click', e=>{ const b=e.target.closest('.achip'); if(b) unavoidLine(b.dataset.unavoid); });
document.getElementById('rOpts').addEventListener('click', e=>{ const b=e.target.closest('button[data-sort]'); if(b){ e.stopPropagation(); setOptSort(b.dataset.sort); } });
{ const cb=document.getElementById('clearRouteBtn');
  if(cb) cb.addEventListener('click', ()=>{
    clearRouteFocus();
    routeLayer.clearLayers(); ++routeToken;
    if(goState) exitGo();
    document.getElementById('rout').classList.remove('show');
    document.getElementById('rOpts').innerHTML=''; currentOpts=[]; currentOptIdx=0;
  }); }
// "avoid this line" from a step in the results → replan without it
document.getElementById('rSteps').addEventListener('click', e=>{ const b=e.target.closest('.st-avoid'); if(b){ e.stopPropagation(); avoidLine(b.dataset.ref); } });
// airport quick actions: the single most common visitor trip, one tap to destination
const AIRPORTS = {};
(function(){                                   // only the airports this city actually has rail to
  const wrap = document.getElementById('airportChips');
  const list = CITY.airports || [];
  if(!wrap) return;
  if(!list.length){ wrap.style.display='none'; return; }
  list.forEach(a=>{ AIRPORTS[a.code]=a;
    const b=document.createElement('button'); b.className='pchip'; b.dataset.ap=a.code;
    b.setAttribute('data-i18n-title','toAirport'); b.title='Route to this airport';
    b.textContent='✈ '+a.label; wrap.appendChild(b); });
})();
document.getElementById('airportChips').addEventListener('click', e=>{
  const b=e.target.closest('.pchip'); if(!b) return;
  const a=AIRPORTS[b.dataset.ap]; if(!a) return;
  setPlannerTab('trip');
  setPoint('D', { name:a.name, lat:a.lat, lng:a.lng });
  if(originPt) runRoute();
  else { showToast(t('needOrigin'),'err'); const so=document.getElementById('selO'); if(so) so.focus(); }
});
document.getElementById('nearBtn').addEventListener('click', showNearby);
document.getElementById('nearX').addEventListener('click', closeNearby);
document.getElementById('goStart').addEventListener('click', startGo);
document.getElementById('goExit').addEventListener('click', exitGo);
document.getElementById('goFollowBtn').addEventListener('click', goRecentre);
// dragging the map yourself turns following off, so the view stops fighting you
map.on('dragstart', function(){ if(goState && !goFollowing){ goState.follow=false;
  const b=document.getElementById('goFollowBtn'); if(b) b.classList.remove('on'); } });
document.getElementById('goPrev').addEventListener('click', ()=>goStep(-1));
document.getElementById('goNext').addEventListener('click', ()=>goStep(1));
document.getElementById('tglExplore').addEventListener('change', e=>toggleAttractions(e.target.checked));
document.getElementById('shareBtn').addEventListener('click', shareTrip);
document.getElementById('printBtn').addEventListener('click', function(){ printTrip('trip'); });
document.getElementById('advPrintBtn').addEventListener('click', function(){ printTrip('adv'); });
document.getElementById('advShareBtn').addEventListener('click', shareAdventure);
document.getElementById('advFavBtn').addEventListener('click', toggleAdvFav);
document.getElementById('advFavClear').addEventListener('click', function(){ advFavs=[];
  try{ localStorage.setItem('irn_advfavs','[]'); }catch(e){} renderAdvFavs(); updateAdvFavBtn(); });
document.getElementById('openPassport').addEventListener('click', ()=>{ closeSettings(); openPassport(); });
document.getElementById('passX').addEventListener('click', closePassport);
document.getElementById('passOverlay').addEventListener('click', closePassport);
document.getElementById('lpFollow').addEventListener('click', toggleFollow);
document.getElementById('leaveRemind').addEventListener('click', e=>{ const b=e.target.closest('button[data-min]'); if(b) remindLeave(+b.dataset.min); });
document.getElementById('resetTrips').addEventListener('click', resetTrips);
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeSettings(); closeNearby(); exitGo(); closePassport(); } });
document.getElementById('speedSeg').addEventListener('click', e=>{
  const s=e.target.dataset.s; if(!s) return;
  [...e.currentTarget.children].forEach(x=>x.classList.toggle('active', x.dataset.s===s));
  simSpeed=parseInt(s,10);
});
document.getElementById('tglTrains').addEventListener('change', e=>{ showTrains=e.target.checked; renderBoard(); });
document.getElementById('tglStations').addEventListener('change', e=>{
  showStations=e.target.checked;
  const g = currentTab==='active' ? stationGroup : plannedStationGroup;
  if(showStations) g.addTo(map); else map.removeLayer(g);
});
document.getElementById('allOn').addEventListener('click', ()=>tabLines().forEach(l=>setLine(l.ref,true)));
document.getElementById('allOff').addEventListener('click', ()=>tabLines().forEach(l=>setLine(l.ref,false)));
document.getElementById('tabs').addEventListener('click', e=>{ const t=e.target.dataset.tab; if(t) setTab(t); });
document.getElementById('langSeg').addEventListener('click', e=>{ const l=e.target.dataset.lang; if(l) setLang(l); });
document.getElementById('plannerTabs').addEventListener('click', e=>{ const m=e.target.dataset.pt; if(m) setPlannerTab(m); });
document.getElementById('advAdd').addEventListener('click', ()=>{
  if(advStops.length>=8) return;                       // sane cap
  advStops.splice(advStops.length-1, 0, null);         // insert before the destination
  rebuildAdvRows();
});
document.getElementById('advPlan').addEventListener('click', planAdventure);
document.getElementById('advClear').addEventListener('click', ()=>{
  advStops=[null,null]; rebuildAdvRows();
  routeLayer.clearLayers(); endpointLayer.clearLayers(); ++routeToken;
  document.getElementById('advOut').classList.remove('show');
});
document.getElementById('busSearch').addEventListener('input', e=> renderBusList(e.target.value));
document.getElementById('wxSearch').addEventListener('input', ()=> renderWeather());
document.getElementById('wxRefresh').addEventListener('click', ()=>{ wxFetchedAt=0; fetchWeather(); });
document.getElementById('route').addEventListener('click', runRoute);
document.getElementById('clear').addEventListener('click', ()=>{
  routeLayer.clearLayers();
  document.getElementById('rout').classList.remove('show');
  setPoint('O',null); setPoint('D',null);
});
document.getElementById('favBtn').addEventListener('click', ()=>{
  if(originPt && destPt) toggleFav(originPt, destPt, { eta:+document.getElementById('rEta').textContent||null,
                               stops:+document.getElementById('rStops').textContent||null,
                               transfers:+document.getElementById('rTr').textContent||null });
});
document.getElementById('histClear').addEventListener('click', ()=>{ planHistory=[]; lsSet(LS_HIST,planHistory); renderPlanLists(); });
document.getElementById('swap').addEventListener('click', ()=>{
  const t=originPt; originPt=destPt; destPt=t;
  document.getElementById('selO').value = originPt?originPt.name:'';
  document.getElementById('selD').value = destPt?destPt.name:'';
  renderEndpoints(); updateFavBtn();
});
document.getElementById('stnX').addEventListener('click', ()=>{ selected=null; document.getElementById('stn').classList.remove('show'); });
document.getElementById('linpX').addEventListener('click', ()=>document.getElementById('linp').classList.remove('show'));
map.on('click', e=>{
  if(pickMode){ const ll=e.latlng;
    // 3 dp ≈ 100 m — enough to tell two pins apart without filling the row with digits
    setPoint(pickMode, { name:`📍 ${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}`, lat:ll.lat, lng:ll.lng });
    armPick(pickMode);   // disarm + restore cursor
    return;
  }
  closeAllPanels();
});
document.getElementById('setO').addEventListener('click', ()=>{ if(selected) setPoint('O',{name:selected.name,lat:selected.lat,lng:selected.lng}); });
document.getElementById('setD').addEventListener('click', ()=>{ if(selected) setPoint('D',{name:selected.name,lat:selected.lat,lng:selected.lng}); });

map.on('zoomstart', ()=>hideTrainsZoom=true);
map.on('zoomend', ()=>hideTrainsZoom=false);
map.on('resize', sizeCanvas);

