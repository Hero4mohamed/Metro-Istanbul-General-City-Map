'use strict';
/* The app opens and works with no connection (V4.4.1).
 *
 * Three things, each tested against the REAL built code:
 *   1. sw.js keeps every file of the app itself. It was meant to keep them "as loaded", but took its copy after the answer had been
 *      handed to the page, so the copy failed silently every time and NOTHING was kept: offline, the page opened and could not start.
 *   2. sw.js answers a map tile it cannot fetch out of an offline pack (offline/<city>.pack, build-offline-packs.cjs).
 *   3. The page keeps İstanbul, İzmir and Ankara without being asked, the other cities by choice, and never downloads on mobile data
 *      unless the person allowed it or pressed the button (src/22a-offline.js).
 * The last tests break the worker on purpose (the project's mutation check only breaks index.html) and require each break to be caught.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const H = require('../testkit/helpers.cjs');
const P = require('../build-offline-packs.cjs');

const ROOT = path.join(__dirname, '..', '..');
const SCOPE = 'https://example.github.io/Metro-Istanbul-General-City-Map/';
const BASE = '/Metro-Istanbul-General-City-Map/';
const TILES = 'https://tiles.openfreemap.org/planet/20260101_000000_pt/';
const INDEX = 'https://tiles.openfreemap.org/planet';
const SW = H.read('sw.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bytesOf = async r => Buffer.from(await r.arrayBuffer());

/* a tile as the tile service stores it (gzipped), recognisable by its content */
const rawTile = name => Buffer.from('\x1a' + 'TILE:' + name + ':' + 'x'.repeat(40));
const gz = b => zlib.gzipSync(b);
const pack = (city, names) => { const t = {}; for (const n of names) t[n] = gz(rawTile(city + '/' + n)); return P.packBytes({ v: 1, city, source: 'test', built: '2026-01-01' }, t); };

