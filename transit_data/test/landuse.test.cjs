/* Forests, parks, campuses and airports on the basemap.
 *
 * Esri's raster cannot tell a forest from a field, so land use comes from OpenStreetMap polygons
 * (fetch-landuse.cjs -> process-landuse.cjs -> landuse-<city>.json) and is painted into each tile
 * as it is graded. Three places this goes wrong without anyone noticing, and each is pinned here:
 *
 *   - the PROCESSOR: a relation stitched shut with a chord across it, a hole filled in, a speck
 *     kept, or an encoding that drifts. A wrong polygon is a forest in the sea;
 *   - the DECODER in the shipped page, which must read exactly what the processor wrote;
 *   - the GRADE: a polygon may recolour the GROUND and nothing else. A street, a label, the sea,
 *     or a tile with no land-use data must come out exactly as they would without the feature.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');
const P = require('../process-landuse.cjs');

function pure() {
  const html = H.html();
  const a = html.indexOf('/* ==BASEMAP-PURE-START== */'), b = html.indexOf('/* ==BASEMAP-PURE-END== */');
  assert.ok(a > 0 && b > a, 'basemap pure block not found in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) +
    '\nmodule.exports={ATLAS_PAL,makeBasemapGrade,decodeLanduse,landuseMinHa,landusePick,LANDUSE_CLASSES};'
  )(mod, mod.exports);
  return mod.exports;
}
const pt = (lat, lon) => ({ lat, lon });
// a closed square of `d` degrees at (lat, lon)
const square = (lat, lon, d) => [pt(lat, lon), pt(lat, lon + d), pt(lat + d, lon + d), pt(lat + d, lon), pt(lat, lon)];

/* ---------------- the processor ---------------- */

test('a tag becomes exactly one class, most specific first', () => {
  assert.strictEqual(P.classOf({ natural: 'wood' }), 'forest');
  assert.strictEqual(P.classOf({ landuse: 'forest' }), 'forest');
  assert.strictEqual(P.classOf({ leisure: 'nature_reserve' }), 'forest');
  assert.strictEqual(P.classOf({ leisure: 'park' }), 'park');
  assert.strictEqual(P.classOf({ leisure: 'golf_course' }), 'park');
  assert.strictEqual(P.classOf({ landuse: 'grass' }), 'park');
  assert.strictEqual(P.classOf({ aeroway: 'aerodrome' }), 'airport');
  assert.strictEqual(P.classOf({ amenity: 'hospital' }), 'campus');
  assert.strictEqual(P.classOf({ amenity: 'university' }), 'campus');
  // an aerodrome inside a nature reserve is an airport, not a forest
  assert.strictEqual(P.classOf({ aeroway: 'aerodrome', leisure: 'nature_reserve' }), 'airport');
  // what is NOT painted: farmland, industry, a private garden
  assert.strictEqual(P.classOf({ landuse: 'farmland' }), null);
  assert.strictEqual(P.classOf({ landuse: 'industrial' }), null);
  assert.strictEqual(P.classOf({ leisure: 'garden', 'garden:type': 'residential' }), null);
  assert.strictEqual(P.classOf({}), null);
  assert.strictEqual(P.classOf(undefined), null);
});

test('two open ways that meet end to end are stitched into one closed ring, whichever way round they run', () => {
  const a = [pt(0, 0), pt(0, 1), pt(1, 1)];
  const b = [pt(1, 1), pt(1, 0), pt(0, 0)];
  const ring = P.assembleRings([a, b]);
  assert.strictEqual(ring.rings.length, 1);
  assert.strictEqual(ring.open, 0);
  // the second way reversed: still one ring
  const rev = P.assembleRings([a, b.slice().reverse()]);
  assert.strictEqual(rev.rings.length, 1, 'a way running the other direction was not joined');
  // three pieces, shuffled
  const c = [pt(0, 0), pt(0, 1)], d = [pt(1, 1), pt(0, 1)], e = [pt(1, 1), pt(1, 0), pt(0, 0)];
  assert.strictEqual(P.assembleRings([e, c, d]).rings.length, 1);
});

test('an outline with a gap is dropped, never closed with a straight line', () => {
  const gap = [pt(0, 0), pt(0, 1), pt(1, 1)];              // never gets back to (0,0)
  const r = P.assembleRings([gap]);
  assert.strictEqual(r.rings.length, 0);
  assert.strictEqual(r.open, 1);
  const rel = { type: 'relation', tags: { natural: 'wood' }, members: [{ type: 'way', role: 'outer', geometry: gap }] };
  assert.strictEqual(P.ringsOfElement(rel), null, 'a relation whose outline does not close was kept');
});

test('a hole stays a hole and goes with the outline that contains it', () => {
  const outer = square(41, 29, 0.1), hole = square(41.03, 29.03, 0.02);
  const rel = { type: 'relation', tags: { leisure: 'park' }, members: [
    { type: 'way', role: 'outer', geometry: outer }, { type: 'way', role: 'inner', geometry: hole }] };
  const raw = { elements: [rel] };
  const { polys } = P.build(raw);
  assert.strictEqual(polys.length, 1);
  assert.strictEqual(polys[0][2].length, 2, 'the hole was filled in');
  // area is the outline minus the hole (0.1 deg x 0.1 deg at lat 41 ~ 8,400 ha; the hole ~ 340 ha)
  const full = P.ringAreaM2(outer) / 1e4, cut = P.ringAreaM2(hole) / 1e4;
  assert.ok(Math.abs(polys[0][1] - (full - cut)) < 2, 'area does not subtract the hole: ' + polys[0][1]);
});

