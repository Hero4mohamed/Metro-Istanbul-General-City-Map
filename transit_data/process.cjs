// Process raw Overpass output into a compact, embeddable transit dataset.
// v2: connectivity-based stitching (no cross-map artifacts), multi-path output
//     (branches kept as separate arrays), and the M2 Seyrantepe shuttle spur.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'network.json'), 'utf8'));

const rels  = raw.elements.filter(e => e.type === 'relation');
const nodes = raw.elements.filter(e => e.type === 'node');

const nodeMap = {};
for (const n of nodes) nodeMap[n.id] = { name: (n.tags && n.tags.name) || null, lat: n.lat, lon: n.lon };

// ---- geo helpers ----
const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b){
  const dLat = toRad(b[0]-a[0]), dLng = toRad(b[1]-a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*Rm*Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s=0; for(let i=1;i<c.length;i++) s += meters(c[i-1],c[i]); return s; };

// Merge ways into connected chains by shared endpoints. Disconnected pieces
// (platform stubs, depot tracks, missing segments) stay as separate chains so
// the renderer never draws a straight line across a gap.
function buildChains(ways, tol){
  let chains = ways.map(w => w.slice());
  let merged = true;
  while(merged){
    merged = false;
    for(let i=0;i<chains.length && !merged;i++){
      for(let j=i+1;j<chains.length;j++){
        const A=chains[i], B=chains[j];
        const a0=A[0], a1=A[A.length-1], b0=B[0], b1=B[B.length-1];
        let nc=null;
        if(meters(a1,b0)<tol)      nc = A.concat(B.slice(1));
        else if(meters(a1,b1)<tol) nc = A.concat(B.slice().reverse().slice(1));
        else if(meters(a0,b1)<tol) nc = B.concat(A.slice(1));
        else if(meters(a0,b0)<tol) nc = B.slice().reverse().concat(A.slice(1));
        if(nc){ chains[i]=nc; chains.splice(j,1); merged=true; break; }
      }
    }
  }
  return chains;
}

// Douglas-Peucker (epsilon in degrees, ~0.00003 ≈ 3 m)
function simplify(pts, eps){
  if (pts.length < 3) return pts;
  const sqEps = eps*eps;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length-1] = true;
  const stack = [[0, pts.length-1]];
  const sd = (p,a,b)=>{ const x=a[0],y=a[1]; let dx=b[0]-x,dy=b[1]-y;
    if(dx||dy){ const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
      if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];} else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);} else {dx=p[0]-x;dy=p[1]-y;} }
    else {dx=p[0]-x;dy=p[1]-y;} return dx*dx+dy*dy; };
  while(stack.length){
    const [s,e]=stack.pop(); let md=0, idx=-1;
    for(let i=s+1;i<e;i++){ const dd=sd(pts[i],pts[s],pts[e]); if(dd>md){md=dd;idx=i;} }
    if(md>sqEps && idx!==-1){ keep[idx]=true; stack.push([s,idx],[idx,e]); }
  }
  return pts.filter((_,i)=>keep[i]);
}

// official-ish colour palette (keyed by ref)
// Official Metro İstanbul line colours (from Wikipedia's Istanbul Metro colour
// module + verified line-symbol SVGs). These override OSM colour tags.
const PALETTE = {
  'M1A':'#EE2229','M1B':'#EE2229',
  'M2':'#059A4D','M2S':'#059A4D','M3':'#0CA6DF','M4':'#E81E77','M5':'#683166','M6':'#C9AA79',
  'M7':'#F490B3','M8':'#487ABF','M9':'#FCD10D','M10':'#4CAA3C','M11':'#A1609B',
  'Marmaray':'#0098A8',
  'T1':'#004B86','T2':'#90ABA0','T3':'#99562F','T4':'#FF7E42','T5':'#7B72B2','T6':'#E77C7C','T7':'#B16400',
  'F1':'#7A745A','F2':'#7A745A','F3':'#7A745A','F4':'#7A745A',
  'Metrobüs':'#A6093D'
};

function normRef(rel){
  const t = rel.tags || {};
  if (t.route === 'train') return 'Marmaray';
  if (t.route === 'bus')   return 'Metrobüs';
  // İstiklal nostalgic tram (Taksim–Tünel) = T2
  if (t.route === 'tram' && /nostal/i.test(t.name||'') && /(tünel|taksim)/i.test(t.name||'')) return 'T2';
  const ref = t.ref || (t.name ? t.name.split(/[: ]/)[0] : 'unknown');
  if (ref === 'M2' && /seyrantepe/i.test(t.name||'')) return 'M2S';  // shuttle spur
  return ref;
}

const groups = {};
for (const rel of rels){ const ref = normRef(rel); (groups[ref] = groups[ref]||[]).push(rel); }

