/* ===========================================================================
   SETTINGS — theme (dark/light), route preference (fastest / fewest changes),
   and the settings panel. All choices persist in localStorage (this device).
   =========================================================================== */
const lsStr=(k,def)=>{ try{ const s=localStorage.getItem(k); return s==null?def:s; }catch(e){ return def; } };
const lsJSON=(k)=>{ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
let themePref = (function(){ const s=lsStr('irn_theme'); if(s==='light'||s==='dark'||s==='auto') return s;
  return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; })();
let routePref = (function(){ const s=lsStr('irn_routePref'); return (s==='fast'||s==='easy')?s:'fast'; })();
function resolveTheme(pref){ if(pref==='auto'){ const h=new Date().getHours(); return (h>=19||h<7)?'dark':'light'; } return pref==='light'?'light':'dark'; }
function applyTheme(pref, syncBase){
  themePref = (pref==='light'||pref==='auto') ? pref : 'dark';
  try{ localStorage.setItem('irn_theme', themePref); }catch(e){}
  const actual = resolveTheme(themePref);
  document.body.classList.toggle('light', actual==='light');
  const tc=document.querySelector('meta[name="theme-color"]'); if(tc) tc.setAttribute('content', actual==='light'?'#E9EEF5':'#070A12');
  document.querySelectorAll('#themeSeg button').forEach(b=> b.classList.toggle('active', b.dataset.theme===themePref));
  // keep the map basemap in step with the UI theme (unless the user is on Satellite)
  if(syncBase && typeof setBase==='function'){
    if(actual==='light' && curBaseKey==='dark') setBase('voyager');
    else if(actual==='dark' && curBaseKey==='voyager') setBase('dark');
  }
}
setInterval(()=>{ if(themePref==='auto') applyTheme('auto', true); }, 300000);   // re-check auto theme every 5 min
function setRoutePref(p, rerun){
  routePref = p==='easy' ? 'easy' : 'fast';
  try{ localStorage.setItem('irn_routePref', routePref); }catch(e){}
  document.querySelectorAll('#prefSeg button').forEach(b=> b.classList.toggle('active', b.dataset.pref===routePref));
  if(rerun && originPt && destPt && currentOpts && currentOpts.length) runRoute();
}
// re-rank the found itineraries per the user's preference before display
/* ---- per-trip customisation: which modes to use, which lines to avoid, how to rank the
   alternatives. All of it is scoped to the CURRENT trip (Settings keeps the global
   defaults), so experimenting here never changes the traveller's saved preferences. ---- */
let tripAvoidLines = new Set();
let optSort = 'pref';        // pref | time | changes | walk | fare
const TRIP_MODES = [['subway','🚇'],['tram','🚊'],['marmaray','🚆'],['suburban','🚆'],
                    ['ferry','⛴'],['bus','🚌'],['funicular','🚡'],['cable','🚡'],['metrobus','🚌']];
function tripModeList(){                     // only modes this city actually has
  const seen=[];
  liveLines.forEach(l=>{ if(seen.indexOf(l.kind)<0) seen.push(l.kind); });
  if(HAS.bus && seen.indexOf('bus')<0) seen.push('bus');
  return TRIP_MODES.filter(m=>seen.indexOf(m[0])>=0);
}
// official card artwork, keyed city → card. Only products whose exact identity is confirmed
// appear here; everything else falls back to the drawn face below.
const CARD_IMG = __CARDIMG_JSON__;
/* A face for the selected product: the operator name, the tier and the published boarding
   fare, coloured by card family. It is an illustration of the product, not a photograph of
   the plastic — enough to confirm at a glance which card the trip is being priced on. */
const CARD_ART = {
  tam:      ['#0E7C9E','#0A5A7F'], ogrenci:  ['#1E9E63','#116B45'],
  genc:     ['#1E9E63','#116B45'], ogretmen: ['#7A5AC9','#553C9A'],
  indirimli:['#C98A2E','#96601A'], abonman:  ['#2563EB','#1D4ED8'],
  bank:     ['#39414F','#222831']
};
function cardArtSVG(key, c){
  const g=CARD_ART[key]||CARD_ART.tam;
  const parts=String(c.label||'').split('·');
  const brand=(parts[0]||'').trim(), tier=(parts[1]||'').trim();
  const big=tier||brand;
  // a portrait card is narrow, so long names wrap rather than shrink to nothing
  const lines=wrapCardName(big, 12);
  const fs=lines.length>1 ? 7.4 : big.length>9 ? 8 : 9.5;
  const fare=c.unlimited ? '∞' : c.base+'₺';
  // a transit card carries a contact chip; a bank card is recognised by its contactless mark
  const mark = key==='bank'
    ? `<g fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round">
         <path d="M11 20a6 6 0 0 1 0 8.5"/><path d="M15.3 16.5a11.5 11.5 0 0 1 0 15.5"/>
         <path d="M19.6 13a17 17 0 0 1 0 22.5"/></g>`
    : `<g><rect x="9" y="17" width="15" height="11.5" rx="2.4" fill="#E9C877"/>
         <path d="M16.5 17v11.5M9 22.75h15" stroke="#B9954A" stroke-width=".85"/></g>`;
  const y0=lines.length>1 ? 74 : 79;
  return `<svg viewBox="0 0 66 105" role="img" aria-label="${svgEsc(c.label||'')}">
    <defs><linearGradient id="cgArt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${g[0]}"/><stop offset="1" stop-color="${g[1]}"/></linearGradient></defs>
    <rect x=".6" y=".6" width="64.8" height="103.8" rx="6.5" fill="url(#cgArt)"/>
    <path d="M0 60 L66 26 L66 105 L0 105 Z" fill="#fff" fill-opacity=".07"/>
    <rect x=".6" y=".6" width="64.8" height="103.8" rx="6.5" fill="none" stroke="#fff" stroke-opacity=".26"/>
    ${mark}
    ${tier ? `<text x="9" y="62" fill="#fff" fill-opacity=".82" font-size="5.4" font-weight="700" letter-spacing=".3">${svgEsc(brand)}</text>` : ''}
    ${lines.map((L,i)=>`<text class="ca-name" x="9" y="${y0+i*9}" fill="#fff" font-size="${fs}" font-weight="800">${svgEsc(L)}</text>`).join('')}
    <text class="ca-fare" x="9" y="97" fill="#fff" fill-opacity=".9" font-size="7.6" font-weight="800">${fare}</text>
  </svg>`;
}
// wrap a product name onto at most two lines that fit the narrow portrait card
function wrapCardName(s, max){
  const out=[]; let cur='';
  String(s).split(/\s+/).forEach(w=>{
    const test = cur ? cur+' '+w : w;
    if(test.length<=max || !cur) cur=test; else { out.push(cur); cur=w; }
  });
  if(cur) out.push(cur);
  return out.length>2 ? [out[0], out.slice(1).join(' ')] : out;
}
// the real card when its exact product is confirmed, the drawn face otherwise
function cardFaceHTML(key, c){
  const img=((CARD_IMG.cities||{})[CITY_ID]||{})[key];
  if(img) return `<img class="ca-img" src="${img.src}"
    alt="${svgEsc(c.label||'')}" title="${svgEsc(img.product||'')}" decoding="async">`;
  return cardArtSVG(key, c);
}
// the fare products this city publishes; hidden entirely for cities with a single tariff
/* Offline basemap. Tiles are cached as you pan, so anywhere you have looked at already works
   offline; this button additionally walks the CURRENT view over a few zoom levels so you can
   prepare an area on purpose before losing signal. It is deliberately bounded and
   user-initiated — bulk-harvesting a provider's tile pyramid is against CARTO's and OSM's
   usage policies, and is not what this does. Everything else needed to plan a trip (network,
   stations, fares, timetables, the routing graph) is already local. */
const OFF_TILE_BUDGET = 700;        // hard ceiling per press
function offTilesFor(bounds, z){
  const lon2x = (lon,z)=>Math.floor((lon+180)/360*Math.pow(2,z));
  const lat2y = (lat,z)=>{ const r=lat*Math.PI/180;
    return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z)); };
  const x0=lon2x(bounds.getWest(),z), x1=lon2x(bounds.getEast(),z);
  const y0=lat2y(bounds.getNorth(),z), y1=lat2y(bounds.getSouth(),z);
  const out=[];
  for(let x=Math.min(x0,x1);x<=Math.max(x0,x1);x++)
    for(let y=Math.min(y0,y1);y<=Math.max(y0,y1);y++) out.push([z,x,y]);
  return out;
}
function offTileURL(z,x,y){
  /* Fill the ACTIVE layer's own template, so a saved tile is byte-identical to what Leaflet
     will later request — including the {r} "@2x" suffix on retina screens and the layer's
     own subdomain rotation. The cache is keyed on the exact URL, so a near-miss saves nothing.

     NOT layer.getTileUrl(coords): that substitutes _getZoomForUrl(), the layer's CURRENT
     zoom, and ignores coords.z — so prefetching several zoom levels wrote every one of them
     under the on-screen zoom with mismatched x/y, collapsing ~340 tiles to 24 useless ones. */
  try{
    const lyr = curBase;
    return L.Util.template(lyr._url, L.extend({
      r: L.Browser.retina ? '@2x' : '',
      s: lyr._getSubdomain({ x:x, y:y, z:z }),
      x: x, y: y, z: z
    }, lyr.options));
  }catch(e){ return null; }
}
let deferredInstall=null;                 // set by beforeinstallprompt, consumed by the Settings row
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);   // iPadOS reports as Mac
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function refreshInstallRow(){
  const btn=document.getElementById("instBtn"), note=document.getElementById("instNote");
  if(!btn||!note) return;
  if(isStandalone()){
    btn.style.display="none"; note.textContent=t("installDone"); return;
  }
  if(deferredInstall){
    btn.style.display=""; btn.disabled=false; note.textContent=t("installWhy");
    btn.onclick = async ()=>{
      btn.disabled=true;
      try{
        deferredInstall.prompt();
        const res=await deferredInstall.userChoice;
        deferredInstall=null;
        note.textContent = (res && res.outcome==="accepted") ? t("installDone") : t("installWhy");
        if(res && res.outcome==="accepted") btn.style.display="none"; else btn.disabled=false;
      }catch(e){ btn.disabled=false; }
    };
    return;
  }
  // no programmatic prompt available on this browser
  btn.style.display="none";
  note.textContent = isIOS() ? t("installIOS") : t("installManual");
}
window.addEventListener("appinstalled", ()=>{ deferredInstall=null; refreshInstallRow(); });
async function offPersist(){
  try{
    if(!navigator.storage || !navigator.storage.persist) return null;
    if(await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  }catch(e){ return null; }
}
let offBusy=false;
async function offSaveArea(){
  if(offBusy || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
  const btn=document.getElementById("offSave"), note=document.getElementById("offNote");
  offBusy=true; btn.disabled=true;
  await offPersist();                 // ask before filling the cache, not after
  /* The button lives in a settings sheet that covers the map on a phone. If the map has not
     been laid out (or was measured while hidden) getSize() is 0x0, getBounds() collapses to a
     point, and this would cheerfully "save" one tile per zoom and report success. Force a
     measure first, and refuse rather than pretend if the viewport still has no extent. */
  map.invalidateSize();
  const b=map.getBounds(), z0=Math.round(map.getZoom());
  if(!(b.getEast()-b.getWest()) || !(b.getNorth()-b.getSouth())){
    document.getElementById("offNote").textContent = t("offNoView");
    offBusy=false; btn.disabled=false; return;
  }
  let list=[];
  for(let z=Math.max(6,z0-1); z<=Math.min(17,z0+2) && list.length<OFF_TILE_BUDGET; z++){
    for(const t of offTilesFor(b,z)){ if(list.length>=OFF_TILE_BUDGET) break; list.push(t); }
  }
  let done=0, failed=0;
  const CONC=6;
  const queue=list.slice();
  await Promise.all(Array.from({length:CONC}, async ()=>{
    while(queue.length){
      const [z,x,y]=queue.shift();
      const u=offTileURL(z,x,y); if(!u){ failed++; done++; continue; }
      // CORS, matching the tile layer's own crossOrigin requests — so the saved entry is the
      // same non-opaque response Leaflet will later pull from the cache, and is not padded
      try{ await fetch(u, {mode:"cors"}); }catch(e){ failed++; }
      done++;
      if(done%25===0) note.textContent=t("offSaving").replace("{n}",done).replace("{t}",list.length);
    }
  }));
  offBusy=false; btn.disabled=false;
  offRefreshNote();
}
function offRefreshNote(){
  const note=document.getElementById("offNote"); if(!note) return;
  if(!navigator.serviceWorker || !navigator.serviceWorker.controller){ note.textContent=t("offUnavailable"); return; }
  navigator.serviceWorker.controller.postMessage("tileStats");
}
if(navigator.serviceWorker){
  navigator.serviceWorker.addEventListener("message", async ev=>{
    if(!ev.data || ev.data.type!=="tileStats") return;
    const note=document.getElementById("offNote"); if(!note) return;
    // measured from the Storage API where available, rather than a per-tile guess
    let mb=(ev.data.count*0.03).toFixed(1);
    try{
      if(navigator.storage && navigator.storage.estimate){
        const est=await navigator.storage.estimate();
        if(est && est.usage) mb=(est.usage/1048576).toFixed(1);
      }
    }catch(e){}
    let txt = t("offStored").replace("{n}", ev.data.count).replace("{mb}", mb);
    try{
      if(navigator.storage && navigator.storage.persisted){
        txt += " " + (await navigator.storage.persisted() ? t("offKept") : t("offEvictable"));
      }
    }catch(e){}
    note.textContent = txt;
  });
}
function renderCardSeg(){
  const sel=document.getElementById('cardSel'), row=document.getElementById('cardRow'),
        note=document.getElementById('cardNote'), art=document.getElementById('cardArt');
  if(!sel||!row) return;
  const cards=FARE.cards;
  if(!cards){ row.style.display='none'; return; }
  row.style.display='';
  sel.innerHTML=Object.keys(cards).map(k=>
    `<option value="${k}">${svgEsc(cards[k].label)}</option>`).join('');
  sel.value=fareCard;
  sel.setAttribute('aria-label', t('fareCard'));
  const c=cardDef();
  if(art) art.innerHTML=cardFaceHTML(fareCard, c);
  // credit the artwork only while it is actually being shown
  const cr=document.getElementById('cardCredit');
  const ci=((CARD_IMG.cities||{})[CITY_ID]||{})[fareCard];
  if(cr) cr.textContent = ci ? t('cardImgCredit').replace('{who}', ci.credit||'') : '';
  const bits=[];
  if(c.unlimited) bits.push(t('cardUnlimited').replace('{n}', c.monthly));
  else bits.push(t('cardPerRide').replace('{n}', c.base));
  if(c.noXfer) bits.push(t('cardNoXfer'));
  if(c.derived) bits.push(t('cardDerived'));
  note.textContent=bits.join(' · ');
}
function renderModeChips(){
  const el=document.getElementById('modeChips'); if(!el) return;
  el.innerHTML = tripModeList().map(m=>{
    const off = avoidModes.has(m[0]);
    return `<button class="mchip ${off?'off':'on'}" data-mode="${m[0]}">${m[1]} ${svgEsc(kindLabel(m[0])||m[0])}</button>`;
  }).join('');
}
function renderAvoidRow(){
  const el=document.getElementById('avoidRow'); if(!el) return;
  el.innerHTML = [...tripAvoidLines].map(r=>{
    const c=colorForLine(r);
    return `<button class="achip" data-unavoid="${svgEsc(r)}"><span class="badge" style="background:${c};color:${inkOn(c)}">${svgEsc(r)}</span>${t('avoiding')}<span class="x">✕</span></button>`;
  }).join('');
}
function toggleTripMode(mode){
  // per-trip only: mirrors into avoidModes for the search, but does NOT persist to Settings
  if(avoidModes.has(mode)) avoidModes.delete(mode); else avoidModes.add(mode);
  renderModeChips();
  if(plannerMode==='adv') planAdventure(); else runRoute();
}
function avoidLine(ref){ if(!ref) return; tripAvoidLines.add(ref); renderAvoidRow();
  if(plannerMode==='adv') planAdventure(); else runRoute(); }
function unavoidLine(ref){ tripAvoidLines.delete(ref); renderAvoidRow();
  if(plannerMode==='adv') planAdventure(); else runRoute(); }
function optWalkMin(o){ return (o.it.steps||[]).filter(s=>s.type==='walk').reduce((a,s)=>a+(s.mins||0),0); }
function optFare(o){ try{ return estimateFare(o.it).tl; }catch(e){ return 0; } }
function setOptSort(v){ optSort=v; sortOptsByPref(); renderOptChips(); selectOption(0); }
function sortOptsByPref(){
  if(!currentOpts || !currentOpts.length) return;
  /* Compare on the DOOR-TO-DOOR time, waiting included. Sorting on travel-only made a route
     that is quick once you are aboard beat one you can actually catch — most visibly at night,
     when the fastest ride is on a line that has not started running. */
  const dt = x => (x.it.doorTotal != null ? x.it.doorTotal : x.it.total);
  if(optSort==='time')         currentOpts.sort((a,b)=> dt(a)-dt(b));
  else if(optSort==='changes') currentOpts.sort((a,b)=> (a.it.transfers-b.it.transfers) || (dt(a)-dt(b)));
  else if(optSort==='walk')    currentOpts.sort((a,b)=> (optWalkMin(a)-optWalkMin(b)) || (dt(a)-dt(b)));
  else if(optSort==='fare')    currentOpts.sort((a,b)=> (optFare(a)-optFare(b)) || (dt(a)-dt(b)));
  else if(routePref==='easy')  currentOpts.sort((a,b)=> (a.it.transfers-b.it.transfers) || (a.it.total-b.it.total));
  else                         currentOpts.sort((a,b)=> (a.it.total-b.it.total) || (a.it.transfers-b.it.transfers));
  currentOptIdx=0;
}
function openSettings(){ document.getElementById('settingsPanel').classList.add('open'); document.getElementById('settingsOverlay').classList.add('on'); }
function closeSettings(){ document.getElementById('settingsPanel').classList.remove('open'); document.getElementById('settingsOverlay').classList.remove('on'); }
function resetTrips(){ planHistory=[]; planFavs=[]; lsSet(LS_HIST,planHistory); lsSet(LS_FAV,planFavs); renderPlanLists(); updateFavBtn(); showToast(t('tripsCleared')); }

/* ---- display / accessibility ---- */
let textSize   = lsStr('irn_textsize')==='large' ? 'large' : 'normal';
let reduceMotionPref = lsStr('irn_motion')==='1';
let highContrastPref = lsStr('irn_contrast')==='1';
let unitSystem = lsStr('irn_units')==='imperial' ? 'imperial' : 'metric';
let clock24    = lsStr('irn_clock')!=='12';        // default 24-hour
let walkPaceKey= (function(){ const s=lsStr('irn_walk'); return (s==='slow'||s==='fast')?s:'normal'; })();
const WALK_PACE={ slow:65, normal:80, fast:100 };
let avoidModes = new Set((function(){ const a=lsJSON('irn_avoid'); return Array.isArray(a)?a:[]; })());
let homePlace  = lsJSON('irn_home');   // {name,lat,lng} | null
let workPlace  = lsJSON('irn_work');
let stepFreePref = lsStr('irn_stepfree')==='1';   // Settings → prefer step-free (elevator) routes
function applyDisplayPrefs(){
  document.body.classList.toggle('large-text', textSize==='large');
  document.body.classList.toggle('reduce-motion', reduceMotionPref);
  document.body.classList.toggle('high-contrast', highContrastPref);
}
let uiStyle = (function(){ try{ const v=localStorage.getItem('irn_uistyle'); return v==='calm'?'calm':'neon'; }catch(e){ return 'neon'; } })();
function setUiStyle(v, save){
  uiStyle = v==='calm' ? 'calm' : 'neon';
  document.body.classList.toggle('calm', uiStyle==='calm');
  if(save){ try{ localStorage.setItem('irn_uistyle', uiStyle); }catch(e){} }
  document.querySelectorAll('#styleSeg button').forEach(b=> b.classList.toggle('active', b.dataset.uis===uiStyle));
  // the map's line glow is drawn, not styled — thin it out so the map matches the calmer chrome
  if(typeof linePolys!=='undefined'){
    linePolys.forEach(o=>{ if(o.glow) o.pl.setStyle({ opacity: uiStyle==='calm' ? 0.07 : o.baseOp }); });
  }
}
function setTextSize(s){ textSize=s==='large'?'large':'normal'; try{localStorage.setItem('irn_textsize',textSize);}catch(e){}
  document.querySelectorAll('#textSeg button').forEach(b=>b.classList.toggle('active', b.dataset.ts===textSize)); applyDisplayPrefs(); }
function setReduceMotion(on){ reduceMotionPref=!!on; try{localStorage.setItem('irn_motion',on?'1':'0');}catch(e){}
  const c=document.getElementById('swMotion'); if(c) c.classList.toggle('on',reduceMotionPref); applyDisplayPrefs(); }
function setHighContrast(on){ highContrastPref=!!on; try{localStorage.setItem('irn_contrast',on?'1':'0');}catch(e){}
  const c=document.getElementById('swContrast'); if(c) c.classList.toggle('on',highContrastPref); applyDisplayPrefs(); }

/* ---- units + clock ---- */
function distStr(km){ if(unitSystem==='imperial'){ const mi=km*0.621371; return mi.toFixed(mi<10?1:0)+' mi'; } return km.toFixed(1)+' km'; }
function distNum(km){ return unitSystem==='imperial' ? (km*0.621371) : km; }
function distUnit(){ return unitSystem==='imperial'?'mi':'km'; }
function timeOpts(o){ return Object.assign({ timeZone:'Europe/Istanbul', hour12:!clock24 }, o||{}); }
function setUnits(u){ unitSystem=u==='imperial'?'imperial':'metric'; try{localStorage.setItem('irn_units',unitSystem);}catch(e){}
  document.querySelectorAll('#unitSeg button').forEach(b=>b.classList.toggle('active', b.dataset.u===unitSystem)); }
function setClock(c){ clock24=c!=='12'; try{localStorage.setItem('irn_clock',clock24?'24':'12');}catch(e){}
  document.querySelectorAll('#clockSeg button').forEach(b=>b.classList.toggle('active', b.dataset.ck===(clock24?'24':'12'))); }

/* ---- walking pace → router walk speed ---- */
function setWalkPace(k, rerun){ walkPaceKey=(k==='slow'||k==='fast')?k:'normal'; WALK=WALK_PACE[walkPaceKey];
  try{localStorage.setItem('irn_walk',walkPaceKey);}catch(e){}
  document.querySelectorAll('#paceSeg button').forEach(b=>b.classList.toggle('active', b.dataset.pace===walkPaceKey));
  if(rerun && originPt && destPt && currentOpts && currentOpts.length) runRoute(); }

/* ---- avoid modes (ferry / bus) — read by routeXY ---- */
function nodeMode(k){ const m=nodeMeta[k]; if(!m) return null; if(m.kind==='bus') return 'bus'; const ln=lineByRef[m.ref]; return ln?ln.kind:null; }
function setAvoid(mode, on, rerun){
  if(on) avoidModes.add(mode); else avoidModes.delete(mode);
  try{ localStorage.setItem('irn_avoid', JSON.stringify([...avoidModes])); }catch(e){}
  const sw=document.getElementById(mode==='ferry'?'swAvoidFerry':'swAvoidBus'); if(sw) sw.classList.toggle('on', avoidModes.has(mode));
  if(rerun && originPt && destPt && currentOpts && currentOpts.length) runRoute(); }
function setStepFree(on, rerun){ stepFreePref=!!on; try{localStorage.setItem('irn_stepfree',on?'1':'0');}catch(e){}
  const sw=document.getElementById('swStepFree'); if(sw) sw.classList.toggle('on', stepFreePref);
  if(rerun && originPt && destPt && currentOpts && currentOpts.length) runRoute(); }

/* ---- İstanbulkart fare estimate — İBB tariff effective 20 Jul 2026 (+10% council decision).
   Exact published figures: full boarding 46.20; Marmaray distance bands 37.40–82.17;
   Metrobüs stop bands 33.08–68.59; Şehir Hatları 58.52 (short crossing) / 65.21 (Kadıköy
   runs) / 171.89 (Adalar). Transfer tiers are the Feb tiers +10% (34.40/26.42/17.18) — the
   exact post-hike tiers weren't published at ship time, hence the "≈" and the ⓘ note.
   Intermediate Marmaray/Metrobüs bands are interpolated between the published endpoints.
   Banded modes are charged full band fare even mid-chain (conservative: never under-quotes). */
/* Fares come from the ACTIVE CITY's tariff, and the three cities genuinely price differently:
     İstanbul (İstanbulkart) — base + decreasing aktarma tiers, distance bands on Marmaray/
                               Metrobüs, ferries on their own tariff.
     Ankara   (AnkaraKart)   — flat base + one flat transfer price.
     İzmir    (İzmirim Kart) — base, then transfers FREE inside the 90-min window (xfer:[0]);
                               İZBAN is charged separately and grants no transfer right.
   The generic walker below covers all three: any field a city omits is simply skipped. */
const FARE = CITY.fare;
function bandFare(b,n){
  let i=b.bands.findIndex(x=>n<=x); if(i<0) i=b.bands.length-1;
  return b.min + (b.max-b.min)*(i/(b.bands.length-1));
}
let fareCard = (function(){ try{ return localStorage.getItem("irn_farecard")||"tam"; }catch(e){ return "tam"; } })();
function cardDef(){ const c=FARE.cards; if(!c) return { base:FARE.base, xfer:FARE.xfer };
  return c[fareCard] || c.tam || c[Object.keys(c)[0]]; }
// distance bands are published at full fare, so scale them to the selected product
function cardScale(){ const c=cardDef(); if(c.unlimited) return 0;
  if(!FARE.cards || !FARE.cards.tam) return 1; return c.base / FARE.cards.tam.base; }
function setFareCard(v, rerun){ fareCard=v;
  try{ localStorage.setItem("irn_farecard", v); }catch(e){}
  try{ renderCardSeg(); }catch(e){}
  if(rerun){ if(plannerMode==="adv") planAdventure(); else if(currentOpts.length) runRoute(); } }
function estimateFare(it){
  const rides=(it.steps||[]).filter(s=>s.type==='ride');
  if(!rides.length) return { taps:0, tl:0, charged:0, refund:0, legs:[] };
  const card=cardDef(), scale=cardScale();
  const refundModes=(FARE.refund&&FARE.refund.modes)||[];
  const legs=[];                           // per-boarding: what is taken, and what comes back
  let chain=0;
  for(const r of rides){
    const line=lineByRef[r.ref];
    const kind=r.bus?'bus':(line?line.kind:'subway');
    const n=Math.max(1,(r.stops||[]).length-1);
    const push=(tl,charged,refund,note)=>{ legs.push({ ref:r.ref, bus:!!r.bus,
      tl:+tl.toFixed(2), charged:+charged.toFixed(2), refund:+refund.toFixed(2), note }); };
    if(kind==='ferry' && FARE.ferry){     // Şehir Hatları: own tariff, outside the aktarma chain
      const f=(/ada/i.test(r.ref||'') ? FARE.adalar : (n<=1?FARE.ferryShort:FARE.ferry))*scale;
      push(f,f,0,'ferry'); continue;
    }
    /* A line the city prices on its OWN tariff, keyed by ref. Two different reasons a line
       lands here, and a city can have both at once (Kocaeli does):
         • on the transit card but on a separate tariff — its ferries, at 25.25₺ not 36₺;
         • not on the card at all — the Kartepe and Uludağ cable cars sell their own ticket
           at the station, which is why they cost 250₺ and 500₺ rather than a bus fare.
       Either way the leg sits outside the aktarma chain. Falls back to the full-fare figure
       when a card has no published rate of its own. */
    const lf = FARE.lineFares && FARE.lineFares[r.ref];
    if(lf){
      const f = (lf[fareCard]!=null) ? lf[fareCard] : lf.tam;
      if(f!=null){ push(f,f,0,'own'); continue; }
    }
    // a suburban line with its own flat tariff and no transfer right (İzmir's İZBAN)
    if(FARE.suburbanFare && (FARE.suburbanRefs||[]).indexOf(r.ref)>=0){
      // prefer the card's own published suburban fare over a scaled one
      const f = (card.suburbanFare!=null) ? card.suburbanFare : FARE.suburbanFare*scale;
      push(f,f,0,'own'); continue; }
    // DISTANCE-BANDED modes: the turnstile takes the MAXIMUM band up front; the difference is
    // only recovered by tapping the "ücret iade" device on the way out (2-hour window).
    let band=null, bandKey=null;
    if(FARE.marmaray && r.ref==='Marmaray'){ band=FARE.marmaray; bandKey='marmaray'; }
    else if(FARE.metrobus && r.ref==='Metrobüs'){ band=FARE.metrobus; bandKey='metrobus'; }
    if(band){
      // Distance bands are the LINE's own published tariff. Scale them DOWN for discounted
      // products, but never up: a bank card is charged the single-ride price, and inflating
      // the band past its published maximum would be an unsupported extrapolation.
      const bScale=Math.min(scale,1);
      const actual=bandFare(band,n)*bScale, upfront=band.max*bScale;
      const refundable = refundModes.indexOf(bandKey)>=0 ? Math.max(0, upfront-actual) : 0;
      push(actual, actual+refundable, refundable, 'band');
      chain++; continue;
    }
    { const x=card.xfer, noX=card.noXfer||!x||!x.length;
      const amt=(chain===0||noX) ? card.base : x[Math.min(chain-1, x.length-1)];
      push(amt, amt, 0, chain===0?'first':'xfer'); }
    chain++;
  }
  const tl=legs.reduce((s2,l)=>s2+l.tl,0);
  const charged=legs.reduce((s2,l)=>s2+l.charged,0);
  const refund=legs.reduce((s2,l)=>s2+l.refund,0);
  return { taps:rides.length, tl:Math.round(tl), charged:Math.round(charged),
           refund:Math.round(refund), legs, card:card.label||'', unlimited:!!card.unlimited };
}

/* ---- service warnings for a planned route: a rail leg's line is suspended / out of
   hours (lineClosedNow), or its service window ends within 45 min → "last train" nudge.
   İETT buses are skipped (per-line hours vary too much to promise anything honest). ---- */
// run a costing function as if a different card were selected, then put the setting back
function withCard(key, fn){
  const prev=fareCard; fareCard=key;
  try{ return fn(); } finally { fareCard=prev; }
}
// price this trip on every product the city sells, cheapest first
function compareCards(compute){
  const cards=FARE.cards; if(!cards) return null;
  const rows=Object.keys(cards).map(k=>{
    const f=withCard(k, compute);
    return { key:k, label:cards[k].label, tl:f.tl, refund:f.refund||0,
             unlimited:!!cards[k].unlimited, monthly:cards[k].monthly||0 };
  });
  rows.sort((a,b)=> a.tl-b.tl || trCmp(a.label,b.label));
  return rows;
}
function fareCompareHTML(rows){
  if(!rows || rows.length<2) return '';
  // a monthly pass costs nothing extra, so it must not become the floor of the price range
  const pay=rows.filter(r=>!r.unlimited);
  const cheapest=(pay[0]||rows[0]).tl, dearest=(pay[pay.length-1]||rows[rows.length-1]).tl;
  const body=rows.map(r=>{
    const on = r.key===fareCard;
    const price = r.unlimited ? t('cardIncluded') : r.tl+' ₺';
    // what you'd save by switching to this card from the one you hold
    const cur = rows.find(x=>x.key===fareCard);
    const diff = cur && !r.unlimited && !cur.unlimited ? r.tl-cur.tl : 0;
    const tag = on ? `<span class="fc-you">${t('cardYours')}</span>`
              : (diff<0 ? `<span class="fc-save">−${Math.abs(diff)} ₺</span>`
              : (diff>0 ? `<span class="fc-more">+${diff} ₺</span>` : ''));
    return `<button class="fc-row${on?' on':''}" data-card="${r.key}">
      <span class="fc-nm">${svgEsc(r.label)}</span>${tag}
      <span class="fc-tl">${price}</span></button>`;
  }).join('');
  return `<details class="fare-cmp"><summary>💳 ${t('compareCards')}
      <b>${cheapest} – ${dearest} ₺</b></summary>${body}
      <div class="fc-note">${t('compareNote')}</div></details>`;
}
// the whole cost picture: what the turnstiles take, what the refund device gives back, net
function fareRowHTML(fe, cmpRows){
  const main = fe.unlimited
    ? `<span class="rf-main">${t('cardIncluded')}</span>`
    : `<span class="rf-main">≈ ${fe.tl} ₺</span>`;
  let html = `<span class="rf-ico">🎫</span>${main}`
    + `<span class="rf-sub">${fe.taps} ${t('fareTaps')}${fe.card?' · '+svgEsc(fe.card):''}</span>`
    + `<span class="rf-i" title="${attrEsc(t(FARE.noteKey||'fareNote'))}">ⓘ</span>`;
  if(fe.refund>0){
    html += `<div class="rf-refund">↩ ${t('refundHint').replace('{c}', fe.charged).replace('{r}', fe.refund)}`
          + `<span class="rf-net">${fe.tl} ₺</span></div>`;
  }
  html += fareCompareHTML(cmpRows);
  return html;
}
function renderRouteWarnings(it){
  const el=document.getElementById('rWarn'); if(!el) return;
  el.innerHTML='';
  const seen=new Set(); let html='';
  (it.steps||[]).forEach(s=>{
    if(s.type!=='ride' || s.bus || seen.has(s.ref)) return;
    seen.add(s.ref);
    const c=lineClosedNow(s.ref);
    if(c){
      html += `<div class="rw closed">⛔ <span><b>${s.ref}</b> ${c.why==='susp'?t('warnSusp'):t('warnClosed').replace('{h}', c.opens||'')}</span></div>`;
      return;
    }
    const h=(lineTiming(s.ref).hours)||''; if(/24/.test(h)) return;
    const m=h.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/); if(!m) return;
    const end=+m[3]*60+ +m[4];
    let left=end-nowIstanbulMin(); if(left<0) left+=1440;   // window spanning midnight
    if(left<=45) html += `<div class="rw last">⏰ <span>${t('warnLast').replace('{ref}', s.ref).replace('{h}', m[3]+':'+m[4]).replace('{n}', left)}</span></div>`;
  });
  el.innerHTML=html;
}

/* ---- saved places (Home / Work) ---- */
function setPlaceFromOrigin(which){
  const pt = resolveTyped('O') || originPt;
  if(!pt){ showToast(t('needOrigin'),'err'); return; }
  const rec={name:pt.name,lat:pt.lat,lng:pt.lng};
  if(which==='home'){ homePlace=rec; try{localStorage.setItem('irn_home',JSON.stringify(rec));}catch(e){} showToast(t('homeSaved')); }
  else { workPlace=rec; try{localStorage.setItem('irn_work',JSON.stringify(rec));}catch(e){} showToast(t('workSaved')); }
  renderPlaces();
}
function clearPlace(which){ if(which==='home'){ homePlace=null; try{localStorage.removeItem('irn_home');}catch(e){} }
  else { workPlace=null; try{localStorage.removeItem('irn_work');}catch(e){} } showToast(t('placeCleared')); renderPlaces(); }
function useSavedPlace(which){ const p=which==='home'?homePlace:workPlace; if(!p) return;
  setPlannerTab('trip'); setPoint('D',{name:p.name,lat:p.lat,lng:p.lng}); if(originPt) runRoute();
  else if(IS_MOBILE && typeof openSheet==='function') openSheet('planner'); }
function renderPlaces(){
  const hv=document.getElementById('homeVal'), wv=document.getElementById('workVal');
  if(hv) hv.textContent = homePlace?homePlace.name:'—';
  if(wv) wv.textContent = workPlace?workPlace.name:'—';
  const hc=document.getElementById('chipHome'), wc=document.getElementById('chipWork'), wrap=document.getElementById('placeChips');
  if(hc) hc.style.display = homePlace?'':'none';
  if(wc) wc.style.display = workPlace?'':'none';
  if(wrap) wrap.style.display = (homePlace||workPlace)?'':'none';
}

/* ---- nearest stops to the user's GPS position ---- */
function showNearby(){
  if(!geoSupported()){ showToast(t('geoUnsupported'),'err'); return; }
  showToast(t('locating'));
  navigator.geolocation.getCurrentPosition(p=>{
    geoPos={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}; renderGeo();
    const here=[geoPos.lat,geoPos.lng]; map.setView(here, Math.max(map.getZoom(),14));
    const near = stationList.map(c=>({c,d:metersBetween(here,[c.lat,c.lng])}))
                            .filter(x=>x.d<=2000).sort((a,b)=>a.d-b.d).slice(0,8);
    // nearest bus stops too (available once the lazy GTFS data has integrated)
    if(busReady){
      const seenB=new Set(near.map(x=>fold(x.c.name))), busNear=[];
      for(const [k,d] of nearbyNodes(here[0],here[1],2000,80)){
        const m=nodeMeta[k]; if(m.kind!=='bus') continue;
        const f=fold(m.name); if(seenB.has(f)) continue; seenB.add(f);
        busNear.push({ c:{name:m.name,lat:m.lat,lng:m.lng,lines:new Set([m.ref])}, d, bus:true });
        if(busNear.length>=4) break;
      }
      near.push(...busNear); near.sort((a,b)=>a.d-b.d); near.length=Math.min(near.length,10);
    }
    renderNearby(near);
  }, geoErr, {enableHighAccuracy:true,timeout:12000,maximumAge:15000});
}
function renderNearby(near){
  const panel=document.getElementById('nearPanel'), body=document.getElementById('nearBody'); if(!panel||!body) return;
  if(!near.length){ body.innerHTML=`<div class="none">${t('nearbyEmpty')}</div>`; }
  else body.innerHTML = near.map((x,i)=>{
    const c=x.c, wmin=Math.max(1,Math.round(x.d/WALK));
    const chips=[...c.lines].slice(0,5).map(r=>{
      const col = x.bus ? BUS_COLOR : colorForLine(r);
      const closed = !x.bus && closedCache[r];       // suspended / out-of-hours → dim + strike
      return `<span class="nb-badge" style="background:${col};color:${inkOn(col)}${closed?';opacity:.45;text-decoration:line-through':''}">${svgEsc(r)}</span>`;
    }).join('');
    return `<div class="nb-row" data-i="${i}"><div class="nb-main"><div class="nb-nm">${svgEsc(c.name)}</div><div class="nb-ch">${chips}</div></div>
      <div class="nb-meta">${Math.round(x.d)} m<span>${wmin} ${t('walkAway')}</span></div></div>`;
  }).join('');
  body.querySelectorAll('.nb-row').forEach(el=>el.addEventListener('click', ()=>{
    const x=near[+el.dataset.i]; if(!x) return;
    setPlannerTab('trip'); setPoint('O',{name:x.c.name,lat:x.c.lat,lng:x.c.lng}); closeNearby();
    if(destPt) runRoute(); else if(IS_MOBILE && typeof openSheet==='function') openSheet('planner');
  }));
  panel.classList.add('open');
}
function closeNearby(){ const p=document.getElementById('nearPanel'); if(p) p.classList.remove('open'); }
// sync every settings control to the saved state (called once on boot)
function initSettingsUI(){
  applyDisplayPrefs();
  WALK = WALK_PACE[walkPaceKey];
  document.querySelectorAll('#textSeg button').forEach(b=>b.classList.toggle('active', b.dataset.ts===textSize));
  document.querySelectorAll('#paceSeg button').forEach(b=>b.classList.toggle('active', b.dataset.pace===walkPaceKey));
  document.querySelectorAll('#unitSeg button').forEach(b=>b.classList.toggle('active', b.dataset.u===unitSystem));
  document.querySelectorAll('#clockSeg button').forEach(b=>b.classList.toggle('active', b.dataset.ck===(clock24?'24':'12')));
  const set=(id,on)=>{ const el=document.getElementById(id); if(el) el.classList.toggle('on',on); };
  set('swMotion',reduceMotionPref); set('swContrast',highContrastPref);
  set('swAvoidFerry',avoidModes.has('ferry')); set('swAvoidBus',avoidModes.has('bus')); set('swStepFree',stepFreePref);
  renderPlaces();
}
// localized line-category label (legend groups + planner steps); falls back to KIND.label
function kindLabel(kind){ const k=I18N[lang]['kind_'+kind]; return k!==undefined ? k : ((KIND[kind]&&KIND[kind].label)||kind); }
/* --- TR→EN disruption translator (same code the scraper uses — injected at build).
       Client-side safety net: if a live update arrives with wording newer than the
       deployed vocabulary, English mode still translates it on the spot. --- */
__TRANSLATOR_JS__
// the names in an alert that are supposed to survive translation unchanged
function disNames(d){ return [d.ref, d.from, d.to].concat(d.stations||[]).filter(Boolean); }
function ensureEnglish(list){
  for(const d of (list||[])){
    if(!d || !d.message) continue;
    /* A hand-written entry and an LLM translation are both better English than these rules can
       produce, and judging them by the rules’ own vocabulary would only mistake ordinary
       English ("engineering works", "cancelled") for untranslated Turkish. Leave them alone. */
    if(d.source==='manual' || d.translatedBy==='llm'){ if(!d.messageLang) d.messageLang='en'; continue; }
    /* Everything else is machine output, so re-derive it from the authoritative original using
       the DEPLOYED rules instead of trusting whatever the feed happens to store: the vocabulary
       may have grown since it was written, and a hybrid baked in by an older build must not
       outlive the fix for it. bestEffortEnglish hands back the untouched original — never a
       guess — when the rules still fall short, and says which language that is in .lang. */
    if(!d.messageTr){                                // legacy entry that kept no original
      if(!hasResidualTurkish(d.message)){ if(!d.messageLang) d.messageLang='en'; continue; }
      d.messageTr = d.message;
    }
    const best = bestEffortEnglish(d.messageTr, disNames(d));
    d.message = best.text; d.messageLang = best.lang;
  }
}
// localized disruption title + message (TR uses the original messageTr when present)
function disTitle(d){ const k='ttl:'+(d.title||''); return I18N[lang][k]!==undefined ? I18N[lang][k] : (d.title||''); }
function disMsg(d){ return (lang==='tr' && d.messageTr) ? d.messageTr : d.message; }
/* True when the reader is NOT reading Turkish but the text on screen is the Turkish original.
   Untranslated is a fine outcome — inventing English we cannot vouch for is not — so the one
   thing we owe the reader is to say which language they are looking at, and why. */
function disUntranslated(d){ return lang!=='tr' && !!d && d.messageLang==='tr'; }
function disTrTag(d){
  return disUntranslated(d) ? '<span class="ann-tr" title="'+t('trOnlyWhy')+'">'+t('trOnlyTag')+'</span> ' : '';
}
// best-effort translation of LINE_META status strings (data); unknown values pass through
function transStatus(s){
  const m={ 'Under construction':'st_construction', 'Planned':'st_planned', 'Under construction / testing':'st_testing',
            'Under construction / testing':'st_testing' };
  if(m[s]) return t(m[s]);
  if(/testing/i.test(s)) return t('st_testing');
  if(/construction/i.test(s)) return t('st_construction');
  if(/planned/i.test(s)) return t('st_planned');
  if(/approx/i.test(s)) return t('st_approx');
  return s;
}
function sevLabel(sev){ return t('sev'+(sev||'').charAt(0).toUpperCase()+(sev||'').slice(1)); }

