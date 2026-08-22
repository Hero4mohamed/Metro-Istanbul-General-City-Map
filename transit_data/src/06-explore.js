/* ===========================================================================
   EXPLORE — İstanbul landmarks as a toggleable map layer. Each shows its nearest
   station + walk, and a "Go here" button that plans a trip to it.
   =========================================================================== */
ATTRACTIONS.forEach(a=>{ let best=null,bd=Infinity; for(const c of stationList){ const d=metersBetween([a.lat,a.lng],[c.lat,c.lng]); if(d<bd){bd=d;best=c;} }
  a.near = best ? { name:best.name, d:bd, lines:[...best.lines] } : null; });
const attractionLayer = L.layerGroup();
let attractionsOn=false;
function attrPopup(a,i){
  const walk = a.near ? Math.max(1,Math.round(a.near.d/WALK)) : null;
  const chips = a.near ? a.near.lines.slice(0,4).map(r=>`<span class="badge" style="background:${colorForLine(r)};color:${inkOn(colorForLine(r))}">${svgEsc(r)}</span>`).join('') : '';
  return `<div class="ap"><div class="ap-nm">${ATTR_CAT[a.cat]||'📍'} ${svgEsc(a.name)}</div>`
    + (a.near?`<div class="ap-st">🚉 ${svgEsc(a.near.name)} · ${walk} ${t('walkAway')} ${chips}</div>`:'')
    + `<button class="ap-go" data-attr-go="${i}">▸ ${t('goHere')}</button></div>`;
}
function renderAttractions(){
  attractionLayer.clearLayers(); if(!attractionsOn) return;
  ATTRACTIONS.forEach((a,i)=>{
    L.marker([a.lat,a.lng],{ icon:L.divIcon({className:'attr-ic', html:`<div class="attr-pin">${ATTR_CAT[a.cat]||'📍'}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:850 })
      .bindPopup(attrPopup(a,i), {className:'attr-pop', maxWidth:230}).addTo(attractionLayer);
  });
}
function toggleAttractions(on){
  attractionsOn = (on!=null) ? !!on : !attractionsOn;
  if(attractionsOn) attractionLayer.addTo(map); else map.removeLayer(attractionLayer);
  renderAttractions();
  const cb=document.getElementById('tglExplore'); if(cb) cb.checked=attractionsOn;
}
function goToAttraction(i){
  const a=ATTRACTIONS[i]; if(!a) return;
  setTab('active'); setPlannerTab('trip'); setPoint('D',{name:a.name,lat:a.lat,lng:a.lng});
  try{ map.closePopup(); }catch(e){}
  if(originPt) runRoute(); else if(typeof IS_MOBILE!=='undefined' && IS_MOBILE && typeof openSheet==='function') openSheet('planner');
}
// attractions within walking distance of an open station (for the station panel)
function attractionsNear(lat,lng,within){ return ATTRACTIONS.map((a,i)=>({a,i,d:metersBetween([lat,lng],[a.lat,a.lng])}))
  .filter(x=>x.d<=(within||700)).sort((x,y)=>x.d-y.d).slice(0,4); }
// planned-line stops — shown as markers in the Vision tab, not in the routing graph
const plannedStationList = [];
visionLines.forEach(line => line.stations.forEach(st => {
  if(st.name) plannedStationList.push({ name:st.name, lat:st.lat, lng:st.lng, ref:line.ref, color:line.color });
}));

