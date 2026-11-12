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
/* The planner can be folded, and several things put something INTO it from outside — a station's
   "route from here", a pin dropped on the map, the assistant, "use my location". The answer of a
   route appears inside the card too, so a folded planner would swallow it. Anything that sets an
   endpoint or runs a route opens the card first (without saving that as the person's preference). */
let plannerSetOpen=null;
function openPlannerCard(){
  const head=document.getElementById("plannerHead");
  if(plannerSetOpen && head && head.getAttribute("aria-expanded")==="false") plannerSetOpen(true,false);
}
function mkSheet(id){
  const s=document.createElement('div'); s.className='msheet glass'; s.id='sheet_'+id;
  s.innerHTML='<div class="mgrab"></div>';
  document.body.appendChild(s);
  if(id==='planner') return s;                 // the planner sheet has three heights and its own dragging (setupPlanSheet)
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
  /* the planner keeps the map in view and usable, so nothing is dimmed behind it (V4.4.1); the other sheets still dim the map */
  document.getElementById('mbackdrop').classList.toggle('on', !!name && name!=='planner' && name!=='modes');   // nor behind the kinds-of-transport sheet (V4.5): choosing Boats is about seeing the map
  document.body.classList.toggle('plan-open', name==='planner'); if(name!=='planner') document.body.classList.remove('plan-full');
  if(name==='planner') setPlanDetent(planRouteShown() ? 'half' : 'compact');
  for(const k in mNavBtns) mNavBtns[k].classList.toggle('on', (name===null? k==='map' : k===name));
  if(navigator.vibrate) try{ navigator.vibrate(8); }catch(e){}
}
/* ---------------------------------------------------------------------------
   THE PLANNER SHEET HAS THREE HEIGHTS (V4.4.1)
   It used to open at 80% of the screen with the map dimmed behind it, so planning a trip meant not seeing the map. Now:
     compact  From, To and the button, nothing else: about a third of the screen, the map above it and still usable
              (pan it, tap a station, use "pick a point on the map");
     half     when a route is found: the times and the first steps, with the route fitted into the map above;
     full     everything (modes, time, favourites, recent plans), and while typing, so the suggestions clear the keyboard.
   Drag the handle (or the sheet) up and down to move between them, tap the handle to step, drag down from compact to close.
   --------------------------------------------------------------------------- */
