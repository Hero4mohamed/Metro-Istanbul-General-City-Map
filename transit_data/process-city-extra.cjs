// Completeness pass for the non-İstanbul city networks. Some real lines are NOT plain
// route relations with stop members, so process-city.cjs alone misses them:
//   • İZBAN's Tepeköy–Selçuk extension lives in its own relation (the line is Aliağa–Selçuk)
//   • İzmir's İZDENİZ ferries have over-water geometry but no pier members → piers come from
//     amenity=ferry_terminal nodes, selected by name / by hint like the İstanbul ferry pipeline
//   • Bursa's T2 tram relation carries no stop members → stops come from railway=tram_stop
//     nodes, which ARE mapped ("T2-Terminal", "T2-Kent Meydanı", …)
//   • Bursa's Uludağ Teleferik is mapped as aerialway WAYS, not a route relation
// Run AFTER process-city.cjs; it patches izmir-lines.json / bursa-lines.json and is
// idempotent (each line is replaced by ref, never duplicated).
const fs = require('fs'); const path = require('path');
const DIR = __dirname;

const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]); return s; };
function buildChains(ways, tol) {
  let ch = ways.map(w => w.slice()); let merged = 1;
  while (merged) {
    merged = 0;
    for (let i = 0; i < ch.length && !merged; i++) for (let j = i + 1; j < ch.length; j++) {
      const A = ch[i], B = ch[j], a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
      let nc = null;
      if (meters(a1, b0) < tol) nc = A.concat(B.slice(1));
      else if (meters(a1, b1) < tol) nc = A.concat(B.slice().reverse().slice(1));
      else if (meters(a0, b1) < tol) nc = B.concat(A.slice(1));
      else if (meters(a0, b0) < tol) nc = B.slice().reverse().concat(A.slice(1));
      if (nc) { ch[i] = nc; ch.splice(j, 1); merged = 1; break; }
    }
  }
  return ch;
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = eps * eps, keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const st = [[0, pts.length - 1]];
  const sd = (p, a, b) => { const x = a[0], y = a[1]; let dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { dx = p[0] - b[0]; dy = p[1] - b[1]; }
      else if (t > 0) { dx = p[0] - (x + dx * t); dy = p[1] - (y + dy * t); }
      else { dx = p[0] - x; dy = p[1] - y; } }
    else { dx = p[0] - x; dy = p[1] - y; }
    return dx * dx + dy * dy; };
  while (st.length) {
    const [s, e] = st.pop(); let md = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const dd = sd(pts[i], pts[s], pts[e]); if (dd > md) { md = dd; idx = i; } }
    if (md > sq && idx !== -1) { keep[idx] = true; st.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// distance of a point to a polyline + its position along it
function projOn(path, pt) {
  let best = Infinity, s = 0, acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], seg = meters(a, b);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t, py = a[1] + dy * t, d = meters(pt, [px, py]);
    if (d < best) { best = d; s = acc + meters(a, [px, py]); }
    acc += seg;
  }
  return { dist: best, s };
}
const orderAlong = (sts, path) => sts.map(st => ({ st, s: projOn(path, [st.lat, st.lng]).s }))
                                     .sort((a, b) => a.s - b.s).map(x => x.st);
const round = p => [+p[0].toFixed(5), +p[1].toFixed(5)];
const rd5 = v => +v.toFixed(5);

function load(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const rel = {}, node = {}, way = {};
  for (const e of raw.elements) {
    if (e.type === 'relation') rel[e.id] = e;
    else if (e.type === 'node') node[e.id] = e;
    else if (e.type === 'way') way[e.id] = e;
  }
  return { rel, node, way, all: raw.elements };
}
const G1 = load('gaps-geom.json');    // İZBAN-Selçuk, ferry routes, Bursa T2 geometry
const G2 = load('gaps2-geom.json');   // ferry terminals, Bursa tram stops, Uludağ ways/stations

function relPaths(r, tol, eps) {
  const ways = (r.members || []).filter(m => m.type === 'way' && m.geometry).map(m => m.geometry.map(g => [g.lat, g.lon]));
  return buildChains(ways, tol).filter(c => c.length > 1).sort((a, b) => chainLen(b) - chainLen(a))
                               .map(c => simplify(c, eps).map(round));
}
function relStations(r, src) {
  const seen = new Set(), out = [];
  for (const m of (r.members || [])) {
    if (m.type !== 'node') continue;
    const n = src.node[m.ref]; if (!n || !n.tags || !n.tags.name) continue;
    const nm = n.tags.name.trim(); const f = nm.toLocaleLowerCase('tr');
    if (seen.has(f)) continue; seen.add(f);
    out.push({ name: nm, lat: rd5(n.lat), lng: rd5(n.lon) });
  }
  return out;
}
// replace-or-append by ref so re-runs stay idempotent
function upsert(arr, line) {
  const i = arr.findIndex(l => l.ref === line.ref);
  if (i >= 0) arr[i] = line; else arr.push(line);
}

