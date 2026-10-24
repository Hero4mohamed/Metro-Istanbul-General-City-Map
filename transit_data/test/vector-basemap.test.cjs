/* The vector map: the style it draws, the libraries it draws it with, and how the page chooses between it and the raster map.
 *
 * It exists because the raster map's names are baked into a picture: a few pixels tall, soft on a phone, the same size
 * at every zoom, and impossible to thin out. A style is data, so it can be checked: that every layer reads a layer the
 * tiles really have, that the colours are the app's own, and — the point of all this — that names get BIGGER as you zoom
 * in, that the big ones appear first, and that every name has a halo and contrast enough to read.
 *
 * What it cannot check from here is how the map LOOKS; that was judged on screen (see the pull request). What it can do
 * is make sure the properties that make it readable cannot be lost by an edit.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('../testkit/helpers.cjs');
const P = require('../process-places.cjs');

/* the palette and the style builder as they ship: the pure blocks of the built page */
function vec() {
  const html = H.html();
  const pick = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert.ok(i > 0 && j > i, a + ' not in the built page'); return html.slice(i, j); };
  const code = pick('/* ==BASEMAP-PURE-START== */', '/* ==BASEMAP-PURE-END== */') + '\n' + pick('/* ==VECTOR-BASEMAP-PURE-START== */', '/* ==VECTOR-BASEMAP-PURE-END== */') +
    '\nmodule.exports={ATLAS_PAL,contrastRgb,vecStyle,vecName,vecColours,vecPlacesData,VEC_TIER,VEC_NOTABLE,VEC_TIERS,vecZ,vecTierOf};';
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}
const V = vec();
const night = V.vecStyle('night', 'en'), day = V.vecStyle('day', 'en');
const byId = (st, id) => st.layers.find(l => l.id === id);

/* The layers the tile service carries, from its own TileJSON (tiles.openfreemap.org/planet, 24 Oct 2026). A style that reads a
   layer not in this list draws nothing for it and says nothing. */
const TILE_LAYERS = ['aerodrome_label', 'aeroway', 'boundary', 'building', 'housenumber', 'landcover', 'landuse', 'mountain_peak', 'park', 'place',
                     'poi', 'transportation', 'transportation_name', 'water', 'water_name', 'waterway'];

test('every layer of the style reads a source and a tile layer that exist', () => {
  for (const [name, st] of [['night', night], ['day', day]]) {
    assert.strictEqual(st.version, 8);
    const ids = st.layers.map(l => l.id);
    assert.strictEqual(new Set(ids).size, ids.length, name + ': two layers share an id: ' + ids.filter((x, i) => ids.indexOf(x) !== i));
    for (const l of st.layers) {
      if (l.type === 'background') continue;
      assert.ok(st.sources[l.source], name + '/' + l.id + ' reads source "' + l.source + '", which the style does not define');
      if (l.source === 'openmaptiles') assert.ok(TILE_LAYERS.includes(l['source-layer']), name + '/' + l.id + ' reads tile layer "' + l['source-layer'] + '", which the tiles do not have');
    }
  }
});