const PLAN_DETENTS = ['compact', 'half', 'full'];
let planDetent = 'compact', planTyping = false;
function planRouteShown(){ const r=document.getElementById('rout'); return !!(r && r.classList.contains('show')); }
/* the three heights in px, for this screen and this content. Compact is what the shortened content needs (measured, not guessed). */
function planHeights(s){
  const vh = window.innerHeight, cls = s.className, was = s.style.height;
  s.classList.remove('d-half','d-full'); s.classList.add('d-compact','short','measuring');
  s.style.height = 'auto';
  const compact = Math.min(s.offsetHeight, Math.round(vh * 0.5));
  s.className = cls; s.style.height = was;
  /* half is a little taller when it has a route to show: the times, the fare and the first steps */
  return { compact: compact, half: Math.max(compact + 60, Math.round(vh * (planRouteShown() ? 0.58 : 0.5))), full: Math.round(vh * 0.88) };
}
/* the lowest height that shows something useful: the Adventure planner has no short form */
function planFloor(){ const adv=document.getElementById('plannerAdv'); return adv && adv.style.display!=='none' ? 'half' : 'compact'; }
function setPlanDetent(d){
  const s = mSheets.planner; if(!s) return;
  if(d==='compact') d = planFloor();
  planDetent = d;
  PLAN_DETENTS.forEach(k => s.classList.toggle('d-'+k, k===d));
  /* the short form (From, To, no options): at compact always, and at half when there is a route to give the room to */
  s.classList.toggle('short', d==='compact' || (d==='half' && planRouteShown()));
  const h = planHeights(s)[d];
  s.style.height = h + 'px';
  document.documentElement.style.setProperty('--plan-h', h + 'px');     // the locate and assistant buttons ride above the sheet
  document.body.classList.toggle('plan-full', d==='full');             // at full height there is no map left for the floating buttons to sit on
  if(d!=='full') s.scrollTop = 0;
  const g = s.querySelector('.mgrab-btn'); if(g) g.setAttribute('aria-expanded', d==='compact' ? 'false' : 'true');
}
/* which height a drag that ended at `h` px (moving at `v` px/ms, + = growing) settles on; null = close the sheet */
function planSettle(h, v, from, H){
  if(h < H.compact - 70 || (from==='compact' && v < -0.5)) return null;
  if(Math.abs(v) > 0.45){ const i = PLAN_DETENTS.indexOf(from); return PLAN_DETENTS[Math.max(0, Math.min(2, i + (v>0 ? 1 : -1)))]; }
  return PLAN_DETENTS.reduce((a, b) => Math.abs(H[b]-h) < Math.abs(H[a]-h) ? b : a);
}
function setupPlanSheet(s){
  s.classList.add('plan');
  const grab = s.querySelector('.mgrab');
  const btn = document.createElement('button'); btn.type='button'; btn.className='mgrab-btn';
  btn.setAttribute('data-i18n-aria','sheetResize'); btn.setAttribute('aria-label', t('sheetResize')); btn.setAttribute('aria-controls','cardPlanner');
  s.replaceChild(btn, grab); btn.appendChild(grab);
  btn.addEventListener('click', () => { planTyping=false; const i=PLAN_DETENTS.indexOf(planDetent); setPlanDetent(PLAN_DETENTS[(i+1) % 3]); });
  /* dragging: the sheet follows the finger, then settles on the nearest height (or the next one, for a flick) */
  let y0=null, h0=0, moved=false, t0=0, H=null;
  s.addEventListener('touchstart', e => {
    y0=null;
    if(e.touches.length!==1 || e.target.closest('input,select,.ac-list,.jmap')) return;
    if(!e.target.closest('.mgrab-btn') && s.scrollTop>0) return;          // scrolled content scrolls; only the top of it drags
    y0=e.touches[0].clientY; h0=s.offsetHeight; moved=false; t0=performance.now(); H=planHeights(s);
  }, {passive:true});
  s.addEventListener('touchmove', e => {
    if(y0===null) return;
    const dy=e.touches[0].clientY-y0;
    if(planDetent==='full' && dy<0 && !moved){ y0=null; return; }          // at full height an upward finger scrolls the content
    if(!moved && Math.abs(dy)<6) return;
    moved=true; s.classList.add('dragging');
    s.style.height = Math.max(H.compact-150, Math.min(H.full, h0-dy)) + 'px';
  }, {passive:true});
  const end = () => {
    if(y0===null) return;
    y0=null; s.classList.remove('dragging');
    if(!moved) return;
    const h=s.offsetHeight, v=(h-h0)/Math.max(1, performance.now()-t0);
    const to=planSettle(h, v, planDetent, H);
    planTyping=false;
    if(to===null){ s.style.height=''; openSheet(null); } else setPlanDetent(to);
  };
  s.addEventListener('touchend', end, {passive:true});
  s.addEventListener('touchcancel', end, {passive:true});
  /* typing: full height, so the suggestions are above the keyboard; back down when the typing is over */
  s.addEventListener('focusin', e => { if(e.target.matches && e.target.matches('.ac-input')){ planTyping=true; setPlanDetent('full'); } });
  s.addEventListener('focusout', e => {
    if(!(e.target.matches && e.target.matches('.ac-input'))) return;
    setTimeout(() => {
      const a=document.activeElement;
      if(!planTyping || (a && a.matches && a.matches('.ac-input'))) return;
      planTyping=false; if(s.classList.contains('open')) setPlanDetent(planRouteShown() ? 'half' : 'compact');
    }, 220);
  });
  /* a route appeared or was cleared: show it at half height with the map above, or go back to the short form */
  const rout=document.getElementById('rout');
  if(rout && typeof MutationObserver!=='undefined') new MutationObserver(() => {
    if(!s.classList.contains('open')) return;
    const a=document.activeElement; if(planRouteShown() && a && a.matches && a.matches('.ac-input')) a.blur();
    planTyping=false; setPlanDetent(planRouteShown() ? 'half' : 'compact');
  }).observe(rout, { attributes:true, attributeFilter:['class'] });
  window.addEventListener('resize', () => { if(s.classList.contains('open') && !planTyping) setPlanDetent(planDetent); });
}
/* On a phone, with the planner sheet open, choosing the second end of a trip finds the route: one tap fewer, and the map above shows
   it at once. Asked by setPoint() each time an end is set; coalesced (a swap sets both ends in turn) and never repeated for the same
   pair (finding a route can itself set an end, from typed text). The button stays for changes of time, modes or card. */