/* a fake browser around the worker. `slow`: opening a cache takes a moment, as it does in a real browser. */
function boot(src, opts) {
  const o = Object.assign({ slow: false }, opts);
  const net = { online: true, routes: new Map(), log: [] };
  const stores = new Map();
  const cacheOf = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (k, v) => { m.set(typeof k === 'string' ? k : k.url, v.clone()); },          // like the real one: a used answer cannot be stored
      match: async k => { const v = m.get(typeof k === 'string' ? k : k.url); return v ? v.clone() : undefined; },
      keys: async () => [...m.keys()].map(u => ({ url: u })),
      delete: async k => m.delete(typeof k === 'string' ? k : k.url),
    };
  };
  const caches = {
    open: async n => { if (o.slow) await sleep(8); return cacheOf(n); },
    match: async (k, q) => { for (const n of stores.keys()) { if (q && q.cacheName && q.cacheName !== n) continue; const r = await cacheOf(n).match(k); if (r) return r; } return undefined; },
    keys: async () => [...stores.keys()], delete: async n => stores.delete(n),
  };
  const fetchFn = async req => {
    const url = typeof req === 'string' ? req : req.url;
    net.log.push(url);
    if (!net.online) throw new TypeError('Failed to fetch');
    const route = net.routes.get(url) || net.routes.get(new URL(url).pathname);
    return route ? route() : new Response('not found', { status: 404 });
  };
  const handlers = {};
  const self = { registration: { scope: SCOPE }, addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} }, navigator: { get onLine() { return net.online; } } };
  const ctx = vm.createContext({ self, caches, location: { origin: new URL(SCOPE).origin }, URL, Response, Request, Headers, Promise, setTimeout, fetch: fetchFn, Map, Set, console, Blob, DecompressionStream, DataView, JSON });
  vm.runInContext(src, ctx);
  return {
    net, stores, cacheOf,
    install: async () => { let p; handlers.install({ waitUntil: x => { p = x; } }); await p; },
    say: data => handlers.message({ data, source: { postMessage() {} } }),
    get: async (url, mode) => { let p; handlers.fetch({ request: { method: 'GET', url, mode: mode || 'cors' }, respondWith: x => { p = x; } }); return p ? await p : undefined; },
  };
}
const APP_FILES = JSON.parse(/const APP_FILES = (\[[^\]]*\]);/.exec(SW)[1]);
function serve(b) {
  b.net.routes.set(BASE, () => new Response('<!doctype html><title>APP</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
  for (const f of APP_FILES) b.net.routes.set(BASE + f, () => new Response('FILE:' + f, { status: 200 }));
  b.net.routes.set(INDEX, () => new Response(JSON.stringify({ tilejson: '3.0.0', tiles: [TILES + '{z}/{x}/{y}.pbf'] }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

/* ---- what each scenario finds wrong (empty = fine) ---- */
const SCENARIOS = {
  async 'every file of the app is kept at install, and answers with no connection'(src) {
    const out = [], b = boot(src, { slow: true }); serve(b);
    await b.install();
    b.net.online = false;
    for (const f of APP_FILES) { const r = await b.get(SCOPE + f); if (!r || r.status !== 200 || (await r.text()) !== 'FILE:' + f) out.push(f + ' did not answer offline'); }
    return out.slice(0, 6);
  },
  async 'a file the page fetched online is kept, although the page read it first'(src) {
    const out = [], b = boot(src, { slow: true });
    b.net.routes.set(BASE + 'transit_data/places-bursa.json', () => new Response('PLACES', { status: 200 }));
    b.net.routes.set(BASE + 'vendor/later-added.js', () => new Response('LATER', { status: 200 }));
    for (const u of ['transit_data/places-bursa.json', 'vendor/later-added.js']) { const r = await b.get(SCOPE + u); await r.text(); }     // the page reads its answer at once
    await sleep(40);
    b.net.online = false;
    for (const [u, want] of [['transit_data/places-bursa.json', 'PLACES'], ['vendor/later-added.js', 'LATER']]) {
      const r = await b.get(SCOPE + u);
      if (!r || r.status !== 200 || (await r.text()) !== want) out.push(u + ' was not kept: offline it is gone');
    }
    return out;
  },
  async 'a tile that cannot be fetched comes out of the offline pack, byte for byte'(src) {
    const out = [], b = boot(src);
    await b.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/istanbul.pack', new Response(pack('istanbul', ['14/9512/6150', '12/2378/1537', '0/0/0'])));
    await b.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/ankara.pack', new Response(pack('ankara', ['13/4843/3105'])));
    b.net.online = false;
    for (const [city, k] of [['istanbul', '14/9512/6150'], ['istanbul', '0/0/0'], ['ankara', '13/4843/3105']]) {
      const r = await b.get(TILES + k + '.pbf');
      if (!r || r.status !== 200) { out.push(k + ' was not answered from the pack'); continue; }
      if (!(await bytesOf(r)).equals(rawTile(city + '/' + k))) out.push(k + ' came out of the pack changed (still zipped, or another tile)');
    }
    const none = await b.get(TILES + '14/1/1.pbf');
    if (none && none.status === 200) out.push('a tile no pack holds was answered with a 200');
    return out;
  },
  async 'the live tile wins when there is a connection, and the pack answers when the tile service is down'(src) {
    const out = [], b = boot(src);
    await b.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/izmir.pack', new Response(pack('izmir', ['12/2357/1582'])));
    b.net.routes.set(TILES + '12/2357/1582.pbf', () => new Response('LIVE', { status: 200 }));
    const live = await b.get(TILES + '12/2357/1582.pbf');
    if ((await live.text()) !== 'LIVE') out.push('with a connection the pack answered instead of the live tile');
    const c = boot(src);
    await c.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/izmir.pack', new Response(pack('izmir', ['12/2357/1582'])));
    c.net.routes.set(TILES + '12/2357/1582.pbf', () => new Response('down', { status: 503 }));
    const down = await c.get(TILES + '12/2357/1582.pbf');
    if (!down || down.status !== 200 || !(await bytesOf(down)).equals(rawTile('izmir/12/2357/1582'))) out.push('with the tile service answering 503 the pack was not used');
    return out;
  },
  async 'the map can start with no connection even if the tile list was never fetched'(src) {
    const out = [], b = boot(src);
    b.net.online = false;
    const r = await b.get(INDEX);
    if (!r || r.status !== 200) return ['no tile list offline: the map cannot start'];
    const j = JSON.parse(await r.text());
    if (!Array.isArray(j.tiles) || !/^https:\/\/tiles\.openfreemap\.org\/.*\{z\}\/\{x\}\/\{y\}\.pbf$/.test(j.tiles[0])) out.push('the stand-in list names no tile address the worker answers');
    if (j.maxzoom !== 14 || j.minzoom !== 0) out.push('the stand-in list has the wrong zoom range (the packs hold 0 to 14)');
    // a kept real list is preferred to the stand-in
    const c = boot(src); serve(c); await c.install(); c.net.online = false;
    const kept = JSON.parse(await (await c.get(INDEX)).text());
    if (kept.tiles[0] !== TILES + '{z}/{x}/{y}.pbf') out.push('offline, the stand-in replaced the real tile list that was kept at install');
    return out;
  },
  async 'a pack is never stored twice, and a new or damaged pack is handled'(src) {
    const out = [], b = boot(src);
    b.net.routes.set(BASE + 'offline/bursa.pack', () => new Response(pack('bursa', ['10/595/385'])));
    if ((await b.get(SCOPE + 'offline/bursa.pack')) !== undefined) out.push('the worker handles the pack download itself: 40 MB would be stored a second time');
    b.net.online = false;
    const before = await b.get(TILES + '10/595/385.pbf');
    if (before && before.status === 200) out.push('a tile was answered from a pack that is not stored');
    await b.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/broken.pack', new Response('this is an error page, not a pack'));
    await b.cacheOf('raynet-packs-v1').put(SCOPE + 'offline/bursa.pack', new Response(pack('bursa', ['10/595/385'])));
    b.say('packsChanged');
    const after = await b.get(TILES + '10/595/385.pbf');
    if (!after || after.status !== 200 || !(await bytesOf(after)).equals(rawTile('bursa/10/595/385'))) out.push('a pack stored after the worker started is not used (or a damaged pack beside it broke the reading)');
    return out;
  },
};
for (const [name, fn] of Object.entries(SCENARIOS)) test('offline maps: ' + name, async () => { assert.deepStrictEqual(await fn(SW), []); });

test('offline maps: the worker\'s list of app files is the app: every engine, typeface, letter shape and icon on disk, and no licence text', () => {
  const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  const onDisk = ['manifest.webmanifest'].concat(walk('vendor'), walk('assets')).filter(f => !/(^|\/)(README\.md|LICEN[SC]E[^/]*)$/i.test(f)).sort();
  assert.deepStrictEqual(APP_FILES, onDisk, 'sw.js was built before a file was added or removed: run the build');
  for (const need of ['vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/maplibre/maplibre-gl-csp.js', 'vendor/maplibre/maplibre-gl-csp-worker.js', 'vendor/maplibre/leaflet-maplibre-gl.js', 'vendor/glyphs/NotoSans-Regular/0-255.pbf', 'vendor/glyphs/NotoSans-Bold/256-511.pbf', 'assets/icon-192.png', 'manifest.webmanifest'])
    assert.ok(APP_FILES.includes(need), need + ' is not kept: the app cannot start (or cannot write a name) with no connection');
  // every file the page itself asks for is in the list
  for (const m of H.html().matchAll(/(?:src|href)="((?:vendor|assets)\/[^"?#]+)"/g)) assert.ok(APP_FILES.includes(m[1]), 'the page loads ' + m[1] + ', which the worker does not keep');
});

/* ---- the pack files ---- */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'offline', 'packs.json'), 'utf8'));
const packOf = id => P.readPack(fs.readFileSync(path.join(ROOT, manifest.packs[id].file)));
const xy = (lat, lng, z) => z + '/' + Math.floor(P.lng2x(lng, z)) + '/' + Math.floor(P.lat2y(lat, z));

test('offline maps: every city has a pack, the list says what the files are, and none is too big to host', () => {
  assert.deepStrictEqual(Object.keys(manifest.packs).sort(), Object.keys(H.cities()).sort(), 'a city has no offline pack (node transit_data/build-offline-packs.cjs <city>)');
  for (const [id, m] of Object.entries(manifest.packs)) {
    const file = path.join(ROOT, m.file);
    assert.ok(fs.existsSync(file), m.file + ' is listed and missing');
    assert.strictEqual(fs.statSync(file).size, m.bytes, id + ': packs.json says a size the file does not have (the app shows it, and uses it for the progress bar)');
    assert.ok(m.bytes < 95 * 1048576, id + ': the pack is over 95 MB; GitHub refuses a file over 100 MB');
    const p = packOf(id);
    assert.strictEqual(p.meta.city, id); assert.strictEqual(Object.keys(p.meta.tiles).length, m.tiles, id + ': tile count');
    assert.ok(/^\d{4}-\d\d-\d\d$/.test(m.built));
  }
});

test('offline maps: a pack holds the whole city at overview zooms and street detail at every station, and its tiles are real', () => {
  for (const id of Object.keys(manifest.packs)) {
    const p = packOf(id), lines = H.cities()[id].lines, have = new Set(Object.keys(p.meta.tiles));
    const want = P.tilesFor(lines), got = want.filter(k => have.has(k)).length;
    assert.ok(got >= want.length * 0.97, id + ': the pack holds ' + got + ' of the ' + want.length + ' tiles the lines need now: rebuild it (node transit_data/build-offline-packs.cjs ' + id + ')');
    for (let z = 0; z <= 14; z++) assert.ok([...have].some(k => k.startsWith(z + '/')), id + ': no tile at zoom ' + z);
    let stations = 0, covered = 0;
    for (const l of lines) { if (l.scope === 'intercity') continue; for (const s of l.stations || []) { stations++; if (have.has(xy(s.lat, s.lng, 14))) covered++; } }
    assert.ok(covered >= stations * 0.99, id + ': only ' + covered + ' of ' + stations + ' stations have street detail (zoom 14) offline');
    // three tiles really are gzipped vector tiles
    for (const k of [[...have][0], [...have][Math.floor(have.size / 2)], [...have][have.size - 1]]) {
      const raw = zlib.gunzipSync(p.tile(k));
      assert.ok(raw.length > 20 && raw[0] === 0x1a, id + ' ' + k + ' is not a vector tile');
    }
  }
  // a pack built and read back is the same tiles, and a file that is not a pack is refused
  const b = P.readPack(pack('x', ['1/0/0', '2/1/1']));
  assert.ok(zlib.gunzipSync(b.tile('2/1/1')).equals(rawTile('x/2/1/1')) && b.tile('9/9/9') === null);
  assert.throws(() => P.readPack(Buffer.from('<!doctype html>not a pack')), /not a pack/);
});

/* ---- the page: what is kept, and when it may download ---- */
const APP = H.appScript().replace(/\r\n/g, '\n');
const MOD = (() => {
  const a = APP.indexOf('/* ==OFFLINE-PURE-START== */'), b = APP.indexOf("(function () {\n  const list = document.getElementById('offPackList')");
  assert.ok(a > 0 && b > a, 'the offline module is not in the built page');
  return APP.slice(a, b);
})();
const pure = (() => { const m = { exports: {} }; new Function('module', APP.slice(APP.indexOf('/* ==OFFLINE-PURE-START== */'), APP.indexOf('/* ==OFFLINE-PURE-END== */')) + '\nmodule.exports = { OFFLINE_DEFAULT, OFF_PACKS, OFF_STATIC, offWanted, offConn, offMayAuto, offMB };')(m); return m.exports; })();

test('offline maps: İstanbul, İzmir and Ankara are kept without being asked, the others by choice, and a removed city stays removed', () => {
  assert.deepStrictEqual(pure.OFFLINE_DEFAULT, ['istanbul', 'izmir', 'ankara']);
  const info = { istanbul: { pack: 'a' }, izmir: { pack: 'b' }, ankara: { pack: 'c' }, bursa: { pack: 'd' }, antalya: { pack: null } };
  for (const c of ['istanbul', 'izmir', 'ankara']) assert.strictEqual(pure.offWanted(c, {}, info), true, c + ' is not kept by default');
  assert.strictEqual(pure.offWanted('bursa', {}, info), false, 'a city nobody asked for is downloaded');
  assert.strictEqual(pure.offWanted('bursa', { bursa: 1 }, info), true, 'a chosen city is not kept');
  assert.strictEqual(pure.offWanted('izmir', { izmir: 0 }, info), false, 'a city the person removed comes back by itself');
  assert.strictEqual(pure.offWanted('antalya', { antalya: 1 }, info), false, 'a city with no pack is "kept"');
  assert.strictEqual(pure.offWanted('nowhere', { nowhere: 1 }, info), false);
  // the names the page and the worker use for the two caches must be the same
  assert.ok(SW.includes("const PACKS = '" + pure.OFF_PACKS + "';") && SW.includes("const STATIC = '" + pure.OFF_STATIC + "';"), 'the page stores packs or files where the worker does not look');
});

test('offline maps: what the connection is, and that nothing downloads by itself on mobile data', () => {
  assert.strictEqual(pure.offConn({ connection: { type: 'cellular' } }), true); assert.strictEqual(pure.offConn({ connection: { type: 'wifi' } }), false);
  assert.strictEqual(pure.offConn({ connection: { type: 'ethernet' } }), false); assert.strictEqual(pure.offConn({ connection: { type: 'wifi', saveData: true } }), true, 'Data Saver is ignored');
  assert.strictEqual(pure.offConn({ connection: { effectiveType: '4g' } }), null, '"4g" says how fast, not whether it is mobile data'); assert.strictEqual(pure.offConn({}), null); assert.strictEqual(pure.offConn(null), null);
  const may = pure.offMayAuto;
  assert.strictEqual(may('wifi', true, true), false, 'a pack starts by itself on mobile data');
  assert.strictEqual(may('wifi', true, false), false);
  assert.strictEqual(may('wifi', false, true), true, 'on Wi-Fi the default maps do not come down by themselves');
  assert.strictEqual(may('wifi', null, true), false, 'a phone that cannot say what it is on (every iPhone) downloads without asking: it may be on mobile data');
  assert.strictEqual(may('wifi', null, false), true, 'a computer with an unknown connection never gets its maps');
  for (const conn of [true, false, null]) assert.strictEqual(may('any', conn, true), true, 'mobile data was allowed and the pack still waits');
  assert.strictEqual(pure.offMB(42484656), 41); assert.strictEqual(pure.offMB(10), 1);
});

/* the page module in a fake page: a phone or a computer, a connection, and a tiny pack for every city */
function page(opts) {
  const o = Object.assign({ phone: true, conn: undefined, store: {}, badPack: false, onLine: true }, opts);
  const stores = new Map(), fetched = [], told = [], toasts = [], els = {};
  const cacheOf = n => { if (!stores.has(n)) stores.set(n, new Map()); const m = stores.get(n); return { put: async (k, v) => { m.set(k, v); }, match: async k => m.get(k), delete: async k => m.delete(k), keys: async () => [...m.keys()] }; };
  const ls = Object.assign({}, o.store);
  const el = id => (els[id] = els[id] || { id, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, addEventListener() {}, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html || ''; }, dataset: {} });
  const asked = [];
  const ctx = vm.createContext({ console, URL, Response, Blob, Uint8Array, String, JSON, Math, Promise, setTimeout, Object,
    location: { href: SCOPE }, IS_MOBILE: o.phone, CITY_IDS: Object.keys(H.cities()), CITIES: H.cities(),
    navigator: { onLine: o.onLine, connection: o.conn, serviceWorker: { controller: { postMessage: m => told.push(m) } } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    lsStr: (k, d) => (k in ls ? ls[k] : d), caches: { open: async n => cacheOf(n) }, window: { caches: true },
    fetch: async (u) => { fetched.push(u); if (/\.pack$/.test(u)) { const id = /offline\/([a-z]+)\.pack/.exec(u)[1]; return new Response(o.badPack ? '<!doctype html>404' : pack(id, ['0/0/0'])); } return new Response('{"data":1}', { status: 200 }); },
    document: { getElementById: id => (id === 'offAsk' ? null : (id === 'offPackList' ? el(id) : null)), createElement: () => ({}), body: {}, querySelector: () => null },
    showToast: m => toasts.push(m), t: k => k, svgEsc: x => String(x), attrEsc: x => String(x) });
  ctx.window = ctx;
  vm.runInContext(MOD.replace('function offAsk(todo) {', 'function offAsk(todo) { __asked.push(todo.slice()); return;'), Object.assign(ctx, { __asked: asked }));
  return { ctx, stores, fetched, told, toasts, ls, asked, els, run: code => vm.runInContext(code, ctx) };
}
const kept = w => [...(w.stores.get('raynet-packs-v1') || new Map()).keys()].map(u => /offline\/([a-z]+)\.pack/.exec(u)[1]).sort();

test('offline maps: on Wi-Fi (or a computer) the three default cities come down by themselves, with their data files, and the worker is told', async () => {
  for (const o of [{ phone: true, conn: { type: 'wifi' } }, { phone: false, conn: undefined }]) {
    const w = page(o);
    await w.run('offAuto()');
    assert.deepStrictEqual(kept(w), ['ankara', 'istanbul', 'izmir'], 'the default maps did not come down by themselves (' + JSON.stringify(o) + ')');
    assert.deepStrictEqual(w.asked, [], 'the person was asked although nothing needed asking');
    const stat = [...w.stores.get('raynet-static-v1').keys()];
    for (const f of ['transit_data/places-istanbul.json', 'transit_data/bus-data-istanbul.json', 'transit_data/landuse-izmir.json', 'transit_data/places-ankara.json']) assert.ok(stat.includes(SCOPE + f), f + ' was not kept with its city: search or buses would not work offline');
    assert.ok(!stat.some(u => /bursa|antalya|kocaeli/.test(u)), 'data of a city nobody asked for was downloaded');
    assert.ok(w.told.includes('packsChanged'), 'the worker was not told a pack arrived: it would not use it until restarted');
    const have = JSON.parse(w.ls.irn_offline_have);
    assert.deepStrictEqual(Object.keys(have).sort(), ['ankara', 'istanbul', 'izmir']); assert.strictEqual(have.istanbul, manifest.packs.istanbul.built);
    assert.strictEqual(w.run('offState.istanbul.state'), 'ready'); assert.strictEqual(w.run('offState.bursa.state'), 'none');
    // a second look fetches nothing more
    const n = w.fetched.length; await w.run('offAuto()'); assert.strictEqual(w.fetched.length, n, 'packs already on the device are downloaded again');
  }
});

test('offline maps: a phone on mobile data (or one that cannot say) is asked once and nothing is downloaded until the person answers', async () => {
  for (const conn of [{ type: 'cellular' }, undefined, { type: 'wifi', saveData: true }]) {
    const w = page({ phone: true, conn });
    await w.run('offAuto()');
    assert.deepStrictEqual(kept(w), [], 'a pack was downloaded on mobile data without asking (' + JSON.stringify(conn) + ')');
    assert.ok(!w.fetched.some(u => /\.pack$/.test(u)));
    assert.strictEqual(w.asked.length, 1, 'the person was not asked'); assert.deepStrictEqual(w.asked[0].slice().sort(), ['ankara', 'istanbul', 'izmir']);
    assert.strictEqual(w.run('offState.izmir.state'), 'waiting');
  }
  // already asked: not asked again, still nothing by itself
  const w = page({ phone: true, conn: { type: 'cellular' }, store: { irn_offline_asked: '1' } });
  await w.run('offAuto()'); assert.deepStrictEqual(w.asked, []); assert.deepStrictEqual(kept(w), []);
  // the switch "on mobile data too": downloads, and does not ask
  const any = page({ phone: true, conn: { type: 'cellular' }, store: { irn_offline_net: 'any' } });
  await any.run('offAuto()'); assert.deepStrictEqual(kept(any), ['ankara', 'istanbul', 'izmir']); assert.deepStrictEqual(any.asked, []);
  // no connection at all: nothing is tried
  const off = page({ phone: false, onLine: false }); await off.run('offAuto()'); assert.deepStrictEqual(off.fetched, []);
});

test('offline maps: Download keeps a city whatever the connection, Remove takes it off and it does not come back, and a bad file is never stored', async () => {
  const w = page({ phone: true, conn: { type: 'cellular' }, store: { irn_offline_asked: '1' } });
  assert.strictEqual(await w.run("offChoose('bursa')"), true);
  assert.deepStrictEqual(kept(w), ['bursa'], 'pressing Download on mobile data did nothing: the person just said to');
  assert.strictEqual(JSON.parse(w.ls.irn_offline_pick).bursa, 1);
  assert.ok(w.toasts.length === 1 && /offDone/.test(w.toasts[0]));
  await w.run("offRemove('bursa')");
  assert.deepStrictEqual(kept(w), []); assert.strictEqual(JSON.parse(w.ls.irn_offline_pick).bursa, 0); assert.ok(!('bursa' in JSON.parse(w.ls.irn_offline_have)));
  // a default city that was removed is not fetched again on Wi-Fi
  const d = page({ phone: true, conn: { type: 'wifi' }, store: { irn_offline_pick: JSON.stringify({ izmir: 0, kocaeli: 1 }) } });
  await d.run('offAuto()');
  assert.deepStrictEqual(kept(d), ['ankara', 'istanbul', 'kocaeli'], 'a removed city came back, or a chosen one was not kept');
  // an error page served in place of a pack
  const bad = page({ phone: false, badPack: true });
  assert.strictEqual(await bad.run("offDownload('istanbul')"), false);
  assert.deepStrictEqual(kept(bad), [], 'a file that is not a map pack was stored as one: the worker would read garbage'); assert.strictEqual(bad.run('offState.istanbul.state'), 'error');
  assert.ok(!bad.ls.irn_offline_have || !JSON.parse(bad.ls.irn_offline_have).istanbul);
  // a pack that was rebuilt (another date) counts as missing
  const old = page({ phone: false, store: { irn_offline_have: JSON.stringify({ istanbul: '2020-01-01', izmir: manifest.packs.izmir.built, ankara: manifest.packs.ankara.built }) } });
  await old.run("caches.open('raynet-packs-v1').then(c => Promise.all(['istanbul', 'izmir', 'ankara'].map(x => c.put(offUrl(x), new Response('old')))))");
  await old.run('offAuto()');
  assert.deepStrictEqual(old.fetched.filter(u => /\.pack$/.test(u)), ['offline/istanbul.pack'], 'a rebuilt pack is not fetched again, or packs that are up to date are');
  assert.strictEqual(JSON.parse(old.ls.irn_offline_have).istanbul, manifest.packs.istanbul.built);
});

test('offline maps: what the page was built with is what is on disk, and Settings has the list and the mobile-data switch', () => {
  const info = JSON.parse(/const OFFLINE = (\{.*?\});\s/.exec(APP)[1]);
  for (const [id, m] of Object.entries(manifest.packs)) {
    assert.strictEqual(info[id].pack, m.file); assert.strictEqual(info[id].packBytes, m.bytes); assert.strictEqual(info[id].v, m.built);
    for (const f of info[id].data) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' is listed for ' + id + ' and does not exist');
    assert.strictEqual(info[id].bytes, m.bytes + info[id].data.reduce((a, f) => a + fs.readFileSync(path.join(ROOT, f)).toString('latin1').replace(/\r\n/g, '\n').length, 0), id + ': the size shown is not the size downloaded');
    assert.ok(info[id].data.some(f => /places-/.test(f)), id + ': the places file (the search) is not part of its offline set');
  }
  const html = H.html();
  assert.ok(/id="offPackList"/.test(html) && /id="swOffData"[^>]*role="switch"[^>]*aria-checked="false"/.test(html), 'Settings lost the offline list or the mobile-data switch (off by default)');
  const I = H.i18nValues();
  for (const lang of Object.keys(I)) for (const k of ['offPacksTitle', 'offPacksIntro', 'offGet', 'offRemove', 'offReady', 'offLoading', 'offWaiting', 'offFailed', 'offNone', 'offDataLbl', 'offDataHint', 'offAskTitle', 'offAskBody', 'offAskBodyUnknown', 'offAskNow', 'offAskWifi', 'offAskLater', 'offDone'])
    assert.ok(I[lang][k] && I[lang][k].length > 2, lang + ' has no text for ' + k);
  for (const lang of Object.keys(I)) { assert.ok(I[lang].offAskBody.includes('{cities}') && I[lang].offAskBody.includes('{mb}'), lang + ': the question does not say which maps or how big'); assert.ok(I[lang].offLoading.includes('{p}')); }
  // the question has two buttons of the same kind, and neither is the default
  const ask = APP.slice(APP.indexOf('function offAsk(todo)'), APP.indexOf('/* ---- Settings > Map > Offline maps ---- */'));
  assert.ok(/<button class="priv-btn" id="offAskWifi">/.test(ask) && /<button class="priv-btn" id="offAskNow">/.test(ask), 'the two answers are not the same kind of button');
  assert.ok(!/autofocus|\.focus\(\)/.test(ask), 'one answer is pre-selected');
});

/* ---- the worker scenarios must be able to fail ---- */
const MUTANTS = [
  { name: 'the copy is taken after the page has the answer (the bug that kept nothing)', scenario: 'a file the page fetched online is kept, although the page read it first',
    edit: s => s.split("if (r && r.ok) { const copy = r.clone(); caches.open(STATIC).then(c => c.put(e.request, copy)).catch(() => {}); }").join("if (r && r.ok) caches.open(STATIC).then(c => c.put(e.request, r.clone())).catch(() => {});") },
  { name: 'no app file is fetched at install', scenario: 'every file of the app is kept at install, and answers with no connection',
    edit: s => s.replace(/const APP_FILES = \[[^\]]*\];/, 'const APP_FILES = [];') },
  { name: 'a tile that cannot be fetched is an error again', scenario: 'a tile that cannot be fetched comes out of the offline pack, byte for byte',
    edit: s => s.replace("const offline = async () => hit || (tile ? await packTile(tile[1], tile[2], tile[3]) :", "const offline = async () => hit || (tile ? null :") },
  { name: 'pack tiles are handed over still zipped', scenario: 'a tile that cannot be fetched comes out of the offline pack, byte for byte',
    edit: s => s.replace(".stream().pipeThrough(new DecompressionStream('gzip'))", '.stream()') },
  { name: 'a 503 from the tile service is passed on', scenario: 'the live tile wins when there is a connection, and the pack answers when the tile service is down',
    edit: s => s.replace('return (await offline()) || r;', 'return r;') },
  { name: 'the pack answers before the live tile', scenario: 'the live tile wins when there is a connection, and the pack answers when the tile service is down',
    edit: s => s.replace('      try {\n        const r = await fetch(e.request);\n        if (r && r.ok) { cache.put(e.request, r.clone()); if (++vecPuts', '      { const early = await offline(); if (early) return early; }\n      try {\n        const r = await fetch(e.request);\n        if (r && r.ok) { cache.put(e.request, r.clone()); if (++vecPuts') },
  { name: 'no stand-in tile list', scenario: 'the map can start with no connection even if the tile list was never fetched',
    edit: s => s.replace("(/\\/planet\\/?$/.test(url.pathname) ? packIndex() : null)", 'null') },
  { name: 'the tile list is not fetched at install', scenario: 'the map can start with no connection even if the tile list was never fetched',
    edit: s => s.replace('quiet(fetch(VEC_INDEX).then(r => (r.ok ? vec.put(VEC_INDEX, r) : null))),', '') },
  { name: 'the worker keeps a second copy of a pack', scenario: 'a pack is never stored twice, and a new or damaged pack is handled',
    edit: s => s.replace("if (url.origin === location.origin && url.pathname.includes('/offline/')) return;", '') },
  { name: 'a new pack is not noticed', scenario: 'a pack is never stored twice, and a new or damaged pack is handled',
    edit: s => s.replace("if (e.data === 'packsChanged') packTiles = null;", '') },
];
test('offline maps: every worker scenario fails on a worker with the matching mistake put back', async () => {
  const src = SW.replace(/\r\n/g, '\n'), notCaught = [];
  for (const [name, fn] of Object.entries(SCENARIOS)) assert.deepStrictEqual(await fn(src), [], 'with line endings normalised the real worker fails: ' + name);
  for (const m of MUTANTS) {
    const broken = m.edit(src);
    if (broken === src) { notCaught.push(m.name + ' (the edit did not apply: the anchor no longer matches the worker)'); continue; }
    let problems; try { problems = await SCENARIOS[m.scenario](broken); } catch (e) { problems = ['threw: ' + e.message]; }
    if (!problems.length) notCaught.push(m.name);
  }
  assert.deepStrictEqual(notCaught, [], 'mistakes the scenarios did not catch:\n  ' + notCaught.join('\n  '));
});