test('the vector map is drawn in the app\'s own palette, not a new one', () => {
  const A = V.ATLAS_PAL;
  const rgb = c => 'rgb(' + c.join(',') + ')';
  for (const [tone, st, P0] of [['night', night, A.night], ['day', day, A.day]]) {
    assert.strictEqual(byId(st, 'background').paint['background-color'], rgb(P0.ground), tone + ' ground');
    assert.strictEqual(byId(st, 'water').paint['fill-color'], rgb(P0.bands.water.c), tone + ' water');
    assert.strictEqual(byId(st, 'landcover-wood').paint['fill-color'], rgb(P0.landuse.forest), tone + ' forest');
    assert.strictEqual(byId(st, 'park').paint['fill-color'], rgb(P0.landuse.park), tone + ' park');
    assert.strictEqual(byId(st, 'landuse-campus').paint['fill-color'], rgb(P0.landuse.campus), tone + ' campus');
    assert.strictEqual(byId(st, 'aeroway-area').paint['fill-color'], rgb(P0.landuse.airport), tone + ' airport');
  }
  // by night EVERY road is the one grey, as on the raster map; by day the casing exists and the main roads are the amber
  for (const id of ['road-minor-service', 'road-tertiary', 'road-secondary', 'road-primary', 'road-trunk', 'road-motorway'])
    assert.strictEqual(byId(night, id).paint['line-color'], 'rgb(' + A.night.roadGrey.join(',') + ')', id + ' is not the one road colour');
  assert.ok(!night.layers.some(l => /^road-casing-/.test(l.id)), 'the night map has road casings: roads are one quiet colour');
  assert.ok(day.layers.some(l => /^road-casing-/.test(l.id)), 'the day map lost its road casings');
  assert.notStrictEqual(byId(day, 'road-primary').paint['line-color'], byId(day, 'road-secondary').paint['line-color'], 'day: main roads should be the amber');
});

/* a name is "readable" when it has a halo, and its colour clears 4.5:1 against the ground it sits on (WCAG AA for text) */
test('every name has a halo and enough contrast to read, by night and by day', () => {
  for (const [tone, st] of [['night', night], ['day', day]]) {
    const ground = tone === 'night' ? V.ATLAS_PAL.night.ground : V.ATLAS_PAL.day.ground;
    const syms = st.layers.filter(l => l.type === 'symbol');
    assert.ok(syms.length >= 14, tone + ': too few name layers (' + syms.length + ')');
    for (const l of syms) {
      assert.ok(l.paint['text-halo-width'] > 0, tone + '/' + l.id + ' has no halo: it would vanish on a road');
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(l.paint['text-color']);
      assert.ok(m, tone + '/' + l.id + ' text colour is not rgb()');
      const c = V.contrastRgb([+m[1], +m[2], +m[3]], ground);
      assert.ok(c >= 4.5, tone + '/' + l.id + ' text is ' + c.toFixed(2) + ':1 against the ground (needs 4.5)');
    }
  }
});

/* the zoom stops of an interpolate expression, as [zoom, value] pairs */
const stops = e => { assert.ok(Array.isArray(e) && e[0] === 'interpolate', 'not a zoom ramp: ' + JSON.stringify(e).slice(0, 60)); const o = []; for (let i = 3; i < e.length; i += 2) o.push([e[i], e[i + 1]]); return o; };

test('names grow as you zoom in', () => {
  for (const st of [night, day]) {
    for (const l of st.layers.filter(l => l.type === 'symbol' && Array.isArray(l.layout['text-size']))) {
      const s = stops(l.layout['text-size']);
      assert.ok(s[s.length - 1][1] > s[0][1], l.id + ': the name is no bigger when you are close than when you are far');
      for (let i = 1; i < s.length; i++) assert.ok(s[i][0] > s[i - 1][0] && s[i][1] >= s[i - 1][1], l.id + ': the size ramp goes backwards at stop ' + i);
    }
  }
  // a street name at the closest zoom is at least 1.3x what it is when it first appears: that is the "clearer when you zoom in"
  for (const id of ['road-label-major', 'road-label-secondary', 'road-label-minor']) {
    const s = stops(byId(night, id).layout['text-size']);
    assert.ok(s[s.length - 1][1] / s[0][1] >= 1.3, id + ' only grows ' + (s[s.length - 1][1] / s[0][1]).toFixed(2) + 'x');
  }
});

