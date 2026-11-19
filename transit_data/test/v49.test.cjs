'use strict';
/* V4.9 part 1: the planner respects what the operators' notices say.
 * Design: docs/superpowers/specs/2026-11-19-v4.9-design.md. Owner's decisions (19 Nov 2026): only stretches the operator says are
 * NOT running are avoided; a shuttle stretch is routable with an amber note; a stretch the notice does not mention at all (M7
 * Kağıthane–Yıldız) stays routable with a red warning; old notices (past the 8 h stale limit) never block anything. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const APP = () => H.appScript().replace(/\r\n/g, '\n');
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
function foldSrc() { const s = APP(), a = s.indexOf('const _foldMemo = new Map();'), b = s.indexOf('};', s.indexOf('const fold = s => {')); return s.slice(a, b + 2); }
function pure() {
  const ctx = { Map, Set, Math, String, Array };
  vm.createContext(ctx);
  vm.runInContext([foldSrc(), fnSrc('noticeStationIndex'), region('NOTICE-ROUTE-PURE'), fnSrc('noticeSections'),
    'this.api = { noticeStretches, noticeRouting, stretchHits, noticeSections };'].join('\n'), ctx);
  return ctx.api;
}
const M7L = require(path.join(__dirname, '..', 'lines.json')).find(l => l.ref === 'M7');
const M7 = M7L.stations, idx = n => M7.findIndex(s => s.name === n);
const M7_TEXT = 'Teknik bir arıza nedeniyle seferler Nurtepe-Mahmutbey arasında normal işletme döngüsünde, Nurtepe-Kağıthane arasında ise mekik seferi olarak yapılmaktadır.';
const plain = o => JSON.parse(JSON.stringify(o));
const named = list => plain(list).map(x => x.kind + ':' + M7[x.a].name + '–' + M7[x.b].name);

test('v4.9: M7\'s notice is a shuttle stretch (Nurtepe–Kağıthane) and a stretch not listed as running (Kağıthane–Yıldız)', () => {
  const api = pure();
  const got = named(api.noticeStretches(M7, { ref: 'M7', scope: 'stations', severity: 'partial', messageTr: M7_TEXT }));
  assert.deepStrictEqual(got.sort(), ['reduced:Nurtepe–Kağıthane', 'unmentioned:Kağıthane–Yıldız']);
  assert.deepStrictEqual(plain(api.noticeSections(M7, M7_TEXT)), [[idx('Nurtepe'), idx('Yıldız')]], 'the map\'s band still covers the whole affected stretch');
});

test('v4.9: only words that say trains do NOT run, or a "segment" marked major, make a stretch closed', () => {
  const api = pure();
  assert.deepStrictEqual(named(api.noticeStretches(M7, { messageTr: 'Arıza nedeniyle Çağlayan-Fulya istasyonları arasında seferler yapılamamaktadır.' })), ['closed:Çağlayan–Fulya']);
  assert.deepStrictEqual(named(api.noticeStretches(M7, { scope: 'segment', from: 'Kağıthane', to: 'Mecidiyeköy', severity: 'major' })), ['closed:Kağıthane–Mecidiyeköy']);
  assert.deepStrictEqual(named(api.noticeStretches(M7, { scope: 'segment', from: 'Kağıthane', to: 'Mecidiyeköy', severity: 'partial' })), ['reduced:Kağıthane–Mecidiyeköy'], 'a segment that is only "affected" is not a closure');
  assert.deepStrictEqual(named(api.noticeStretches(M7, { messageTr: 'Seferler Nurtepe-Kağıthane arasında ise mekik seferi olarak yapılmaktadır.' })), ['reduced:Nurtepe–Kağıthane'], '"yapılmaktadır" (trains DO run) is not "yapılamamaktadır"');
  assert.strictEqual(api.noticeStretches(M7, { messageTr: 'Asansör bakımdadır.' }).length, 0, 'no stretch named, nothing made up');
  assert.strictEqual(api.noticeStretches(M7, { messageTr: 'Atlantis-Yıldız arasında seferler yapılamamaktadır.' }).length, 0, 'a station the line does not have');
});

/* the lines and notices a city might have, as the planner sees them */
const lineOf = ref => (ref === 'M7' ? M7L : null);
const NOW = { checkedStale: false };
test('v4.9: a closed stretch blocks its inner stations, the track inside it, and an end that is the end of the line', () => {
  const api = pure();
  const d = { id: 'x', ref: 'M7', scope: 'segment', from: 'Kağıthane', to: 'Yıldız', severity: 'major' };
  const r = plain(api.noticeRouting([d], lineOf, false));
  const k = n => 'M7#' + idx(n);
  for (const n of ['Çağlayan', 'Mecidiyeköy', 'Fulya']) assert.ok(r.nodes.includes(k(n)), n + ' cannot be boarded or passed');
  assert.ok(r.nodes.includes(k('Yıldız')), 'Yıldız is the end of the line: nothing else reaches it');
  assert.ok(!r.nodes.includes(k('Kağıthane')), 'Kağıthane is still served from the other side');
  assert.ok(r.edges.includes(k('Kağıthane') + '>' + k('Çağlayan')) && r.edges.includes(k('Çağlayan') + '>' + k('Kağıthane')), 'the track out of the stretch is cut both ways');
  assert.strictEqual(r.avoided.length, 1, 'and it is listed as avoided, to say so in the results');
  const two = plain(api.noticeRouting([{ id: 'y', ref: 'M7', scope: 'segment', from: 'Çağlayan', to: 'Mecidiyeköy', severity: 'major' }], lineOf, false));
  assert.deepStrictEqual([two.nodes.length, two.edges.length], [0, 2], 'two neighbouring stations: no inner station, but the track between them is cut');
});