/* ============================ İZMİR ============================ */
const izmir = JSON.parse(fs.readFileSync(path.join(DIR, 'izmir-lines.json'), 'utf8'));

// (1) İZBAN Aliağa–Selçuk: fold the Tepeköy→Selçuk relation into the existing İZBAN line
{
  const z = izmir.find(l => l.ref === 'İZBAN');
  const ext = G1.rel[16191186];
  if (z && ext) {
    const before = z.stations.length;
    const seen = new Set(z.stations.map(s => s.name.toLocaleLowerCase('tr')));
    for (const st of relStations(ext, G1)) if (!seen.has(st.name.toLocaleLowerCase('tr'))) { seen.add(st.name.toLocaleLowerCase('tr')); z.stations.push(st); }
    z.paths = z.paths.concat(relPaths(ext, 120, 0.00004));
    // re-order the whole line along its longest path so Aliağa…Selçuk reads in sequence
    const main = z.paths.slice().sort((a, b) => chainLen(b) - chainLen(a))[0];
    z.stations = orderAlong(z.stations, main);
    z.official = 'İZBAN · Aliağa – Selçuk';
    console.log('İZBAN  ' + before + ' → ' + z.stations.length + ' stops (Selçuk extension), paths=' + z.paths.length);
  } else console.warn('  ! İZBAN extension not applied');
}

// (2) İZDENİZ ferries — over-water geometry from the route relation, piers from ferry_terminal
// nodes. Terminals whose name isn't tagged (Karşıyaka / Bostanlı / Bayraklı) are resolved by
// picking the REAL pier node nearest a hint coordinate, so every coordinate stays OSM data.
const PIER_HINT = { 'Karşıyaka':[38.4552,27.1202], 'Bostanlı':[38.4518,27.0979], 'Bayraklı':[38.4640,27.1585] };
const terminals = G2.all.filter(e => e.type === 'node' && e.tags && e.tags.amenity === 'ferry_terminal');
function findPier(name, path) {
  const f = name.toLocaleLowerCase('tr');
  let cand = terminals.filter(t => t.tags.name && t.tags.name.toLocaleLowerCase('tr').includes(f));
  if (!cand.length && PIER_HINT[name]) {                     // unnamed pier → nearest to the hint
    const h = PIER_HINT[name];
    cand = terminals.slice().sort((a, b) => meters([a.lat,a.lon],h) - meters([b.lat,b.lon],h)).slice(0, 1);
    if (cand.length && meters([cand[0].lat,cand[0].lon], h) > 1200) cand = [];
  }
  if (cand.length && path) cand = cand.sort((a, b) => projOn(path,[a.lat,a.lon]).dist - projOn(path,[b.lat,b.lon]).dist);
  if (!cand.length) return null;
  return { name, lat: rd5(cand[0].lat), lng: rd5(cand[0].lon) };
}
const FERRIES = [
  { rel:13743100, piers:['Karşıyaka','Konak'] },
  { rel:451604,   piers:['Bostanlı','Konak'] },
  { rel:451607,   piers:['Karşıyaka','Göztepe'] },
  { rel:451611,   piers:['Göztepe','Alsancak'] },
  { rel:451553,   piers:['Bostanlı','Üçkuyular'], car:true },
  { rel:451554,   piers:['Bayraklı','Alsancak','Pasaport','Konak'] },
  { rel:11289564, piers:['Konak','Güzelbahçe','Urla'] }
];
let ferryAdded = 0;
for (const cfg of FERRIES) {
  const r = G1.rel[cfg.rel]; if (!r) { console.warn('  ! ferry rel missing', cfg.rel); continue; }
  const paths = relPaths(r, 400, 0.00004);
  if (!paths.length) { console.warn('  ! ferry no geometry', cfg.piers.join('–')); continue; }
  const main = paths[0];
  const last = cfg.piers.length - 1;
  const stations = cfg.piers.map((p, i) => {
    const hit = findPier(p, main);
    if (hit) return hit;
    // a terminus with no tagged pier node (Bayraklı) — the route geometry ENDS at that pier,
    // so take the path endpoint: still real OSM data, and keeps the line's name honest
    if (i === 0)    return { name:p, lat:rd5(main[0][0]),               lng:rd5(main[0][1]) };
    if (i === last) return { name:p, lat:rd5(main[main.length-1][0]),   lng:rd5(main[main.length-1][1]) };
    return null;
  }).filter(Boolean);
  if (stations.length < 2) { console.warn('  ! ferry piers unresolved', cfg.piers.join('–')); continue; }
  // VALIDATION GATE. Several İzmir ferry relations carry geometry that does not match their
  // name (451607 "Karşıyaka–Göztepe" actually ends at Karantina; 11289564 "Konak–Urla" runs
  // off toward Karaburun; 451554 covers only the Alsancak–Pasaport leg). Ship a line only if
  // every pier genuinely sits on its own route, and no two piers collapsed onto one point.
  const off = stations.map(s => projOn(main, [s.lat, s.lng]).dist);
  const dup = stations.some((s, i) => stations.some((o, j) => j > i && meters([s.lat,s.lng],[o.lat,o.lng]) < 60));
  const worst = Math.max(...off);
  if (worst > 400 || dup) {
    console.warn('  ! skipped ' + cfg.piers.join('–') + ' — OSM geometry does not match the route' +
                 ' (worst pier ' + Math.round(worst) + ' m off' + (dup ? ', duplicate piers' : '') + ')');
    continue;
  }
  const ref = cfg.piers[0] + '–' + cfg.piers[last];
  upsert(izmir, { ref, kind:'ferry', color:'#3FA9E0', paths, stations: orderAlong(stations, main),
                  scope:'active', city:'izmir',
                  official:'İZDENİZ · ' + cfg.piers.join(' – ') + (cfg.car ? ' (arabalı)' : '') });
  ferryAdded++;
}
console.log('İzmir ferries added: ' + ferryAdded);
fs.writeFileSync(path.join(DIR, 'izmir-lines.json'), JSON.stringify(izmir));