test('the important names come first: bigger places from afar, smaller ones and streets as you come in', () => {
  const z = id => byId(night, id).minzoom;
  assert.ok(z('place-city') < z('place-town') && z('place-town') < z('place-village'), 'cities, towns, villages in the wrong order');
  assert.ok(z('place-suburb') < z('place-quarter'), 'a neighbourhood should appear after a district');
  assert.ok(z('road-label-major') < z('road-label-secondary') && z('road-label-secondary') < z('road-label-minor'), 'street names should come in by importance');
  // and the places people go: the tiers appear in increasing zoom, landmarks first and shops last
  const tiers = V.VEC_TIERS.map(t => byId(night, 'poi-label-' + t).minzoom);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i] > tiers[i - 1], 'tier ' + V.VEC_TIERS[i] + ' does not appear later than tier ' + V.VEC_TIERS[i - 1]);
  const at = (k, r) => V.vecTierOf(k, r);
  assert.ok(at('airport', 3) < at('hospital', 2) && at('hospital', 2) <= at('mosque', 1) && at('mosque', 0) <= at('police', 0),
    'airport < a well-known hospital <= a well-known mosque, and an ordinary mosque no later than a police station');
});

test('the map names the places you asked for (visitors, worship, hospitals, police) and not the shops, food or hotels', () => {
  for (const k of Object.keys(V.VEC_TIER).concat(Object.keys(V.VEC_NOTABLE))) assert.ok(P.TYPES.includes(k), 'a table names a type the places file does not have: ' + k);
  // V4.0, asked for by the user: tourist places, places of worship, hospitals and police stations, and the big landmarks
  for (const k of ['attraction', 'museum', 'historic', 'viewpoint', 'tower', 'mosque', 'church', 'synagogue', 'worship', 'hospital', 'police', 'airport'])
    assert.ok(V.vecTierOf(k, 3) > 0 && V.vecTierOf(k, 0) > 0, k + ' should be drawn on the map');
  // every zoom in a table has a name layer to draw it, and no table asks for one that does not exist
  const used = new Set(); Object.values(V.VEC_TIER).forEach(v => { used.add(v[0]); used.add(v[1]); }); Object.values(V.VEC_NOTABLE).forEach(v => used.add(v[0]));
  for (const t of used) assert.ok(V.VEC_TIERS.includes(t), 'zoom ' + t + ' is asked for but has no name layer');
  // "we don't need to show every single place": none of these is drawn, however well known (they are all still searchable)
  for (const k of ['restaurant', 'cafe', 'fast_food', 'bar', 'shop', 'supermarket', 'pharmacy', 'clinic', 'bank', 'post', 'fuel', 'hotel', 'lodging', 'school', 'sports', 'cinema', 'ferry', 'bus_station', 'pier', 'other'])
    assert.strictEqual(V.vecTierOf(k, 3), 0, k + ' should not be drawn on the map');
  assert.ok(V.VEC_TIERS.every(t => byId(night, 'poi-label-' + t) && byId(day, 'poi-label-' + t)), 'a tier has no name layer');
  assert.strictEqual(byId(night, 'poi-label-18'), undefined, 'a tier below the visitor/worship/help kinds is back');
  // names only: a dot for every shop made a busy street look crowded, so no marker is drawn for the places file
  for (const st of [night, day]) assert.ok(!st.layers.some(l => l.source === 'places' && l.type !== 'symbol'), 'a marker (dot) is drawn beside place names again');
});

