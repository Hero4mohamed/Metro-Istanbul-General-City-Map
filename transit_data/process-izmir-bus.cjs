/* Turn İzmir's open-data CSVs into the shapes the app already consumes.
 *
 * The portal gives three things: a line list, every stop with the lines that serve it, and
 * ordered road geometry per line and direction. What it does not give is stops IN ORDER along a
 * line, which the routing graph needs.
 *
 * That is derivable. Each stop knows its lines; each line knows its road shape. Projecting a
 * line's stops onto that line's own geometry gives both the order (distance along the path) and
 * a way to tell the two directions apart (a stop serving the outbound side sits far from the
 * inbound polyline). This is the same projection the İstanbul bus pipeline uses.
 *
 * No timetables: İzmir publishes none for buses, so the schedule file is written empty rather
 * than filled with invented headways — the same rule applied to Ankara.
 *
 * Usage: node process-izmir-bus.cjs
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const rows = f => read(f).split(/\r?\n/).filter(l => l.trim()).map(l => l.split(';'));

const SNAP_MAX_M = 400;      // a stop further than this from a direction's path is not on it
const SIMPLIFY_M = 12;       // Douglas-Peucker tolerance; 563k raw points is far more than needed

/* --- geometry helpers: equirectangular metres, fine at city scale --- */
const R = 6371000, D2R = Math.PI / 180;
const mx = (lng, lat0) => lng * D2R * R * Math.cos(lat0 * D2R);
const my = lat => lat * D2R * R;

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][0];
  const P = pts.map(p => [mx(p[1], lat0), my(p[0])]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, best = tol;
    const [ax, ay] = P[a], [bx, by] = P[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = P[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx, qy = ay + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* distance from a point to a polyline, and how far along it that lands */
function projectOnto(pt, path2, lat0) {
  const px = mx(pt[1], lat0), py = my(pt[0]);
  let best = Infinity, along = 0, acc = 0;
  for (let i = 0; i + 1 < path2.length; i++) {
    const ax = mx(path2[i][1], lat0), ay = my(path2[i][0]);
    const bx = mx(path2[i + 1][1], lat0), by = my(path2[i + 1][0]);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const seg = Math.sqrt(len2);
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) { best = d; along = acc + t * seg; }
    acc += seg;
  }
  return { dist: best, along };
}

/* --- load --- */
const hatRows = rows('izmir-hatlar.csv').slice(1);
const durakRows = rows('izmir-duraklar.csv').slice(1);
const guzRows = rows('izmir-guzergah.csv').slice(1);

const lineMeta = new Map();          // ref -> {name, from, to}
for (const c of hatRows) {
  const ref = (c[0] || '').trim();
  if (!ref) continue;
  lineMeta.set(ref, { name: (c[1] || '').trim(), from: (c[4] || '').trim(), to: (c[5] || '').trim() });
}

const stopsByLine = new Map();       // ref -> [{name, lat, lng}]
let badStops = 0;
for (const c of durakRows) {
  const name = (c[1] || '').trim();
  const lat = parseFloat(c[2]), lng = parseFloat(c[3]);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) { badStops++; continue; }
  for (const ref of (c[4] || '').split('-').map(x => x.trim()).filter(Boolean)) {
    if (!stopsByLine.has(ref)) stopsByLine.set(ref, []);
    stopsByLine.get(ref).push({ name, lat, lng });
  }
}

const shapes = new Map();            // "ref|yon" -> [[lat,lng]]
for (const c of guzRows) {
  const ref = (c[0] || '').trim(), yon = (c[1] || '').trim();
  const lng = parseFloat(c[2]), lat = parseFloat(c[3]);
  if (!ref || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const k = ref + '|' + yon;
  if (!shapes.has(k)) shapes.set(k, []);
  const arr = shapes.get(k);
  const last = arr[arr.length - 1];
  if (last && last[0] === lat && last[1] === lng) continue;      // the feed repeats points
  arr.push([lat, lng]);
}

/* --- build --- */
const directory = [], graph = [], geom = {};
let noShape = 0, noStops = 0, rawPts = 0, keptPts = 0;

for (const [ref, meta] of [...lineMeta].sort((a, b) => {
  const na = parseInt(a[0], 10), nb = parseInt(b[0], 10);
  return (isNaN(na) ? 1e9 : na) - (isNaN(nb) ? 1e9 : nb) || a[0].localeCompare(b[0], 'tr');
})) {
  const candidates = stopsByLine.get(ref) || [];
  const chains = [];

  for (const yon of ['1', '2']) {
    const raw = shapes.get(ref + '|' + yon);
    if (!raw || raw.length < 2) continue;
    rawPts += raw.length;
    const shape = simplify(raw, SIMPLIFY_M);
    keptPts += shape.length;
    chains.push(shape);

    const lat0 = shape[0][0];
    const onPath = [];
    const seen = new Set();
    for (const s of candidates) {
      const { dist, along } = projectOnto([s.lat, s.lng], shape, lat0);
      if (dist > SNAP_MAX_M) continue;                    // belongs to the other direction
      const key = s.name + '@' + s.lat.toFixed(4) + ',' + s.lng.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);
      onPath.push({ along, stop: [+s.lat.toFixed(5), +s.lng.toFixed(5), s.name] });
    }
    if (onPath.length < 2) continue;
    onPath.sort((a, b) => a.along - b.along);
    const ordered = onPath.map(x => x.stop);
    const dir = yon === '1' ? 0 : 1;
    graph.push({
      ref, dir,
      head: dir === 0 ? (meta.to || '') : (meta.from || ''),
      stops: ordered,
    });
  }

  if (!chains.length) { noShape++; continue; }
  if (!graph.some(g => g.ref === ref)) { noStops++; }
  geom[ref] = chains;
  directory.push({
    ref,
    from: meta.from || (meta.name.split('-')[0] || '').trim(),
    to: meta.to || (meta.name.split('-').slice(1).join('-') || '').trim(),
    id: null,
    op: 'ESHOT',
    desc: meta.name,
  });
}
directory.forEach((d, i) => { d.id = i; });

fs.writeFileSync(path.join(DIR, 'izmir-bus-directory.json'), JSON.stringify(directory));
fs.writeFileSync(path.join(DIR, 'izmir-bus-graph.json'), JSON.stringify(graph));
fs.writeFileSync(path.join(DIR, 'izmir-bus-schedules.json'), JSON.stringify({}));
fs.writeFileSync(path.join(DIR, 'izmir-bus-geom.json'), JSON.stringify(geom));

const totalStops = graph.reduce((a, g) => a + g.stops.length, 0);
console.log('izmir: ' + directory.length + ' lines, ' + graph.length + ' directions, ' +
  totalStops + ' stops (' + (totalStops / (graph.length || 1)).toFixed(0) + ' per direction)');
console.log('       geometry ' + rawPts.toLocaleString('en') + ' → ' + keptPts.toLocaleString('en') +
  ' points after simplify at ' + SIMPLIFY_M + ' m');
if (noShape) console.log('       ' + noShape + ' line(s) had no usable geometry');
if (noStops) console.log('       ' + noStops + ' line(s) had geometry but too few stops to order');
if (badStops) console.log('       ' + badStops + ' stop row(s) skipped as unusable');
console.log('       no schedules written: İzmir publishes no bus timetable');
