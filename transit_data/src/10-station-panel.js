/* ===========================================================================
   6. STATION PANEL + PREDICTIVE ARRIVALS
   =========================================================================== */
let selected = null;
function colorForLine(ref){ return lineByRef[ref] ? lineByRef[ref].color : "#888"; }

function etaForTrain(tr, sTarget){
  // simulated seconds for this train to reach distance sTarget, allowing 1 reversal
  const stops = tr.line._stops, sp = tr.speed;
  let s = tr.s, dir = tr.dir, t = (tr.state==="dwell")?Math.max(0,tr.dwell):0;
  for(let guard=0; guard<400; guard++){
    // distance to target if continuing in dir without passing an end first
    const end = dir>0 ? tr.line._len : 0;
    const reachable = dir>0 ? (sTarget>=s-1) : (sTarget<=s+1);
    if(reachable){
      // count dwell stops strictly between s and sTarget
      let dwc=0;
      for(const st of stops){ if(dir>0 ? (st>s+1 && st<sTarget-1) : (st<s-1 && st>sTarget+1)) dwc++; }
      return t + Math.abs(sTarget-s)/sp + dwc*DWELL;
    }
    // go to end, reverse
    let dwc=0;
    for(const st of stops){ if(dir>0 ? (st>s+1 && st<end-1) : (st<s-1 && st>end+1)) dwc++; }
    t += Math.abs(end-s)/sp + dwc*DWELL + DWELL;
    s = end; dir = -dir;
  }
  return Infinity;
}
function buildBoard(reg){
  const out = [];
  reg.lines.forEach(ref => {
    const line = lineByRef[ref];
    const node = reg.nodes.find(n=>n.ref===ref);
    if(!node) return;
    if(closedCache[ref]) return;                       // no arrivals on a closed line
    const sTarget = node.s;
    const lineTrains = trains.filter(t=>t.ref===ref);
    const byDest = {};
    lineTrains.forEach(tr => {
      const e = etaForTrain(tr, sTarget);
      if(!isFinite(e)) return;
      // destination terminus in the train's *arriving* direction
      const arrivingDir = (tr.s<=sTarget)?1:-1;  // rough; group by nearest terminus heading
      const destName = arrivingDir>0 ? line.stations[line.stations.length-1].name : line.stations[0].name;
      (byDest[destName]=byDest[destName]||[]).push(e);
    });
    Object.keys(byDest).forEach(dest=>{
      byDest[dest].sort((a,b)=>a-b);
      out.push({ ref, color:line.color, dest, etas:byDest[dest].slice(0,2) });
    });
  });
  return out;
}
/* Minutes, not seconds. This board is modelled from a published frequency, so "3m 43s" was
   claiming to know the arrival to the second — precision the input does not contain, and the
   most persuasive kind of wrong. Rounding to the minute with a "~" states the same estimate at
   the resolution it actually has. The exact board below quotes real clock times and is allowed
   to be precise, because there the operator supplied the number. */
