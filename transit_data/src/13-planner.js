/* ===========================================================================
   7. TRIP PLANNER  (+ refresh-safe history & favourites in localStorage)
   =========================================================================== */
const LS_HIST='irn_history', LS_FAV='irn_favourites';
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||'[]'); }catch(e){ return []; } }
function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
let planHistory = lsGet(LS_HIST);
let planFavs = lsGet(LS_FAV);
const attrEsc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');

/* ---- door-to-door endpoints: any stop (searchable) or any pinned map point ---- */
let originPt=null, destPt=null, pickMode=null;
const endpointLayer = L.layerGroup().addTo(map);
function epIcon(role){
  const c = role==='O' ? '#3ee387' : '#ff5d6c';
  return L.divIcon({ className:'ep-icon',
    html:`<div style="width:17px;height:17px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c};border:2px solid #06121b;box-shadow:0 3px 7px rgba(0,0,0,.6)"></div>`,
    iconSize:[17,17], iconAnchor:[8,17] });
}
function renderEndpoints(){
  endpointLayer.clearLayers();
  if(originPt) L.marker([originPt.lat,originPt.lng],{icon:epIcon('O'),zIndexOffset:1500,interactive:false}).addTo(endpointLayer);
  if(destPt)   L.marker([destPt.lat,destPt.lng],  {icon:epIcon('D'),zIndexOffset:1500,interactive:false}).addTo(endpointLayer);
}
function setPoint(which, pt){
  if(which && which[0]==='A'){ const i=+which.slice(1); if(!isNaN(i)){ setAdvStop(i, pt); return; } }  // adventure row pick
  if(which==='O') originPt=pt; else destPt=pt;
  document.getElementById(which==='O'?'selO':'selD').value = pt ? pt.name : '';
  renderEndpoints(); updateFavBtn();
}
/* ===========================================================================
   GPS — locate the user and route from their real position. Live pulsing dot +
   accuracy ring; the planner can use "my location" as an endpoint. Browser
   Geolocation API; needs HTTPS (the live site) or localhost. Nothing is stored
   or sent anywhere — the position stays in the page.
   =========================================================================== */
