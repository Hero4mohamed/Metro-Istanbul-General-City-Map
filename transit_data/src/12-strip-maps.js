/* ===========================================================================
   STRIP MAPS — a per-line station diagram (line panel, like a station sign) and
   a multimodal journey diagram (trip planner). Pure inline SVG, generated from
   the same data the map already uses; both scroll horizontally when long.
   =========================================================================== */
const svgEsc = s => (s==null?'':(''+s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const MODE_GLYPH = { subway:'🚇', marmaray:'🚆', suburban:'🚆', tram:'🚊', funicular:'🚡', cable:'🚠', metrobus:'🚌', ferry:'⛴', bus:'🚌' };
function mGlyph(kind, bus){ return bus ? '🚌' : (MODE_GLYPH[kind] || '🚇'); }
function inkOn(hex){                                    // pick black/white text for a colored chip
  const c=(hex||'').replace('#',''); if(c.length<6) return '#fff';
  const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b)>150 ? '#0b0f17' : '#fff';
}
function svgPill(cx, baseY, text, bg, fg){
  const w=Math.max(28, text.length*6.1+16), x=cx-w/2;
  return `<g><rect x="${x.toFixed(1)}" y="${baseY-13}" width="${w.toFixed(1)}" height="17" rx="8.5" fill="${bg}"/>`
       + `<text x="${cx}" y="${baseY-1}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${fg}" style="font-family:var(--font)">${svgEsc(text)}</text></g>`;
}
// (A) horizontal strip map of one line's stations, with interchange badges + terminals
function lineStripSVG(line){
  const sts=line.stations||[]; if(sts.length<2) return '';
  const live=isLive(line), col=line.color||'#888';
  const GAP=46, PADX=30, TY=64;
  // labels are drawn diagonally (rotate 45°), so each extends ~len·6.3·0.72 px to the lower-right.
  // Size the canvas to that overflow (esp. the LAST label, which used to be clipped at the edge)
  // and grow the height for long names, so every station name shows in full.
  const labelExt = n => (n?[...n].length:0)*6.3*0.72;
  const lastX = PADX + (sts.length-1)*GAP;
  const rightPad = Math.max(PADX, Math.ceil(4 + labelExt(sts[sts.length-1].name)) + 12);
  const W = lastX + rightPad;
  let maxExt = 0; for(const s of sts) maxExt = Math.max(maxExt, labelExt(s.name));
  const H = Math.max(188, Math.ceil(TY + 15 + maxExt + 16));
  const P=[`<line x1="${PADX}" y1="${TY}" x2="${lastX}" y2="${TY}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`];
  sts.forEach((st,i)=>{
    const x=PADX+i*GAP, term=(i===0||i===sts.length-1);
    let others=[];
    if(live){ const cl=clusterFor(line.ref,i); if(cl&&cl.lines.size>1) others=[...cl.lines].filter(r=>r!==line.ref); }
    // compact interchange chips (ferries → ⛴, dedupe, cap 3) so long ferry refs don't sprawl
    let chips=[]; { const seen=new Set();
      for(const r of others){ const ln=lineByRef[r];
        const lab = (ln&&ln.kind==='ferry') ? '⛴' : (r==='Metrobüs'?'MB':(r==='Marmaray'?'MAR':r));
        if(seen.has(lab)) continue; seen.add(lab);
        chips.push({lab, col:colorForLine(r)}); if(chips.length>=3) break; } }
    if(chips.length){
      P.push(`<line x1="${x}" y1="${TY-7}" x2="${x}" y2="${TY-15}" stroke="${col}" stroke-width="2"/>`);
      chips.forEach((ch,k)=>{
        const bw=Math.max(17, ch.lab.length*6.2+8), by=TY-21-k*16;
        P.push(`<rect x="${(x-bw/2).toFixed(1)}" y="${by-11}" width="${bw.toFixed(1)}" height="13" rx="3" fill="${ch.col}"/>`);
        P.push(`<text x="${x}" y="${by-1}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${inkOn(ch.col)}" style="font-family:var(--mono)">${svgEsc(ch.lab)}</text>`);
      });
    }
    if(term) P.push(`<circle cx="${x}" cy="${TY}" r="8" fill="var(--svg-hole)" stroke="${col}" stroke-width="4"/>`);
    else if(others.length) P.push(`<circle cx="${x}" cy="${TY}" r="6.5" fill="var(--svg-hole)" stroke="${col}" stroke-width="3"/>`);
    else P.push(`<circle cx="${x}" cy="${TY}" r="5" fill="${col}"/><circle cx="${x}" cy="${TY}" r="2.1" fill="var(--svg-hole)"/>`);
    P.push(`<text x="${x+4}" y="${TY+15}" transform="rotate(45 ${x+4} ${TY+15})" font-size="10.5" fill="${term?'var(--text)':'var(--muted)'}" font-weight="${term?'700':'500'}" style="font-family:var(--font)">${svgEsc(st.name)}</text>`);
  });
  return `<svg class="strip-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${P.join('')}</svg>`;
}
function lineStripHTML(line){
  const svg=lineStripSVG(line); if(!svg) return '';
  const sts=line.stations||[], ref=line.partOf||line.ref, col=line.color||'#888';
  return `<div class="strip-dir"><span class="badge" style="background:${col};color:${inkOn(col)}">${svgEsc(ref)}</span>`
       + `<b>${svgEsc(sts[0].name)}</b><span class="ar">⟷</span><b>${svgEsc(sts[sts.length-1].name)}</b>`
       + `<span class="strip-hint">${t('stripHint')}</span></div>`
       + `<div class="strip-scroll">${svg}</div>`;
}
// (B) multimodal journey diagram from an itinerary: legs as colored bars, ferries
//     visibly cross water, transfers are interchange nodes, walks are dashed.
function buildJourney(it,res){
  const oName=(res&&res.origin&&res.origin.name)||t('from');
  const dName=(res&&res.dest&&res.dest.name)||t('to');
  let segs=[];
  (it.steps||[]).forEach(s=>{
    if(s.type==='walk'){
      segs.push(s.dest ? {walk:true,from:s.from,to:dName,mins:s.mins}
                       : {walk:true,from:oName,to:s.to,mins:s.mins});
    } else if(s.type==='ride'){
      const ln=lineByRef[s.ref], ferry=!s.bus&&ln&&ln.kind==='ferry';
      segs.push({walk:false, ref:s.ref, bus:s.bus, kind:s.bus?'bus':(ln?ln.kind:'subway'),
                 color:s.bus?BUS_COLOR:colorForLine(s.ref), from:s.from, to:s.to, stops:s.stops, ferry});
    }
  });
  if(!segs.length) return null;
  // drop access-walk legs whose endpoints are the same named stop (origin == boarding pier)
  let segs2=segs.filter(sg=> !(sg.walk && fold(sg.from)===fold(sg.to)));
  if(!segs2.length) segs2=segs;
  segs=segs2;
  const nodes=[{name:segs[0].from}]; segs.forEach(sg=>nodes.push({name:sg.to}));
  nodes[0].role='origin'; nodes[nodes.length-1].role='dest';
  for(let i=1;i<nodes.length-1;i++){ const a=segs[i-1], b=segs[i]; nodes[i].role=(!a.walk&&!b.walk)?'interchange':'stop'; }
  return {segs, nodes};
}
function journeySVG(it,res){
  const J=buildJourney(it,res); if(!J) return '';
  const {segs,nodes}=J, LW=140, PADX=36, TY=72, H=170, W=PADX*2+(nodes.length-1)*LW;
  const P=[];
  segs.forEach((sg,i)=>{
    const x0=PADX+i*LW, x1=PADX+(i+1)*LW, mx=(x0+x1)/2;
    if(sg.walk){
      P.push(`<line x1="${x0}" y1="${TY}" x2="${x1}" y2="${TY}" stroke="#9fb0c0" stroke-width="3" stroke-dasharray="1,7" stroke-linecap="round"/>`);
      P.push(svgPill(mx, TY-13, '🚶 '+Math.max(1,Math.round(sg.mins))+' '+t('minUnit'), 'var(--surface-2)', 'var(--text)'));
    } else if(sg.ferry){
      P.push(`<rect x="${x0+3}" y="${TY-2}" width="${(x1-x0-6).toFixed(1)}" height="22" rx="8" fill="rgba(56,150,220,.18)"/>`);
      let wp=`M ${x0+5} ${TY+16}`; for(let wx=x0+5; wx<x1-9; wx+=12) wp+=' q 6 -5 12 0';
      P.push(`<path d="${wp}" fill="none" stroke="rgba(120,190,240,.75)" stroke-width="1.5"/>`);
      P.push(`<line x1="${x0}" y1="${TY}" x2="${x1}" y2="${TY}" stroke="${sg.color}" stroke-width="4" stroke-dasharray="1.5,6" stroke-linecap="round"/>`);
      P.push(svgPill(mx, TY-13, '⛴ '+t('kind_ferry'), sg.color, inkOn(sg.color)));
    } else {
      P.push(`<rect x="${x0}" y="${TY-4}" width="${(x1-x0).toFixed(1)}" height="8" rx="4" fill="${sg.color}"/>`);
      const lab=(sg.bus?'🚌 ':mGlyph(sg.kind)+' ')+sg.ref;
      const sub=sg.stops!=null?('  ·  '+sg.stops+' '+(sg.stops===1?t('stop_one'):t('stop_many'))):'';
      P.push(svgPill(mx, TY-13, lab+sub, sg.color, inkOn(sg.color)));
    }
  });
  nodes.forEach((nd,i)=>{
    const x=PADX+i*LW;
    if(nd.role==='origin'||nd.role==='dest') P.push(`<circle cx="${x}" cy="${TY}" r="7.5" fill="${nd.role==='origin'?'#3ee387':'#ff5d6c'}" stroke="#06121b" stroke-width="2.5"/>`);
    else if(nd.role==='interchange') P.push(`<circle cx="${x}" cy="${TY}" r="7" fill="var(--svg-hole)" stroke="var(--gold)" stroke-width="3"/>`);
    else P.push(`<circle cx="${x}" cy="${TY}" r="5" fill="var(--svg-hole)" stroke="var(--muted)" stroke-width="1.5"/>`);
    const bold=(nd.role!=='stop');
    P.push(`<text x="${x+4}" y="${TY+16}" transform="rotate(38 ${x+4} ${TY+16})" font-size="10.5" fill="${bold?'var(--text)':'var(--muted)'}" font-weight="${bold?'700':'500'}" style="font-family:var(--font)">${svgEsc(nd.name)}</text>`);
  });
  return `<svg class="jmap-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${P.join('')}</svg>`;
}
function journeyHTML(it,res){ const s=journeySVG(it,res); return s ? `<div class="jmap-h">${t('journeyMap')}</div><div class="jmap-scroll">${s}</div>` : ''; }

function openLine(line){
  selected = null; document.getElementById('stn').classList.remove('show');
  const live = isLive(line);
  curLineRef = live ? line.ref : null;   // only live lines can be followed for alerts
  updateFollowBtn();
  const meta = (HAS.lineMeta ? LINE_META[line.ref] : null) || {};
  const official = line.official || meta.official || line.ref;
  document.getElementById('lpSw').style.background = line.color;
  document.getElementById('lpSw').style.color = line.color;
  document.getElementById('lpRef').textContent = (line.partOf || line.ref) + (live ? '' : ' ◇');
  document.getElementById('lpName').textContent = official;
  /* Say that a funicular is a counterbalanced pair. It explains what the map is showing — two
     cars always moving against each other, meeting in the middle — and why the wait is a cycle
     rather than a queue of vehicles. It is a property of the mode, not a measurement. */
  const paired = live && line.kind === 'funicular' && line.paired !== false;
  document.getElementById('lpKind').textContent =
    kindLabel(line.kind) + (paired ? ' · '+t('pairedCars') : '')
    + (line.branch ? ' · '+t('shuttleSpur') : '') + (live ? '' : ' · ' + transStatus(line.status||'Planned'));
  const conns = [];
  if(live) line.stations.forEach((st,idx) => {
    const cl = clusterFor(line.ref, idx);
    if(cl && cl.lines.size>1){ const others=[...cl.lines].filter(r=>r!==line.ref); if(others.length) conns.push({at:st.name, others}); }
  });
  const third = live ? conns.length : (line.launch ? fmtLaunch(line.launch) : t('soonWord'));
  if(line.scope==='intercity'){
    // never derive length from geometry here: an intercity relation stitches with gaps, so
    // _len under-reports badly (İstanbul–Ankara → 244 of 533 km). Curated km or nothing.
    const km = line.km ? distNum(line.km).toFixed(0) : '—';
    document.getElementById('lpStats').innerHTML =
      `<div class="c"><b>${km}</b><span>${distUnit()}</span></div>
       <div class="c"><b>${icDur(line.mins)}</b><span>${t('journeyWord')}</span></div>
       <div class="c"><b style="font-size:${line.fare?'15px':'11px'}">${line.fare?line.fare+' ₺':'—'}</b><span>${t('fareApprox')}</span></div>`;
  } else
  document.getElementById('lpStats').innerHTML =
    `<div class="c"><b>${distNum(line._len/1000).toFixed(1)}</b><span>${distUnit()}</span></div>
     <div class="c"><b>${line.stations.length||'—'}</b><span>${t('stationsLower')}</span></div>
     <div class="c"><b style="font-size:${live?'15px':'11px'}">${third}</b><span>${live?t('interchangesWord'):t('targetOpen')}</span></div>`;
  const strip=document.getElementById('lpStrip'), stripBt=document.getElementById('lpStripBt');
  const stripHTML=lineStripHTML(line);
  strip.innerHTML=stripHTML;
  strip.style.display = stripHTML ? '' : 'none';
  if(stripBt) stripBt.style.display = stripHTML ? '' : 'none';
  document.getElementById('lpConn').innerHTML = !live
    ? `<div class="planned-banner">◷ ${line.status||'Planned'}${line.launch?(' · targeting '+fmtLaunch(line.launch)):''}<span>Excluded from live pathfinding &amp; carriage simulation until launch.${line.approx?' ⚠ Approximate alignment — hand-placed from the published station list.':''}</span></div>`
    : (conns.length
        ? conns.map(c=>`<div class="cn"><span class="at">${c.at}</span><span class="ls">${c.others.map(r=>`<span class="badge" style="background:${colorForLine(r)}">${r}</span>`).join('')}</span></div>`).join('')
        : '<div class="none">Terminus-to-terminus · no mid-line interchanges.</div>');
  if(!live){
    document.getElementById('lpExp').innerHTML =
      `<div class="exp"><div class="exp-n">${official}</div><div class="exp-m"><span class="exp-s wip">${line.status||'Planned'}</span> · ${line.launch?fmtLaunch(line.launch):'date TBC'}</div></div>`;
  } else {
    const exp = meta.exp || [];
    document.getElementById('lpExp').innerHTML = exp.length
      ? exp.map(e=>{ const cls=/oper/i.test(e.status)?'ok':(/constr|test/i.test(e.status)?'wip':'plan');
          return `<div class="exp"><div class="exp-n">${e.name}</div><div class="exp-m"><span class="exp-s ${cls}">${e.status}</span> · ${e.opening}</div></div>`; }).join('')
      : '<div class="none">No active expansion projects on record.</div>';
  }
  document.getElementById('linp').classList.add('show');
}
function closeAllPanels(){
  selected=null;
  document.getElementById('stn').classList.remove('show');
  document.getElementById('linp').classList.remove('show');
}

