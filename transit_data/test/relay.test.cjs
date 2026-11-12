'use strict';
/* The relay (relay/src/worker.mjs + relay/feeder.cjs): the Cloudflare Worker the app asks for İstanbul's live buses, and the
 * feeder that fetches them from İETT inside Türkiye. The records used here are real ones, recorded from api.ibb.gov.tr on
 * 12 Nov 2026 at 03:00 (line 40). The Worker's real handler is run, on a stand-in for its database that understands exactly
 * the statements the Worker makes. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FILE = path.join(__dirname, '..', '..', 'relay', 'src', 'worker.mjs');
const load = () => import(pathToFileURL(FILE).href);
const FEEDER = require('../../relay/feeder.cjs');
const REAL = [
  { kapino: 'O2001', boylam: '29.1094513333333', enlem: '41.233543', hatkodu: '40', guzergahkodu: '40_G_D0', hatad: 'RUMELİFENERİ / GARİPÇE - TAKSİM', yon: 'TAKSİM', son_konum_zamani: '2026-11-12 03:00:58', yakinDurakKodu: '112721' },
  { kapino: 'O1283', boylam: '29.1084886666667', enlem: '41.2348476666667', hatkodu: '40', guzergahkodu: '40_D_D0', hatad: 'RUMELİFENERİ / GARİPÇE - TAKSİM', yon: 'RUMELİ FENERİ', son_konum_zamani: '2026-11-12 03:00:50', yakinDurakKodu: '112721' },
];
const NOW = Date.UTC(2026, 10, 12, 0, 1, 10);            // 03:01:10 in Turkey
const trClock = ms => new Date(ms + 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const fresh = () => REAL.map(r => Object.assign({}, r, { son_konum_zamani: trClock(Date.now() - 5000) }));

test('relay: İETT\'s records become plain bus records, with Turkish clock time read as Turkish time', async () => {
  const W = await load();
  assert.strictEqual(W.turkeyTime('2026-11-12 03:00:58'), Date.UTC(2026, 10, 12, 0, 0, 58), 'the time was not read as UTC+3: every bus would look three hours old, or three hours in the future');
  assert.deepStrictEqual(W.parseBuses(REAL, NOW), [
    { id: 'O2001', lat: 41.233543, lng: 29.109451, t: Date.UTC(2026, 10, 12, 0, 0, 58), to: 'TAKSİM', stop: '112721' },
    { id: 'O1283', lat: 41.234848, lng: 29.108489, t: Date.UTC(2026, 10, 12, 0, 0, 50), to: 'RUMELİ FENERİ', stop: '112721' }]);
  assert.strictEqual(W.parseBuses(null, NOW), null);
  assert.deepStrictEqual(W.parseBuses([], NOW), [], 'a line with no buses out is an answer: none');
});

test('relay: a bus that is not really there is not passed on', async () => {
  const W = await load();
  const r = (over) => Object.assign({}, REAL[0], over);
  const out = W.parseBuses([
    r({ kapino: 'OLD', son_konum_zamani: '2026-11-12 02:40:00' }),                  // stopped reporting 21 minutes ago
    r({ kapino: 'FAR', enlem: '39.9', boylam: '32.8' }),                             // Ankara
    r({ kapino: 'ZERO', enlem: '0', boylam: '0' }),
    r({ kapino: '', enlem: '41.0', boylam: '29.0' }),
    r({ kapino: 'NOTIME', son_konum_zamani: '' }),
    r({ kapino: 'TWICE', enlem: '41.01', son_konum_zamani: '2026-11-12 03:00:10' }), r({ kapino: 'TWICE', enlem: '41.02', son_konum_zamani: '2026-11-12 03:00:40' }),
    r({ kapino: 'COMMA', enlem: '41,05', boylam: '29,02' }),
  ], NOW);
  assert.deepStrictEqual(out.map(b => b.id).sort(), ['COMMA', 'TWICE'], 'an old, far, empty or untimed record was passed on as a live bus');
  assert.strictEqual(out.find(b => b.id === 'TWICE').lat, 41.02, 'of two records for one vehicle the older one won');
  assert.strictEqual(out.find(b => b.id === 'COMMA').lat, 41.05);
});

test('relay: every İstanbul line the app can open is a line the relay and the feeder accept, and nothing else gets into the question', async () => {
  const W = await load();
  const html = require('../testkit/helpers.cjs').appScript();
  const refs = [...new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bus-data-istanbul.json'), 'utf8')).graph.map(d => d.ref))];
  assert.ok(refs.length > 700, 'the İstanbul bus data is missing');
  for (const re of [W.LINE_RE, FEEDER.LINE_RE]) {
    const refused = refs.filter(r => !re.test(r));
    assert.deepStrictEqual(refused, [], 'these lines of the app would be refused: ' + refused.slice(0, 8).map(r => JSON.stringify(r)).join(', '));
    for (const bad of ['', '34G</HatKodu><x>', '34 G', '34g', 'A&B', '123456789', '<', '"']) assert.ok(!re.test(bad), 'this is not a line code and would be written into the question to İETT: ' + JSON.stringify(bad));
  }
  assert.strictEqual(String(W.LINE_RE), String(FEEDER.LINE_RE), 'the Worker and the feeder disagree about what a line code is');
  assert.ok(FEEDER.soap('15ÇK').includes('<HatKodu>15ÇK</HatKodu>'));
  assert.ok(!/[\u0080-\u009f]/.test(refs.join('')), 'a line code carries an invisible control character again (İETT\'s feed writes "Ş" + U+009E): it would match nothing');
  assert.ok(html.length > 1000);
});

test('feeder: İETT\'s envelope is unwrapped, and an error page is not an answer', () => {
  const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const env = '<soap:Envelope><soap:Body><GetHatOtoKonum_jsonResponse xmlns="http://tempuri.org/"><GetHatOtoKonum_jsonResult>' + esc(JSON.stringify(REAL)) + '</GetHatOtoKonum_jsonResult></GetHatOtoKonum_jsonResponse></soap:Body></soap:Envelope>';
  assert.deepStrictEqual(FEEDER.unwrap(env), REAL);
  assert.strictEqual(FEEDER.unwrap('<html><body><b>Http/1.1 Service Unavailable</b></body></html>'), null, 'an error page was taken for "no buses"');
  assert.strictEqual(FEEDER.unwrap('<GetHatOtoKonum_jsonResult>{not json</GetHatOtoKonum_jsonResult>'), null);
  assert.deepStrictEqual(FEEDER.unwrap('<GetHatOtoKonum_jsonResult>[]</GetHatOtoKonum_jsonResult>'), []);
});

test('relay: what the page is told depends on how fresh the feeder\'s answer is, and old is never passed off as new', async () => {
  const W = await load();
  const buses = JSON.stringify(W.parseBuses(REAL, NOW));
  let a = W.answerFor('40', { at: NOW - 10000, ok: 1, body: buses }, NOW - 3000, NOW);
  assert.strictEqual(a.status, 200); assert.strictEqual(a.body.buses.length, 2); assert.strictEqual(a.body.now, NOW, 'the page is not told the relay\'s clock: a phone with a wrong clock would see every bus as stale');
  assert.ok(!a.body.warming);
  a = W.answerFor('40', { at: NOW - 61000, ok: 1, body: buses }, NOW - 3000, NOW);
  assert.deepStrictEqual([a.status, a.body.warming, a.body.buses.length], [200, true, 0], 'a minute-old answer was served as now (or the page was not told that a fresh one is on its way)');
  a = W.answerFor('40', null, NOW - 3000, NOW);
  assert.deepStrictEqual([a.status, a.body.warming], [200, true]);
  a = W.answerFor('40', { at: NOW - 61000, ok: 1, body: buses }, NOW - 46000, NOW);
  assert.deepStrictEqual([a.status, a.body.error], [503, 'no-feed'], 'with no feeder running the relay still pretends buses are coming');
  a = W.answerFor('40', null, 0, NOW);
  assert.deepStrictEqual([a.status, a.body.error], [503, 'no-feed']);
  a = W.answerFor('40', { at: NOW - 5000, ok: 0, body: '[]' }, NOW - 3000, NOW);
  assert.deepStrictEqual([a.status, a.body.error], [502, 'upstream'], 'İETT not answering the feeder was passed on as "no buses on the line"');
  a = W.answerFor('40', { at: NOW - 5000, ok: 1, body: buses }, NOW - 3000, NOW + 11 * 60000 - 5000);
  assert.strictEqual(a.status, 503);
  assert.ok(W.sameToken('abc', 'abc') && !W.sameToken('abd', 'abc') && !W.sameToken('ab', 'abc') && !W.sameToken('', '') && !W.sameToken(undefined, 'abc'));
});

/* A stand-in for the Worker's database: three small tables, and exactly the statements the Worker uses. An unknown statement
   throws, so a changed query cannot pass by being ignored. */
