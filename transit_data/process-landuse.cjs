/* Turn the raw OpenStreetMap land-use dump (fetch-landuse.cjs) into the small file the app ships.
 *
 *   node transit_data/process-landuse.cjs [city ...]
 *
 * Reads landuse-osm-<city>.json, writes landuse-<city>.json.
 *
 * WHAT HAPPENS TO A POLYGON
 *   1. Classified into one of four things the basemap paints: forest, park, campus, airport. A tag
 *      that is none of them is not drawn (see the note in fetch-landuse.cjs about farmland).
 *   2. Its rings are assembled: a plain closed way is one ring; a multipolygon relation is stitched
 *      together from its member ways, outer rings and holes apart. A relation whose outline does not
 *      close is DROPPED, not guessed at — a forest with a straight line across it is worse than a
 *      forest that is missing.
 *   3. Measured, in hectares, so the app can leave small ones out while zoomed out. A polygon under
 *      its class's minimum is dropped here, which is what keeps the file small.
 *   4. Simplified (Douglas-Peucker, 3.5 m, 6 m for forests: invisible at the deepest zoom the map offers) and written
 *      as integer deltas of 1e-5 degrees (~1.1 m), which is what makes it compress.
 *
 * The decoder lives in the app (08a-landuse.js) and the tests round-trip one through the other.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CLASSES = ['forest', 'park', 'campus', 'airport'];          // index = the class code stored in the file
const MIN_HA = { forest: 1.5, park: 0.3, campus: 2, airport: 10 };
/* Simplification tolerance, metres. A forest's edge is fuzzy anyway and forests are most of the vertices
   (four in five in İstanbul), so they are simplified harder; a park or a campus is a designed shape. */
const TOL_M = { forest: 6, park: 3.5, campus: 3.5, airport: 3.5 };
const SCALE = 1e5;                                                // degrees -> integer units (~1.1 m)

/* The one place a tag becomes a class. First match wins, most specific first: an aerodrome inside
   a nature reserve is an airport. */
function classOf(tags) {
  const t = tags || {};
  if (t.aeroway === 'aerodrome') return 'airport';
  if (t.amenity === 'university' || t.amenity === 'college' || t.amenity === 'hospital') return 'campus';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.leisure === 'nature_reserve') return 'forest';
  if (t['garden:type']) return null;                              // a private garden, not a place anyone goes
  if (/^(park|garden|golf_course|recreation_ground|common)$/.test(t.leisure || '')) return 'park';
  if (/^(grass|village_green|recreation_ground)$/.test(t.landuse || '')) return 'park';
  return null;
}

const key = p => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
const isClosed = pts => pts.length >= 4 && key(pts[0]) === key(pts[pts.length - 1]);

/* Join open polylines end to end into closed rings. Ways in a multipolygon share their end nodes
   exactly, so matching is by coordinate, in either direction. Returns { rings, open } where `open`
   counts the polylines that never closed. */
function assembleRings(segments) {
  const rings = [];
  const left = segments.filter(s => s && s.length >= 2).map(s => s.slice());
  const done = [];
  for (const s of left) { if (isClosed(s)) done.push(s); }
  const pool = left.filter(s => !isClosed(s));
  let open = 0;
  while (pool.length) {
    let ring = pool.pop(), grew = true;
    while (grew && !isClosed(ring)) {
      grew = false;
      const end = key(ring[ring.length - 1]), start = key(ring[0]);
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i], a = key(s[0]), b = key(s[s.length - 1]);
        if (a === end)        { ring = ring.concat(s.slice(1)); }
        else if (b === end)   { ring = ring.concat(s.slice(0, -1).reverse()); }
        else if (b === start) { ring = s.concat(ring.slice(1)); }
        else if (a === start) { ring = s.slice().reverse().concat(ring.slice(1)); }
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    if (isClosed(ring)) done.push(ring); else open++;
  }
  for (const r of done) rings.push(r);
  return { rings, open };
}

/* The polygon(s) of one OSM element, as { outers: [ring...], inners: [ring...] } with every ring a
   list of {lat, lon}; or null when it has no usable outline. */
function ringsOfElement(e) {
  if (e.type === 'way') {
    const g = e.geometry || [];
    return isClosed(g) ? { outers: [g], inners: [], open: 0 } : null;
  }
  if (e.type === 'relation') {
    const outer = [], inner = [];
    for (const m of e.members || []) {
      if (m.type !== 'way' || !m.geometry || m.geometry.length < 2) continue;
      (m.role === 'inner' ? inner : outer).push(m.geometry);
    }
    if (!outer.length) return null;
    const o = assembleRings(outer), i = assembleRings(inner);
    if (!o.rings.length) return null;
    /* An outer outline with a gap in it would be drawn with a chord straight across it. If ANY
       outer polyline failed to close, the whole relation is left out. A hole that fails to close is
       just a hole we do not cut. */
    if (o.open) return null;
    return { outers: o.rings, inners: i.rings, open: o.open };
  }
  return null;
}

/* metres per degree at a latitude (equirectangular: exact enough for polygons a few km across) */
function mPerDeg(lat) { return { y: 111320, x: 111320 * Math.cos(lat * Math.PI / 180) }; }

