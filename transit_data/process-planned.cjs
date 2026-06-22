// Process planned / under-construction lines (Vision & Expansion scope).
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'planned.json'), 'utf8'));

const rels  = raw.elements.filter(e => e.type === 'relation');
const nodes = raw.elements.filter(e => e.type === 'node');
const nodeMap = {};
for (const n of nodes) nodeMap[n.id] = { name:(n.tags&&n.tags.name)||null, lat:n.lat, lon:n.lon };

const Rm = 6371000, toRad = d => d*Math.PI/180;
function meters(a,b){ const dLat=toRad(b[0]-a[0]),dLng=toRad(b[1]-a[1]),la1=toRad(a[0]),la2=toRad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*Rm*Math.asin(Math.sqrt(h)); }
const chainLen = c => { let s=0; for(let i=1;i<c.length;i++) s+=meters(c[i-1],c[i]); return s; };
function buildChains(ways, tol){
  let chains = ways.map(w=>w.slice()); let merged=true;
  while(merged){ merged=false;
    for(let i=0;i<chains.length && !merged;i++) for(let j=i+1;j<chains.length;j++){
      const A=chains[i],B=chains[j],a0=A[0],a1=A[A.length-1],b0=B[0],b1=B[B.length-1]; let nc=null;
      if(meters(a1,b0)<tol)nc=A.concat(B.slice(1)); else if(meters(a1,b1)<tol)nc=A.concat(B.slice().reverse().slice(1));
      else if(meters(a0,b1)<tol)nc=B.concat(A.slice(1)); else if(meters(a0,b0)<tol)nc=B.slice().reverse().concat(A.slice(1));
      if(nc){ chains[i]=nc; chains.splice(j,1); merged=true; break; } }
  }
  return chains;
}
function simplify(pts,eps){ if(pts.length<3)return pts; const sq=eps*eps; const keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true; const st=[[0,pts.length-1]];
  const sd=(p,a,b)=>{const x=a[0],y=a[1];let dx=b[0]-x,dy=b[1]-y; if(dx||dy){const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
    if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];}else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);}else{dx=p[0]-x;dy=p[1]-y;}}else{dx=p[0]-x;dy=p[1]-y;}return dx*dx+dy*dy;};
  while(st.length){const[s,e]=st.pop();let md=0,idx=-1;for(let i=s+1;i<e;i++){const dd=sd(pts[i],pts[s],pts[e]);if(dd>md){md=dd;idx=i;}}
    if(md>sq&&idx!==-1){keep[idx]=true;st.push([s,idx],[idx,e]);}}
  return pts.filter((_,i)=>keep[i]); }

// ref → planned-line config
function planCfg(rel){
  const t = rel.tags||{};
  let ref = t.ref;
  // M11 is fully operational since 19 Jun 2026 → handled by the active set, skip here.
  if (ref === 'M7') ref = 'M7X';             // Mecidiyeköy–Yıldız–Kabataş extension
  if (ref === 'M4') ref = 'M4X';             // Sabiha Gökçen–Tuzla extension (only the Tuzla relation is fetched)
  const CFG = {
    'M7X' :{ kind:'subway', color:'#F490B3', official:'M7 Extension · Yıldız – Kabataş', launch:null, status:'Under construction' },
    'M4X' :{ kind:'subway', color:'#E81E77', official:'M4 Extension · Sabiha Gökçen – Tuzla', launch:null, status:'Under construction' },
    'M12' :{ kind:'subway', color:'#CAD300', official:'M12 · Göztepe – Ümraniye (Finance Center Axis)', launch:null, status:'Under construction' },
    'M10' :{ kind:'subway', color:'#4CAA3C', official:'M10 · Pendik – Sabiha Gökçen Havalimanı', launch:null, status:'Under construction' },
    'T6'  :{ kind:'tram',   color:'#E77C7C', official:'T6 · Sirkeci – Kazlıçeşme', scope:'active', status:'Operational', launch:null },
    'T7'  :{ kind:'tram',   color:'#B16400', official:'T7 · Bayrampaşa Meydan – Feshane', launch:null, status:'Under construction' }
  };
  return { ref, cfg: CFG[ref] };
}

const groups = {};
for (const rel of rels){ const { ref } = planCfg(rel); if(!ref) continue; (groups[ref]=groups[ref]||[]).push(rel); }

function extract(ref, list){
  let best=null;
  for(const rel of list){
    const ways=(rel.members||[]).filter(m=>m.type==='way'&&m.geometry&&!/platform/.test(m.role||''))
      .map(m=>m.geometry.map(g=>[g.lat,g.lon]));
    if(!ways.length) continue;
    const chains=buildChains(ways,40).sort((a,b)=>chainLen(b)-chainLen(a));
    const stations=[]; const seen=new Set();
    for(const m of (rel.members||[])){ if(m.type!=='node')continue; if(!/stop|platform/.test(m.role||''))continue;
      const info=nodeMap[m.ref]; if(!info||!info.name)continue; if(seen.has(info.name))continue; seen.add(info.name);
      stations.push({name:info.name,lat:info.lat,lng:info.lon}); }
    const score=chainLen(chains[0])+stations.length*1000;
    if(!best||score>best.score) best={chains,stations,score};
  }
  if(!best) return null;
  const round=c=>simplify(c,0.00003).map(p=>[+p[0].toFixed(5),+p[1].toFixed(5)]);
  let paths=best.chains.filter((c,i)=>i===0||chainLen(c)>300).map(round);
  if(!paths.length) paths=[round(best.chains[0])];
  return { paths, stations: best.stations.map(s=>({name:s.name,lat:+s.lat.toFixed(5),lng:+s.lng.toFixed(5)})) };
}

const out=[];
for(const ref of Object.keys(groups)){
  const { cfg } = planCfg(groups[ref][0]);
  if(!cfg) continue;
  const ex = extract(ref, groups[ref]);
  if(!ex || !ex.paths.length || ex.paths[0].length<2) continue;
  out.push({ ref, kind:cfg.kind, color:cfg.color, paths:ex.paths, stations:ex.stations,
             scope:cfg.scope||'planned', official:cfg.official, status:cfg.status, launch:cfg.launch, partOf:cfg.partOf||null });
}
const order = { 'M7X':0,'M4X':1,'M10':2,'M12':3,'T6':4,'T7':5 };
out.sort((a,b)=>(order[a.ref]??9)-(order[b.ref]??9));

fs.writeFileSync(path.join(DIR,'planned-lines.json'), JSON.stringify(out));
console.log('REF'.padEnd(7),'KIND'.padEnd(9),'PTS','STAT','LAUNCH');
for(const l of out) console.log(l.ref.padEnd(7),(l.kind||'').padEnd(9),String(l.paths[0].length).padEnd(4),String(l.stations.length).padEnd(4),l.launch||'—');
console.log('TOTAL PLANNED:', out.length);
