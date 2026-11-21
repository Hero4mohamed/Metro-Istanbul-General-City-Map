'use strict';
/* V4.9 part 3: the Environment tab: real topography and 3D buildings in a 3D view of its own (MapLibre 4.7.1, already shipped),
 * because the main Leaflet map cannot tilt. Design: docs/superpowers/specs/2026-11-19-v4.9-design.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
const HTML = () => H.html ? H.html() : fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
function pure() {
  const ctx = { Math, JSON, Object, Array, Date };
  vm.createContext(ctx);
  vm.runInContext(region('ENV-PURE') + '\nthis.api = { ENV_DEM, ENV_CREDIT, envSunPosition, envLight, envStyle, envBuildingInfo, envLinesFC };', ctx);
  return ctx.api;
}
const plain = o => JSON.parse(JSON.stringify(o));

/* ---- the sun ---- */
test('v4.9 env: the sun over İstanbul is where it really is (solstice noon high in the south, below the horizon at midnight)', () => {
  const api = pure(), ist = [41.0082, 28.9784];
  const noon = api.envSunPosition(Date.UTC(2026, 5, 21, 10, 6), ist[0], ist[1]);
  assert.ok(Math.abs(noon.alt - (90 - 41.0082 + 23.44)) < 0.6, 'solar noon on 21 June: 90° − latitude + 23.44° ≈ 72.4°, got ' + noon.alt.toFixed(2));
  assert.ok(Math.abs(noon.az - 180) < 3, 'due south at solar noon, got ' + noon.az.toFixed(1));
  const morning = api.envSunPosition(Date.UTC(2026, 2, 20, 5, 0), ist[0], ist[1]);
  assert.ok(morning.az > 80 && morning.az < 100 && morning.alt > -2 && morning.alt < 12, 'equinox morning: low in the east, got ' + morning.az.toFixed(1) + '° / ' + morning.alt.toFixed(1) + '°');
  assert.ok(api.envSunPosition(Date.UTC(2026, 5, 21, 21, 0), ist[0], ist[1]).alt < 0, 'midnight in İstanbul: below the horizon');
});
test('v4.9 env: sun lighting points the light where the sun is, from its height; at night it is dim', () => {
  const api = pure();
  const day = plain(api.envLight({ az: 135, alt: 40 })), night = plain(api.envLight({ az: 300, alt: -10 }));
  assert.strictEqual(day.hillshadeDir, 135);
  assert.deepStrictEqual([day.light.anchor, day.light.position[1], day.light.position[2]], ['map', 135, 50], 'MapLibre: azimuth from north, polar angle from overhead');
  assert.ok(night.light.intensity < day.light.intensity && night.hillshadeExag < day.hillshadeExag, 'night is dimmer, not a midday light from below the ground');
  assert.ok(night.light.position[2] <= 90);
});