test('specks and unclassified things are not shipped', () => {
  const raw = { elements: [
    { type: 'way', id: 1, tags: { leisure: 'park' }, geometry: square(41, 29, 0.0001) },       // ~0.1 ha
    { type: 'way', id: 2, tags: { natural: 'wood' }, geometry: square(41, 29, 0.05) },        // a real forest
    { type: 'way', id: 3, tags: { landuse: 'farmland' }, geometry: square(41, 29, 0.05) },
  ] };
  const { polys, stats } = P.build(raw);
  assert.strictEqual(polys.length, 1);
  assert.strictEqual(P.CLASSES[polys[0][0]], 'forest');
  assert.strictEqual(stats.droppedSmall, 1);
  assert.strictEqual(stats.unclassified, 1);
});

test('simplification keeps the ring closed, keeps its corners, and drops points on a straight edge', () => {
  // a 0.02 deg square with 40 collinear points along its bottom edge
  const ring = [pt(41, 29)];
  for (let i = 1; i < 40; i++) ring.push(pt(41, 29 + 0.02 * i / 40));
  ring.push(pt(41, 29.02), pt(41.02, 29.02), pt(41.02, 29), pt(41, 29));
  const s = P.simplify(ring, 3.5);
  assert.strictEqual(s.length, 5, 'collinear points survived: ' + s.length);
  assert.deepStrictEqual(s[0], s[s.length - 1], 'the ring is no longer closed');
});

test('what the processor writes decodes to the same places, to the unit it stores', () => {
  const ring = square(41.0123456, 29.0654321, 0.03);
  const dec = P.decodeRing(P.encodeRing(ring));
  assert.strictEqual(dec.length, ring.length);
  dec.forEach((q, i) => {
    assert.ok(Math.abs(q[0] - ring[i].lat) <= 0.5e-5 + 1e-9 && Math.abs(q[1] - ring[i].lon) <= 0.5e-5 + 1e-9, 'vertex ' + i + ' drifted');
  });
  assert.deepStrictEqual(dec[0], dec[dec.length - 1]);
});

/* ---------------- the decoder in the shipped page ---------------- */

test('the page decodes a processed file back onto the right Web-Mercator spot', () => {
  const B = pure();
  const poly = square(41.0, 29.0, 0.05);
  const built = P.build({ elements: [{ type: 'way', id: 1, tags: { natural: 'wood' }, geometry: poly }] });
  const file = { v: 1, classes: P.CLASSES, scale: 1e5, p: built.polys };
  const list = B.decodeLanduse(file);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(B.LANDUSE_CLASSES[list[0].c], 'forest');
  // first vertex -> world fraction x = (lng+180)/360; y from the Mercator formula
  const f = list[0].rings[0];
  const s = Math.sin(41 * Math.PI / 180);
  assert.ok(Math.abs(f[0] - (29 + 180) / 360) < 1e-6, 'x is off: ' + f[0]);
  assert.ok(Math.abs(f[1] - (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))) < 1e-6, 'y is off: ' + f[1]);
  // closed, and the bounding box really contains every vertex
  assert.strictEqual(f[0], f[f.length - 2]);
  const bb = list[0].bb;
  for (let i = 0; i < f.length; i += 2) assert.ok(f[i] >= bb[0] - 1e-12 && f[i] <= bb[2] + 1e-12 && f[i + 1] >= bb[1] - 1e-12 && f[i + 1] <= bb[3] + 1e-12);
  // a file from a different version, or garbage, decodes to nothing rather than throwing
  assert.deepStrictEqual(B.decodeLanduse({ v: 2, p: [] }), []);
  assert.deepStrictEqual(B.decodeLanduse(null), []);
});

test('small polygons are left out when zoomed out, and the cut-off halves in each dimension per zoom', () => {
  const B = pure();
  assert.ok(B.landuseMinHa(8) > 100 && B.landuseMinHa(8) < 400, 'z8 cut-off is off: ' + B.landuseMinHa(8));
  assert.ok(B.landuseMinHa(14) < 0.2, 'z14 cut-off hides parks that are visible: ' + B.landuseMinHa(14));
  for (let z = 6; z < 18; z++) assert.ok(Math.abs(B.landuseMinHa(z) / B.landuseMinHa(z + 1) - 4) < 1e-9, 'not a factor of 4 per zoom at ' + z);
  const file = { v: 1, classes: P.CLASSES, scale: 1e5, p: P.build({ elements: [
    { type: 'way', id: 1, tags: { natural: 'wood' }, geometry: square(41.0, 29.0, 0.05) },       // ~ 2,300 ha
    { type: 'way', id: 2, tags: { leisure: 'park' }, geometry: square(41.0, 29.1, 0.004) },       // ~ 15 ha, under the z10 cut-off
  ] }).polys };
  const list = B.decodeLanduse(file);
  const tile = (z, lat, lon) => { const n = 2 ** z, s = Math.sin(lat * Math.PI / 180);
    return [Math.floor((lon + 180) / 360 * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)]; };
  const [x10, y10] = tile(10, 41.01, 29.01);
  assert.strictEqual(B.landusePick(list, 10, x10, y10).length, 1, 'at z10 the big forest should show and the small park should not');
  const [x15, y15] = tile(15, 41.002, 29.102);
  assert.strictEqual(B.landusePick(list, 15, x15, y15).filter(p => p.ha < 100).length, 1, 'the park is missing at z15');
  // a tile nowhere near it picks nothing
  assert.strictEqual(B.landusePick(list, 12, 0, 0).length, 0);
});