test('v4.9: shuttle and not-listed stretches are never blocked, only warned about', () => {
  const api = pure();
  const r = plain(api.noticeRouting([{ id: 'm7', ref: 'M7', scope: 'stations', severity: 'partial', messageTr: M7_TEXT }], lineOf, false));
  assert.deepStrictEqual([r.nodes.length, r.edges.length, r.lines.length], [0, 0, 0], 'the owner\'s decision: routable');
  assert.deepStrictEqual(r.warn.map(w => w.kind).sort(), ['reduced', 'unmentioned']);
});

test('v4.9: old notices block nothing: a closed stretch and a suspended line become warnings', () => {
  const api = pure();
  const ds = [{ id: 'a', ref: 'M7', scope: 'segment', from: 'Kağıthane', to: 'Yıldız', severity: 'major' },
              { id: 'b', ref: 'M7', scope: 'line', severity: 'major' }];
  const fresh = plain(api.noticeRouting(ds, lineOf, false)), old = plain(api.noticeRouting(ds, lineOf, true));
  assert.ok(fresh.nodes.length && fresh.lines.includes('M7'), 'fresh: avoided');
  assert.deepStrictEqual([old.nodes.length, old.edges.length, old.lines.length], [0, 0, 0], 'stale: nothing blocked');
  assert.deepStrictEqual(old.warn.map(w => w.kind).sort(), ['closedStale', 'lineStale']);
});

test('v4.9: a warning belongs to a leg only when the leg rides through part of the stretch', () => {
  const api = pure();
  const warn = [{ ref: 'M7', kind: 'reduced', a: idx('Nurtepe'), b: idx('Kağıthane') }, { ref: 'M7', kind: 'unmentioned', a: idx('Kağıthane'), b: idx('Yıldız') }];
  const hit = (from, to) => plain(api.stretchHits(warn, 'M7', idx(from), idx(to))).map(w => w.kind);
  assert.deepStrictEqual(hit('Mahmutbey', 'Nurtepe'), [], 'ending at the edge of a stretch is not riding it');
  assert.deepStrictEqual(hit('Alibeyköy', 'Kağıthane'), ['reduced']);
  assert.deepStrictEqual(hit('Mecidiyeköy', 'Nurtepe'), ['reduced', 'unmentioned'], 'either direction');
  assert.deepStrictEqual(plain(api.stretchHits(warn, 'M2', 0, 5)), [], 'another line');
});

