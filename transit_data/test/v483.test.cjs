'use strict';
/* V4.8.3 (21 Nov 2026), asked by the owner: the Alerts number should not "constantly say 60 or whatever" but tell people about
 * "actual new updates"; once they have seen the announcements it should drop. And for bus notices: "for any update or new
 * thing even if the same line of bus yes make it count towards the counter again please cause it is technically new."
 * Also: B2 runs again, so its hand-written works notice goes. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const APP = () => H.appScript().replace(/\r\n/g, '\n');
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
const plain = o => JSON.parse(JSON.stringify(o));
function seenKit() {
  const ctx = { JSON, Array, Set, String, Object };
  vm.createContext(ctx);
  vm.runInContext(region('NOTICES-PURE') + '\n' + region('ANNSEEN-PURE') + '\nthis.fp = annFingerprint; this.step = annSeenStep; this.parse = annParseSeen;', ctx);
  return { fp: d => ctx.fp(d), step: (live, seen, open) => plain(ctx.step(live, seen, open)), parse: r => plain(ctx.parse(r)) };
}
const A = { id: 'm7-fault', ref: 'M7', severity: 'partial', message: 'Trains run between Nurtepe and Mahmutbey only.', messageTr: 'Seferler Nurtepe-Mahmutbey arası.' };
const B = { id: 'ferry-2231', mode: 'ferry', severity: 'minor', message: 'Aşiyan–Üsküdar trips cancelled', until: '2026-11-22' };
const C = { id: 'bus:500T:delay:abc', mode: 'bus', ref: '500T', kind: 'delay', severity: 'minor', message: 'Delays on 500T', tpl: { k: 'delay' } };

test('v4.8.3: a notice\'s fingerprint changes when its text changes and not otherwise', () => {
  const k = seenKit();
  assert.strictEqual(k.fp(A), k.fp(Object.assign({}, A)), 'the same notice gave two fingerprints');
  assert.notStrictEqual(k.fp(Object.assign({}, A, { message: A.message + ' Shuttle buses run.' })), k.fp(A), 'a reworded notice must count as new');
  assert.notStrictEqual(k.fp(Object.assign({}, B, { until: '2026-11-23' })), k.fp(B), 'a new end date is a change');
  assert.notStrictEqual(k.fp(Object.assign({}, A, { severity: 'major' })), k.fp(A), 'a worse severity is a change');
  assert.strictEqual(k.fp(Object.assign({}, C, { _shown: 1, route: [[41, 29]], title: 'Delays' })), k.fp(C), 'something the reader does not see changed the fingerprint');
  assert.ok(k.fp(A).startsWith('m7-fault#'), 'the fingerprint starts with the notice id');
});

test('v4.8.3: the badge counts only notices not seen yet', () => {
  const k = seenKit();
  const r = k.step([A, B, C], [k.fp(A)], false);
  assert.strictEqual(r.badge, 2);
  assert.deepStrictEqual(r.fresh, [k.fp(B), k.fp(C)]);
  assert.deepStrictEqual(r.seen, [k.fp(A)], 'not opening the card marked something seen');
});

test('v4.8.3: opening Alerts marks everything seen and the badge goes to 0', () => {
  const k = seenKit();
  const r = k.step([A, B, C], [], true);
  assert.strictEqual(r.badge, 0);
  assert.deepStrictEqual(r.fresh, [k.fp(A), k.fp(B), k.fp(C)], 'what was new when the card opened is what gets the NEW tag');
  assert.deepStrictEqual(r.seen.slice().sort(), [k.fp(A), k.fp(B), k.fp(C)].sort());
  const later = k.step([A, B, C], r.seen, false);
  assert.strictEqual(later.badge, 0, 'after a look the badge stays at 0 until something changes');
  assert.deepStrictEqual(later.fresh, []);
});

test('v4.8.3: a new cancelled departure on a bus line already seen counts again', () => {
  const k = seenKit();
  const trips1 = { id: 'bus:500T:trips:k1', mode: 'bus', ref: '500T', kind: 'trips', severity: 'minor', tpl: { k: 'trips', n: 1, list: ['07:10'] }, messageTr: '1 sefer: 07:10' };
  const trips2 = { id: 'bus:500T:trips:k2', mode: 'bus', ref: '500T', kind: 'trips', severity: 'minor', tpl: { k: 'trips', n: 2, list: ['07:10', '07:40'] }, messageTr: '2 sefer: 07:10, 07:40' };
  const seen = k.step([trips1], [], true).seen;
  const r = k.step([trips2], seen, false);
  assert.strictEqual(r.badge, 1, 'one more cancelled departure on 500T is new');
  /* the same id with a new list (should parseIettNotices ever keep the id) is new too: the list is part of the fingerprint */
  const r2 = k.step([Object.assign({}, trips2, { id: trips1.id })], seen, false);
  assert.strictEqual(r2.badge, 1);
});