test('a well-known place shows a zoom earlier; a park or square is drawn only when it is well known', () => {
  // the places file ranks a kind from its type (a museum starts at 2, a mosque at 0) and adds one for a Wikidata entry
  assert.strictEqual(V.vecTierOf('museum', 2), 16, 'an ordinary museum waits for a street view');
  assert.strictEqual(V.vecTierOf('museum', 3), 15, 'a Wikidata-listed one comes a zoom earlier');
  assert.strictEqual(V.vecTierOf('mosque', 0), 16, 'the corner mosque shows from a street view');
  assert.strictEqual(V.vecTierOf('mosque', 1), 15, 'the Süleymaniye from further out');
  assert.strictEqual(V.vecTierOf('hospital', 1), 16); assert.strictEqual(V.vecTierOf('hospital', 2), 15);
  assert.strictEqual(V.vecTierOf('police', 0), 16);
  assert.strictEqual(V.vecTierOf('historic', 1), 17); assert.strictEqual(V.vecTierOf('historic', 2), 16);
  assert.strictEqual(V.vecTierOf('airport', 3), 13);
  assert.strictEqual(V.vecTierOf('park', 0), 0, 'a pocket park is not drawn: there are hundreds');
  assert.strictEqual(V.vecTierOf('park', 1), 0, 'nor an ordinary park (2,000 of them)');
  assert.strictEqual(V.vecTierOf('park', 2), 16, 'a park with a Wikidata entry is');
  assert.strictEqual(V.vecTierOf('square', 2), 0); assert.strictEqual(V.vecTierOf('square', 3), 16);
  assert.strictEqual(V.vecTierOf('cafe', 3), 0, 'not even a famous café');
  assert.strictEqual(V.vecTierOf('no-such-type', 3), 0, 'a kind that is not listed is not drawn');
});

test('names follow the interface language, falling back to the local name', () => {
  assert.deepStrictEqual(V.vecName('en'), ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]);
  for (const lg of ['tr', 'fr', 'ar']) assert.deepStrictEqual(V.vecName(lg), ['coalesce', ['get', 'name']], lg);
  const poi = lg => V.vecStyle('night', lg).layers.find(l => l.id === 'poi-label-16').layout['text-field'];
  assert.deepStrictEqual(poi('en'), ['coalesce', ['get', 'en'], ['get', 'n']]);
  assert.deepStrictEqual(poi('ar'), ['coalesce', ['get', 'ar'], ['get', 'n']]);
  assert.deepStrictEqual(poi('tr'), ['coalesce', ['get', 'n'], ['get', 'n']]);
});

test('the places file becomes map names, minus what the tiles name better', () => {
  const file = P.build(require('../testkit/places-fixture.cjs').rawCity()).out;
  const html = H.html();
  const metaSrc = html.match(/const GAZ_TYPE_META = (\{[\s\S]*?\n\});/);
  assert.ok(metaSrc, 'GAZ_TYPE_META not found');
  const meta = new Function('return ' + metaSrc[1])();
  const g = { n: file.n.split('\n').length, name: file.n.split('\n'), types: file.types, t: file.t, r: file.r, en: file.en, ar: file.ar, lat: [], lng: [] };
  let a = 0, o = 0; file.la.forEach((d, i) => { a += d; o += file.lo[i]; g.lat.push(a / 1e5); g.lng.push(o / 1e5); });
  const fc = V.vecPlacesData(g, meta);
  const names = fc.features.map(f => f.properties.n);
  assert.ok(names.includes('Galata Kulesi') && names.includes('Kadıköy Devlet Hastanesi') && names.includes('Merkez Camii'), 'a landmark, a hospital and a mosque should be on the map');
  for (const shop of ['Starbucks', 'Moda Eczanesi', 'Migros', 'Zeytin Market', 'Moda Sahil Cafe']) assert.ok(!names.includes(shop), shop + ' should not be drawn on the map (it is still searchable)');
  assert.ok(!names.includes('Kadıköy') && !names.includes('Moda') && !names.includes('Bağdat Caddesi'), 'districts, neighbourhoods and streets are the tiles\' to name');
  const gal = fc.features.find(f => f.properties.n === 'Galata Kulesi');
  assert.strictEqual(gal.properties.en, 'Galata Tower'); assert.ok(gal.properties.r >= 2, 'Galata Kulesi in the fixture has a Wikidata entry, so it ranks as well known'); assert.strictEqual(gal.properties.tier, V.vecTierOf('attraction', gal.properties.r));
  assert.ok(Math.abs(gal.geometry.coordinates[0] - 29.06) < 1e-4 && Math.abs(gal.geometry.coordinates[1] - 41.02) < 1e-4, 'GeoJSON is [longitude, latitude]');
  assert.ok(fc.features.every(f => f.properties.tier >= 13 && f.properties.tier <= 17 && f.properties.dot === undefined));
});