/* ---------------- the grade ---------------- */

function gradePx(B, tone, rgb, lu, z) {
  const d = Float64Array.from([rgb[0], rgb[1], rgb[2], 255]);
  B.makeBasemapGrade(B.ATLAS_PAL[tone])(d, z === undefined ? 14 : z, lu);
  return [d[0], d[1], d[2]];
}
// a 1-pixel mask in a class's palette colour, fully covered
function mask(B, tone, cls, alpha) {
  const c = B.ATLAS_PAL[tone].landuse[cls];
  return { a: Uint8ClampedArray.from([c[0], c[1], c[2], alpha === undefined ? 255 : alpha]) };
}
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const ESRI_LAND = [236, 232, 197], ESRI_ROAD = [252, 252, 252], ESRI_TEXT = [40, 40, 40], ESRI_WATER = [188, 220, 244], ESRI_PARK = [221, 228, 185];

test('ground under a polygon takes the class colour, by day and by night', () => {
  const B = pure();
  for (const tone of ['night', 'day']) {
    for (const cls of ['forest', 'park', 'campus', 'airport']) {
      const got = gradePx(B, tone, ESRI_LAND, mask(B, tone, cls));
      const want = B.ATLAS_PAL[tone].landuse[cls];
      assert.ok(dist(got, want) <= 14, tone + ' ' + cls + ' ground came out ' + got + ', wanted ~' + want);
    }
  }
});

test('the four classes are told apart on the screen, not just in the palette', () => {
  const B = pure();
  for (const tone of ['night', 'day']) {
    const cs = ['forest', 'park', 'campus', 'airport'].map(c => gradePx(B, tone, ESRI_LAND, mask(B, tone, c)));
    const land = gradePx(B, tone, ESRI_LAND, null);
    cs.forEach((c, i) => assert.ok(dist(c, land) >= 8, tone + ' class ' + i + ' is indistinguishable from plain land'));
    assert.ok(dist(cs[0], cs[1]) >= 8, tone + ': forest and park are the same green');
  }
});

test('a street, a label and the sea come through a polygon unchanged', () => {
  const B = pure();
  for (const tone of ['night', 'day']) {
    for (const [name, px] of [['road', ESRI_ROAD], ['text', ESRI_TEXT], ['water', ESRI_WATER]]) {
      const plain = gradePx(B, tone, px, { a: null }), under = gradePx(B, tone, px, mask(B, tone, 'forest'));
      assert.ok(dist(plain, under) <= 3, tone + ' ' + name + ' was recoloured by the polygon under it: ' + plain + ' -> ' + under);
    }
  }
});

test('a polygon edge is a blend, not a step', () => {
  const B = pure();
  const full = gradePx(B, 'night', ESRI_LAND, mask(B, 'night', 'forest', 255));
  const half = gradePx(B, 'night', ESRI_LAND, mask(B, 'night', 'forest', 128));
  const none = gradePx(B, 'night', ESRI_LAND, mask(B, 'night', 'forest', 0));
  assert.ok(dist(none, gradePx(B, 'night', ESRI_LAND, null)) <= 1, 'zero coverage changed the ground');
  assert.ok(dist(half, none) > 3 && dist(half, full) > 3, 'half coverage is not between none and full: ' + [none, half, full].join(' | '));
});

test('a tile with no land-use data is graded exactly as before; one inside the city drops the raster\'s own park tint', () => {
  const B = pure();
  const bare = Float64Array.from([ESRI_PARK[0], ESRI_PARK[1], ESRI_PARK[2], 255]);
  B.makeBasemapGrade(B.ATLAS_PAL.night)(bare, 14);                  // the old two-argument call
  const unknown = gradePx(B, 'night', ESRI_PARK, null);
  assert.deepStrictEqual(unknown, [bare[0], bare[1], bare[2]], 'no mask changed the grade');
  const covered = gradePx(B, 'night', ESRI_PARK, { a: null });
  const land = gradePx(B, 'night', ESRI_LAND, { a: null });
  assert.ok(dist(covered, land) <= 8, 'inside the city Esri\'s park tint still shows (it would double the polygons): ' + covered + ' vs ' + land);
  assert.ok(dist(unknown, land) > dist(covered, land), 'outside the city the raster park tint should survive');
});