const geoLayer = L.layerGroup().addTo(map);
let geoWatchId=null, geoActive=false, geoFirstFix=false, geoPos=null;
function geoSupported(){ return ('geolocation' in navigator) && window.isSecureContext; }
function renderGeo(){
  geoLayer.clearLayers(); if(!geoPos) return;
  if(geoPos.acc && geoPos.acc<4000)
    L.circle([geoPos.lat,geoPos.lng],{radius:geoPos.acc,color:'#2f8fff',weight:1,opacity:.5,fillColor:'#2f8fff',fillOpacity:.12,interactive:false}).addTo(geoLayer);
  L.marker([geoPos.lat,geoPos.lng],{icon:L.divIcon({className:'geo-ic',html:'<div class="geo-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]}),interactive:false,zIndexOffset:2000}).addTo(geoLayer);
}
function geoErr(e){
  stopLocate();
  const c=e&&e.code;
  showToast(c===1 ? t('geoDenied') : t('geoUnavailable'), 'err');
}
function startLocate(){
  if(!geoSupported()){ showToast(t('geoUnsupported'),'err'); return; }
  geoActive=true; geoFirstFix=true;
  const b=document.getElementById('locateFab'); if(b) b.classList.add('on','busy');
  showToast(t('locating'));
  geoWatchId=navigator.geolocation.watchPosition(p=>{
    geoPos={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}; renderGeo();
    const b2=document.getElementById('locateFab'); if(b2) b2.classList.remove('busy');
    if(geoFirstFix){ geoFirstFix=false; map.setView([geoPos.lat,geoPos.lng], Math.max(map.getZoom(),15)); }
  }, geoErr, {enableHighAccuracy:true,timeout:12000,maximumAge:10000});
}
function stopLocate(){
  if(geoWatchId!=null){ try{ navigator.geolocation.clearWatch(geoWatchId); }catch(e){} geoWatchId=null; }
  geoActive=false; geoPos=null; geoLayer.clearLayers();
  const b=document.getElementById('locateFab'); if(b) b.classList.remove('on','busy');
}
function toggleLocate(){ geoActive ? stopLocate() : startLocate(); }
// fill a planner endpoint (O / D) with the user's current position, then route if the other end is set
function useMyLocation(which, btn){
  if(!geoSupported()){ showToast(t('geoUnsupported'),'err'); return; }
  if(btn) btn.classList.add('busy'); showToast(t('locating'));
  navigator.geolocation.getCurrentPosition(p=>{
    if(btn) btn.classList.remove('busy');
    geoPos={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}; renderGeo();
    setPoint(which, {name:t('myLocation'), lat:geoPos.lat, lng:geoPos.lng});
    if(which==='O' && destPt) runRoute();
    else if(which==='D' && originPt) runRoute();
    else map.setView([geoPos.lat,geoPos.lng], Math.max(map.getZoom(),14));
  }, e=>{ if(btn) btn.classList.remove('busy'); geoErr(e); }, {enableHighAccuracy:true,timeout:12000,maximumAge:15000});
}

// live search over every stop (rail + ferry + bus); diacritic-insensitive + typo-tolerant
// one dropdown row: rail/ferry stop (line-coloured dot), bus stop (amber), curated landmark
// (★), or a live-geocoded place/address (📍)
function acItemHTML(pl, id){
  if(pl.geo) return `<div class="ac-item" data-id="${id}"><span class="ac-ic">📍</span><span class="ac-nm">${svgEsc(pl.name)}</span><small>${svgEsc(pl.ctx||t('placeWord'))}</small></div>`;
  if(pl.poi) return `<div class="ac-item" data-id="${id}"><span class="ac-ic">★</span><span class="ac-nm">${svgEsc(pl.name)}</span><small>${t('landmarkWord')}</small></div>`;
  const col = pl.bus ? BUS_COLOR : colorForLine(pl.ref);
  const kl  = pl.bus ? (t('busLabel')||'Bus') : (lineByRef[pl.ref] ? kindLabel(lineByRef[pl.ref].kind) : 'Rail');
  return `<div class="ac-item" data-id="${id}"><span class="ac-dot" style="background:${col}"></span><span class="ac-nm">${svgEsc(pl.name)}</span><small>${svgEsc(kl)}</small></div>`;
}
// drop geocoded hits that just duplicate a local stop/landmark (same name, or within 200 m)
function dedupeGeo(geo, local){
  return geo.filter(g => !local.some(l => fold(l.name)===fold(g.name) || metersBetween([g.lat,g.lng],[l.lat,l.lng])<200));
}
// shared autocomplete: local stops+landmarks render instantly; a debounced geocoder then
// appends real places/addresses under a divider. `key` isolates each field's async token.
const _acTok = {}, _acDeb = {};
function acSearch(key, q, listEl, onPick){
  if(!foldQ(q)){ listEl.classList.remove('show'); listEl.innerHTML=''; return; }
  const local = searchPlaces(q);
  const draw = (geo, loading)=>{
    let html = local.map((pl,i)=>acItemHTML(pl,'L'+i)).join('');
    if(geo && geo.length) html += `<div class="ac-sec">${t('placesAddr')}</div>` + geo.map((pl,i)=>acItemHTML(pl,'G'+i)).join('');
    if(loading && !geo) html += `<div class="ac-hint ac-loading">${t('searchingPlace')}</div>`;
    if(!html) html = `<div class="ac-hint">${t('noPlaceMatch')}</div>`;
    listEl.innerHTML = html; listEl.classList.add('show');
    listEl.querySelectorAll('.ac-item[data-id]').forEach(el=>el.addEventListener('mousedown', ev=>{
      ev.preventDefault(); const id=el.dataset.id; const pl = id[0]==='G' ? (geo||[])[+id.slice(1)] : local[+id.slice(1)];
      if(pl){ onPick({ name:pl.name, lat:pl.lat, lng:pl.lng }); listEl.classList.remove('show'); }
    }));
  };
  const willGeo = foldQ(q).length>=3;
  draw(null, willGeo);                                    // instant local results
  const my = (_acTok[key]=(_acTok[key]||0)+1);
  clearTimeout(_acDeb[key]);
  if(willGeo) _acDeb[key]=setTimeout(async ()=>{
    const geo = dedupeGeo(await geocode(q), local);
    if(my!==_acTok[key]) return;                          // a newer keystroke superseded this one
    draw(geo, false);
  }, 350);
}
function acRender(which, q){
  const listEl=document.getElementById(which==='O'?'acO':'acD');
  acSearch(which, q, listEl, pt=> setPoint(which, pt));
}
// arm/disarm "pick a point on the map" mode for a field
function armPick(which){
  pickMode = (pickMode===which) ? null : which;
  document.querySelectorAll('.ac-pin').forEach(b=>b.classList.toggle('armed', b.dataset.for===pickMode));
  map.getContainer().style.cursor = pickMode ? 'crosshair' : '';
}
// resolve a typed (but not clicked) field to its best matching place
function resolveTyped(which){
  const cur = which==='O'?originPt:destPt;
  const val = document.getElementById(which==='O'?'selO':'selD').value.trim();
  if(!val){ if(which==='O') originPt=null; else destPt=null; return null; }
  if(cur && cur.name===val) return cur;             // already a chosen stop / pinned point
  const f=foldQ(val);
  /* Anything past an exact hit goes through the ranked search. Scanning PLACES directly returns
     the alphabetically first prefix match, so the dropdown would offer "Atatürk Havalimanı"
     while pressing Enter silently resolved to "HAVALİMANI TAKSİ KOOPERATİFİ" — the list and
     the field disagreeing about what you picked. */
  const m = PLACES.find(p=>p._q===f) || searchPlaces(val)[0];
  if(m){ const pt={name:m.name,lat:m.lat,lng:m.lng}; if(which==='O') originPt=pt; else destPt=pt;
    document.getElementById(which==='O'?'selO':'selD').value=m.name; return pt; }
  return null;
}
function isFav(oN,dN){ return planFavs.some(p=>p.oN===oN && p.dN===dN); }
const epOf = p => ({ o:{name:p.oN,lat:p.oLat,lng:p.oLng}, d:{name:p.dN,lat:p.dLat,lng:p.dLng} });
const epRec = (o,d,sum)=>({ oN:o.name,oLat:o.lat,oLng:o.lng, dN:d.name,dLat:d.lat,dLng:d.lng,
                            eta:sum?sum.eta:null, stops:sum?sum.stops:null, transfers:sum?sum.transfers:null });
function recordPlan(o,d,sum){
  planHistory = planHistory.filter(p=>!(p.oN===o.name && p.dN===d.name));
  planHistory.unshift(epRec(o,d,sum));
  if(planHistory.length>12) planHistory.length=12;
  lsSet(LS_HIST, planHistory); renderPlanLists();
}
function toggleFav(o,d,sum){
  if(isFav(o.name,d.name)) planFavs = planFavs.filter(p=>!(p.oN===o.name && p.dN===d.name));
  else planFavs.unshift(epRec(o,d,sum));
  lsSet(LS_FAV, planFavs); renderPlanLists(); updateFavBtn();
}
function loadPlan(o,d){ setPoint('O',o); setPoint('D',d); runRoute(); }
function updateFavBtn(){
  const b=document.getElementById('favBtn'); if(!b) return;
  const f = originPt && destPt && isFav(originPt.name,destPt.name);
  b.textContent = f ? t('favourited') : t('saveFav');
  b.classList.toggle('isfav', !!f);
}
function planRow(p, on){
  return `<div class="plan-item" data-on="${attrEsc(p.oN)}" data-dn="${attrEsc(p.dN)}"
       data-ola="${p.oLat}" data-olo="${p.oLng}" data-dla="${p.dLat}" data-dlo="${p.dLng}">
    <button class="pi-star ${on?'on':''}" data-act="star" title="favourite">★</button>
    <div class="pi-route">
      <span class="pi-pt">${svgEsc(p.oN)}</span>
      <span class="pi-pt pi-to">${svgEsc(p.dN)}</span>
    </div>
    <span class="pi-meta">${p.eta!=null?`<span class="pi-eta">${p.eta}m</span>`:''}
      <button class="pi-del" data-act="del" title="remove">✕</button></span></div>`;
}
function renderPlanLists(){
  const fav=document.getElementById('favList'), hist=document.getElementById('histList');
  if(!fav||!hist) return;
  fav.innerHTML = planFavs.length ? planFavs.map(p=>planRow(p,true)).join('') : `<div class="plan-empty">${t('noFav')}</div>`;
  hist.innerHTML = planHistory.length ? planHistory.map(p=>planRow(p,isFav(p.oN,p.dN))).join('') : `<div class="plan-empty">${t('noRecent')}</div>`;
  bindPlanItems(fav,'fav'); bindPlanItems(hist,'hist');
}
function bindPlanItems(container, kind){
  container.querySelectorAll('.plan-item').forEach(it=>{
    const o={ name:it.dataset.on, lat:+it.dataset.ola, lng:+it.dataset.olo };
    const d={ name:it.dataset.dn, lat:+it.dataset.dla, lng:+it.dataset.dlo };
    it.addEventListener('click', e=>{
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if(act==='star'){ toggleFav(o,d,null); return; }
      if(act==='del'){
        if(kind==='fav'){ planFavs=planFavs.filter(p=>!(p.oN===o.name&&p.dN===d.name)); lsSet(LS_FAV,planFavs); }
        else { planHistory=planHistory.filter(p=>!(p.oN===o.name&&p.dN===d.name)); lsSet(LS_HIST,planHistory); }
        renderPlanLists(); updateFavBtn(); return;
      }
      loadPlan(o,d);
    });
  });
}

function buildItinerary(res){
  const p = res.path.map(k=>nodeMeta[k]);
  const steps=[], segs=[]; let i=0;
  while(i<p.length){
    const ref=p[i].ref, isBus=p[i].kind==='bus'; let j=i;
    while(j+1<p.length && p[j+1].ref===ref && (p[j+1].kind==='bus')===isBus) j++;
    if(j>i){
      if(isBus){
        const coords=[]; for(let k=i;k<=j;k++) coords.push([p[k].lat,p[k].lng]);
        segs.push({ ref, bus:true, coords });
      } else {
        segs.push({ ref, s0:p[i].s, s1:p[j].s });
      }
      const sibs = isBus ? siblingBuses([p[i].lat,p[i].lng],[p[j].lat,p[j].lng], ref) : null;
      /* Boarding and alighting COORDINATES ride along with the leg. The transfer check needs a
         measured walk between the platform you step onto and the one you leave from, and the
         station name alone cannot give that — two lines sharing a name can be 200 m apart. */
      steps.push({type:"ride", ref, bus:isBus, from:p[i].name, to:p[j].name, stops:Math.abs(p[j].idx-p[i].idx), siblings:sibs,
                  fromLat:p[i].lat, fromLng:p[i].lng, toLat:p[j].lat, toLng:p[j].lng});
    } else if(steps.length===0){
      steps.push({type:"ride", ref, bus:isBus, from:p[i].name, to:p[i].name, stops:0,
                  fromLat:p[i].lat, fromLng:p[i].lng, toLat:p[i].lat, toLng:p[i].lng});
    }
    if(j+1<p.length) steps.push({type:"transfer", at:p[j+1].name, ref:p[j+1].ref, bus:p[j+1].kind==='bus'});
    i=j+1;
  }
  // collapse consecutive transfers (pass-through stops): keep first location, final target line
  const cleaned=[];
  for(const s of steps){
    const prev=cleaned[cleaned.length-1];
    if(s.type==='transfer' && prev && prev.type==='transfer'){ prev.ref=s.ref; prev.bus=s.bus; }
    else cleaned.push(s);
  }
  // wrap the ride with access-walk legs (origin → first stop, last stop → destination)
  const out=[];
  if(res.oWalk!=null && res.oWalk>0.5 && p.length) out.push({type:'walk', mins:res.oWalk, to:p[0].name});
  for(const s of cleaned) out.push(s);
  if(res.dWalk!=null && res.dWalk>0.5 && p.length) out.push({type:'walk', mins:res.dWalk, from:p[p.length-1].name, dest:true});
  return { steps:out, segs, total:res.total,
           transfers:cleaned.filter(s=>s.type==="transfer").length,
           stops:cleaned.filter(s=>s.type==="ride").reduce((a,s)=>a+s.stops,0) };
}
/* ---- on-demand REAL geometry: bus road shape (Overpass) + walking paths (OSRM foot) ----
   Nothing is embedded — each leg of a found route is fetched live and cached, so the
   straight placeholder lines get replaced by true road / footpath geometry.            */
const busIdByRef = (()=>{ const m={}; (typeof BUS_DIR!=='undefined'?BUS_DIR:[]).forEach(d=>{ if(d.ref && !(d.ref in m)) m[d.ref]=d.id; }); return m; })();
const busGeoCache={}, footCache={};
let routeToken=0;
function _stitchBus(ways){                               // member ways → one ordered polyline
  if(!ways.length) return [];
  const path = ways[0].geometry.map(g=>[g.lat,g.lon]);
  for(let i=1;i<ways.length;i++){
    let seg = ways[i].geometry.map(g=>[g.lat,g.lon]); if(seg.length<2) continue;
    const last=path[path.length-1];
    if(metersBetween(last,seg[seg.length-1]) < metersBetween(last,seg[0])) seg=seg.reverse();
    if(metersBetween(path[path.length-1],seg[0])<5) seg=seg.slice(1);
    for(const q of seg) path.push(q);
  }
  return path;
}
function _nearestIdx(poly,pt){ let bi=0,bd=Infinity; for(let i=0;i<poly.length;i++){ const dd=metersBetween(poly[i],pt); if(dd<bd){bd=dd;bi=i;} } return bi; }
function _minDist(poly,pt){ let bd=Infinity; for(let i=0;i<poly.length;i++){ const dd=metersBetween(poly[i],pt); if(dd<bd) bd=dd; } return bd; }
function _busPortion(full,a,b){                          // slice the road shape to boarding→alighting
  if(!full||!full.length) return null;
  // baked geometry is an ARRAY OF PATHS (a route split into disconnected chains is kept split so
  // nothing is bridged by a straight chord) — pick the chain that actually covers this leg
  if(Array.isArray(full[0]) && Array.isArray(full[0][0])){
    let best=null, bs=Infinity;
    for(const p of full){ if(p.length<2) continue; const sc=_minDist(p,a)+_minDist(p,b); if(sc<bs){ bs=sc; best=p; } }
    if(!best || bs>1200) return null;                    // leg isn't on this route's road shape
    full = best;
  }
  if(full.length<2) return null;
  const i=_nearestIdx(full,a), j=_nearestIdx(full,b); if(i===j) return null;
  let s=full.slice(Math.min(i,j),Math.max(i,j)+1); if(i>j) s=s.reverse(); return s;
}
async function fetchBusGeom(ref){
  if(ref in busGeoCache) return busGeoCache[ref];
  // baked road shape (from bus-data-<city>.json) — instant, offline, immune to Overpass outages.
  // Previously this always went to Overpass live, so whenever Overpass was busy the leg stayed
  // a straight placeholder line cutting across the city.
  await ensureBusGeom();
  if(BUS_GEOM && BUS_GEOM[ref]) return busGeoCache[ref]=BUS_GEOM[ref];
  const id=busIdByRef[ref]; if(!id) return busGeoCache[ref]=null;
  try{
    const q=`[out:json][timeout:60];relation(${id});out geom;`;
    const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:q});
    const j=await r.json(); const rel=(j.elements||[]).find(e=>e.type==='relation');
    const ways=(rel?rel.members:[]).filter(m=>m.type==='way'&&m.geometry);
    const full=_stitchBus(ways); return busGeoCache[ref]= full.length>1?full:null;
  }catch(e){ return busGeoCache[ref]=null; }
}
async function fetchFoot(a,b){                           // FOSSGIS public OSRM foot profile
  const key=a[0].toFixed(4)+','+a[1].toFixed(4)+'|'+b[0].toFixed(4)+','+b[1].toFixed(4);
  if(key in footCache) return footCache[key];
  try{
    const u=`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
    const r=await fetch(u); const j=await r.json();
    if(j.code!=='Ok'||!j.routes||!j.routes[0]) return footCache[key]=null;
    return footCache[key]={ pts:j.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]), dur:j.routes[0].duration };
  }catch(e){ return footCache[key]=null; }
}
function drawWalkPath(pts){ return L.polyline(pts,{color:'#9fb0c0',weight:3,opacity:.9,dashArray:'1,7',lineCap:'round'}).addTo(routeLayer); }
function drawWalkLeg(a,b){ return drawWalkPath([a,b]); }
function drawBusPath(pts,dashed){
  const w=L.polyline(pts,{color:'#fff',weight:7,opacity:.7,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
  const c=L.polyline(pts,{color:BUS_COLOR,weight:4,opacity:1,lineCap:'round',lineJoin:'round',dashArray:dashed?'2,8':null}).addTo(routeLayer);
  return [w,c];
}
// write the refined ETA back to the most-recent history row (and matching favourite)
function updatePlanEta(eta){
  if(planHistory[0]){ planHistory[0].eta=eta; lsSet(LS_HIST,planHistory); }
  if(originPt&&destPt){ const f=planFavs.find(p=>p.oN===originPt.name&&p.dN===destPt.name); if(f){ f.eta=eta; lsSet(LS_FAV,planFavs); } }
  renderPlanLists();
}
// progressively swap straight placeholders for real geometry + refine ETA with real walk times
async function upgradeRoute(legs, token, baseTotal){
  const note=document.getElementById('refineNote');
  let total=baseTotal, refined=false;
  for(const leg of legs){
    if(token!==routeToken) return;
    let real=null, realWalkMin=null;
    if(leg.kind==='bus'){ const full=await fetchBusGeom(leg.ref); if(full) real=_busPortion(full,leg.a,leg.b); }
    else { const fr=await fetchFoot(leg.a,leg.b); if(fr&&fr.pts.length>1){ real=fr.pts; realWalkMin=fr.dur/60; } }
    if(token!==routeToken) return;
    if(real&&real.length>1){
      leg.placeholders.forEach(p=>routeLayer.removeLayer(p));
      leg.placeholders = leg.kind==='bus' ? drawBusPath(real,false) : [drawWalkPath(real)];
    }
    if(realWalkMin!=null && leg.estWalkMin!=null){   // swap modelled walk-minutes for the router's real time
      total += realWalkMin - leg.estWalkMin; refined=true;
      const el=document.getElementById('rEta'); if(el) el.textContent=Math.round(total);
    }
  }
  if(note && token===routeToken) note.remove();
  if(refined && token===routeToken) updatePlanEta(Math.round(total));
}
let currentOpts=[], currentOptIdx=0;
// build up to N distinct itineraries by penalising lines used in earlier options
function routeOptions(o,d,maxOpts){
  const opts=[], sigs=new Set(), penalty=new Set();
  for(let k=0; k<maxOpts+4 && opts.length<maxOpts; k++){
    const res=routeXY(o,d, penalty.size?penalty:null);
    if(!res) break;
    const it=buildItinerary(res);
    const rides=it.steps.filter(s=>s.type==='ride');
    const sig=rides.map(s=>(s.bus?'b':'')+s.ref).join('>');
    if(!sigs.has(sig)){ sigs.add(sig); opts.push({res,it,sig}); }
    if(!rides.length) break;
    rides.forEach(s=> penalty.add(s.ref));         // steer the next search onto other lines
  }
  // drop unreasonable detours (>2.2× the fastest) so alternatives stay useful
  if(opts.length>1){ const best=opts[0].it.total;
    return opts.filter((o,i)=> i===0 || o.it.total<=best*2.2); }
  return opts;
}
const optLines = it => it.steps.filter(s=>s.type==='ride').map(s=> s.bus?('🚌'+s.ref):s.ref).join(' › ') || 'Walk';
function renderOptChips(){
  const el=document.getElementById('rOpts');
  if(currentOpts.length<2){ el.innerHTML=''; return; }
  const sorts=[['pref',t('sortBest')],['time',t('sortTime')],['changes',t('sortChanges')],['walk',t('sortWalk')],['fare',t('sortFare')]];
  el.innerHTML=`<div class="ropts-h">${t('alternatives')}</div>`
    +`<div class="ropts-sort">${sorts.map(sv=>`<button data-sort="${sv[0]}" class="${optSort===sv[0]?'on':''}">${sv[1]}</button>`).join('')}</div>`
    +currentOpts.map((o,i)=>`<div class="ropt${i===currentOptIdx?' sel':''}" data-i="${i}">
      <div class="ro-t">${i===0?(routePref==='easy'?t('easiest'):t('fastest')):t('option')+' '+(i+1)}</div>
      <div class="ro-m">${Math.round(o.it.total)}<small> ${t('minUnit')}</small></div>
      <div class="ro-s">${optLines(o.it)}</div></div>`).join('');
  el.querySelectorAll('.ropt').forEach(c=> c.addEventListener('click', ()=> selectOption(+c.dataset.i)));
}
// the rail/bus refs an itinerary actually rides (walking legs contribute nothing)
function itinRefs(it){
  const s=new Set();
  ((it&&it.steps)||[]).forEach(st=>{ if(st.type==='ride' && st.ref) s.add(st.ref); });
  return s;
}
function selectOption(idx){
  if(!currentOpts[idx]) return;
  currentOptIdx=idx;
  setRouteFocus(itinRefs(currentOpts[idx].it));
  document.querySelectorAll('#rOpts .ropt').forEach(c=> c.classList.toggle('sel', +c.dataset.i===idx));
  showItinerary(currentOpts[idx].res, currentOpts[idx].it);
}
// draw + list a single itinerary (shared by the option chips)
// draw one itinerary's placeholders into routeLayer; collects geometry-upgrade legs + extent
function drawItin(res, it, allPts, legs){
  const o=res.origin, d=res.dest;
  const pm=res.path.map(k=>nodeMeta[k]);
  const firstStop=[pm[0].lat,pm[0].lng], lastStop=[pm[pm.length-1].lat,pm[pm.length-1].lng];
  if(res.oWalk>0.5){ const a=[o.lat,o.lng]; legs.push({kind:'walk',a,b:firstStop,estWalkMin:res.oWalk,placeholders:[drawWalkLeg(a,firstStop)]}); allPts.push(a,firstStop); }
  if(res.dWalk>0.5){ const b=[d.lat,d.lng]; legs.push({kind:'walk',a:lastStop,b,estWalkMin:res.dWalk,placeholders:[drawWalkLeg(lastStop,b)]}); allPts.push(lastStop,b); }
  // transfer walks: every boundary where the line/mode changes along the path
  { let i=0; while(i<pm.length){ const ref=pm[i].ref, bus=pm[i].kind==='bus'; let j=i;
      while(j+1<pm.length && pm[j+1].ref===ref && (pm[j+1].kind==='bus')===bus) j++;
      if(j+1<pm.length){ const a=[pm[j].lat,pm[j].lng], b=[pm[j+1].lat,pm[j+1].lng];
        if(metersBetween(a,b)>25){ legs.push({kind:'walk',a,b,estWalkMin:metersBetween(a,b)/80,placeholders:[drawWalkLeg(a,b)]}); allPts.push(a,b); } }
      i=j+1; } }
  it.segs.forEach(seg=>{
    const pts = seg.bus ? seg.coords : subPath(lineByRef[seg.ref], seg.s0, seg.s1);
    if(!pts || pts.length<2) return;
    if(seg.bus){
      legs.push({kind:'bus', ref:seg.ref, a:pts[0], b:pts[pts.length-1], placeholders:drawBusPath(pts,true)});
    } else {
      const col=lineByRef[seg.ref].color;
      L.polyline(pts,{color:"#fff",weight:9,opacity:.85,lineCap:'round'}).addTo(routeLayer);
      L.polyline(pts,{color:col,weight:4.5,opacity:1,lineCap:'round'}).addTo(routeLayer);
    }
    pts.forEach(p=>allPts.push(p));
  });
}
/* ===== depart at / arrive by =============================================================
   The routing graph holds no timetable, so this does NOT re-route by time — it anchors the
   journey to a clock. Waiting comes from each line's published headway (you wait about half
   a headway on average); the per-leg split is proportional to the router's own total, so the
   headline ETA can never contradict the steps; and every ride is checked against its
   operating hours at the moment you would actually board it. It is labelled an estimate
   because it is one: the only exact times this app holds are bus first/last/headway. ===== */
let planWhen = { mode:'now', min:null };
function fmtMinOfDay(m){
  m = Math.round(((m % 1440) + 1440) % 1440);
  const h = Math.floor(m / 60), mm = m % 60;
  if(clock24) return String(h).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
  const ap = h < 12 ? 'AM' : 'PM', h12 = (h % 12) || 12;
  return h12 + ':' + String(mm).padStart(2,'0') + ' ' + ap;
}
/* Waiting now comes from the departure oracle rather than from half a headway everywhere.
   Where an exact timetable is held the wait is the real gap to the real next departure; where
   only a frequency is published it is still half a headway, but it SAYS so. */
function rideWait(step, atMin){
  const d = departureInfo(step.ref, { afterMin: atMin != null ? atMin : nowIstanbulMin(),
                                      bus: !!step.bus, lat: step.fromLat, lng: step.fromLng });
  return (d.waitMin != null) ? d.waitMin : expectedWaitFor(lineTiming(step.ref).hwMin || 10);
}
function itinWaitTotal(it){
  // used only to anchor an "arrive by" plan before the real timeline is built, so the cheap
  // frequency estimate is the right tool: the exact pass happens in itinPlan once a start
  // minute exists, and a departure oracle answer depends on the very time being solved for
  return (it.steps||[]).filter(s=>s.type==='ride')
    .reduce((a,s)=>a + expectedWaitFor(lineTiming(s.ref).hwMin || 10), 0);
}
// minute-of-day this itinerary should start at, honouring the Now / Depart / Arrive choice
function plannedStart(it){
  if(planWhen.mode === 'now' || planWhen.min == null) return nowIstanbulMin();
  if(planWhen.mode === 'depart') return planWhen.min;
  return planWhen.min - (it.total || 0) - itinWaitTotal(it);   // arrive by → work backwards
}
/* Walk the journey forward through the clock, asking the oracle at each boarding rather than
   assuming half a headway. Each ride records WHERE its time came from, so the summary can say
   how much of the journey is actually known and how much is an expectation.

   Every change is checked for feasibility: arrival + measured walk + interchange buffer is
   compared against the real next departure, and when the connection cannot be made the plan
   rolls forward to the one that can instead of quietly quoting a time nobody could achieve. */
function itinPlan(it, startMin){
  const steps = it.steps || [];
  // shape of each moving leg, then scaled so the parts sum to the router's own total
  const raw = steps.map(s => s.type==='walk' ? (s.mins||0)
                          : s.type==='ride' ? Math.max(1, (s.stops||1) * 1.5) : 0);
  const rawSum = raw.reduce((a,b)=>a+b, 0) || 1;
  const k = (it.total || rawSum) / rawSum;
  const rows = []; let t = startMin, wait = 0;
  const sources = []; let prevRide = null, missed = 0;

  steps.forEach((s, i) => {
    if(s.type === 'ride'){
      let xfer = null;
      if(prevRide){
        // a change: measure it, and let the oracle say whether the connection stands up
        /* The arrival minute is board + a scaled share of the router's static total, so it is
           an estimate — say so, and the oracle will decline to name a missed train. Once legs
           are trip-matched against the alighting station's timetable this becomes true. */
        xfer = checkTransfer(t, { lat:prevRide.toLat, lng:prevRide.toLng, name:prevRide.to },
                                { lat:s.fromLat, lng:s.fromLng, ref:s.ref, bus:!!s.bus, name:s.from },
                                { arrivalExact:false });
        if(xfer.verdict === 'infeasible') missed++;
      }
      /* You cannot board before you can physically be on the platform. On a change that is
         arrival + the measured walk + the interchange buffer; on the first leg it is simply
         now. Boarding from the arrival minute instead would hand the traveller a free walk. */
      const earliest = xfer ? xfer.readyMin : t;
      const d = departureInfo(s.ref, { afterMin: earliest, bus: !!s.bus, lat: s.fromLat, lng: s.fromLng });
      sources.push({ ref:s.ref, source:d.source, confidence:d.confidence, exact:d.exact });
      // board at the real departure when one is known, otherwise after the expected wait
      const board = (d.exact && d.next != null)
                  ? Math.max(d.next, earliest)
                  : earliest + (d.waitMin != null ? d.waitMin : expectedWaitFor(d.headwayMin || 10));
      const w = Math.max(0, board - t); wait += w; t = board;
      const dur = raw[i] * k;
      rows.push({ s, wait:w, board:t, off:t + dur, dep:d, xfer }); t += dur;
      prevRide = s;
    } else {
      const dur = raw[i] * k;
      rows.push({ s, board:t, off:t + dur }); t += dur;
      if(s.type === 'transfer') { /* the walk is inside checkTransfer; nothing extra to add */ }
    }
  });
  return { rows, start:startMin, end:t, wait, sources,
           conf: journeyConfidence(sources), missedConnections: missed };
}
// the summary strip above the steps, plus any "that line is shut then" warnings
function timetableHTML(it){
  const p = itinPlan(it, plannedStart(it));
  /* The old strip said "estimated from published frequencies" on every journey, including ones
     built entirely from published timetables — understating what the app knows as badly as the
     arrivals board once overstated it. Say which it is. */
  const c = p.conf || { level:'low', exactLegs:0, legs:0, allExact:false };
  const basis = c.allExact ? t('ttConfHigh')
              : c.exactLegs ? t('ttConfMixed').replace('{n}', c.exactLegs).replace('{m}', c.legs)
              : t('ttEst');
  let html = '<div class="tt-row">' +
    '<span>' + svgEsc(t('ttDepart')) + ' <b>' + fmtMinOfDay(p.start) + '</b></span>' +
    '<span>→</span>' +
    '<span>' + svgEsc(t('ttArrive')) + ' <b>' + fmtMinOfDay(p.end) + '</b></span>' +
    (p.wait >= 1 ? '<span class="tt-est">' + svgEsc(t('ttWait').replace('{n}', Math.round(p.wait))) + '</span>' : '') +
    '<span class="tt-est tt-conf-' + svgEsc(c.level) + '">' + svgEsc(basis) + '</span></div>';
  if(p.missedConnections) html += '<div class="tt-row tt-warn">⚠ ' + svgEsc(t('ttMissed')) + '</div>';
  const shut = [];
  p.rows.forEach(r => {
    if(r.s.type !== 'ride' || r.s.bus) return;
    const c = lineClosedAt(r.s.ref, r.board);
    if(c && c.why === 'hours') shut.push(r.s.ref + ' (' + c.hours + ')');
  });
  if(shut.length) html += '<div class="tt-row tt-warn">⚠ ' +
    svgEsc(t('ttShut').replace('{l}', shut.join(', '))) + '</div>';
  return html;
}

/* Warm the exact timetables for an itinerary's boarding stations, then re-render its timing if
   anything new arrived and the user has not moved on. Silent by design: nothing is promised
   before it lands, so there is nothing to apologise for if it never does. */
async function warmItineraryTimetables(it, token, stepsEl){
  try{
    const pts = (it.steps||[]).filter(s=>s.type==='ride' && !s.bus && s.fromLat!=null)
                              .map(s=>({ ref:s.ref, lat:s.fromLat, lng:s.fromLng, bus:false }));
    if(!pts.length) return;
    const added = await warmTimetables(pts, 6000);
    if(!added) return;
    if(token !== routeToken) return;                       // a newer route replaced this one
    if(!stepsEl || !stepsEl.isConnected) return;
    const note = document.getElementById('refineNote');    // keep the geometry notice if present
    stepsEl.innerHTML = timetableHTML(it) + stepsHTML(it);
    if(note && !document.getElementById('refineNote')) stepsEl.insertBefore(note, stepsEl.firstChild);
  }catch(e){ /* timing stays at the tier it already had */ }
}
function showItinerary(res, it){
  const stepsEl=document.getElementById('rSteps');
  routeLayer.clearLayers();
  const token=++routeToken;     // invalidate any geometry fetches still in flight
  document.getElementById('rEta').textContent=Math.round(it.total);
  document.getElementById('rStops').textContent=it.stops;
  document.getElementById('rTr').textContent=it.transfers;
  { const fe=estimateFare(it), fEl=document.getElementById('rFare');
    if(fEl) fEl.innerHTML = fe.taps ? fareRowHTML(fe, compareCards(()=>estimateFare(it))) : '';
    renderRouteWarnings(it); }
  const allPts=[], legs=[];
  drawItin(res, it, allPts, legs);
  if(allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.25));
  const jm=document.getElementById('rJourney'); if(jm) jm.innerHTML = journeyHTML(it, res);
  stepsEl.innerHTML = timetableHTML(it) + stepsHTML(it);
  if(legs.length){
    const note=document.createElement('div'); note.className='none'; note.id='refineNote';
    note.textContent='⏳ Loading real road & footpath geometry…';
    stepsEl.insertBefore(note, stepsEl.firstChild);
    upgradeRoute(legs, token, it.total);
  }
  /* Fetch the operator's exact timetables for the stations this journey actually boards at,
     then redraw. The plan above is already correct and already labelled — this upgrades it
     from "about every 4–9 minutes" to "the 19:58, and you have 3 minutes to change". Deliberately
     after first paint: the answer must never wait on a network call, and if the API is down the
     user keeps the frequency-based plan instead of a spinner. */
  warmItineraryTimetables(it, token, stepsEl);

  goCurrent = { res, it };                                  // remember the shown itinerary for "Go" mode
  const gs=document.getElementById('goStart'); if(gs) gs.style.display='';
}

/* ===========================================================================
   LIVE "GO" JOURNEY MODE — an in-trip companion. After planning, tap ▶ Start and
   the app tracks you with GPS along the route: current step, "get off in N stops",
   transfer prompts, a buzz when your stop is next, and live progress. Manual ◀ ▶
   for tunnels where GPS drops. Uses only the plan + GPS already in the app.
   =========================================================================== */
let goCurrent=null;    // {res,it} currently shown
let goState=null;      // active run: {plan, si, stopIdx, watchId, lastBuzz}
function buildGoPlan(res, it){
  const pm=res.path.map(k=>nodeMeta[k]);
  const oName=(res.origin&&res.origin.name)||t('from'), dName=(res.dest&&res.dest.name)||t('to');
  const steps=[];
  if(res.oWalk>0.5 && pm.length) steps.push({type:'walk', to:pm[0].name, toLat:pm[0].lat, toLng:pm[0].lng, mins:res.oWalk});
  let i=0, prevAlight=null;
  while(i<pm.length){
    const ref=pm[i].ref, bus=pm[i].kind==='bus'; let j=i;
    while(j+1<pm.length && pm[j+1].ref===ref && (pm[j+1].kind==='bus')===bus) j++;
    const ls=pm.slice(i,j+1);
    if(prevAlight) steps.push({type:'transfer', at:pm[i].name, toLat:pm[i].lat, toLng:pm[i].lng, ref, bus});
    steps.push({type:'ride', ref, bus, from:ls[0].name, to:ls[ls.length-1].name, stops:ls.map(s=>({name:s.name,lat:s.lat,lng:s.lng}))});
    prevAlight=ls[ls.length-1].name; i=j+1;
  }
  if(res.dWalk>0.5) steps.push({type:'walk', dest:true, to:dName, toLat:res.dest.lat, toLng:res.dest.lng, mins:res.dWalk});
  return { steps, oName, dName, total:it.total, startedAt:Date.now() };
}
function startGo(){
  if(!goCurrent) return;
  const plan=buildGoPlan(goCurrent.res, goCurrent.it); if(!plan.steps.length) return;
  goState={ plan, si:0, stopIdx:0, watchId:null, lastBuzz:-1,
            dest:{ name:plan.dName, lat:goCurrent.res.dest.lat, lng:goCurrent.res.dest.lng },
            off:0, reroutes:0, rerouting:false, follow:true };
  goTrail = L.polyline([], { color:'#7CF0BE', weight:5, opacity:.9, lineCap:'round',
            dashArray:'1,9', renderer:lineRenderer }).addTo(routeLayer);   // breadcrumb of where you have been
  document.getElementById('goPanel').classList.add('open');
  document.getElementById('goOverlay').classList.add('on');
  document.body.classList.add('go-active');
  if(geoSupported()){ try{ goState.watchId=navigator.geolocation.watchPosition(goTick, ()=>{}, {enableHighAccuracy:true,maximumAge:5000,timeout:15000}); }catch(e){} }
  renderGo();
}
function goRecentre(){
  if(!goState) return;
  goState.follow=true; goState.off=0;
  if(geoPos){ goFollowing=true; map.setView([geoPos.lat,geoPos.lng], Math.max(map.getZoom(),15), {animate:true}); goFollowing=false; }
  const b=document.getElementById('goFollowBtn'); if(b) b.classList.add('on');
}
function exitGo(){
  if(goState && goState.watchId!=null){ try{ navigator.geolocation.clearWatch(goState.watchId); }catch(e){} }
  if(goTrail){ try{ routeLayer.removeLayer(goTrail); }catch(e){} goTrail=null; }
  goState=null;
  document.getElementById('goPanel').classList.remove('open');
  document.getElementById('goOverlay').classList.remove('on');
  document.body.classList.remove('go-active');
}
function goStep(delta){ if(!goState) return; goState.si=Math.max(0,Math.min(goState.plan.steps.length-1, goState.si+delta)); goState.stopIdx=0;
  if(goState.si===goState.plan.steps.length-1 && !goState.recorded){ goState.recorded=true; recordJourney(goState.plan); }  // completed → passport
  renderGo(); }
function goTick(p){
  if(!goState || goState.rerouting) return;
  const here=[p.coords.latitude, p.coords.longitude];
  geoPos={lat:here[0], lng:here[1], acc:p.coords.accuracy}; renderGeo();
  // keep the map on the traveller (unless they panned away themselves)
  if(goState.follow){ goFollowing=true; map.panTo(here, { animate:true, duration:.7 }); goFollowing=false; }
  if(goTrail) goTrail.addLatLng(here);
  // OFF-ROUTE WATCH: if the fix is far from the planned corridor for several updates in a row
  // (missed the stop, took the wrong line, walked the wrong way) → replan from where you are.
  { const d=goDistToPlan(here);
    if(d!=null && d>ROUTE_OFF_M && (p.coords.accuracy||0)<120){
      if(++goState.off>=3){ goReroute(here); return; }
    } else if(d!=null && d<ROUTE_OFF_M*0.6) goState.off=0; }
  const st=goState.plan.steps[goState.si];
  if(st){
    if(st.type==='ride'){
      let bi=goState.stopIdx, bd=Infinity;
      st.stops.forEach((s,k)=>{ const d=metersBetween(here,[s.lat,s.lng]); if(d<bd){bd=d; bi=k;} });
      if(bd<700 && bi>=goState.stopIdx) goState.stopIdx=bi;                 // forward-only, trust GPS within 700 m
      const remaining=(st.stops.length-1)-goState.stopIdx;
      if(remaining===1 && goState.lastBuzz!==goState.si){ goState.lastBuzz=goState.si; if(navigator.vibrate) try{navigator.vibrate([120,60,120]);}catch(e){} }
      if(remaining<=0 && bd<250 && goState.si<goState.plan.steps.length-1){ goStep(1); return; }
    } else if(st.toLat!=null && metersBetween(here,[st.toLat,st.toLng])<45 && goState.si<goState.plan.steps.length-1){ goStep(1); return; }
  }
  renderGo();
}
const ROUTE_OFF_M = 450;      // metres off the planned corridor before we consider you off-route
let goTrail=null, goFollowing=false;
// shortest distance from a position to the REMAINING part of the plan (current step onward), so
// walking away from an already-completed leg never counts as off-route
function goDistToPlan(here){
  if(!goState) return null;
  let best=Infinity;
  for(let i=goState.si;i<goState.plan.steps.length;i++){
    const st=goState.plan.steps[i];
    if(st.type==='ride' && st.stops) st.stops.forEach(sp=>{ const d=metersBetween(here,[sp.lat,sp.lng]); if(d<best) best=d; });
    else if(st.toLat!=null){ const d=metersBetween(here,[st.toLat,st.toLng]); if(d<best) best=d; }
  }
  return best===Infinity ? null : best;
}
// replan from the traveller's real position to the same destination, then resume guidance
function goReroute(here){
  if(!goState || goState.rerouting) return;
  if(goState.reroutes>=6){ showToast(t('goOffRoute'),'err'); goState.off=0; return; }
  goState.rerouting=true; goState.reroutes++;
  showToast(t('goRerouting'));
  const from={ name:t('myLocation'), lat:here[0], lng:here[1] }, to=goState.dest;
  setTimeout(function(){
    let res=null; try{ res=routeXY(from,to); }catch(e){}
    if(!res){ goState.rerouting=false; goState.off=0; showToast(t('goOffRoute'),'err'); return; }
    const it=buildItinerary(res);
    goCurrent={res,it};
    routeLayer.clearLayers();
    const allPts=[], legs=[]; drawItin(res,it,allPts,legs);
    goTrail = L.polyline([here], { color:'#7CF0BE', weight:5, opacity:.9, lineCap:'round',
              dashArray:'1,9', renderer:lineRenderer }).addTo(routeLayer);
    const plan=buildGoPlan(res,it);
    goState.plan=plan; goState.si=0; goState.stopIdx=0; goState.lastBuzz=-1;
    goState.off=0; goState.rerouting=false;
    if(legs.length) upgradeRoute(legs, ++routeToken, 0);
    renderGo();
    showToast(t('goRerouted')+' · '+Math.round(it.total)+' '+t('minUnit'));
  }, 30);
}
function renderGo(){
  if(!goState) return;
  const st=goState.plan.steps[goState.si];
  let icon='🚶', big='', sub='', col='var(--muted)', badge='';
  if(st.type==='ride'){
    col = st.bus?BUS_COLOR:colorForLine(st.ref);
    icon = st.bus?'🚌':mGlyph(lineByRef[st.ref]&&lineByRef[st.ref].kind, false);
    const remaining=Math.max(0,(st.stops.length-1)-goState.stopIdx);
    big = remaining>0 ? `${t('getOffIn')} ${remaining} ${remaining===1?t('stop_one'):t('stop_many')}` : `${t('getOffNow')} · ${st.to}`;
    sub = `→ ${st.to}`; badge=st.ref;
  } else if(st.type==='transfer'){ icon='⇄'; col='var(--gold)'; big=`${t('transferAt')} ${st.at}`; sub=`${t('take')} ${st.ref}`; badge=st.ref; }
  else { icon='🚶'; big = st.dest ? t('walkToDest') : `${t('walkToShort')} ${st.to}`; sub=`~${Math.max(1,Math.round(st.mins||1))} ${t('minUnit')}`; }
  document.getElementById('goNow').innerHTML =
    `<div class="go-ic" style="background:${st.type==='ride'?col:'var(--surface-2)'};color:${st.type==='ride'?inkOn(col):'var(--text)'}">${icon}</div>`
    +`<div class="go-txt"><div class="go-big">${svgEsc(big)}</div><div class="go-sub">${badge?`<span class="badge" style="background:${col};color:${inkOn(col)}">${svgEsc(badge)}</span> `:''}${svgEsc(sub)}</div></div>`;
  document.getElementById('goProgress').innerHTML = goState.plan.steps.map((s,ix)=>{
    const cls=(ix<goState.si?'done ':'')+(ix===goState.si?'cur':'');
    let lb; if(s.type==='ride'){ const c=s.bus?BUS_COLOR:colorForLine(s.ref); lb=`<span class="gp-badge" style="background:${c};color:${inkOn(c)}">${svgEsc(s.ref)}</span> ${svgEsc(s.from)} → ${svgEsc(s.to)}`; }
    else if(s.type==='transfer') lb=`⇄ ${svgEsc(s.at)}`;
    else lb=`🚶 ${s.dest?t('toYourDest'):svgEsc(s.to)}`;
    return `<div class="gp-row ${cls}"><span class="gp-dot"></span><span class="gp-lb">${lb}</span></div>`;
  }).join('');
  const arr=new Date(goState.plan.startedAt + goState.plan.total*60000);
  document.getElementById('goArrive').textContent = t('arrive')+' '+new Intl.DateTimeFormat(LOCALE[lang]||'en-GB', timeOpts({hour:'2-digit',minute:'2-digit'})).format(arr);
}

/* ---- share a planned trip: deep link (#go=…) that re-opens the exact trip + Web Share ---- */
function tripDeepLink(){
  const base=location.origin+location.pathname;
  if(!originPt||!destPt) return base;
  const enc=p=>encodeURIComponent(p.name)+'@'+(+p.lat).toFixed(5)+','+(+p.lng).toFixed(5);
  return base+'#go='+enc(originPt)+'|'+enc(destPt);
}
async function shareTrip(){
  if(!originPt||!destPt){ showToast(t('pickOD'),'err'); return; }
  const it=(currentOpts[currentOptIdx]||{}).it;
  const text=`${originPt.name} → ${destPt.name}`+(it?` · ${Math.round(it.total)} ${t('minUnit')} · ${optLines(it)}`:'');
  const url=tripDeepLink();
  try{ if(navigator.share){ await navigator.share({title:'İSTANBUL · RAY-NET', text, url}); return; } }catch(e){ if(e && e.name==='AbortError') return; }
  try{ await navigator.clipboard.writeText(text+'\n'+url); showToast(t('linkCopied')); }catch(e){ showToast(url); }
}
function applyTripHash(){
  const m=(location.hash||'').match(/go=([^|]+)\|(.+)$/); if(!m) return false;
  const dec=s=>{ let at; try{ at=decodeURIComponent(s); }catch(e){ return null; } const i=at.lastIndexOf('@'); if(i<0) return null;
    const c=at.slice(i+1).split(','); const la=+c[0], ln=+c[1]; if(isNaN(la)||isNaN(ln)) return null; return {name:at.slice(0,i), lat:la, lng:ln}; };
  const o=dec(m[1]), d=dec(m[2]); if(!o||!d) return false;
  try{ setTab('active'); setPlannerTab('trip'); setPoint('O',o); setPoint('D',d); runRoute(); }catch(e){ return false; }
  return true;
}

/* ---- passport / light gamification: lines ridden, trips & km, saved on this device ---- */
let rideRidden = new Set((function(){ const a=lsJSON('irn_ridden'); return Array.isArray(a)?a:[]; })());
let rideTrips = +lsStr('irn_trips','0')||0;
let rideKm = +lsStr('irn_km','0')||0;
function recordJourney(plan){
  if(!plan) return; let km=0; const refs=new Set();
  for(const s of plan.steps){ if(s.type==='ride'){ if(!s.bus) refs.add(s.ref);
    for(let i=1;i<s.stops.length;i++) km+=metersBetween([s.stops[i-1].lat,s.stops[i-1].lng],[s.stops[i].lat,s.stops[i].lng])/1000; } }
  if(!refs.size && km<0.2) return;
  refs.forEach(r=>rideRidden.add(r)); rideTrips++; rideKm+=km;
  try{ localStorage.setItem('irn_ridden', JSON.stringify([...rideRidden])); localStorage.setItem('irn_trips', ''+rideTrips); localStorage.setItem('irn_km', rideKm.toFixed(1)); }catch(e){}
}
function openPassport(){ renderPassport(); document.getElementById('passPanel').classList.add('open'); document.getElementById('passOverlay').classList.add('on'); }
function closePassport(){ document.getElementById('passPanel').classList.remove('open'); document.getElementById('passOverlay').classList.remove('on'); }
function renderPassport(){
  const lines=liveLines.filter(l=>!l.partOf);
  const grid=lines.map(l=>{ const on=rideRidden.has(l.ref); return `<span class="pp-badge ${on?'on':''}" style="${on?`background:${l.color};color:${inkOn(l.color)}`:''}">${svgEsc(l.ref)}</span>`; }).join('');
  document.getElementById('passBody').innerHTML =
    `<div class="pp-stats"><div class="pp-stat"><b>${rideRidden.size}</b><span>/ ${lines.length} ${t('linesRidden')}</span></div>`
    +`<div class="pp-stat"><b>${rideTrips}</b><span>${rideTrips===1?t('tripOne'):t('tripMany')}</span></div>`
    +`<div class="pp-stat"><b>${Math.round(rideKm)}</b><span>km</span></div></div>`
    +`<div class="pp-grid">${grid}</div><div class="pp-note">${t('passportNote')}</div>`;
}