/* ---------------- V4.0: the names are a map of their own, above the metro lines ---------------- */

test('the style splits into land and names: nothing is lost, nothing is drawn twice', () => {
  const full = V.vecStyle('night', 'en'), base = V.vecStyle('night', 'en', undefined, 'base'), labels = V.vecStyle('night', 'en', undefined, 'labels');
  assert.ok(base.layers.length > 20 && labels.layers.length > 5);
  assert.ok(base.layers.every(l => l.type !== 'symbol'), 'a name is drawn in the map that sits UNDER the metro lines');
  assert.ok(labels.layers.every(l => l.type === 'symbol'), 'the map above the lines draws something that is not a name (it would cover the lines)');
  const ids = a => a.layers.map(l => l.id);
  assert.deepStrictEqual(ids(base).concat(ids(labels)).sort(), ids(full).sort(), 'the two parts are not the whole style');
  assert.ok(base.layers.some(l => l.type === 'background') && !labels.layers.some(l => l.type === 'background'), 'only the lower map has a background; the upper one must stay see-through');
  assert.deepStrictEqual(Object.keys(base.sources), ['openmaptiles'], 'the land map has no use for the places file');
  assert.deepStrictEqual(Object.keys(labels.sources).sort(), ['openmaptiles', 'places']);
  // every layer of either part still reads a source that part has
  for (const st of [base, labels]) for (const l of st.layers) if (l.source) assert.ok(st.sources[l.source], l.id + ' reads a source its map does not have');
  assert.ok(byId(labels, 'poi-label-16') && byId(labels, 'place-city') && byId(labels, 'road-label-minor') && byId(labels, 'housenumber'));
  assert.ok(byId(base, 'water') || base.layers.some(l => /water/.test(l.id)), 'the land map lost its water');
});

