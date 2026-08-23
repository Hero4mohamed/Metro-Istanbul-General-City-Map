/* ===========================================================================
   MOBILE APP SHELL (PWA) — bottom navigation + slide-up sheets. The existing
   feature cards are REPARENTED into sheets (same DOM, same listeners), so the
   phone gets its own UI without duplicating any logic.
   =========================================================================== */
// Robust phone/tablet detection. The layout-viewport width alone is unreliable (a heavy page
// can momentarily report a wide viewport during load, locking a touch device into the desktop
// layout). "pointer:coarse + hover:none" describes the INPUT device, not the viewport, so it's
// stable from first paint and can't be fooled by viewport timing or mis-reported screen sizes —
// any real touchscreen (phone/tablet) gets the app shell; a mouse desktop never does.
const IS_MOBILE = matchMedia('(pointer:coarse)').matches && matchMedia('(hover:none)').matches
  || matchMedia('(max-width:720px)').matches;
let mSheets={}, mNavBtns={};
function mkSheet(id){
  const s=document.createElement('div'); s.className='msheet glass'; s.id='sheet_'+id;
  s.innerHTML='<div class="mgrab"></div>';
  document.body.appendChild(s);
  // swipe-down to close
  let y0=null, dy=0;
  s.addEventListener('touchstart',e=>{ if(s.scrollTop<=0){ y0=e.touches[0].clientY; dy=0; } },{passive:true});
  s.addEventListener('touchmove',e=>{ if(y0===null) return; dy=e.touches[0].clientY-y0;
    if(dy>0){ s.style.transform=`translateY(${dy}px)`; } },{passive:true});
  s.addEventListener('touchend',()=>{ if(y0===null) return;
    s.style.transform=''; if(dy>90) openSheet(null); y0=null; },{passive:true});
  return s;
}
function openSheet(name){
  for(const k in mSheets) mSheets[k].classList.toggle('open', k===name);
  document.getElementById('mbackdrop').classList.toggle('on', !!name);
  for(const k in mNavBtns) mNavBtns[k].classList.toggle('on', (name===null? k==='map' : k===name));
  if(navigator.vibrate) try{ navigator.vibrate(8); }catch(e){}
}
function setupMobile(){
  if(!IS_MOBILE) return;
  document.body.classList.add('mobile');
  // backdrop + toast
  const bd=document.createElement('div'); bd.id='mbackdrop'; bd.className='mbackdrop';
  bd.addEventListener('click',()=>openSheet(null)); document.body.appendChild(bd);
  // sheets
  mSheets={ planner:mkSheet('planner'), layers:mkSheet('layers'), weather:mkSheet('weather'), alerts:mkSheet('alerts') };
  // installing is offered in Settings → App, for phones and desktop alike
  // reparent the desktop cards into their sheets (order preserved)
  const controls=document.querySelector('.controls');
  [...controls.children].forEach(el=>{
    if(el.id==='cardPlanner') mSheets.planner.appendChild(el);
    else if(el.id==='cardWeather') mSheets.weather.appendChild(el);
    else mSheets.layers.appendChild(el);
    el.style.display='';   // sheets control visibility now; setTab still toggles weather/bus cards
  });
  document.getElementById('cardPlanner').style.display='';
  const ann=document.getElementById('announce'); mSheets.alerts.appendChild(ann); ann.classList.remove('collapsed');
  // bottom navigation
  const nav=document.createElement('div'); nav.className='mnav glass';
  const items=[ ['map','🗺','mMap'], ['planner','⇆','mPlanner'], ['layers','◈','mLayers'], ['weather','☀','mWeather'], ['alerts','📢','mAlerts'] ];
  items.forEach(([k,icon,key])=>{
    const b=document.createElement('button');
    b.innerHTML=`<span class="mi">${icon}</span><span class="ml" data-i18n="${key}">${t(key)}</span>`;
    b.addEventListener('click',()=>{
      if(k==='map'){ openSheet(null); return; }
      if(k==='weather'){ setTab('weather'); }
      // the planner only works on the İstanbul network — leave any non-metro scope first
      if(k==='planner' && (currentTab==='weather'||currentTab==='bus'||currentTab==='intercity')) setTab('active');
      openSheet(k);
    });
    mNavBtns[k]=b; nav.appendChild(b);
  });
  document.body.appendChild(nav);
  mNavBtns.map.classList.add('on');

}
// toast (used for PWA update notifications)
function showToast(msg, kind){
  let tEl=document.getElementById('mtoast');
  if(!tEl){ tEl=document.createElement('div'); tEl.id='mtoast'; tEl.className='mtoast'; document.body.appendChild(tEl); }
  tEl.textContent=msg; tEl.classList.toggle('err', kind==='err'); tEl.classList.add('on');
  clearTimeout(tEl._t); tEl._t=setTimeout(()=>tEl.classList.remove('on'), 4200);
}
// PWA: register the service worker (auto-updates on every deploy) + install prompt
// (deferredInstall is declared near the Settings install row, which reads it)
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredInstall=e;
  try{ refreshInstallRow(); }catch(_){}          // Settings row is the install affordance now
});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  navigator.serviceWorker.register('sw.js', { updateViaCache:'none' }).then(reg=>{
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) reg.update().catch(()=>{}); });
  }).catch(()=>{});
  let hadSW=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{ if(hadSW) showToast(t('appUpdated')); hadSW=true; });
}