let planAutoT = null, planAutoKey = '';
function planAutoRun(){
  if(!IS_MOBILE || !mSheets.planner || !mSheets.planner.classList.contains('open')) return;
  clearTimeout(planAutoT);
  planAutoT = setTimeout(() => {
    if(!originPt || !destPt || !mSheets.planner.classList.contains('open')) return;
    const key = [originPt.lat, originPt.lng, destPt.lat, destPt.lng].join(',');
    if(key === planAutoKey || (originPt.lat === destPt.lat && originPt.lng === destPt.lng)) return;
    planAutoKey = key; runRoute();
  }, 140);
}
/* What covers the map when a route is fitted into it: on a phone, the top bar and the planner sheet at the height it shows a route
   at. Leaflet's fitBounds takes these as padding, so the whole route lands in the part of the map that can be seen. */
function mapFitPad(){
  if(!IS_MOBILE) return null;
  const s=mSheets.planner, tb=document.querySelector('.topbar');
  const top = tb ? Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) + 10 : 10;
  /* the planner at the height it shows a route at; or whatever other sheet is open over an undimmed map (the kinds of transport) */
  const other = document.querySelector('.msheet.modes.open');
  const bottom = s && s.classList.contains('open') ? planHeights(s).half + 10 : (other ? other.offsetHeight + 10 : 100);
  return { paddingTopLeft:[28, top], paddingBottomRight:[28, bottom] };
}
/* The Map button (V4.5). Anywhere else, it brings back the default map: sheets and panels closed, the full network on show.
   Pressed again, already there, it opens the kinds of transport (Metro & rail / Buses / Boats). */