function fmtEta(sec){
  if(sec<45) return {t:t('dueNow'), now:true};
  return {t:'~'+Math.max(1, Math.round(sec/60))+' '+t('minUnit'), now:false};
}
function openStation(reg){
  selected = reg;
  document.getElementById('linp').classList.remove('show');
  document.getElementById('stnNm').textContent = reg.name;
  document.getElementById('stnLines').innerHTML = [...reg.lines]
    .map(ref=>`<span class="badge" style="background:${colorForLine(ref)}">${ref}</span>`).join("");
  const nL=reg.lines.size;
  let meta = t('servedBy').replace('{n}', nL);
  if(lang==='en') meta = `Served by ${nL} line${nL>1?"s":""}.`;   // proper English plural
  if(nL>1) meta += ` <span class="ix">◆ ${t('interchange')} · ${TRANSFER_MIN} ${t('minUnit')} ${t('transferWord')}</span>`;
  document.getElementById('stnMeta').innerHTML = meta;
  // operating hours / frequency per serving line (official-style timetable)
  const svc = [...reg.lines].map(ref=>{
    const ln=lineByRef[ref]; if(!ln) return '';
    const tm=lineTiming(ref);
    return `<div class="svc-row"><span class="svc-cd" style="background:${ln.color}">${ref}</span><span class="svc-tx"><b>${tm.freq}</b> · ${tm.hours}</span></div>`;
  }).filter(Boolean).join('');
  document.getElementById('stnService').innerHTML = svc ? `<div class="bt">${t('serviceHours')}</div>${svc}` : '';
  // step-free / accessibility (İBB elevator + escalator data, OSM wheelchair tags)
  const acc = accFor(reg.name), ael = document.getElementById('stnAccess');
  if(ael){
    if(acc){
      const badge = acc.stepFree===true ? `<span class="acc-badge ok">♿ ${t('accStepFree')}</span>`
                  : acc.stepFree===false ? `<span class="acc-badge no">⚠ ${t('accNotStepFree')}</span>`
                  : (acc.wheelchair==='limited' ? `<span class="acc-badge lim">♿ ${t('accLimited')}</span>` : '');
      const counts=[];
      if(acc.elevators!=null) counts.push(`🛗 ${acc.elevators} ${t('accLifts')}`);
      if(acc.escalators!=null) counts.push(`${acc.escalators} ${t('accEscalators')}`);
      const src = acc.wheelchair!=null ? 'İBB · OSM' : 'İBB';
      ael.innerHTML = `<div class="bt">${t('accessibility')}</div><div class="acc-row">${badge}`
        + (counts.length?`<span class="acc-counts">${counts.join(' · ')}</span>`:'')
        + `</div><div class="acc-src">${t('accSource')} ${src}</div>`;
      ael.style.display='';
    } else { ael.innerHTML=''; ael.style.display='none'; }
  }
  // nearby attractions (Explore)
  const atEl=document.getElementById('stnAttr');
  if(atEl){
    const near=attractionsNear(reg.lat, reg.lng, 700);
    atEl.innerHTML = near.length
      ? `<div class="st-attr"><div class="bt">✨ ${t('nearbyAttr')}</div><div class="sa-list">`
        + near.map(x=>`<span class="sa-chip" data-attr-go="${x.i}">${ATTR_CAT[x.a.cat]||'📍'} ${svgEsc(x.a.name)} · ${Math.max(1,Math.round(x.d/WALK))}${t('minUnit')}</span>`).join('')
        + `</div></div>`
      : '';
  }
  document.getElementById('stn').classList.add('show');
  renderBoard();
  loadSchedule(reg);        // EXACT official departures (async, api.ibb.gov.tr)
}

/* ---- EXACT scheduled departures from the official Metro İstanbul API (CORS-open).
   Resolves the clicked station to its official ID (same line ref + nearest ≤450 m),
   then fetches the direction list + the full departure timetable, and shows the next
   trains after the current İstanbul time. Cached per station/direction. ---- */