/* ---- wiring ---- */
test('v4.9: the router uses the notices: blocked stations and cut track are skipped, under the stale rule', () => {
  const r = fnSrc('routeXY');
  assert.ok(/const nr = noticeRoutingNow\(\);/.test(r), 'routeXY asks for the notice blocks');
  assert.ok(/markBlocked\(avoid, noLine, nr\.lines, nr\.nodes\)/.test(r), 'blocked lines and stations go into the same marking as before');
  assert.ok(/if\(nrEdges && nrEdges\.has\(u \+ '>' \+ e\.to\)\) continue;/.test(r), 'and cut track is never crossed');
  const now = fnSrc('noticeRoutingNow');
  assert.ok(/noticeRouting\(activeDisruptions\(\), ref => lineByRef\[ref\], noticesStale\(\)\)/.test(now), 'built from the active notices, with the stale rule');
  assert.ok(/ANN_STALE_MIN|annAges\(/.test(fnSrc('noticesStale')), 'stale means the same 8 hours the Announcements panel uses');
  assert.ok(/nodes \? \[\.\.\.nodes\]\.sort\(\)\.join\(','\) : ''/.test(fnSrc('markBlocked')), 'a change in blocked stations is noticed by the marking\'s memo');
});
test('v4.9: the route says what it avoided and warns on the leg it affects', () => {
  const w = fnSrc('renderRouteWarnings');
  assert.ok(/stretchHits\(nr\.warn, s\.ref, s\.fromIdx, s\.toIdx\)/.test(w), 'each rail leg is checked against the warnings');
  for (const k of ['nrReduced', 'nrUnlisted', 'nrClosedStale', 'nrAvoid']) assert.ok(w.includes("t('" + k + "')"), k);
  const i18n = require('fs').readFileSync(path.join(__dirname, '..', 'src', '01-i18n.js'), 'utf8');
  for (const k of ['nrReduced', 'nrUnlisted', 'nrClosedStale', 'nrAvoid'])
    assert.strictEqual((i18n.match(new RegExp('(^|[^A-Za-z])' + k + ':"', 'gm')) || []).length, 4, k + ' in all four languages');
});

/* ---- part 2: how fresh each live source is, said on screen ---- */
function ageEnv() {
  const T = { liveBusAgo: 'updated {age} ago', liveBusSeen: 'seen moving', ageSec: '{n} s', ageMin: '{n} min', ageHour: '{n} h', ageDay: '{n} d' };
  const ctx = { Math, isFinite, t: k => T[k] || k };
  vm.createContext(ctx);
  vm.runInContext(fnSrc('ageWords') + '\n' + fnSrc('liveBusAgeText') + '\nthis.f = liveBusAgeText;', ctx);
  return ctx.f;
}
test('v4.9: the live-bus strip says how fresh İstanbul\'s buses are, and says İzmir\'s are "seen moving" (its feed has no times)', () => {
  const f = ageEnv(), now = 1e12;
  assert.strictEqual(f('relay', now - 40000, now), ' · updated 40 s ago');
  assert.strictEqual(f('relay', now - 5 * 60000, now), ' · updated 5 min ago');
  assert.strictEqual(f('izmir', now - 40000, now), ' · seen moving', 'never an age the source did not give');
  assert.strictEqual(f('relay', undefined, now), '', 'no answer yet: nothing claimed');
  const show = fnSrc('liveBusShow');
  assert.ok(/text \+= liveBusAgeText\(me\.src\.kind, me\.last, now\);/.test(show), 'the strip shows it, not only a tooltip');
  assert.ok(/setInterval\(\(\) => \{ if\(liveBus && !document\.hidden\) liveBusShow\(\); \}, 15000\);/.test(APP()), 'and keeps it true between answers');
});
test('v4.9: route warnings that quote notices say how old the notices are', () => {
  assert.ok(/html \+= '<div class="rw-age">' \+ svgEsc\(annAgeText\(a\)\) \+ '<\/div>';/.test(fnSrc('renderRouteWarnings')));
  const i18n = require('fs').readFileSync(path.join(__dirname, '..', 'src', '01-i18n.js'), 'utf8');
  for (const k of ['liveBusAgo', 'liveBusSeen', 'ageSec'])
    assert.strictEqual((i18n.match(new RegExp('(^|[^A-Za-z])' + k + ':"', 'gm')) || []).length, 4, k + ' in all four languages');
});