function fakeDb() {
  const t = { wanted: new Map(), snap: new Map(), meta: new Map() }; let writes = 0;
  const run = (sql, a) => {
    if (/^INSERT INTO wanted/.test(sql)) { t.wanted.set(a[0], a[1]); writes++; return []; }
    if (/^INSERT INTO meta/.test(sql)) { t.meta.set('feeder', a[0]); return []; }
    if (/^INSERT INTO snap/.test(sql)) { t.snap.set(a[0], { at: a[1], ok: a[2], body: a[3] }); return []; }
    if (/^SELECT at, ok, body FROM snap/.test(sql)) { const r = t.snap.get(a[0]); return r ? [r] : []; }
    if (/^SELECT v FROM meta/.test(sql)) return t.meta.has('feeder') ? [{ v: t.meta.get('feeder') }] : [];
    if (/^SELECT line FROM wanted/.test(sql)) return [...t.wanted].filter(([, at]) => at > a[0]).sort((x, y) => y[1] - x[1]).slice(0, a[1]).map(([line]) => ({ line }));
    if (/^DELETE FROM (wanted|snap)/.test(sql)) { const m = t[/wanted/.test(sql) ? 'wanted' : 'snap']; for (const [k, v] of m) if ((v.at || v) < a[0]) m.delete(k); return []; }
    throw new Error('the stand-in database does not know this statement: ' + sql);
  };
  const stmt = (sql, a) => ({ bind: (...b) => stmt(sql, b), run: async () => { run(sql, a || []); return {}; }, first: async () => run(sql, a || [])[0] || null, _go: () => ({ results: run(sql, a || []) }) });
  return { t, writes: () => writes, prepare: sql => stmt(sql), batch: async list => list.map(s => s._go()) };
}
async function world() {
  const W = await load(), db = fakeDb(), env = { turkmaps_relay: db, FEED_TOKEN: 'test-token-0123456789' }, pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const ask = async (pathAndQuery, o) => { o = o || {}; const h = {}; if (o.origin) h.Origin = o.origin; if (o.token) h.Authorization = 'Bearer ' + o.token;
    const r = await W.default.fetch(new Request('https://relay.example' + pathAndQuery, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined }), o.env || env, ctx);
    await Promise.all(pending.splice(0)); return r; };
  return { W, db, env, ask };
}