test('the names are drawn above the metro lines and below the markers, and let every click through', () => {
  const html = H.html();
  assert.ok(/map\.createPane\(VEC_LABEL_PANE\)\.style\.zIndex = 450;/.test(html), 'the names pane is gone or at the wrong height');
  assert.ok(/map\.getPane\(VEC_LABEL_PANE\)\.style\.pointerEvents = 'none';/.test(html), 'the names would swallow clicks meant for the lines and stations');
  const z = Number(html.match(/map\.createPane\(VEC_LABEL_PANE\)\.style\.zIndex = (\d+)/)[1]);
  assert.ok(z > 400 && z < 600, 'the names must sit above the overlay pane (lines, z 400) and below the marker pane (z 600): ' + z);
  assert.ok(/const stationRenderer = L\.canvas\(\{ padding:0\.5, pane:'stationPane' \}\);/.test(html) && /map\.createPane\('stationPane'\)\.style\.zIndex = 460;/.test(html), 'the station dots are no longer above the names');
  assert.ok(/L\.maplibreGL\(\{ style: vecStyle\(tone, lang, VEC_GLYPHS_ABS, 'labels'\), pane: VEC_LABEL_PANE/.test(html), 'the page no longer draws the names in their own pane');
  assert.ok(/style: vecStyle\(tone, lang, VEC_GLYPHS_ABS, 'base'\)/.test(html), 'the base map still draws names');
  assert.ok(/onRemove: function \(map\) \{\s*if \(this\._labels && this\._labels\._map\) map\.removeLayer\(this\._labels\);/.test(html), 'switching map would leave the names behind');
});

/* ---------------- the libraries, and the page that uses them ---------------- */

test('the vendored map libraries are exactly the files whose hashes are recorded', () => {
  const dir = path.join(H.ROOT, 'vendor', 'maplibre'), readme = fs.readFileSync(path.join(H.ROOT, 'vendor', 'README.md'), 'utf8');
  for (const f of ['maplibre-gl-csp.js', 'maplibre-gl-csp-worker.js', 'maplibre-gl.css', 'leaflet-maplibre-gl.js']) {
    const want = new RegExp('`' + f.replace(/\./g, '\\.') + '`[^\\n]*`([A-Za-z0-9+/=]+)`').exec(readme);
    assert.ok(want, f + ' has no recorded hash in vendor/README.md');
    const got = crypto.createHash('sha384').update(fs.readFileSync(path.join(dir, f))).digest('base64');
    assert.strictEqual(got, want[1], f + ' has changed since its hash was recorded (a library edited by hand, or upgraded without updating the README)');
  }
  for (const f of ['LICENSE-maplibre-gl.txt', 'LICENSE-maplibre-gl-leaflet.txt']) assert.ok(fs.existsSync(path.join(dir, f)), 'no licence file ' + f);
});

test('the page loads the libraries from itself, and lets the tile host in without opening the policy up', () => {
  const html = H.html();
  assert.ok(/<script src="vendor\/maplibre\/maplibre-gl-csp\.js"><\/script>/.test(html) && /<script src="vendor\/maplibre\/leaflet-maplibre-gl\.js"><\/script>/.test(html), 'the scripts are not loaded');
  assert.ok(/href="vendor\/maplibre\/maplibre-gl\.css"/.test(html), 'the stylesheet is not loaded');
  assert.ok(html.indexOf('maplibre-gl-csp.js') > html.indexOf('leaflet.js'), 'MapLibre must load after Leaflet: the bridge needs both');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(/connect-src[^;]*https:\/\/tiles\.openfreemap\.org/.test(csp), 'the tile host is not allowed to be fetched from');
  assert.ok(/worker-src 'self'(;|$)/.test(csp) && !/blob:/.test(csp.match(/worker-src[^;]*/)[0]), 'the worker policy was opened up: use the CSP build of MapLibre instead of allowing blob workers');
  assert.ok(!/unsafe-eval/.test(csp), 'unsafe-eval is allowed');
  assert.ok(html.indexOf("maplibregl.setWorkerUrl('vendor/maplibre/maplibre-gl-csp-worker.js')") > 0, 'the worker file is never named');
});

test('a device that cannot draw it, or a tile service that cannot be reached, gets the raster map', () => {
  const html = H.html();
  assert.ok(/const USE_VECTOR = !!\(VectorBase && vecSupported\(\)\);/.test(html), 'the choice between vector and raster is gone');
  assert.ok(/dark:\s+USE_VECTOR \? new VectorBase\('dark', 'night'\) : RASTER_BASES\.dark/.test(html) && /voyager: USE_VECTOR \? new VectorBase\('voyager', 'day'\) : RASTER_BASES\.voyager/.test(html),
    'dark and day no longer fall back to the raster pair');
  const fb = html.match(/function vecFallback\(key\)\{[\s\S]*?\n\}/);
  assert.ok(fb && /BASES\[key\] = RASTER_BASES\[key\]/.test(fb[0]) && /map\.removeLayer\(curBase\)/.test(fb[0]), 'vecFallback does not swap the raster map in');
  assert.ok(/errors > 0 && self\._map && typeof vecFallback === 'function'\) vecFallback\(self\._key\)/.test(html), 'a vector map that never loads does not fall back');
  // supported means: the libraries are there AND a WebGL context can be made
  const sup = html.match(/function vecSupported\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(/maplibregl === 'undefined'/.test(sup) && /getContext\('webgl2'\)/.test(sup), 'vecSupported does not test for WebGL');
});

test('attribution is shown for the map data, as the licences require', () => {
  const html = H.html();
  for (const must of ['OpenFreeMap', 'OpenMapTiles', 'OpenStreetMap']) assert.ok(new RegExp('VEC_ATTRIBUTION[^;]*' + must).test(html.replace(/\s+/g, ' ')) || html.includes(must), 'attribution for ' + must + ' is missing');
  assert.ok(/attribution: VEC_ATTRIBUTION/.test(html), 'the vector layer does not pass its attribution to the map');
});

/* ---------------- offline: saving an area, and the service worker ---------------- */

test('"save this area" asks for the tile the vector map will really ask for, once', () => {
  const src = H.html().match(/const OFF_VEC_MAXZ = 14;\s*function offVecTile\(z,x,y\)\{[\s\S]*?\n\}/);
  assert.ok(src, 'offVecTile is gone');
  const offVecTile = new Function(src[0] + '\nreturn offVecTile;')();
  // the map reads the tile one zoom out (512px tiles on a 256px grid)...
  assert.deepStrictEqual(offVecTile(10, 600, 300), [9, 300, 150]);
  assert.deepStrictEqual(offVecTile(15, 2 * 5000 + 1, 2 * 3000 + 1), [14, 5000, 3000]);
  // ...and never deeper than the tiles go: a closer view enlarges the zoom-14 tile around it
  assert.deepStrictEqual(offVecTile(17, 8 * 5000 + 7, 8 * 3000 + 3), [14, 5000, 3000]);
  assert.deepStrictEqual(offVecTile(18, 16 * 5000 + 15, 16 * 3000), [14, 5000, 3000]);
  // the tile covers the view it stands in for: its area contains the 256px tile's
  for (const [z, x, y] of [[8, 151, 98], [13, 4900, 3030], [16, 39201, 24013]]) {
    const [Z, X, Y] = offVecTile(z, x, y), k = 2 ** (z - Z);
    assert.ok(x >= X * k && x < (X + 1) * k && y >= Y * k && y < (Y + 1) * k, 'tile ' + [Z, X, Y] + ' does not cover ' + [z, x, y]);
  }
  // the saver swaps in the vector address when the active map is the vector one, and de-duplicates the zoom-14 tiles
  const html = H.html();
  assert.ok(/if\(lyr && lyr\._glMap\) return offVectorURL\(z,x,y\);/.test(html), 'a saved vector tile would be asked for at a raster address');
  assert.ok(/if\(seen\.has\(k\)\) continue; seen\.add\(k\);/.test(html), 'the same zoom-14 tile would be saved once per view');
  assert.ok(/getSource\('openmaptiles'\)[\s\S]{0,120}src\.tiles\[0\]/.test(html), 'the address does not come from the tile index the map loaded');
  // the tile service's rule for apps that keep tiles offline (openfreemap.org, 24 Oct 2026): <= 3,000 tiles, <= 4 requests at once
  assert.ok(/const CONC = vec \? 4 : 6;/.test(html), 'saving vector tiles would use more than the 4 parallel requests the service allows');
  const cap = Number((H.read('sw.js').match(/const VEC_CAP\s*=\s*(\d+)/) || [])[1]), budget = Number((html.match(/const OFF_TILE_BUDGET = (\d+)/) || [])[1]);
  assert.ok(cap > 0 && cap <= 3000, 'the vector tile cache can grow past the 3,000 tiles the service allows an app to keep');
  assert.ok(budget > 0 && budget <= 3000, 'one "save this area" can ask for more than 3,000 tiles');
});

/* the service worker as it ships, run against a stand-in browser */
function swWorld() {
  const vm = require('node:vm');
  const handlers = {}, stores = new Map(), calls = [];
  const mkResp = (body, ok = true) => ({ ok, status: ok ? 200 : 503, type: 'cors', body, clone() { return this; } });
  function Response(body, init) { return { ok: true, status: 200, body, init, clone() { return this; } }; }
  Response.error = () => ({ ok: false, status: 0, type: 'error', clone() { return this; } });
  const store = n => { if (!stores.has(n)) stores.set(n, new Map()); return stores.get(n); };
  const cacheOf = n => ({
    match: async req => store(n).get(req.url), put: async (req, r) => { store(n).set(req.url, r); },
    keys: async () => [...store(n).keys()].map(url => ({ url })), delete: async k => store(n).delete(k.url || k)
  });
  const caches = {
    open: async n => cacheOf(n), delete: async n => stores.delete(n), keys: async () => [...stores.keys()],
    match: async (req, o) => { for (const [n, m] of stores) if ((!o || !o.cacheName || o.cacheName === n) && m.has(req.url)) return m.get(req.url); }
  };
  const world = { online: true, fail: false, bodies: {} };
  const ctx = {
    URL, Promise, setTimeout, Response, caches, location: { origin: 'https://app.test' },
    fetch: async req => { calls.push(req.url); if (world.fail) throw new TypeError('offline'); return mkResp(world.bodies[req.url] || ('body of ' + req.url)); },
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} }, navigator: { get onLine() { return world.online; } } }
  };
  vm.runInNewContext(H.read('sw.js'), ctx);
  const get = async url => {
    let p = null;
    handlers.fetch({ request: { method: 'GET', url, mode: 'cors' }, respondWith: x => { p = x; } });
    return p ? await p : undefined;
  };
  const stats = () => new Promise(res => handlers.message({ data: 'tileStats', source: { postMessage: res } }));
  return { get, stats, calls, stores, world, handlers };
}

