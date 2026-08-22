/* ===========================================================================
   PROACTIVE ALERTS — follow lines for disruption notifications + a "leave" reminder.
   No backend, so notifications fire while the app is open / recently active (reliable
   on Android, limited on iOS PWAs). Everything stays on-device.
   =========================================================================== */
let followedLines = new Set((function(){ const a=lsJSON('irn_follow'); return Array.isArray(a)?a:[]; })());
let alertedIds = new Set((function(){ const a=lsJSON('irn_alerted'); return Array.isArray(a)?a:[]; })());
let curLineRef = null, leaveTimer=null;
function askNotify(){ try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }catch(e){} }
function notify(title, body, kind){
  showToast(body||title, kind);                                   // always show in-app
  try{ if('Notification' in window && Notification.permission==='granted'){
    if(navigator.serviceWorker && navigator.serviceWorker.ready)
      navigator.serviceWorker.ready.then(reg=>reg.showNotification(title,{body, icon:'assets/icon-192.png', badge:'assets/icon-192.png', tag:'irn-alert'})).catch(()=>{ try{ new Notification(title,{body}); }catch(_){}} );
    else new Notification(title,{body});
  } }catch(e){}
}
function toggleFollow(){
  const ref=curLineRef; if(!ref) return;
  if(followedLines.has(ref)) followedLines.delete(ref); else { followedLines.add(ref); askNotify(); }
  try{ localStorage.setItem('irn_follow', JSON.stringify([...followedLines])); }catch(e){}
  updateFollowBtn(); checkDisruptionAlerts(true);                 // silent: mark current state as seen
}
function updateFollowBtn(){
  const b=document.getElementById('lpFollow'); if(!b) return;
  if(!curLineRef){ b.style.display='none'; return; }
  const on=followedLines.has(curLineRef); b.style.display='';
  b.textContent = on ? '🔔 '+t('following') : '🔕 '+t('followLine');
  b.classList.toggle('on', on);
}
// notify when a followed line is newly disrupted (called after each live-disruptions refresh)
function checkDisruptionAlerts(silent){
  const active=new Set();
  for(const d of (DISRUPTIONS||[])){ if(!d||!d.ref) continue; active.add(d.id);
    if(followedLines.has(d.ref) && !alertedIds.has(d.id)){
      alertedIds.add(d.id);
      // plain text here, so the "shown in Turkish" label is a prefix rather than a badge
      const body=(disUntranslated(d)?'['+t('trOnlyTag')+'] ':'')+disMsg(d);
      if(!silent) notify('⚠ '+d.ref+' · '+disTitle(d), body, d.severity==='major'?'err':null);
    }
  }
  alertedIds = new Set([...alertedIds].filter(id=>active.has(id)));   // clear resolved so they re-alert if they recur
  try{ localStorage.setItem('irn_alerted', JSON.stringify([...alertedIds])); }catch(e){}
}
// local "time to leave" reminder for the planned trip
function remindLeave(mins){
  if(!originPt||!destPt){ showToast(t('pickOD'),'err'); return; }
  askNotify(); clearTimeout(leaveTimer);
  const o=originPt.name, d=destPt.name, it=(currentOpts[currentOptIdx]||{}).it, dur=it?Math.round(it.total):null;
  leaveTimer=setTimeout(()=>{ notify('🔔 '+t('timeToLeave'), o+' → '+d+(dur?` · ~${dur} ${t('minUnit')}`:'')); }, mins*60000);
  showToast(t('reminderSet').replace('{n}', mins));
}
/* ---- printable trip sheet ----------------------------------------------------------------
   Builds a clean, self-contained itinerary into #printSheet and calls window.print(). The
   @media print rule hides the whole app and shows only this sheet, so the browser's own
   "Save as PDF" produces the directory. No library, no popup — works on mobile too. */