// ease-out count-up for the topbar stat tiles
function countUp(el, target, ms){
  if(!el) return; target=+target||0;
  const t0=performance.now();
  (function tick(now){
    const p=Math.min(1,(now-t0)/ms), e=1-Math.pow(1-p,3);
    el.textContent=Math.round(target*e);
    if(p<1) requestAnimationFrame(tick);
  })(t0);
}
function init(){
  setupMobile();              // phone app shell (bottom nav + sheets) — no-op on desktop
  { const lf=document.getElementById('locateFab');
    if(lf){ if(geoSupported()) lf.addEventListener('click', toggleLocate); else lf.style.display='none'; } }
  applyTheme(themePref, true);      // restore saved dark/light/auto theme (+ matching basemap)
  setRoutePref(routePref, false);   // restore saved route preference
  setUiStyle(uiStyle, false);       // restore the saved icon & colour style
  initSettingsUI();                 // sync text size, pace, units, clock, switches, saved places
  try{ const pm=lsStr('irn_planmode'); if(pm==='adv') setPlannerTab('adv'); }catch(e){}
  try{ renderAdvFavs(); }catch(e){}         // restore saved adventures
  try{ applyTripHash(); }catch(e){} // open a shared trip link (#go=…)
  try{ applyAdvHash(); }catch(e){}  // open a shared adventure link (#adv=…)
  document.querySelectorAll('#langSeg button').forEach(b=> b.classList.toggle('active', b.dataset.lang===lang));
  applyI18n();
  ensureEnglish(DISRUPTIONS); // safety net: translate any Turkish left in the baked-in feed
  refreshClosed();            // suspended / out-of-hours lines (sim + arrivals board honesty)
  populateSelects();
  renderModeChips(); renderAvoidRow();   // per-trip mode + avoided-line controls
  renderCardSeg();                       // fare products for this city
  rebuildAdvRows();           // adventure planner stop rows
  sizeCanvas();
  spawnTrains();
  countUp(document.getElementById('sLines'), liveLines.filter(l=>!l.partOf).length, 900);
  countUp(document.getElementById('sStations'), stationList.length, 1100);
  countUp(document.getElementById('sTrains'), trains.length, 1300);
  setTab('active');           // builds legend + adds the active-scope layers
  applyZoomStyling();         // size lines/markers for the initial zoom
  renderPlanLists();          // restore saved history + favourites
  updateFavBtn();
  renderAnnouncements();
  renderDisruptionMarkers();
  animRaf=requestAnimationFrame(frame);
  if(HAS.disruptions) loadLiveDisruptions();   // İstanbul-only feed (metro.istanbul scraper)
  if(HAS.bus) loadBusData();                   // this city's bus network, lazily
  { const sv=document.getElementById("offSave"), cl=document.getElementById("offClear");
    if(sv) sv.addEventListener("click", offSaveArea);
    if(cl) cl.addEventListener("click", ()=>{ if(navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.controller.postMessage("clearTiles"); });
    offRefreshNote(); }
  try{ refreshInstallRow(); }catch(e){}
  /* The Layers header folds its own card — it must not hide the planner or the tabs, which is
     what the old floating button did when it toggled the whole column. Each section keeps its
     own open/closed state, so the panel comes back exactly as it was left. */
  { const head=document.getElementById("layersHead"), body=document.getElementById("layersBody");
    if(head && body){
      const setOpen=(open,save)=>{
        body.classList.toggle("folded", !open);
        head.setAttribute("aria-expanded", open?"true":"false");
        if(save){ try{ localStorage.setItem("irn_layers", open?"1":"0"); }catch(e){} }
      };
      setOpen(lsStr("irn_layers","1")!=="0", false);
      head.addEventListener("click", ()=> setOpen(body.classList.contains("folded"), true));
    }
    document.querySelectorAll("#cardLayers .lyr, #cardLines .lyr").forEach(d=>{
      const key="irn_lyr_"+(d.querySelector("summary span")?.getAttribute("data-i18n")||"x");
      const saved=lsStr(key,null);
      if(saved!==null) d.open = saved==="1";
      d.addEventListener("toggle", ()=>{ try{ localStorage.setItem(key, d.open?"1":"0"); }catch(e){} });
    });
  }
  { const bo=document.getElementById('busOpLabel');
    if(bo) bo.textContent = BUS_OPERATOR ? ' · ' + BUS_OPERATOR : ''; }
}
// ---- lazy bus data: fetched post-paint so the map is interactive immediately. The service
// worker caches it stale-while-revalidate, so repeat/offline launches get it instantly. ----
let busLoadTries = 0;
async function loadBusData(){
  try{
    const r = await fetch('transit_data/bus-data-' + CITY_ID + '.json');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d = await r.json();
    BUS_GRAPH = d.graph || [];  BUS_SCHED = d.sched || {};   // geometry loads on first route draw
    // graph integration builds ~70k nodes — run it off the critical path
    /* Bus nodes have just joined the graph, so every cached wait is stale — and the refIds the
       search indexes them by no longer cover the new nodes. clearWaitCache() rebuilds both. */
    const go = ()=>{ integrateBuses(); busReady = true; clearWaitCache(); busReadyResolve(); };
    if('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 200);
  }catch(e){
    // offline first-visit or transient failure: retry a few times, then leave rail-only
    if(++busLoadTries < 4) setTimeout(loadBusData, 8000 * busLoadTries);
  }
}
// pull the latest auto-scraped disruptions (committed by the GitHub Action) at runtime, so the
// panel/map go live without rebuilding the page. Same-origin on Pages; silently keeps the
// baked-in copy on file:// or when offline.
async function loadLiveDisruptions(){
  try{
    const r = await fetch('transit_data/disruptions.json?t='+Date.now(), { cache:'no-store' });
    if(!r.ok) return;
    const data = await r.json();
    if(Array.isArray(data)){ ensureEnglish(data); DISRUPTIONS = data; renderAnnouncements(); renderDisruptionMarkers(); refreshClosed(); checkDisruptionAlerts(); }
  }catch(e){ /* offline / file:// → keep the baked-in DISRUPTIONS */ }
}
// ---- city switcher: the city name in the title opens a picker. Changing city reloads with
// ?city=… so EVERY derived structure (graph, stations, sim, fares, weather, search) is rebuilt
// from that city's data — nothing can be left half-switched. ----
(function(){
  const btn=document.getElementById('cityBtn'), menu=document.getElementById('cityMenu'),
        nameEl=document.getElementById('cityName');
  if(!btn||!menu) return;
  nameEl.textContent = CITY.name;
  document.title = CITY.name + ' · RAY-NET — Live Transit Network Map';
  const lineCount = id => (CITIES[id].lines||[]).filter(l=>!l.partOf && l.scope!=='planned').length;
  // biggest network first, so the list reads İstanbul → Ankara → İzmir → Bursa → Antalya
  // which modes a city runs — same glyphs the trip planner uses, deduped in TRIP_MODES order
  const cityModes = id => {
    const c=CITIES[id], seen=new Set();
    (c.lines||[]).forEach(l=>{ if(l.scope==='active' || !l.scope) seen.add(l.kind); });
    if(c.has && c.has.bus) seen.add("bus");
    // dedupe on the GLYPH: marmaray/suburban share 🚆, funicular/cable 🚡, bus/metrobüs 🚌,
    // so filtering on the mode key alone would print the same icon twice for İstanbul
    return [...new Set(TRIP_MODES.filter(m=>seen.has(m[0])).map(m=>m[1]))];
  };
  menu.innerHTML = CITY_IDS.slice().sort((a,b)=> lineCount(b)-lineCount(a) || trCmp(CITIES[a].label,CITIES[b].label)).map(id=>{
    const c=CITIES[id], n=lineCount(id), icons=cityModes(id);
    return `<button class="city-item${id===CITY_ID?' on':''}" role="option" aria-selected="${id===CITY_ID}" data-city="${id}">
      <span class="ci-n">${svgEsc(c.label)}</span>
      <span class="ci-m" aria-hidden="true">${icons.join('')}</span>
      <span class="ci-c">${n} ${t('linesShort')}</span></button>`;
  }).join('');
  const close=()=>{ menu.classList.remove('show'); btn.setAttribute('aria-expanded','false'); };
  btn.addEventListener('click', e=>{ e.stopPropagation();
    const open=!menu.classList.contains('show');
    menu.classList.toggle('show', open); btn.setAttribute('aria-expanded', open?'true':'false'); });
  menu.addEventListener('click', e=>{ const b=e.target.closest('button[data-city]'); if(!b) return;
    close(); switchCity(b.dataset.city); });
  document.addEventListener('click', e=>{ if(!menu.contains(e.target) && e.target!==btn) close(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && focusRefs) clearRouteFocus(); });
})();
// ---- first-visit welcome / guide (reopenable from the ? header button) ----
(function(){
  const ov = document.getElementById('wcOverlay');
  const close = ()=>{ ov.classList.remove('show'); try{ localStorage.setItem('irn_welcomed','1'); }catch(e){} };
  document.getElementById('wcGo').addEventListener('click', close);
  ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
  document.getElementById('helpBtn').addEventListener('click', ()=> ov.classList.add('show'));
  try{ if(!localStorage.getItem('irn_welcomed')) ov.classList.add('show'); }catch(e){}
})();
