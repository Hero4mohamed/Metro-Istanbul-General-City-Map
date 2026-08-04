// Fetch REAL road geometry for every İETT bus route and bake it, so drawn bus legs never
// depend on a live Overpass call at trip-planning time (Overpass is frequently congested, and
// when it fails the app was left showing a straight chord between stops).
// Output: bus-geom.json  { ref: [[lat,lng],…] }  — merged into bus-data-istanbul.json by build.cjs.
// Resumable: re-running keeps what it already has and only fetches the missing refs.
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const DIR = __dirname;

const dir = JSON.parse(fs.readFileSync(path.join(DIR, 'bus-directory.json'), 'utf8'));
const OUT = path.join(DIR, 'bus-geom.json');
const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
// stitch relation ways into the longest continuous road chain
function stitch(ways) {
  let ch = ways.map(w => w.slice()), merged = 1;
  while (merged) {
    merged = 0;
    for (let i = 0; i < ch.length && !merged; i++) for (let j = i + 1; j < ch.length; j++) {
      const A = ch[i], B = ch[j], a0 = A[0], a1 = A[A.length-1], b0 = B[0], b1 = B[B.length-1];
      let nc = null;
      if (meters(a1,b0) < 30) nc = A.concat(B.slice(1));
      else if (meters(a1,b1) < 30) nc = A.concat(B.slice().reverse().slice(1));
      else if (meters(a0,b1) < 30) nc = B.concat(A.slice(1));
      else if (meters(a0,b0) < 30) nc = B.slice().reverse().concat(A.slice(1));
      if (nc) { ch[i] = nc; ch.splice(j,1); merged = 1; break; }
    }
  }
  const len = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i-1], c[i]); return s; };
  return ch.sort((a,b) => len(b) - len(a));
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = eps*eps, keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length-1] = true;
  const st = [[0, pts.length-1]];
  const sd = (p,a,b) => { const x=a[0],y=a[1]; let dx=b[0]-x, dy=b[1]-y;
    if (dx||dy) { const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
      if (t>1){dx=p[0]-b[0];dy=p[1]-b[1];} else if (t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);} else {dx=p[0]-x;dy=p[1]-y;} }
    else { dx=p[0]-x; dy=p[1]-y; }
    return dx*dx+dy*dy; };
  while (st.length) { const [s,e] = st.pop(); let md=0, idx=-1;
    for (let i=s+1;i<e;i++){ const dd=sd(pts[i],pts[s],pts[e]); if(dd>md){md=dd;idx=i;} }
    if (md>sq && idx!==-1){ keep[idx]=true; st.push([s,idx],[idx,e]); } }
  return pts.filter((_,i)=>keep[i]);
}

const EPS = 0.00004;                      // ~4 m — keeps every real turn, drops noise
const ENDPOINTS = ['https://overpass-api.de/api/interpreter',
                   'https://overpass.kumi.systems/api/interpreter',
                   'https://overpass.private.coffee/api/interpreter'];
const tmp = path.join(require('os').tmpdir(), 'busgeom-q.txt');

function post(query, epIdx) {
  fs.writeFileSync(tmp, query);
  const out = execFileSync('curl.exe',
    ['-s','-m','170','-A','istanbul-rail-network/1.0 (data pipeline)','-X','POST',
     '--data-binary','@'+tmp, ENDPOINTS[epIdx % ENDPOINTS.length]],
    { maxBuffer: 1024*1024*400, encoding: 'utf8' });
  if (!out || out[0] !== '{') throw new Error('non-json');
  return JSON.parse(out);
}

const todo = dir.filter(l => l.id && !(l.ref in have));
console.log('bus routes total ' + dir.length + ', already have ' + Object.keys(have).length + ', to fetch ' + todo.length);

const BATCH = 40;
let ep = 0, done = 0, failed = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const q = '[out:json][timeout:170];(' + slice.map(l => 'relation(' + l.id + ');').join('') + ');out geom;';
  let data = null;
  for (let attempt = 0; attempt < 6 && !data; attempt++) {
    try { data = post(q, ep); }
    catch (e) { ep++; if (attempt === 5) console.warn('  ! batch failed at ' + i); }
  }
  if (!data) { failed += slice.length; continue; }
  const byId = {};
  for (const el of (data.elements || [])) if (el.type === 'relation') byId[el.id] = el;
  for (const l of slice) {
    const rel = byId[l.id];
    if (!rel) { have[l.ref] = null; continue; }
    const ways = (rel.members || []).filter(m => m.type === 'way' && m.geometry)
                                    .map(m => m.geometry.map(g => [g.lat, g.lon]));
    if (!ways.length) { have[l.ref] = null; continue; }
    const chains = stitch(ways);
    // keep every substantial chain: a route that is genuinely split must not be bridged by a chord
    const paths = chains.filter(c => c.length > 1).map(c => simplify(c, EPS).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));
    have[l.ref] = paths.length ? paths : null;
    done++;
  }
  fs.writeFileSync(OUT, JSON.stringify(have));           // checkpoint every batch → resumable
  console.log('  ' + Math.min(i + BATCH, todo.length) + '/' + todo.length + '  (' +
              (fs.statSync(OUT).size/1024/1024).toFixed(1) + ' MB)');
}
const withGeom = Object.keys(have).filter(k => have[k]).length;
console.log('DONE: ' + withGeom + ' routes with geometry, ' + (Object.keys(have).length - withGeom) +
            ' without, ' + failed + ' failed;  ' + (fs.statSync(OUT).size/1024/1024).toFixed(1) + ' MB');