test('v4.8.3: the seen list is rewritten only when Alerts is opened, live notices first', () => {
  const k = seenKit();
  const closed = k.step([A], [k.fp(A), 'gone#x', k.fp(B)], false);
  assert.deepStrictEqual(closed.seen, [k.fp(A), 'gone#x', k.fp(B)], 'a closed card must not change the list');
  assert.strictEqual(closed.badge, 0);
  const open = k.step([C, A], ['gone#x', k.fp(A)], true);
  assert.deepStrictEqual(open.seen, [k.fp(C), k.fp(A), 'gone#x'], 'live notices first, then the older ones');
});

test('v4.8.3: a notice that drops out for a moment and comes back unchanged is not new; changed, it is', () => {
  const k = seenKit();
  const seen = k.step([A], [], true).seen;
  const gone = k.step([], seen, false);
  assert.strictEqual(k.step([A], gone.seen, false).badge, 0, 'an İETT notice that blinks out and back is the same notice');
  assert.strictEqual(k.step([Object.assign({}, A, { message: 'Service resumed on M7.' })], gone.seen, false).badge, 1, 'the owner\'s rule: anything updated is technically new');
});

test('v4.8.3: without storage the badge counts everything, as before', () => {
  const k = seenKit();
  const r = k.step([A, B, C], null, false);
  assert.strictEqual(r.badge, 3);
  assert.strictEqual(r.seen, null, 'nothing to save when storage is unavailable');
  assert.deepStrictEqual(r.fresh, [k.fp(A), k.fp(B), k.fp(C)]);
  assert.strictEqual(k.step([A, B, C], null, true).badge, 0, 'an open card still shows no badge');
});

test('v4.8.3: a damaged seen list is read as empty', () => {
  const k = seenKit();
  assert.deepStrictEqual(k.parse('x'), []);
  assert.deepStrictEqual(k.parse('{}'), []);
  assert.deepStrictEqual(k.parse('[1,"a"]'), ['a']);
  assert.deepStrictEqual(k.parse(null), []);
  assert.deepStrictEqual(k.parse('["a","b"]'), ['a', 'b']);
});

/* the same notice twice in the live list (rail feed + carried copy) counts once */
test('v4.8.3: a notice listed twice counts once', () => {
  const k = seenKit();
  const r = k.step([A, Object.assign({}, A)], [], false);
  assert.strictEqual(r.badge, 1);
});