test('relay: a line someone opens goes on the feeder\'s list, the feeder\'s answer reaches the page, and only the app\'s page may read it', async () => {
  const w = await world(), APP = 'https://hero4mohamed.github.io';
  let r = await w.ask('/iett/buses?line=R1', { origin: APP });
  assert.strictEqual(r.status, 503, 'with no feeder ever heard from, the relay did not say so');
  assert.deepStrictEqual(await r.json(), { error: 'no-feed' });
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), APP, 'the page cannot read the refusal, so it cannot tell the person why there are no buses');
  r = await w.ask('/feed/wanted', { token: w.env.FEED_TOKEN });
  assert.deepStrictEqual((await r.json()).lines, ['R1'], 'the line that was asked for is not on the feeder\'s list');
  r = await w.ask('/iett/buses?line=R1', { origin: APP });
  let b = await r.json();
  assert.deepStrictEqual([r.status, b.warming, b.buses.length], [200, true, 0], 'feeder alive, answer not yet in: the page should be told to ask again shortly');
  r = await w.ask('/feed/push', { method: 'POST', token: w.env.FEED_TOKEN, body: { lines: { R1: fresh(), 'bad line': fresh(), R9: null } } });
  assert.deepStrictEqual(await r.json(), { stored: 2 }, 'a push stored something other than its two valid lines');
  r = await w.ask('/iett/buses?line=r1', { origin: APP });                       // lower case is read as its capitals
  b = await r.json();
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(b.buses.map(x => x.id), ['O2001', 'O1283']); assert.ok(!b.warming && Math.abs(b.now - Date.now()) < 5000);
  assert.strictEqual(r.headers.get('Cache-Control'), 'no-store', 'a cache could hand out an old answer as now');
  assert.strictEqual((await w.ask('/iett/buses?line=R9', { origin: APP })).status, 502, 'a line İETT did not answer for was shown as an empty line');
  r = await w.ask('/iett/buses?line=R1', { origin: 'https://evil.example' });
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), null, 'another website\'s script may read the relay: it would spend this project\'s free quota');
  assert.ok(/Origin/.test(r.headers.get('Vary') || ''));
  assert.strictEqual((await w.ask('/iett/buses?line=R1', { origin: 'http://localhost:8470' })).headers.get('Access-Control-Allow-Origin'), 'http://localhost:8470');
  assert.strictEqual(w.db.writes(), 2, 'every request writes to the database: a busy line would use up the free daily writes (one write per line per 20 s is the rule)');
  assert.ok(!JSON.stringify([...w.db.t.wanted, ...w.db.t.snap]).includes('evil.example') && w.db.t.wanted.size === 2, 'something other than line codes and times is being kept');
});