/* ---- printable trip brochure ---------------------------------------------------------------
   Builds a keepsake-style directory into #printSheet: a coloured hero band, the ACTIVE CITY's
   own rail network drawn faintly behind the page as a watermark (generated from the same
   geometry the map uses — not clip art), a route ribbon, KPI pills, a colour-railed timeline
   with per-leg fares, and a fare table. @media print hides the app and prints only this, so
   the browser's Save-as-PDF produces the brochure. Works for a Trip and for an Adventure. */
function citySilhouette(){
  // trace the live network into a viewBox — a real, city-specific silhouette
  let la0=90, la1=-90, ln0=180, ln1=-180;
  const paths=[];
  liveLines.forEach(l=>{ if(!l.paths) return;
    l.paths.forEach(p=>{ if(!p || p.length<2) return;
      const step = Math.max(1, Math.floor(p.length/90));      // sample: keeps the SVG small
      const pts=[]; for(let i=0;i<p.length;i+=step) pts.push(p[i]);
      pts.push(p[p.length-1]);
      pts.forEach(c=>{ if(c[0]<la0)la0=c[0]; if(c[0]>la1)la1=c[0]; if(c[1]<ln0)ln0=c[1]; if(c[1]>ln1)ln1=c[1]; });
      paths.push(pts);
    });
  });
  if(!paths.length || la1<=la0 || ln1<=ln0) return '';
  const W=1000, H=Math.round(W*(la1-la0)/((ln1-ln0)*Math.cos((la0+la1)/2*Math.PI/180))) || 600;
  const X = lng => ((lng-ln0)/(ln1-ln0)*W).toFixed(1);
  const Y = lat => ((la1-lat)/(la1-la0)*H).toFixed(1);
  const d = paths.map(p=>'M'+p.map(c=>X(c[1])+' '+Y(c[0])).join('L')).join('');
  return '<svg class="ps-water" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'+
         '<path d="'+d+'" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function _psFmtTL(v){ return (Math.round(v*100)/100).toString().replace(/\.00$/,'')+' ₺'; }
// one itinerary → timeline rows; "fare" supplies the per-boarding charges in order
function _psRows(it, fare){
  let fi=0;
  return (it.steps||[]).map(s=>{
    if(s.type==='walk')
      return '<div class="ps-step"><span class="ps-dot walk"></span><div class="ps-b">'+
        '<div class="ps-t">'+t('walk')+' ~'+Math.max(1,Math.round(s.mins))+' '+t('minUnit')+'</div>'+
        '<div class="ps-m">'+(s.dest?t('toYourDest'):(t('toStop')+' '+svgEsc(s.to||'')))+'</div></div><div class="ps-f"></div></div>';
    if(s.type==='ride'){
      const fl=fare.legs[fi++];
      const col=s.bus?BUS_COLOR:colorForLine(s.ref);
      const label=s.bus?t('busLabel'):kindLabel(lineByRef[s.ref].kind);
      const hw=s.bus?busHeadway(s.ref):null;
      return '<div class="ps-step"><span class="ps-dot" style="background:'+col+'"></span><div class="ps-b">'+
        '<div class="ps-t"><span class="ps-badge" style="background:'+col+';color:'+inkOn(col)+'">'+svgEsc(s.ref)+'</span>'+label+'</div>'+
        '<div class="ps-m">'+svgEsc(s.from)+' → '+svgEsc(s.to)+' · '+s.stops+' '+(s.stops===1?t('stop_one'):t('stop_many'))+
        (hw?' · '+t('busEvery')+' ~'+hw+' '+t('minUnit'):'')+'</div></div>'+
        '<div class="ps-f">'+(fl?(fl.tl===0?'<span class="free">'+t('freeXfer')+'</span>':_psFmtTL(fl.tl)):'')+'</div></div>';
    }
    return '<div class="ps-step"><span class="ps-dot xfer"></span><div class="ps-b">'+
      '<div class="ps-t">'+t('transferAt')+' '+svgEsc(s.at||'')+'</div>'+
      '<div class="ps-m">'+t('walkToShort')+' '+svgEsc(s.ref||'')+' · +'+TRANSFER_MIN+' '+t('minUnit')+'</div></div><div class="ps-f"></div></div>';
  }).join('');
}
function _psRibbon(itins){
  const seen=[], out=[];
  itins.forEach(it=>(it.steps||[]).forEach(s=>{ if(s.type!=='ride') return;
    const key=(s.bus?'b':'')+s.ref; if(seen.indexOf(key)>=0) return; seen.push(key);
    const col=s.bus?BUS_COLOR:colorForLine(s.ref);
    out.push('<span class="ps-rb" style="background:'+col+';color:'+inkOn(col)+'">'+(s.bus?'🚌 ':'')+svgEsc(s.ref)+'</span>');
  }));
  return out.join('<span class="ps-arw">›</span>');
}
function buildPrintSheet(mode){
  const el=document.getElementById('printSheet'); if(!el) return false;
  const isAdv = mode==='adv';
  let title, sub, kpis, body, fare, itins;
  const when=new Date().toLocaleString(LOCALE[lang]||'en-GB', timeOpts({dateStyle:'medium', timeStyle:'short'}));

  if(isAdv){
    if(!lastAdv || !lastAdv.legs.length) return false;
    fare = advFareTotal();
    itins = lastAdv.legs.map(L=>L.it);
    title = svgEsc(lastAdv.pts[0].name)+' → '+svgEsc(lastAdv.pts[lastAdv.pts.length-1].name);
    sub   = '✦ '+t('advTab')+' · '+lastAdv.pts.length+' '+t('stopsWord');
    kpis  = [[Math.round(lastAdv.totMin), t('min')], [lastAdv.totStops, t('stops')],
             [lastAdv.totTr, t('transfers')], [fare.tl+' ₺', t('fareApprox')]];
    body  = lastAdv.legs.map((L,i)=>
      '<div class="ps-leg"><span class="ps-legn">'+(i+1)+'</span>'+svgEsc(L.from.name)+' → '+svgEsc(L.to.name)+
      '<b>'+Math.round(L.it.total)+' '+t('minUnit')+'</b></div>'+_psRows(L.it, fare.legs[i])).join('');
  } else {
    const cur=currentOpts[currentOptIdx]; if(!cur) return false;
    const it=cur.it, res=cur.res;
    fare=estimateFare(it); itins=[it];
    title=svgEsc((res.origin&&res.origin.name)||t('from'))+' → '+svgEsc((res.dest&&res.dest.name)||t('to'));
    sub=t('tripTab');
    const shown=(function(){ const e=document.getElementById('rEta'); const v=e&&parseInt(e.textContent,10);
      return isFinite(v)&&v>0 ? v : Math.round(it.total); })();
    kpis=[[shown,t('min')],[it.stops,t('stops')],[it.transfers,t('transfers')],[fare.tl+' ₺',t('fareApprox')]];
    body=_psRows(it, fare);
  }

  el.innerHTML =
    '<div class="ps-card">'+citySilhouette()+
      '<div class="ps-hero"><div class="ps-brand">'+svgEsc(CITY.name)+' · RAY-NET</div>'+
        '<div class="ps-h1">'+title+'</div>'+
        '<div class="ps-sub">'+sub+' · '+when+'</div>'+
        '<div class="ps-ribbon">'+_psRibbon(itins)+'</div></div>'+
      '<div class="ps-body">'+
        '<div class="ps-kpis">'+kpis.map(k=>'<div class="ps-kpi"><b>'+k[0]+'</b><span>'+k[1]+'</span></div>').join('')+'</div>'+
        '<div class="ps-sec">'+t('stepByStep')+'</div>'+body+
        '<div class="ps-tot"><span>'+t('totalFare')+' · '+fare.taps+' '+t('fareTaps')+'</span><span>'+fare.tl+' ₺</span></div>'+
        '<div class="ps-note">'+t(FARE.noteKey||'fareNote')+'<br>'+t('printSrc')+'</div>'+
      '</div>'+
    '</div>';
  return true;
}
function printTrip(mode){
  if(!buildPrintSheet(mode)){ showToast(mode==='adv'?t('advEmpty'):t('pickOD'),'err'); return; }
  setTimeout(function(){ window.print(); }, 60);   // let layout settle before the dialog opens
}
function stepsHTML(it){
  // per-boarding fares, matched to ride steps in order, so each leg shows what it costs
  const _fare = estimateFare(it); let _fi = 0;
  const fmtTL = v => (Math.round(v*100)/100).toString().replace(/\.00$/,'') + ' ₺';
  return it.steps.map(s=>{
    if(s.type==="walk"){
      return `<div class="step"><div class="rail"><span class="nd" style="border-color:#9fb0c0"></span><span class="pipe" style="background:#9fb0c0"></span></div>
        <div class="tx"><div class="nm">🚶 ${t('walk')} ~${Math.max(1,Math.round(s.mins))} ${t('minUnit')}</div>
        <div class="mt">${s.dest ? t('toYourDest') : (t('toStop')+' '+s.to)}</div></div></div>`;
    } else if(s.type==="ride"){
      const c = s.bus ? BUS_COLOR : colorForLine(s.ref);
      const label = s.bus ? t('busLabel') : kindLabel(lineByRef[s.ref].kind);
      let alt='';
      if(s.bus && s.siblings && s.siblings.length){
        const show=s.siblings.slice(0,6), more=s.siblings.length-show.length;
        alt=`<div class="mt alt">${t('also')} ${show.map(r=>`<span class="altbus">${r}</span>`).join(' ')}${more>0?` <span class="altmore">+${more}</span>`:''}</div>`;
      }
      const hw = s.bus ? busHeadway(s.ref) : null;                      // İETT GTFS frequency
      const freq = hw ? ` · ${t('busEvery')} ~${hw} ${t('minUnit')}` : '';
      const fl = _fare.legs[_fi++];                                     // this boarding's charge
      const fare = fl ? `<span class="st-fare${fl.tl===0?' free':''}">🎫 ${fl.tl===0?t('freeXfer'):fmtTL(fl.tl)}</span>` : '';
      return `<div class="step"><div class="rail"><span class="nd" style="border-color:${c}"></span><span class="pipe" style="background:${c}"></span></div>
        <div class="tx"><div class="nm"><span class="badge" style="background:${c}">${s.bus?'🚌 '+s.ref:s.ref}</span>${label}${fare}<button class="st-avoid" data-ref="${attrEsc(s.ref)}" title="${attrEsc(t('avoidThis'))}">⊘</button></div>
        <div class="mt">${s.from} → ${s.to} · ${s.stops} ${s.stops===1?t('stop_one'):t('stop_many')}${freq}</div>${alt}</div></div>`;
    } else {
      const c = s.bus ? BUS_COLOR : colorForLine(s.ref);
      return `<div class="step"><div class="rail"><span class="nd" style="border-color:var(--gold)"></span><span class="pipe" style="background:var(--gold)"></span></div>
        <div class="tx"><div class="nm" style="color:var(--gold)">⇄ ${t('transferAt')} ${s.at}</div>
        <div class="mt">${t('walkToShort')} <span class="badge" style="background:${c}">${s.bus?'🚌 '+s.ref:s.ref}</span> · +${TRANSFER_MIN} ${t('minUnit')}</div></div></div>`;
    }
  }).join("");
}
/* ---- Adventure Planner: chain multiple stops into one journey ---- */
let plannerMode='trip';
let advStops=[null,null];           // resolved {name,lat,lng} per row (null = not chosen yet)
function advLabel(i){ return i===0 ? t('from') : (i===advStops.length-1 ? t('to') : t('stopN')+' '+i); }
function setAdvStop(i, pt){
  advStops[i]=pt;
  const inp=document.getElementById('advI'+i); if(inp) inp.value=pt?pt.name:'';
  drawAdvMarkers();
}
function acRenderAdv(i, q){
  const listEl=document.getElementById('advL'+i); if(!listEl) return;
  acSearch('A'+i, q, listEl, pt=> setAdvStop(i, pt));
}
function makeAdvRow(i){
  const row=document.createElement('div'); row.className='field adv-row';
  row.innerHTML=`<label>${advLabel(i)}</label>
    <div class="ac"><input id="advI${i}" class="ac-input" type="text" placeholder="${t('searchStop')}" autocomplete="off" value="${advStops[i]?attrEsc(advStops[i].name):''}">
      <button class="ac-pin" data-for="A${i}" title="${t('pickPoint')}">📍</button>
      <div class="ac-list" id="advL${i}"></div></div>
    ${advStops.length>2 && i>0 && i<advStops.length-1 ? `<button class="adv-x" data-i="${i}" title="✕">✕</button>`:''}`;
  const inp=row.querySelector('input');
  inp.addEventListener('input', ()=>{ advStops[i]=null; acRenderAdv(i, inp.value); });
  inp.addEventListener('focus', ()=>{ if(inp.value.trim()) acRenderAdv(i, inp.value); });
  inp.addEventListener('blur',  ()=> setTimeout(()=>{ const l=document.getElementById('advL'+i); if(l) l.classList.remove('show'); },150));
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ const l=document.getElementById('advL'+i); if(l) l.classList.remove('show'); } });
  row.querySelector('.ac-pin').addEventListener('click', ()=>armPick('A'+i));
  const x=row.querySelector('.adv-x');
  if(x) x.addEventListener('click', ()=>{ advStops.splice(i,1); rebuildAdvRows(); drawAdvMarkers(); });
  return row;
}
function rebuildAdvRows(){
  const box=document.getElementById('advStopsBox'); if(!box) return;
  box.innerHTML='';
  advStops.forEach((_,i)=> box.appendChild(makeAdvRow(i)));
}
function advIcon(i, n){
  const c = i===0 ? '#3ee387' : (i===n-1 ? '#ff5d6c' : '#FFC94D');
  return L.divIcon({ className:'ep-icon',
    html:`<div style="width:20px;height:20px;border-radius:50%;background:${c};border:2px solid #06121b;color:#06121b;font:800 11px/17px var(--font);text-align:center;box-shadow:0 3px 7px rgba(0,0,0,.6)">${i+1}</div>`,
    iconSize:[20,20], iconAnchor:[10,10] });
}
function drawAdvMarkers(){
  if(plannerMode!=='adv') return;
  endpointLayer.clearLayers();
  advStops.forEach((p,i)=>{ if(p) L.marker([p.lat,p.lng],{icon:advIcon(i,advStops.length),zIndexOffset:1500,interactive:false}).addTo(endpointLayer); });
}
function resolveAdv(i){
  if(advStops[i]) return advStops[i];
  const inp=document.getElementById('advI'+i); const val=inp?inp.value.trim():'';
  if(!val) return null;
  const f=foldQ(val);
  // ranked, for the same reason as resolveTyped: a raw scan returns the alphabetically first hit
  const m = PLACES.find(p=>p._q===f) || searchPlaces(val)[0];
  if(m){ const pt={name:m.name,lat:m.lat,lng:m.lng}; advStops[i]=pt; if(inp) inp.value=m.name; return pt; }
  return null;
}
/* ---- Adventure planner: the same conveniences the Trip planner has (fares, service
   warnings, favourites, share links, printable directory). Each LEG is charged as its own
   fare chain — you stop to visit a place, so the operator's transfer window has lapsed. ---- */