/* ---- wired into the card (source-level, as v482 does: the card itself needs a browser) ---- */
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
test('v4.8.3: the bottom-bar badge shows the unseen count, not the total', () => {
  const r = fnSrc('renderAnnouncements');
  assert.ok(/annSeenStep\(/.test(r), 'renderAnnouncements does not ask annSeenStep');
  assert.ok(/mb\.textContent[^;]*step\.badge|step\.badge[\s\S]{0,200}mb\.textContent/.test(r), 'the badge is not set from the unseen count');
  assert.ok(!/mb[^;]*rail\.length \+ ferry\.length \+ groups\.length|n=rail\.length \+ ferry\.length \+ groups\.length/.test(r), 'the badge still counts every notice');
});
test('v4.8.3: the badge counts each bus notice, not each bus group', () => {
  assert.ok(/annSeenStep\(\s*rail\.concat\(\s*ferry\s*,\s*bus\s*\)/.test(fnSrc('renderAnnouncements')), 'the live list given to annSeenStep must be rail + ferry + every bus notice');
});
test('v4.8.3: opening the Alerts sheet re-renders the card so it is marked seen', () => {
  assert.ok(/renderAnnouncements\(\)/.test(fnSrc('openSheet')), 'openSheet does not re-render the card');
  assert.ok(/getElementById\('annHead'\)\.addEventListener\('click'[\s\S]{0,200}renderAnnouncements\(\)/.test(APP()), 'expanding the card on a wide screen does not mark it seen');
});
test('v4.8.3: new rows carry a NEW tag and the bus section says how many are new', () => {
  assert.ok(/\bannIsNew\b/.test(fnSrc('annRowHTML')), 'rail and ferry rows have no NEW tag');
  assert.ok(/\bannIsNew\b/.test(fnSrc('annBusGroupHTML')), 'bus rows have no NEW tag');
  assert.ok(/t\('annNNew'\)/.test(fnSrc('renderAnnouncements')), 'the bus section does not say how many are new');
});
test('v4.8.3: "new" is written in all four languages', () => {
  const src = fs.readFileSync(path.join(ROOT, 'transit_data', 'src', '01-i18n.js'), 'utf8');
  assert.strictEqual((src.match(/\bannNew:/g) || []).length, 4, 'annNew is not in en, tr, ar and fr');
  const nn = [...src.matchAll(/\bannNNew:"([^"]*)"/g)].map(m => m[1]);
  assert.strictEqual(nn.length, 4, 'annNNew is not in en, tr, ar and fr');
  nn.forEach(s => assert.ok(s.includes('{n}'), 'annNNew has no {n}: ' + s));
});

/* Found in the browser (21 Nov): the card is drawn before İETT's bus notices arrive, and trimming the list to "what is live right
   now" at that moment threw away every bus notice you had seen, so a reload showed 99+ again. A feed that has not arrived yet
   must not unsee anything. */
test('v4.8.3: a feed that has not arrived yet does not unsee its notices', () => {
  const k = seenKit();
  const seen = k.step([A, B, C], [], true).seen;
  const boot = k.step([A], seen, false);                 // only the rail notice is in yet
  assert.ok(boot.seen.includes(k.fp(C)), 'the bus notice was dropped from the seen list before the bus feed arrived');
  assert.strictEqual(k.step([A, B, C], boot.seen, false).badge, 0, 'after a reload, what you had seen counts as new again');
});
test('v4.8.3: the seen list cannot grow without end', () => {
  const k = seenKit();
  const old = Array.from({ length: 2500 }, (_, i) => 'old' + i + '#x');
  const r = k.step([A, B], old, true);
  assert.ok(r.seen.length <= 2000, 'the list kept ' + r.seen.length + ' fingerprints');
  assert.ok(r.seen.includes(k.fp(A)) && r.seen.includes(k.fp(B)), 'what is live now must be kept');
  assert.strictEqual(r.seen[0], k.fp(A), 'live notices come first, so the cap drops the oldest');
});

/* ---- B2 and the version ---- */
test('v4.8.3: the B2 works notice is gone (B2 runs again)', () => {
  const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'transit_data', 'disruptions-manual.json'), 'utf8'));
  assert.ok(Array.isArray(manual), 'disruptions-manual.json must stay a list');
  assert.ok(!manual.some(e => e && e.ref === 'B2'), 'the B2 works notice is still there; the owner says B2 runs again');
});
test('v4.8.3: the app says V4.8.3', () => {
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'transit_data', 'legal-config.json'), 'utf8')).appVersion, 'V4.8.3');
});
