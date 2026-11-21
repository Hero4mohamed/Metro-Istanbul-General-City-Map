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

test('v4.8.3: the seen list keeps only live notices', () => {
  const k = seenKit();
  const r = k.step([A], [k.fp(A), 'gone#x', k.fp(B)], false);
  assert.deepStrictEqual(r.seen, [k.fp(A)], 'notices that have ended must be dropped from the list, or it grows without end');
  assert.strictEqual(r.badge, 0);
});

test('v4.8.3: a notice that ends and comes back is new again', () => {
  const k = seenKit();
  const seen = k.step([A], [], true).seen;
  const gone = k.step([], seen, false);
  assert.deepStrictEqual(gone.seen, []);
  assert.strictEqual(k.step([A], gone.seen, false).badge, 1, 'the owner\'s rule: anything that (re)appears is technically new');
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