test('relay: only the feeder may read the list or push, and a bad request never touches the database', async () => {
  const w = await world();
  for (const p of ['/feed/wanted', '/feed/push']) {
    assert.strictEqual((await w.ask(p, { method: p === '/feed/push' ? 'POST' : 'GET', body: p === '/feed/push' ? { lines: {} } : undefined })).status, 403, p + ' answers without the feeder\'s token');
    assert.strictEqual((await w.ask(p, { token: 'test-token-012345678X', method: p === '/feed/push' ? 'POST' : 'GET', body: p === '/feed/push' ? { lines: {} } : undefined })).status, 403, p + ' accepts a wrong token');
    assert.strictEqual((await w.ask(p, { token: 'x', env: { turkmaps_relay: w.db } })).status, 503, p + ' is open when no token has been set at all');
  }
  assert.strictEqual((await w.ask('/feed/push', { method: 'POST', token: w.env.FEED_TOKEN, body: { nothing: 1 } })).status, 400);
  assert.strictEqual((await w.ask('/feed/push', { token: w.env.FEED_TOKEN })).status, 405);
  for (const bad of ['/iett/buses', '/iett/buses?line=', '/iett/buses?line=34G%3C%2FHatKodu%3E', '/iett/buses?line=' + 'A'.repeat(9)]) assert.strictEqual((await w.ask(bad)).status, 400, bad + ' was not refused');
  assert.strictEqual((await w.ask('/iett/buses?line=R2', { method: 'POST' })).status, 405);
  assert.strictEqual((await w.ask('/anything-else')).status, 404);
  assert.strictEqual(w.db.t.wanted.size + w.db.t.snap.size, 0, 'a refused request left something in the database');
  const h = await (await w.ask('/health')).json();
  assert.deepStrictEqual(h.feeder, { alive: false, heardSecondsAgo: null });
});

/* ---- V4.5.2: the notices job on GitHub reads the ferry operator's announcement pages through the relay ---- */
test('relay /fetch: reads the ferry announcement pages for the job that holds the token, and nothing else for anyone', async () => {
  const W = await load();
  for (const ok of ['https://sehirhatlari.istanbul/tr/duyurular', 'https://sehirhatlari.istanbul/tr/duyurular/asiyan-seferleri-duyurusu-2231', 'https://sehirhatlari.istanbul/tr/duyurular/01-kas%C4%B1m-3825']) assert.ok(W.FETCHABLE.test(ok), ok + ' is refused');
  for (const bad of ['https://sehirhatlari.istanbul/', 'https://sehirhatlari.istanbul/tr/duyurular/..', 'https://sehirhatlari.istanbul/tr/duyurular/a/b', 'https://sehirhatlari.istanbul/tr/duyurular?x=1',
    'http://sehirhatlari.istanbul/tr/duyurular', 'https://sehirhatlari.istanbul.evil.example/tr/duyurular', 'https://www.metro.istanbul/', 'https://api.ibb.gov.tr/', 'file:///etc/passwd', ''])
    assert.ok(!W.FETCHABLE.test(bad), 'the relay would fetch ' + JSON.stringify(bad) + ': it must not be a general proxy');
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('<html>duyurular</html>', { status: 200 }); };
  try {
    const env = { FETCH_TOKEN: 'fetch-token-0123456789', FEED_TOKEN: 'feed-token-0123456789' }, ctx = { waitUntil() {} };
    const ask = (q, token, e, method) => W.default.fetch(new Request('https://relay.example/fetch' + q, { method: method || 'GET', headers: token ? { Authorization: 'Bearer ' + token } : {} }), e || env, ctx);
    const good = '?u=' + encodeURIComponent('https://sehirhatlari.istanbul/tr/duyurular');
    assert.strictEqual((await ask(good)).status, 403, 'the pages are handed to anyone who asks');
    assert.strictEqual((await ask(good, 'feed-token-0123456789')).status, 403, 'the feeder\'s token opens the fetch endpoint: one leaked secret would open both doors');
    assert.strictEqual((await ask(good, 'x', { FEED_TOKEN: 'feed-token-0123456789' })).status, 503, 'with no fetch token set the endpoint is open');
    assert.strictEqual((await ask('?u=' + encodeURIComponent('https://www.metro.istanbul/'), env.FETCH_TOKEN)).status, 400);
    assert.strictEqual((await ask(good, env.FETCH_TOKEN, env, 'POST')).status, 405);
    assert.strictEqual(calls.length, 0, 'a refused request still reached the ferry site');
    const r = await ask(good, env.FETCH_TOKEN);
    assert.strictEqual(r.status, 200); assert.strictEqual(await r.text(), '<html>duyurular</html>');
    assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), null, 'a web page may read the fetch endpoint');
    assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].url, 'https://sehirhatlari.istanbul/tr/duyurular');
    assert.ok(/IstanbulTransitMap/.test(calls[0].init.headers['User-Agent']), 'the relay does not say who is asking, as the scraper does when it asks directly');
    assert.strictEqual(calls[0].init.redirect, 'manual', 'a redirect could lead the relay to an address that was never allowed');
    globalThis.fetch = async () => new Response('Just a moment...', { status: 403 });
    assert.strictEqual((await ask(good, env.FETCH_TOKEN)).status, 403, 'the operator\'s refusal was passed on as a page that was read');
  } finally { globalThis.fetch = real; }
});