/* ============================ BURSA ============================ */
const bursa = JSON.parse(fs.readFileSync(path.join(DIR, 'bursa-lines.json'), 'utf8'));

// (3) T2 tram — relation has geometry but no stop members; the stops exist as tram_stop nodes
{
  const r = G1.rel[14502330];
  const stops = G2.all.filter(e => e.type === 'node' && e.tags && e.tags.railway === 'tram_stop'
                                && /^T2\s*[-–]/.test(e.tags.name || ''));
  if (r && stops.length >= 2) {
    const paths = relPaths(r, 60, 0.00004);
    const seen = new Set(), sts = [];
    for (const n of stops) {
      const nm = n.tags.name.replace(/^T2\s*[-–]\s*/, '').trim(), f = nm.toLocaleLowerCase('tr');
      if (seen.has(f)) continue; seen.add(f);
      sts.push({ name: nm, lat: rd5(n.lat), lng: rd5(n.lon) });
    }
    upsert(bursa, { ref:'T2', kind:'tram', color:'#7E57C2', paths,
                    stations: orderAlong(sts, paths[0]), scope:'active', city:'bursa',
                    official:'T2 · Kent Meydanı – Terminal' });
    console.log('Bursa T2 added: ' + sts.length + ' stops, paths=' + paths.length);
  } else console.warn('  ! Bursa T2 not built');
}

// (4) Uludağ Teleferik — mapped as aerialway ways (cable_car), with real named stations
{
  const ways = [24774556, 24774655].map(id => G2.way[id]).filter(w => w && w.geometry);
  const NAMES = ['Teferrüç', 'Kadıyayla', 'Sarıalan', 'Kurbağakaya'];
  const stns = G2.all.filter(e => e.type === 'node' && e.tags && e.tags.aerialway === 'station'
                              && NAMES.indexOf((e.tags.name || '').trim()) >= 0);
  if (ways.length) {
    const paths = buildChains(ways.map(w => w.geometry.map(g => [g.lat, g.lon])), 250)
                    .filter(c => c.length > 1).sort((a, b) => chainLen(b) - chainLen(a))
                    .map(c => simplify(c, 0.00004).map(round));
    const seen = new Set(), sts = [];
    for (const n of stns) { const nm = n.tags.name.trim(), f = nm.toLocaleLowerCase('tr');
      if (seen.has(f)) continue; seen.add(f); sts.push({ name: nm, lat: rd5(n.lat), lng: rd5(n.lon) }); }
    let ordered = orderAlong(sts, paths[0]);
    // read base → summit: Teferrüç is the valley station, so flip if it ended up last
    if (ordered.length > 1 && /teferr/i.test(ordered[ordered.length - 1].name)) ordered = ordered.reverse();
    upsert(bursa, { ref:'TF', kind:'cable', color:'#E8A33D', paths,
                    stations: ordered, scope:'active', city:'bursa',
                    official:'Uludağ Teleferik · Teferrüç – Oteller' });
    console.log('Bursa Uludağ Teleferik added: ' + sts.length + ' stations, paths=' + paths.length);
  } else console.warn('  ! Uludağ ways missing');
}
fs.writeFileSync(path.join(DIR, 'bursa-lines.json'), JSON.stringify(bursa));

for (const [c, arr] of [['izmir', izmir], ['bursa', bursa]])
  console.log('\n' + c.toUpperCase() + ' now ' + arr.length + ' lines: ' +
              arr.map(l => l.ref + '(' + l.stations.length + ')').join(', '));