test('the service worker keeps vector tiles as you browse, and serves them again without the network', async () => {
  const W = swWorld(), tile = 'https://tiles.openfreemap.org/planet/20261001_001001_pt/14/9031/6129.pbf';
  const a = await W.get(tile), b = await W.get(tile);
  assert.ok(a && a.ok && b && b.ok, 'a tile did not come back');
  assert.strictEqual(W.calls.filter(u => u === tile).length, 1, 'a cached tile was fetched again (its address carries its version, so it can never be stale)');
  W.world.fail = true;
  const c = await W.get(tile);
  assert.ok(c && c.ok, 'offline, a tile that was viewed no longer draws');
  const gone = await W.get('https://tiles.openfreemap.org/planet/20261001_001001_pt/14/1/1.pbf');
  assert.ok(gone && !gone.ok, 'offline, a tile never viewed should fail honestly, not pretend');
});

test('the tile index is read from the network when there is one, so a new data version is noticed', async () => {
  const W = swWorld(), index = 'https://tiles.openfreemap.org/planet';
  W.world.bodies[index] = 'version one';
  assert.strictEqual((await W.get(index)).body, 'version one');
  W.world.bodies[index] = 'version two';
  assert.strictEqual((await W.get(index)).body, 'version two', 'the tile index was served stale while online');
  W.world.fail = true;
  assert.strictEqual((await W.get(index)).body, 'version two', 'offline, the map cannot find its tiles');
});

test('vector tiles live in their own cache: counted, cleared and kept apart from the raster cleanup', async () => {
  const W = swWorld();
  await W.get('https://tiles.openfreemap.org/planet/v/10/1/1.pbf');
  await W.get('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/10/1/1');
  const s = await W.stats();
  assert.strictEqual(s.count, 2, 'the saved-tiles count misses one of the two caches');
  // the activate step drops old raster caches by prefix: the vector cache must not match it
  const names = [...W.stores.keys()];
  const vecName = names.find(n => /vtiles/.test(n));
  assert.ok(vecName && !/^raynet-tiles-/.test(vecName), 'the vector cache would be deleted as an old raster cache on every update');
  W.handlers.message({ data: 'clearTiles', source: { postMessage() {} } });
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual([...W.stores.keys()].filter(n => /tiles/.test(n)).length, 0, '"Clear" leaves a tile cache behind');
});

test('the service worker leaves other hosts alone', async () => {
  const W = swWorld();
  assert.strictEqual(await W.get('https://example.com/something.pbf'), undefined, 'a stranger host was intercepted');
  assert.strictEqual(W.calls.length, 0);
});
