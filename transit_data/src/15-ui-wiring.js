/* ===========================================================================
   8. UI WIRING
   =========================================================================== */
let showTrains=true, showStations=true, simSpeed=3, currentTab='active';
function tabLines(){ return currentTab==='active' ? liveLines
                          : currentTab==='intercity' ? intercityLines : visionLines; }

// switch between Active Network, Vision & Expansion, and Bus Directory scopes
let busListBuilt = false;
if(!HAS.bus){ const bt=document.querySelector('#tabs button[data-tab="bus"]'); if(bt) bt.style.display='none'; }
// hide Vision for a city with no projects mapped (Bursa/Antalya) rather than show an empty tab
if(!visionLines.length){ const vt=document.querySelector('#tabs button[data-tab="vision"]'); if(vt) vt.style.display='none'; }
function setTab(t){
  currentTab = t;
  focusStateOff();            // changing scope ends route focus; setTab itself rebuilds below
  document.querySelectorAll('#tabs button').forEach(b=>{
    const on = b.dataset.tab===t;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');   // keep AT in sync with the visual state
  });
  closeAllPanels();
  NETWORK.forEach(l => map.removeLayer(lineLayers[l.ref].group));
  map.removeLayer(ghostGroup); map.removeLayer(stationGroup); map.removeLayer(plannedStationGroup);
  busLayer.clearLayers(); map.removeLayer(weatherLayer);
  map.removeLayer(disruptionLayer);                          // hazard overlays belong to Active only
  const hideCore = (t==='bus' || t==='weather' || t==='intercity');
  document.getElementById('cardLines').style.display   = hideCore ? 'none' : '';
  document.getElementById('cardPlanner').style.display = hideCore ? 'none' : '';
  document.getElementById('cardBus').style.display     = (t==='bus') ? '' : 'none';
  document.getElementById('cardWeather').style.display = (t==='weather') ? '' : 'none';
  document.getElementById('cardIntercity').style.display = (t==='intercity') ? '' : 'none';
  if(t!=='intercity'){                                       // leaving: drop the highlight, restore İstanbul view
    if(map.hasLayer(intercityHi)) map.removeLayer(intercityHi);
    dimIntercityBase(false); map.removeLayer(intercityStationGroup);
    if(icReturn){ map.setView(icReturn.c, icReturn.z, {animate:false}); icReturn=null; }
  }
  if(t==='active'){
    liveLines.forEach(l => { if(lineLayers[l.ref].on) lineLayers[l.ref].group.addTo(map); });
    if(showStations) stationGroup.addTo(map);
    disruptionLayer.addTo(map);
    buildLegend();
  } else if(t==='vision'){
    ghostGroup.addTo(map);                                   // dim live network for context
    visionLines.forEach(l => { if(lineLayers[l.ref].on) lineLayers[l.ref].group.addTo(map); });
    if(showStations) plannedStationGroup.addTo(map);
    buildLegend();
  } else if(t==='intercity'){
    // national scale: remember the İstanbul view, then frame the whole TCDD network
    if(!icReturn) icReturn = { c:map.getCenter(), z:map.getZoom() };
    intercityLines.forEach(l => { if(lineLayers[l.ref].on) lineLayers[l.ref].group.addTo(map); });
    intercityStationGroup.addTo(map);
    if(!icListBuilt){ renderIntercityList(); icListBuilt = true; }
    if(icSelected && lineByRef[icSelected]) selectIntercity(lineByRef[icSelected], false);   // re-apply highlight
    else fitIntercity();
    buildLegend();
  } else if(t==='weather'){
    ghostGroup.addTo(map);                                   // faint network for orientation
    weatherLayer.addTo(map);
    ensureWeather();                                         // fetch (or refresh stale) data
  } else { // bus directory
    ghostGroup.addTo(map);                                   // rail/ferry context behind buses
    if(!busListBuilt){ renderBusList(''); busListBuilt = true; }
  }
}