/* ---- the 3D style, built on the app's own basemap style ---- */
function baseStyle() {
  return { version: 8, sources: { openmaptiles: { type: 'vector', url: 'x' } }, layers: [
    { id: 'background', type: 'background' },
    { id: 'landcover-wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: {} },
    { id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'place-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' }] };
}
const FC = { type: 'FeatureCollection', features: [] };
function styleFor(preset, exag) {
  const api = pure();
  return plain(api.envStyle(baseStyle(), { preset, exag: exag || 1, tone: 'night', lines: FC, stops: FC, route: FC, sun: { az: 180, alt: 50 } }));
}
test('v4.9 env: terrain comes from AWS Terrain Tiles (keyless, Terrarium) with the full required credit', () => {
  const api = pure(), s = styleFor('standard');
  assert.strictEqual(api.ENV_DEM, 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png', 'the bucket checked on 19 Nov 2026 (the -eu mirror answers 403)');
  assert.deepStrictEqual([s.sources.dem.type, s.sources.dem.encoding, s.sources.dem.tiles[0]], ['raster-dem', 'terrarium', api.ENV_DEM]);
  for (const k of ['dem', 'dem-hs']) assert.strictEqual(s.sources[k].maxzoom, 14,
    k + ': terrain stops where the street tiles stop (OpenFreeMap planet TileJSON: maxzoom 14, read 19 Nov 2026); deeper terrain under stretched street tiles cannot be lined up (MapLibre warns)');
  const credit = String(api.ENV_CREDIT);
  for (const must of ['Mapzen', 'EU-DEM', 'ETOPO1', 'GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey', 'Kartverket', 'Geoscience Australia'])
    assert.ok(credit.includes(must), 'the credit lists ' + must + ' (the tile maker asks for the whole list)');
});
test('v4.9 env: the three presets: Light is flat with hill shading, Standard adds 3D terrain, Full adds 3D buildings', () => {
  const light = styleFor('light'), std = styleFor('standard', 1.5), full = styleFor('full');
  for (const s of [light, std, full]) assert.ok(s.layers.some(l => l.type === 'hillshade' && l.source === 'dem-hs'), 'hill shading in every preset');
  assert.deepStrictEqual(full.sources['dem-hs'].tiles, full.sources.dem.tiles, 'hill shading reads the same tiles through a source of its own (MapLibre warns when terrain and hill shading share one)');
  assert.ok(!light.terrain, 'Light: no 3D terrain');
  assert.deepStrictEqual(std.terrain, { source: 'dem', exaggeration: 1.5 }, 'Standard: 3D terrain at the chosen relief');
  const ext = l => l.find(x => x.id === 'env-building-3d');
  assert.strictEqual(ext(std.layers).layout.visibility, 'none'); assert.strictEqual(ext(full.layers).layout.visibility, 'visible');
  assert.strictEqual(full.layers.find(x => x.id === 'building').layout.visibility, 'none', 'Full: the flat footprints give way to the 3D ones');
  const ids = full.layers.map(l => l.id), hs = ids.indexOf('env-hillshade');
  assert.ok(hs > ids.indexOf('landcover-wood') && hs < ids.indexOf('road-major'), 'hill shading over the ground, under the roads');
  assert.ok(ids.indexOf('env-lines') < ids.indexOf('place-city'), 'the lines are under the names');
});
test('v4.9 env: 3D buildings are honest: multi-part buildings shown properly, the 5 m default drawn muted', () => {
  const b = styleFor('full').layers.find(x => x.id === 'env-building-3d');
  assert.strictEqual(b.type, 'fill-extrusion');
  assert.deepStrictEqual(b.filter, ['!=', ['get', 'hide_3d'], true], 'parts of a building (towers, domes) are not buried in its outline');
  assert.deepStrictEqual(b.paint['fill-extrusion-height'], ['coalesce', ['get', 'render_height'], 0], 'a building with no height is flat, never a null warning');
  assert.deepStrictEqual(b.paint['fill-extrusion-base'], ['coalesce', ['get', 'render_min_height'], 0]);
  const c = JSON.stringify(b.paint['fill-extrusion-color']);
  assert.ok(c.includes('["==",["get","render_height"],5]'), 'exactly 5 m (OpenMapTiles\' default when no height or floors are mapped) gets its own, muted colour');
  const api = pure();
  assert.deepStrictEqual(plain(api.envBuildingInfo(5)), { key: 'envBldDefault' });
  assert.deepStrictEqual(plain(api.envBuildingInfo(31.4)), { key: 'envBldEst', n: 31 });
});
test('v4.9 env: the city\'s lines are drawn over the terrain in their own colours, ferries dashed', () => {
  const api = pure();
  const fc = plain(api.envLinesFC([{ ref: 'M2', kind: 'subway', color: '#00A651', paths: [[[41, 29], [41.01, 29.01]]] },
                                    { ref: 'F', kind: 'ferry', color: '#2E86C1', paths: [[[41, 29], [41.02, 29]]] }]));
  assert.deepStrictEqual(fc.features.map(f => [f.properties.ref, f.properties.color, f.properties.ferry, f.geometry.coordinates[0]]),
    [['M2', '#00A651', false, [29, 41]], ['F', '#2E86C1', true, [29, 41]]], 'GeoJSON is lng,lat');
  const s = styleFor('full');
  assert.ok(s.layers.find(l => l.id === 'env-lines').filter.toString().includes('ferry'), 'ferries on their own dashed layer');
});

/* ---- wiring in the built app ---- */
test('v4.9 env: an Environment tab, its card, and the 3D view\'s own container', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app.template.html'), 'utf8');
  assert.ok(/<button data-tab="env" role="tab" aria-selected="false" data-i18n="tabEnv">/.test(html), 'the tab');
  assert.ok(html.includes('id="cardEnv"') && html.includes('<div id="envMap" hidden></div>'), 'the card and the container');
  assert.ok(/body\.env-on #map\{visibility:hidden;\}/.test(html), 'the paused 2D map is hidden under the 3D view (its marker layers stack above a plain fixed box, seen at phone size)');
  const st = fnSrc('setTab');
  assert.ok(/t==='env'/.test(st) && /envOpen\(\)/.test(st) && /envClose\(\)/.test(st), 'setTab opens the view on the tab and closes it on leaving');
});
test('v4.9 env: one heavy map at a time: the main basemap comes off and the animation pauses, and both come back', () => {
  const open = fnSrc('envOpen'), close = fnSrc('envClose');
  assert.ok(/map\.removeLayer\(curBase\)/.test(open), 'the main basemap\'s two GL maps are removed while the 3D view is open');
  assert.ok(/animOn = false; if\(animRaf\) cancelAnimationFrame\(animRaf\);/.test(open), 'the train animation pauses');
  assert.ok(/\.remove\(\)/.test(close) && /envBase\.addTo\(map\)/.test(close) && /captureEnd\(\)/.test(close), 'leaving frees the 3D map and brings both back');
});
test('v4.9 env: the security policy lets the page load terrain tiles, and from nowhere else new', () => {
  const csp = (/Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')) || [])[1] || '';
  for (const dir of ['connect-src', 'img-src']) {
    const d = (csp.split(';').find(x => x.trim().startsWith(dir)) || '');
    assert.ok(d.includes('https://elevation-tiles-prod.s3.amazonaws.com'), dir + ' allows the terrain tiles');
  }
});
test('v4.9 env: the credits, the data sources file and the privacy notice say where terrain comes from', () => {
  const legal = fs.readFileSync(path.join(__dirname, '..', 'legal-content.cjs'), 'utf8');
  for (const f of ['privacy.html', 'privacy.tr.html', 'credits.html', 'credits.tr.html'])
    assert.ok(/Terrain Tiles/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'legal', f), 'utf8')), 'legal/' + f + ' names the terrain tiles');
  assert.ok(/elevation-tiles-prod/.test(legal), 'the privacy notice names the host the device contacts');
  const ds = fs.readFileSync(path.join(__dirname, '..', '..', 'DATA-SOURCES.md'), 'utf8');
  assert.ok(/Terrain Tiles/.test(ds) && /EU-DEM/.test(ds), 'DATA-SOURCES.md lists the terrain and its credit');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', '01-i18n.js'), 'utf8');
  for (const k of ['tabEnv', 'envTitle', 'envLight', 'envStandard', 'envFull', 'envRelief', 'envExag', 'envSun', 'envSunNow', 'envNoNet', 'envBldDefault', 'envBldEst', 'envPerf', 'envCreditNote'])
    assert.strictEqual((i18n.match(new RegExp('(^|[^A-Za-z])' + k + ':"', 'gm')) || []).length, 4, k + ' in all four languages');
});