const MI_API='https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2';
const miDirCache={}, miTTCache={};
let schedToken=0;
function miMatch(reg, ref){
  let best=null, bd=Infinity;
  for(const s of MI_STATIONS){ if(s[2]!==ref) continue;
    const d=metersBetween([reg.lat,reg.lng],[s[3],s[4]]); if(d<bd){ bd=d; best=s; } }
  return (best && bd<=450) ? best : null;
}
async function miPost(u,body){
  const r=await fetch(MI_API+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error('HTTP '+r.status); return r.json();
}
function nowIstanbulMin(){   // minutes since midnight in Europe/Istanbul
  try{ const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
       const [h,m]=p.split(':').map(Number); return h*60+m; }
  catch(e){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
}
let schedData=null;   // [{ref,color,target,times:[HH:MM,...]}] for the open station → live countdown
async function loadSchedule(reg){
  const el=document.getElementById('stnSched'); if(!el) return;
  schedData=null;
  const tok=++schedToken;
  const refs=[...reg.lines].filter(r=>MI_STATIONS.some(s=>s[2]===r));
  if(!refs.length){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="bt">⏱ ${t('liveArrivals')} <span class="live">${t('official')}</span></div><div class="none">${t('schedLoading')}</div>`;
  const data=[];
  for(const ref of refs){
    const st=miMatch(reg,ref); if(!st) continue;
    try{
      const dkey='d'+st[1]+'_'+st[0];
      if(!miDirCache[dkey]) miDirCache[dkey]=((await miPost('/GetDirectionsByLineIdAndStationId',{lineId:st[1],stationId:st[0]})).Data)||[];
      for(const d of miDirCache[dkey]){
        const tkey='t'+st[0]+'_'+d.DirectionId;
        if(!miTTCache[tkey]){
          const tt=await miPost('/GetTimeTable',{boardingStationId:st[0],directionId:d.DirectionId});
          const row=(tt.Data&&tt.Data[0])||{}; const ti=row.TimeInfos;
          miTTCache[tkey]=(Array.isArray(ti)?(ti[0]&&ti[0].Times):(ti&&ti.Times))||[];
        }
        if(tok!==schedToken) return;               // user opened another station meanwhile
        const ln=lineByRef[ref];
        data.push({ ref, color: ln?ln.color:'#888', target:(d.DirectionName||'').split('->').pop().trim(), times: miTTCache[tkey] });
      }
    }catch(e){ /* API hiccup → skip this line's block */ }
  }
  if(tok!==schedToken) return;
  schedData=data;
  renderSched();
}
// live minute-countdown to the next departures (recomputed each tick from the official timetable)
function renderSched(){
  const el=document.getElementById('stnSched'); if(!el) return;
  if(!schedData || !schedData.length){ el.innerHTML=''; return; }
  const nowM=nowIstanbulMin();
  const blocks=schedData.map(b=>{
    if(!b.times || !b.times.length) return '';
    const allDm=b.times.map(x=>{const p=x.split(':'); return (+p[0])*60+(+p[1]);})
      .map(tm=> tm>=nowM ? tm-nowM : tm+1440-nowM).filter(dm=> dm>=0).sort((a,b)=>a-b);
    const mins=allDm.filter(dm=> dm<=120).slice(0,3);
    let chips;
    if(mins.length) chips = mins.map((dm,i)=>`<span class="cd-min ${i===0?'soon':''}">${dm===0?t('dueNow'):dm}</span>`).join('')+(mins[0]===0&&mins.length===1?'':`<span class="cd-unit">${t('minUnit')}</span>`);
    else if(allDm.length){ const nm=(nowM+allDm[0])%1440; chips = `<span class="cd-next">${t('nextArr')} ${String(Math.floor(nm/60)).padStart(2,'0')}:${String(nm%60).padStart(2,'0')}</span>`; }
    else chips = `<span class="cd-none">${t('schedNone')}</span>`;
    return `<div class="arr-row"><span class="svc-cd" style="background:${b.color}">${svgEsc(b.ref)}</span>`+
      `<div class="arr-tx"><div class="arr-to">→ ${svgEsc(b.target)}</div><div class="arr-mins">${chips}</div>`+
      `<div class="arr-fl">${t('firstDep')} ${b.times[0]} · ${t('lastDep')} ${b.times[b.times.length-1]}</div></div></div>`;
  }).filter(Boolean);
  el.innerHTML = blocks.length ? `<div class="bt">⏱ ${t('liveArrivals')} <span class="live">${t('official')}</span></div>`+blocks.join('') : '';
}
// tick the countdown while a station panel is open (no re-fetch — recompute from cached times)
setInterval(()=>{ try{ if(schedData && document.getElementById('stn').classList.contains('show')) renderSched(); }catch(e){} }, 15000);
function renderBoard(){
  if(!selected) return;
  const el = document.getElementById('stnBoard');
  if(!showTrains){ el.innerHTML = `<div class="none">${t('carrOff')}</div>`; return; }
  // lines at this station that are NOT running right now → honest closed rows, no fake ETAs
  const closedRows=[...selected.lines].filter(r=>closedCache[r]).map(r=>{
    const c=closedCache[r], ln=lineByRef[r];
    const msg = c.why==='susp' ? `⚠ ${t('boardSusp')}` : `🌙 ${t('boardClosed')} · ${c.hours}`;
    return `<div class="arr"><span class="cd" style="background:${ln?ln.color:'#888'}">${r}</span>
      <div class="ds">${msg}<small>${c.why==='susp'?t('seeAnn'):t('opensAt')+' '+c.opens}</small></div></div>`;
  }).join("");
  const board = buildBoard(selected);
  const liveRows = board.map(b => b.etas.map((sec,i)=>{
    const e=fmtEta(sec);
    return `<div class="arr"><span class="cd" style="background:${b.color}">${b.ref}</span>
      <div class="ds">→ ${b.dest}<small>${i===0?t('nextArr'):t('followingArr')}</small></div>
      <div class="et ${e.now?'now':''}">${e.t}</div></div>`;
  }).join("")).join("");
  // say where these numbers come from, right where they are read
  const src = liveRows ? `<div class="board-src">${svgEsc(t('boardModelled'))}</div>` : '';
  el.innerHTML = (src + liveRows + closedRows) || `<div class="none">${t('noApproach')}</div>`;
}

