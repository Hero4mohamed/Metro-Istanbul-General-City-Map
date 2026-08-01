// Fill the last gaps: bus refs that the routing graph uses (İETT GTFS) but which have no entry
// in bus-directory.json, so the id-based pass missed them. These are fetched by REF name from
// OSM instead. Appends into bus-geom.json (never overwrites an existing shape).
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const DIR = __dirname;

const graph = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-graph.json'), 'utf8'));
const geom  = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-geom.json'), 'utf8'));
const refs  = [...new Set(graph.map(l => l.ref))].filter(r => !geom[r]);
console.log('routed bus refs without geometry: ' + refs.length);
if (!refs.length) process.exit(0);

const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0]-a[0]), dLng = toRad(b[1]-a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*Rm*Math.asin(Math.sqrt(h));
}
function stitch(ways) {
  let ch = ways.map(w => w.slice()), merged = 1;
  while (merged) { merged = 0;
    for (let i=0;i<ch.length && !merged;i++) for (let j=i+1;j<ch.length;j++) {
      const A=ch[i],B=ch[j],a0=A[0],a1=A[A.length-1],b0=B[0],b1=B[B.length-1]; let nc=null;
      if (meters(a1,b0)<30) nc=A.concat(B.slice(1));
      else if (meters(a1,b1)<30) nc=A.concat(B.slice().reverse().slice(1));
      else if (meters(a0,b1)<30) nc=B.concat(A.slice(1));
      else if (meters(a0,b0)<30) nc=B.slice().reverse().concat(A.slice(1));
      if (nc) { ch[i]=nc; ch.splice(j,1); merged=1; break; } } }
  const len = c => { let s=0; for(let i=1;i<c.length;i++) s+=meters(c[i-1],c[i]); return s; };
  return ch.sort((a,b)=>len(b)-len(a));
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq=eps*eps, keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true; const st=[[0,pts.length-1]];
  const sd=(p,a,b)=>{ const x=a[0],y=a[1]; let dx=b[0]-x,dy=b[1]-y;
    if(dx||dy){ const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
      if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];} else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);} else {dx=p[0]-x;dy=p[1]-y;} }
    else { dx=p[0]-x; dy=p[1]-y; } return dx*dx+dy*dy; };
  while(st.length){ const [s,e]=st.pop(); let md=0,idx=-1;
    for(let i=s+1;i<e;i++){ const dd=sd(pts[i],pts[s],pts[e]); if(dd>md){md=dd;idx=i;} }
    if(md>sq&&idx!==-1){ keep[idx]=true; st.push([s,idx],[idx,e]); } }
  return pts.filter((_,i)=>keep[i]);
}
const ENDPOINTS = ['https://overpass-api.de/api/interpreter',
                   'https://overpass.kumi.systems/api/interpreter',
                   'https://overpass.private.coffee/api/interpreter'];
const tmp = path.join(require('os').tmpdir(), 'busgeom-extra.txt');
function post(q, ep) {
  fs.writeFileSync(tmp, q);
  const out = execFileSync('curl.exe',
    ['-s','-m','170','-A','istanbul-rail-network/1.0 (data pipeline)','-X','POST','--data-binary','@'+tmp,
     ENDPOINTS[ep % ENDPOINTS.length]], { maxBuffer: 1024*1024*300, encoding:'utf8' });
  if (!out || out[0] !== '{') throw new Error('non-json');
  return JSON.parse(out);
}

const esc = r => r.replace(/["\\]/g, '');
const BATCH = 15; let ep = 0, added = 0;
for (let i = 0; i < refs.length; i += BATCH) {
  const slice = refs.slice(i, i + BATCH);
  // İstanbul bbox, matched by exact ref so we don't pull another city's line with the same number
  const q = '[out:json][timeout:170];(' +
    slice.map(r => `relation["route"="bus"]["ref"="${esc(r)}"](40.78,28.00,41.65,29.95);`).join('') +
    ');out geom;';
  let data = null;
  for (let a = 0; a < 5 && !data; a++) { try { data = post(q, ep); } catch (e) { ep++; } }
  if (!data) { console.warn('  ! batch failed at ' + i); continue; }
  const byRef = {};
  for (const el of (data.elements || [])) {
    if (el.type !== 'relation' || !el.tags || !el.tags.ref) continue;
    (byRef[el.tags.ref] = byRef[el.tags.ref] || []).push(el);
  }
  for (const r of slice) {
    const rels = byRef[r]; if (!rels || !rels.length) { continue; }
    // merge every direction's ways, then keep the distinct chains
    const ways = [];
    for (const rel of rels)
      for (const m of (rel.members || [])) if (m.type === 'way' && m.geometry) ways.push(m.geometry.map(g => [g.lat, g.lon]));
    if (!ways.length) continue;
    const paths = stitch(ways).filter(c => c.length > 1).map(c => simplify(c, 0.00004).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));
    if (paths.length) { geom[r] = paths; added++; }
  }
  fs.writeFileSync(path.join(DIR, 'bus-geom.json'), JSON.stringify(geom));
  console.log('  ' + Math.min(i + BATCH, refs.length) + '/' + refs.length + ' (added ' + added + ')');
}
const still = [...new Set(graph.map(l => l.ref))].filter(r => !geom[r]);
console.log('DONE: added ' + added + '; routed refs still without geometry: ' + still.length +
            (still.length ? ' → ' + still.slice(0, 12).join(', ') : ''));