function relWays(rel){
  return (rel.members||[]).filter(m => m.type==='way' && m.geometry && !/platform/.test(m.role||''))
                          .map(m => m.geometry.map(g => [g.lat, g.lon]));
}
function relStops(rel, seen, out){
  for (const m of (rel.members||[])){
    if (m.type!=='node' || !/stop|platform/.test(m.role||'')) continue;
    const info = nodeMap[m.ref];
    if (!info || !info.name || seen.has(info.name)) continue;
    seen.add(info.name); out.push({ name:info.name, lat:info.lat, lng:info.lon });
  }
}
function extractLine(ref, relList){
  let best = null;
  if (ref === 'M7'){
    // operational M7 = Mahmutbey–Mecidiyeköy trunk + Mecidiyeköy–Yıldız extension
    const trunk = relList.find(r => /mahmutbey\s*-\s*mecidiyeköy/i.test(r.tags.name||''));
    const ext   = relList.find(r => /mecidiyeköy\s*-\s*yıldız/i.test(r.tags.name||''));
    const rels = [trunk, ext].filter(Boolean);
    if (rels.length){
      let ways = []; const stations = []; const seen = new Set();
      rels.forEach(r => { ways = ways.concat(relWays(r)); relStops(r, seen, stations); });
      const chains = buildChains(ways, 45).sort((a,b)=>chainLen(b)-chainLen(a));
      best = { chains, stations, tags:(trunk||ext).tags };
    }
  }
  if (!best){
    for (const rel of relList){
      const ways = relWays(rel);
      if (!ways.length) continue;
      const chains = buildChains(ways, 35).sort((a,b)=>chainLen(b)-chainLen(a));
      const stations = []; relStops(rel, new Set(), stations);
      const score = chainLen(chains[0]) + stations.length*1000;
      if (!best || score>best.score) best = { chains, stations, score, tags:rel.tags };
    }
  }
  if (!best) return null;

  const eps = (ref==='Metrobüs'||ref==='Marmaray') ? 0.00004 : 0.00003;
  const minPath = (ref==='Metrobüs') ? 500 : 400;   // drop short noise chains
  const round = c => simplify(c, eps).map(p => [ +p[0].toFixed(5), +p[1].toFixed(5) ]);
  let paths = best.chains.filter((c,i)=> i===0 || chainLen(c) > minPath).map(round);
  if (!paths.length) paths = [ round(best.chains[0]) ];
  // paths[0] is the main continuous path; the app derives coords = paths[0].
  const stations = best.stations.map(s => ({ name:s.name, lat:+s.lat.toFixed(5), lng:+s.lng.toFixed(5) }));

  const osm = best.tags.colour && /^#?[0-9A-Fa-f]{6}$/.test(best.tags.colour.replace('#',''))
            ? (best.tags.colour[0]==='#'?best.tags.colour:'#'+best.tags.colour) : null;
  const colour = PALETTE[ref] || osm || '#888888';   // official palette wins

  let kind = best.tags.route;
  if (ref==='Marmaray') kind='marmaray';
  if (ref==='Metrobüs') kind='metrobus';
  if (/^F\d/.test(ref))  kind='funicular';
  // M2S is the Seyrantepe shuttle — integrated into M2 (solid green, no separate
  // legend chip), so it reads as part of the M2 backbone rather than its own line.
  const branch = false;
  const partOf = (ref==='M2S') ? 'M2' : null;
  return { ref, kind, color:colour, paths, stations, branch, partOf, scope:'active' };
}

// T7 is a planned/Vision line; T6 is operational but route=train in OSM (handled
// in process-planned.cjs as scope:active). T2 = İstiklal nostalgic tram.
const ALLOWED = new Set([
  'M1A','M1B','M2','M2S','M3','M4','M5','M6','M7','M8','M9','M11',
  'T1','T2','T3','T4','T5','F1','F2','F3','F4','Marmaray','Metrobüs'
]);
const out = [];
for (const ref of Object.keys(groups)){
  if (!ALLOWED.has(ref)) continue;
  const line = extractLine(ref, groups[ref]);
  if (!line || !line.paths.length || line.paths[0].length < 2) continue;
  out.push(line);
}

const order = { subway:0, marmaray:0, train:0, tram:2, light_rail:1, funicular:3, monorail:2, metrobus:4 };
out.sort((a,b)=> (order[a.kind]??9)-(order[b.kind]??9) || a.ref.localeCompare(b.ref));

fs.writeFileSync(path.join(DIR,'lines.json'), JSON.stringify(out));
const kb = (fs.statSync(path.join(DIR,'lines.json')).size/1024).toFixed(1);

// diagnostics: confirm no big intra-path gaps remain
console.log('LINE'.padEnd(10),'KIND'.padEnd(10),'COLOR'.padEnd(9),'PATHS','MAIN_PTS','STAT','MAXGAP(m)');
for (const l of out){
  let mg=0; l.paths.forEach(p=>{ for(let i=1;i<p.length;i++) mg=Math.max(mg, meters(p[i-1],p[i])); });
  console.log(l.ref.padEnd(10),(l.kind||'').padEnd(10),l.color.padEnd(9),
    String(l.paths.length).padEnd(5), String(l.paths[0].length).padEnd(8), String(l.stations.length).padEnd(4), Math.round(mg));
}
console.log('\nTOTAL LINES:', out.length, ' FILE:', kb, 'KB');