function mapIsDefault(){
  const shown = id => { const e=document.getElementById(id); return !!(e && e.classList.contains('show')); };
  return currentTab==='active' && !document.querySelector('.msheet.open') && !shown('stn') && !shown('linp');
}
function mapButton(){
  if(mapIsDefault()){ openSheet('modes'); return; }
  openSheet(null);
  if(typeof closeAllPanels==='function') closeAllPanels();
  if(currentTab!=='active') setTab('active');
}
function syncModeSeg(tab){
  document.querySelectorAll('#modeSeg button').forEach(b => { const on = b.dataset.mode===tab || (b.dataset.mode==='active' && tab!=='bus' && tab!=='boat'); b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
}
function setupMobile(){
  if(!IS_MOBILE) return;
  document.body.classList.add('mobile');
  // backdrop + toast
  const bd=document.createElement('div'); bd.id='mbackdrop'; bd.className='mbackdrop';
  bd.addEventListener('click',()=>openSheet(null)); document.body.appendChild(bd);
  // sheets
  /* Four sheets, four buttons. Weather is one of the scopes in the Layers sheet (Active / Vision / Buses / Intercity / Weather), so it
     has no sheet or button of its own. */
  mSheets={ planner:mkSheet('planner'), layers:mkSheet('layers'), alerts:mkSheet('alerts'), modes:mkSheet('modes') };
  /* V4.5: the kinds of transport live behind the Map button. Its first press is the default map; pressed again there, it opens this
     sheet: Metro & rail (the full map), Buses, Boats. Buses used to be one of the views in the Layers sheet. */
  mSheets.modes.classList.add('modes');
  { const seg=document.createElement('div'); seg.className='mode-seg'; seg.id='modeSeg'; seg.setAttribute('role','tablist'); seg.setAttribute('aria-label', t('modesTitle')); seg.setAttribute('data-i18n-aria','modesTitle');
    const kinds=[ ['active','🚇','modeRail', true], ['bus','🚌','modeBus', !!HAS.bus], ['boat','⛴','modeBoat', boatLines.length>0] ];
    kinds.forEach(([tab,icon,key,has])=>{ if(!has) return;
      const b=document.createElement('button'); b.type='button'; b.dataset.mode=tab; b.setAttribute('role','tab');
      b.innerHTML=`<span class="mode-i" aria-hidden="true">${icon}</span><span data-i18n="${key}">${t(key)}</span>`;
      b.addEventListener('click',()=>{ if(currentTab!==tab) setTab(tab); if(tab==='active') openSheet(null); });
      seg.appendChild(b); });
    const hint=document.createElement('div'); hint.className='mode-hint'; hint.setAttribute('data-i18n','modeHint'); hint.textContent=t('modeHint');
    mSheets.modes.appendChild(seg); mSheets.modes.appendChild(hint); }
  // installing is offered in Settings → App, for phones and desktop alike
  // reparent the desktop cards into their sheets (order preserved)
  const controls=document.querySelector('.controls');
  [...controls.children].forEach(el=>{
    if(el.id==='cardPlanner') mSheets.planner.appendChild(el);
    else if(el.id==='cardBus' || el.id==='cardBoats') mSheets.modes.appendChild(el);
    else mSheets.layers.appendChild(el);
    el.style.display='';   // sheets control visibility now; setTab still toggles the weather / bus / intercity cards
  });
  document.getElementById('cardPlanner').style.display='';
  setupPlanSheet(mSheets.planner);
  const ann=document.getElementById('announce'); mSheets.alerts.appendChild(ann); ann.classList.remove('collapsed');
  // bottom navigation
  const nav=document.createElement('div'); nav.className='mnav glass';
  const items=[ ['map','🗺','mMap'], ['planner','⇆','mPlanner'], ['layers','◈','mLayers'], ['alerts','📢','mAlerts'] ];
  items.forEach(([k,icon,key])=>{
    const b=document.createElement('button');
    b.innerHTML=`<span class="mi">${icon}</span><span class="ml" data-i18n="${key}">${t(key)}</span>`;
    b.addEventListener('click',()=>{
      if(k==='map'){ mapButton(); return; }
      // the planner only works on the İstanbul network — leave any non-metro scope first
      if(k==='planner' && (currentTab==='weather'||currentTab==='bus'||currentTab==='boat'||currentTab==='intercity')) setTab('active');
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
  /* The Trip Planner card folds the same way, and remembers it separately: someone who keeps the
     layers open but the planner tucked away (or the reverse) gets exactly that back. */
  const wireFold=(headId, bodyId, key)=>{
    const head=document.getElementById(headId), body=document.getElementById(bodyId);
    if(!head || !body) return null;
    const setOpen=(open,save)=>{
      body.classList.toggle("folded", !open);
      head.setAttribute("aria-expanded", open?"true":"false");
      if(save){ try{ localStorage.setItem(key, open?"1":"0"); }catch(e){} }
    };
    setOpen(lsStr(key,"1")!=="0", false);
    head.addEventListener("click", ()=> setOpen(body.classList.contains("folded"), true));
    return setOpen;
  };
  { wireFold("layersHead","layersBody","irn_layers");
    plannerSetOpen = wireFold("plannerHead","plannerBody","irn_planner");
    // the "skip to trip planner" link lands on a card that may be folded: open it first
    const skip=document.querySelector('.skip-link[href="#cardPlanner"]');
    if(skip) skip.addEventListener("click", openPlannerCard);
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
    const stamp = Date.now();
    // the small status file says when the notices were last read from the operator; it is optional, and a miss just means "unknown"
    const [r, sr] = await Promise.all([
      fetch('transit_data/disruptions.json?t='+stamp, { cache:'no-store' }),
      fetch('transit_data/disruptions-status.json?t='+stamp, { cache:'no-store' }).catch(() => null)
    ]);
    if(!r.ok) return;
    const data = await r.json();
    if(sr && sr.ok){ try{ const st = await sr.json(), ms = Date.parse(st.checkedAt), fm = Date.parse(st.ferryCheckedAt);
      if(isFinite(ms)) DISR_CHECKED = ms;
      DISR_FERRY_CHECKED = isFinite(fm) ? fm : null;       // an older status file has one time for both
    }catch(e){} }
    if(Array.isArray(data)){ ensureEnglish(data); DISRUPTIONS = data; applyDisruptionFeed(); checkDisruptionAlerts(); }
  }catch(e){ /* offline / file:// → keep the baked-in DISRUPTIONS */ }
}
// a tab left open all day used to keep the notices it was opened with, and would now also keep the age it computed from them
if(HAS.disruptions) setInterval(() => { if(!document.hidden) loadLiveDisruptions(); }, 10 * 60 * 1000);
// ---- city switcher: the city name in the title opens a picker. Changing city reloads with
// ?city=… so EVERY derived structure (graph, stations, sim, fares, weather, search) is rebuilt
// from that city's data — nothing can be left half-switched. ----
(function(){
  const btn=document.getElementById('cityBtn'), menu=document.getElementById('cityMenu'),
        nameEl=document.getElementById('cityName');
  if(!btn||!menu) return;
  nameEl.textContent = CITY.name;
  document.title = CITY.name + ' · TURKMAPS — Transit Network Map';
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