test('scraper: the ferry page is asked directly first, through the relay only when that fails, and never when no relay is set', async () => {
  const F = require('../scrape-ferry.cjs');
  assert.strictEqual(F.relayFor({}), null);
  assert.strictEqual(F.relayFor({ RELAY_URL: 'https://turkmaps-relay.turkmaps-relay.workers.dev' }), null, 'a relay with no token is used');
  assert.strictEqual(F.relayFor({ RELAY_URL: 'http://plain.example', RELAY_FETCH_TOKEN: 't' }), null, 'the token would be sent over plain http');
  const env = { RELAY_URL: 'https://relay.example/', RELAY_FETCH_TOKEN: 'tok' }, page = 'https://sehirhatlari.istanbul/tr/duyurular';
  const world = answers => { const calls = []; return { calls, fetch: async (url, init) => { calls.push({ url: String(url), init }); const a = answers[calls.length - 1]; if (a === 'throw') throw new Error('network'); return { ok: a.status === 200, status: a.status, text: async () => a.body || '' }; } }; };
  let w = world([{ status: 200, body: 'direct' }]);
  assert.strictEqual(await F.get(page, { env, fetch: w.fetch }), 'direct'); assert.strictEqual(w.calls.length, 1, 'the relay was used although the page answered directly');
  w = world([{ status: 403 }, { status: 200, body: 'via relay' }]);
  assert.strictEqual(await F.get(page, { env, fetch: w.fetch }), 'via relay');
  assert.strictEqual(w.calls[1].url, 'https://relay.example/fetch?u=' + encodeURIComponent(page)); assert.strictEqual(w.calls[1].init.headers.Authorization, 'Bearer tok');
  assert.ok(!w.calls[0].init.headers.Authorization, 'the relay\'s token was sent to the ferry site');
  w = world(['throw', { status: 200, body: 'via relay' }]);
  assert.strictEqual(await F.get(page, { env, fetch: w.fetch }), 'via relay');
  w = world([{ status: 403 }]);
  await assert.rejects(F.get(page, { env: {}, fetch: w.fetch }), /HTTP 403/); assert.strictEqual(w.calls.length, 1);
  w = world([{ status: 403 }, { status: 502 }]);
  await assert.rejects(F.get(page, { env, fetch: w.fetch }), /403 directly and HTTP 502 through the relay/, 'a page that neither way could read was taken as read');
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'disruptions.yml'), 'utf8');
  assert.ok(/RELAY_URL:\s+https:\/\/turkmaps-relay\.turkmaps-relay\.workers\.dev/.test(wf) && /RELAY_FETCH_TOKEN: \$\{\{ secrets\.RELAY_FETCH_TOKEN \}\}/.test(wf), 'the job on GitHub is not given the relay');
});