function ringAreaM2(pts) {
  if (pts.length < 4) return 0;
  const m = mPerDeg(pts[0].lat);
  let a = 0;
  for (let i = 0, n = pts.length - 1; i < n; i++) {
    const x1 = pts[i].lon * m.x, y1 = pts[i].lat * m.y, x2 = pts[i + 1].lon * m.x, y2 = pts[i + 1].lat * m.y;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/* Douglas-Peucker on one ring, tolerance in metres. Iterative so a 5,000-vertex forest cannot
   overflow the stack. The ring stays closed: its first and last points are always kept. */
function simplify(pts, tolM) {
  if (pts.length <= 4) return pts;
  const m = mPerDeg(pts[0].lat);
  const P = pts.map(p => [p.lon * m.x, p.lat * m.y]);
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let dmax = 0, idx = -1;
    const ax = P[a][0], ay = P[a][1], bx = P[b][0], by = P[b][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (L2 === 0) d = Math.hypot(P[i][0] - ax, P[i][1] - ay);
      else {
        const t = Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / L2));
        d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
      }
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tolM && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < P.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* [lat0, lon0, dlat, dlon, dlat, dlon, ...] in integer units. The closing point is NOT stored (it
   always equals the first); the decoder closes the ring. */
function encodeRing(pts) {
  const out = [];
  let pl = 0, po = 0;
  const n = pts.length - 1;                                       // drop the duplicate closing point
  for (let i = 0; i < n; i++) {
    const la = Math.round(pts[i].lat * SCALE), lo = Math.round(pts[i].lon * SCALE);
    if (i === 0) out.push(la, lo); else out.push(la - pl, lo - po);
    pl = la; po = lo;
  }
  return out;
}
function decodeRing(a) {
  const pts = [];
  let la = 0, lo = 0;
  for (let i = 0; i + 1 < a.length; i += 2) {
    la = i === 0 ? a[0] : la + a[i]; lo = i === 0 ? a[1] : lo + a[i + 1];
    pts.push([la / SCALE, lo / SCALE]);
  }
  if (pts.length) pts.push(pts[0]);
  return pts;
}

function build(raw) {
  const stats = { in: raw.elements.length, classes: {}, droppedOpen: 0, droppedSmall: 0, unclassified: 0, vertices: 0 };
  CLASSES.forEach(c => { stats.classes[c] = 0; });
  const polys = [];
  for (const e of raw.elements) {
    const cls = classOf(e.tags);
    if (!cls) { stats.unclassified++; continue; }
    const r = ringsOfElement(e);
    if (!r) { stats.droppedOpen++; continue; }
    // one OSM element can be several separate pieces (a relation with two outer rings): keep each piece with ITS holes
    const pieces = r.outers.map(o => ({ outer: o, holes: [] }));
    for (const h of r.inners) {
      // a hole belongs to the outer ring that contains its first vertex
      const home = pieces.find(p => pointInRing(h[0], p.outer));
      if (home) home.holes.push(h);
    }
    for (const p of pieces) {
      let m2 = ringAreaM2(p.outer);
      for (const h of p.holes) m2 -= ringAreaM2(h);
      const ha = m2 / 10000;
      if (ha < MIN_HA[cls]) { stats.droppedSmall++; continue; }
      const outer = simplify(p.outer, TOL_M[cls]);
      if (outer.length < 4) { stats.droppedSmall++; continue; }
      const rings = [encodeRing(outer)];
      for (const h of p.holes) {
        if (ringAreaM2(h) < 1000) continue;                       // a hole under 0.1 ha is noise
        const hs = simplify(h, TOL_M[cls]);
        if (hs.length >= 4) rings.push(encodeRing(hs));
      }
      polys.push([CLASSES.indexOf(cls), Math.round(ha * 10) / 10, rings]);
      stats.classes[cls]++;
      stats.vertices += rings.reduce((s, q) => s + q.length / 2, 0);
    }
  }
  polys.sort((a, b) => b[1] - a[1]);                              // big first: they are the ones seen from far away
  return { polys, stats };
}

function pointInRing(pt, ring) {
  const x = pt.lon, y = pt.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon, yi = ring[i].lat, xj = ring[j].lon, yj = ring[j].lat;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

module.exports = { CLASSES, MIN_HA, classOf, assembleRings, ringsOfElement, ringAreaM2, simplify, encodeRing, decodeRing, build, pointInRing };

if (require.main === module) {
  const cities = JSON.parse(fs.readFileSync(path.join(DIR, 'cities.json'), 'utf8'));
  const want = process.argv.slice(2);
  const list = want.length ? want : Object.keys(cities);
  for (const city of list) {
    const src = path.join(DIR, 'landuse-osm-' + city + '.json');
    if (!fs.existsSync(src)) { console.log(city.padEnd(10) + 'no raw dump (run fetch-landuse.cjs) — skipped'); continue; }
    const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
    const { polys, stats } = build(raw);
    const out = { v: 1, city, classes: CLASSES, scale: SCALE,
                  source: 'OpenStreetMap contributors (ODbL), via Overpass', osmBase: raw.osmBase || null,
                  fetched: raw.fetched || null, box: raw.box, p: polys };
    const text = JSON.stringify(out);
    const dest = path.join(DIR, 'landuse-' + city + '.json');
    /* only rewrite when the CONTENT changed: the fetch timestamp alone must not make a commit */
    let same = false;
    try {
      const prev = JSON.parse(fs.readFileSync(dest, 'utf8'));
      same = JSON.stringify(prev.p) === JSON.stringify(out.p);
    } catch (e) { /* no previous file */ }
    if (!same) fs.writeFileSync(dest, text);
    console.log(city.padEnd(10) + polys.length + ' polygons ' +
      CLASSES.map(c => c + ':' + stats.classes[c]).join(' ') + '  | open-dropped ' + stats.droppedOpen +
      ', small-dropped ' + stats.droppedSmall + ', ' + stats.vertices + ' vertices, ' +
      (text.length / 1024).toFixed(0) + ' KB' + (same ? ' (unchanged)' : ' (written)'));
  }
}