let lastAdv = null;
let advFavs = (function(){ try{ return JSON.parse(localStorage.getItem('irn_advfavs')||'[]'); }catch(e){ return []; } })();
function advFareTotal(){
  if(!lastAdv) return { taps:0, tl:0, legs:[] };
  let taps=0, tl=0; const legs=[];
  lastAdv.legs.forEach(L=>{ const f=estimateFare(L.it); taps+=f.taps; tl+=f.tl; legs.push(f); });
  return { taps, tl, legs };
}
function renderAdvFare(){
  const el=document.getElementById('aFare'); if(!el) return;
  const f=advFareTotal();
  el.innerHTML = f.taps ? fareRowHTML(f, compareCards(()=>advFareTotal())) : '';
}
function renderAdvWarnings(){
  const el=document.getElementById('aWarn'); if(!el) return;
  el.innerHTML='';
  if(!lastAdv) return;
  const seen=new Set(), merged={ steps:[] };
  lastAdv.legs.forEach(L=> (L.it.steps||[]).forEach(s=>{
    if(s.type==='ride' && !s.bus && !seen.has(s.ref)){ seen.add(s.ref); merged.steps.push(s); } }));
  const tmp=document.createElement('div'); tmp.id='__advw';
  const keep=document.getElementById('rWarn');
  // reuse the trip renderer by pointing it at this container
  const orig=document.getElementById('rWarn');
  if(orig){ orig.id='__rwarn_tmp'; el.id='rWarn'; renderRouteWarnings(merged); el.id='aWarn'; orig.id='rWarn'; }
}
function advSig(pts){ return (pts||[]).map(p=>p.name).join(' → '); }
function isAdvFav(sig){ return advFavs.some(a=>a.sig===sig); }
function updateAdvFavBtn(){
  const b=document.getElementById('advFavBtn'); if(!b) return;
  const on = lastAdv && isAdvFav(advSig(lastAdv.pts));
  b.classList.toggle('on', !!on);
  b.innerHTML = (on?'★ ':'☆ ')+`<span>${on?t('savedWord'):t('saveAdv')}</span>`;
}
function toggleAdvFav(){
  if(!lastAdv){ showToast(t('advEmpty'),'err'); return; }
  const sig=advSig(lastAdv.pts);
  if(isAdvFav(sig)) advFavs=advFavs.filter(a=>a.sig!==sig);
  else advFavs.unshift({ sig, stops:lastAdv.pts.map(p=>({name:p.name,lat:p.lat,lng:p.lng})),
                         eta:Math.round(lastAdv.totMin), tl:advFareTotal().tl });
  if(advFavs.length>12) advFavs.length=12;
  try{ localStorage.setItem('irn_advfavs', JSON.stringify(advFavs)); }catch(e){}
  renderAdvFavs(); updateAdvFavBtn();
}
function renderAdvFavs(){
  const sec=document.getElementById('advFavSec'), list=document.getElementById('advFavList');
  if(!sec||!list) return;
  sec.style.display = advFavs.length ? '' : 'none';
  list.innerHTML = advFavs.map((a,i)=>`<div class="plan-item" data-i="${i}">
      <div class="pi-tx"><div class="pi-nm">${svgEsc(a.sig)}</div>
        <div class="pi-mt">${a.stops.length} ${t('stopsWord')}${a.eta?' · '+a.eta+' '+t('minUnit'):''}${a.tl?' · '+a.tl+' ₺':''}</div></div>
      <button class="pi-x" data-x="${i}" title="✕">✕</button></div>`).join('');
  list.querySelectorAll('.plan-item').forEach(el=>el.addEventListener('click', ev=>{
    if(ev.target.dataset.x!==undefined) return;
    const a=advFavs[+el.dataset.i]; if(!a) return;
    advStops=a.stops.map(s=>({name:s.name,lat:s.lat,lng:s.lng}));
    rebuildAdvRows(); drawAdvMarkers(); planAdventure();
  }));
  list.querySelectorAll('.pi-x').forEach(el=>el.addEventListener('click', ev=>{
    ev.stopPropagation(); advFavs.splice(+el.dataset.x,1);
    try{ localStorage.setItem('irn_advfavs', JSON.stringify(advFavs)); }catch(e){}
    renderAdvFavs(); updateAdvFavBtn();
  }));
}
function advDeepLink(){
  if(!lastAdv) return location.href.split('#')[0];
  const q=lastAdv.pts.map(p=>`${p.lat.toFixed(5)},${p.lng.toFixed(5)},${encodeURIComponent(p.name)}`).join('|');
  return location.href.split('#')[0]+'#adv='+q;
}
async function shareAdventure(){
  if(!lastAdv){ showToast(t('advEmpty'),'err'); return; }
  const text=advSig(lastAdv.pts)+` · ${Math.round(lastAdv.totMin)} ${t('minUnit')} · ${advFareTotal().tl} ₺`;
  const url=advDeepLink();
  try{ if(navigator.share){ await navigator.share({title:CITY.name+' · RAY-NET', text, url}); return; } }catch(e){ if(e&&e.name==='AbortError') return; }
  try{ await navigator.clipboard.writeText(text+'\n'+url); showToast(t('linkCopied')); }catch(e){ showToast(url); }
}
function applyAdvHash(){
  const m=(location.hash||'').match(/adv=(.+)$/); if(!m) return false;
  const stops=m[1].split('|').map(part=>{ const c=part.split(','); const lat=+c[0], lng=+c[1];
    if(!isFinite(lat)||!isFinite(lng)) return null;
    return { name: c[2]?decodeURIComponent(c[2]):(lat.toFixed(4)+', '+lng.toFixed(4)), lat, lng }; }).filter(Boolean);
  if(stops.length<2) return false;
  advStops=stops; setPlannerTab('adv'); rebuildAdvRows(); drawAdvMarkers(); planAdventure();
  return true;
}
function planAdventure(){
  const out=document.getElementById('advOut'), stepsEl=document.getElementById('aSteps');
  routeLayer.clearLayers(); clearRouteFocus();
  const token=++routeToken;
  const pts=advStops.map((_,i)=>resolveAdv(i));
  drawAdvMarkers();
  out.classList.add('show');
  if(pts.some(p=>!p)){
    document.getElementById('aEta').textContent='–'; document.getElementById('aStops').textContent='–'; document.getElementById('aTr').textContent='–';
    stepsEl.innerHTML=`<div class="none">${t('advEmpty')}</div>`; return;
  }
  let totMin=0, totStops=0, totTr=0, failed=false;
  const allPts=[], legsUp=[], parts=[], advLegs=[];
  for(let i=0;i<pts.length-1;i++){
    const res=routeXY(pts[i], pts[i+1]);
    if(!res){ parts.push(`<div class="leg-h fail">${t('leg')} ${i+1} · ${pts[i].name} → ${pts[i+1].name} · ${t('noRoute')}</div>`); failed=true; continue; }
    const it=buildItinerary(res);
    totMin+=it.total; totStops+=it.stops; totTr+=it.transfers;
    advLegs.push({res,it,from:pts[i],to:pts[i+1]});
    drawItin(res, it, allPts, legsUp);
    parts.push(`<div class="leg-h"><span class="leg-n">${i+1}</span>${pts[i].name} → ${pts[i+1].name} · <b>${Math.round(it.total)} ${t('minUnit')}</b></div>`+journeyHTML(it,res)+stepsHTML(it));
  }
  document.getElementById('aEta').textContent = failed ? '—' : Math.round(totMin);
  document.getElementById('aStops').textContent = totStops;
  document.getElementById('aTr').textContent = totTr;
  stepsEl.innerHTML = parts.join('');
  // remember the whole adventure so share / save / print can rebuild it
  lastAdv = { pts: pts.slice(), legs: advLegs, totMin, totStops, totTr, failed };
  { const all=new Set(); advLegs.forEach(l=>itinRefs(l.it).forEach(r=>all.add(r)));
    setRouteFocus(all); }
  renderAdvFare(); renderAdvWarnings(); updateAdvFavBtn();
  if(allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.2));
  if(legsUp.length){
    const note=document.createElement('div'); note.className='none'; note.id='refineNote';
    note.textContent='⏳ Loading real road & footpath geometry…';
    stepsEl.insertBefore(note, stepsEl.firstChild);
    upgradeRoute(legsUp, token, 0);
  }
}
function setPlannerTab(m){
  plannerMode=m;
  try{ localStorage.setItem('irn_planmode', m); }catch(e){}
  document.querySelectorAll('#plannerTabs button').forEach(b=>b.classList.toggle('active', b.dataset.pt===m));
  document.getElementById('plannerTrip').style.display = m==='trip' ? '' : 'none';
  document.getElementById('plannerAdv').style.display  = m==='adv'  ? '' : 'none';
  routeLayer.clearLayers(); endpointLayer.clearLayers(); clearRouteFocus();
  if(pickMode) armPick(pickMode);        // disarm any pending pick
  ++routeToken;
  if(m==='trip') renderEndpoints(); else { rebuildAdvRows(); drawAdvMarkers(); }
}
async function resolveGeocodeEndpoints(oTxt, dTxt){
  if(oTxt){ const r=await geocode(oTxt); if(r[0]) setPoint('O',{name:r[0].name,lat:r[0].lat,lng:r[0].lng}); }
  if(dTxt){ const r=await geocode(dTxt); if(r[0]) setPoint('D',{name:r[0].name,lat:r[0].lat,lng:r[0].lng}); }
  const stillO = oTxt && !originPt, stillD = dTxt && !destPt;
  if(stillO || stillD){                                  // geocoder found nothing for a typed field
    document.getElementById('rSteps').innerHTML=`<div class="none">${t('placeNotFound')}</div>`;
    showToast(t('placeNotFound'),'err'); return;
  }
  runRoute();
}
function runRoute(){
  const o=resolveTyped('O'), d=resolveTyped('D');
  // a field holding TYPED text that matched no local stop/landmark → look it up as a real
  // place/address, then re-run. So "just type where you're going" works without pinning.
  const oTxt=document.getElementById('selO').value.trim(), dTxt=document.getElementById('selD').value.trim();
  if((!o && oTxt) || (!d && dTxt)){
    const out=document.getElementById('rout'); out.classList.add('show');
    document.getElementById('rSteps').innerHTML=`<div class="none">${t('searchingPlace')}</div>`;
    resolveGeocodeEndpoints(!o?oTxt:null, !d?dTxt:null);
    return;
  }
  renderEndpoints();
  const out=document.getElementById('rout'), stepsEl=document.getElementById('rSteps');
  routeLayer.clearLayers(); ++routeToken; clearRouteFocus();
  if(goState) exitGo();                                   // a fresh plan ends any active live journey
  document.getElementById('rOpts').innerHTML=''; currentOpts=[]; currentOptIdx=0;
  { const jm=document.getElementById('rJourney'); if(jm) jm.innerHTML=''; const fEl=document.getElementById('rFare'); if(fEl) fEl.innerHTML='';
    const wEl=document.getElementById('rWarn'); if(wEl) wEl.innerHTML='';
    const gs=document.getElementById('goStart'); if(gs) gs.style.display='none'; }
  if(!o || !d){ out.classList.add('show');
    document.getElementById('rEta').textContent='–'; document.getElementById('rStops').textContent='–'; document.getElementById('rTr').textContent='–';
    stepsEl.innerHTML=`<div class="none">${t('pickOD')}</div>`; updateFavBtn(); return; }
  currentOpts = routeOptions(o,d,4);
  if(!currentOpts.length){ out.classList.add('show'); document.getElementById('rEta').textContent='—';
    document.getElementById('rStops').textContent='—'; document.getElementById('rTr').textContent='—';
    stepsEl.innerHTML=`<div class="none">${t('noRoute')}</div>`; updateFavBtn(); return; }
  sortOptsByPref();     // rank by the user's Fastest / Fewest-changes preference
  renderOptChips();
  selectOption(0);
  out.classList.add('show');
  const best=currentOpts[0].it;
  recordPlan(o, d, { eta: Math.round(best.total), stops: best.stops, transfers: best.transfers });
  updateFavBtn();
}

