'use strict';
/* V4.8.2 (19 Nov 2026), asked by the owner before the closed test on Google Play:
 *   1. "Data & sources", the Assistant AI key box and the assistant itself ("Ask the map", still being developed) are shown only to
 *      the owner: a hidden developer switch (tap the version line in About 7 times). Nothing in them is secret, so a switch is
 *      enough; tying it to the owner's account would put a personal address in public code.
 *   2. Diagnostics becomes "Send feedback": the person's own email app opens with the message ready, addressed to the app's contact
 *      address. Technical details only when they tick the box. The app itself still sends nothing.
 *   3. The contact address is the app's own, transportengist@gmail.com, everywhere. */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const APP = () => H.appScript().replace(/\r\n/g, '\n');
function fnSrc(name) {
  const s = APP(), i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'function ' + name + ' not found');
  let depth = 0, k = s.indexOf('{', s.indexOf(')', i));
  for (let j = k; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) return s.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
function region(name) {
  const s = APP(), a = s.indexOf('/* ==' + name + '-START== */'), b = s.indexOf('/* ==' + name + '-END== */');
  assert.ok(a > 0 && b > a, 'the ' + name + ' block is missing');
  return s.slice(a, b);
}
const plain = o => JSON.parse(JSON.stringify(o));
const ADDRESS = 'transportengist@gmail.com';

/* ---- 3. the contact address ---- */
test('v4.8.2: the app\'s own address is the contact everywhere, and the owner\'s personal one is nowhere', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'transit_data', 'legal-config.json'), 'utf8'));
  assert.strictEqual(cfg.contactEmail, ADDRESS);
  assert.ok(H.html().includes('href="mailto:' + ADDRESS + '"'), 'Settings › About shows it');
  const files = ['index.html', 'SECURITY.md', 'DATA-SOURCES.md', 'README.md', ...fs.readdirSync(path.join(ROOT, 'legal')).map(f => 'legal/' + f)];
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    assert.ok(!/mohamedyounis248/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' still carries the personal address');
  }
});

/* ---- 2. feedback by email ---- */
function mailer() {
  const ctx = { encodeURIComponent, String, Math };
  vm.createContext(ctx);
  vm.runInContext(region('FEEDBACK-PURE') + '\nthis.f = feedbackMail;', ctx);
  return o => plain(ctx.f(Object.assign({ to: ADDRESS, version: 'V4.8.2', kind: 'problem', text: 'The M2 line is missing', tech: '' }, o)));
}
test('v4.8.2: feedback is an email to the app\'s address, its subject says the app, version and kind', () => {
  const f = mailer();
  const m = f({});
  assert.strictEqual(m.to, ADDRESS);
  assert.strictEqual(m.subject, 'TurkMaps V4.8.2 – Problem');
  assert.strictEqual(m.body, 'The M2 line is missing');
  assert.strictEqual(m.href, 'mailto:' + ADDRESS + '?subject=' + encodeURIComponent('TurkMaps V4.8.2 – Problem') + '&body=' + encodeURIComponent('The M2 line is missing'));
  assert.deepStrictEqual(['idea', 'complaint', 'other', 'nonsense'].map(k => f({ kind: k }).subject),
    ['TurkMaps V4.8.2 – Idea', 'TurkMaps V4.8.2 – Complaint', 'TurkMaps V4.8.2 – Other', 'TurkMaps V4.8.2 – Other'], 'the subject is English whatever the language, so the inbox sorts');
  const amp = f({ text: 'a & b ? c = d #e' });
  assert.ok(!/[&?#=]/.test(amp.href.split('&body=')[1]), 'what the person typed cannot break the address: ' + amp.href);
});
test('v4.8.2: technical details only when ticked, and a long message is cut so every email app accepts it', () => {
  const f = mailer();
  assert.ok(!f({ tech: '' }).body.includes('Technical details'), 'nothing technical unless asked');
  const t = f({ tech: 'app: V4.8.2 build 1\ncity: istanbul' });
  assert.strictEqual(t.body, 'The M2 line is missing\n\n-- Technical details --\napp: V4.8.2 build 1\ncity: istanbul');
  const long = f({ text: 'ç'.repeat(3000), tech: 'x'.repeat(2000) });
  assert.ok(long.href.length <= 1900, 'mailto kept under 1900 characters (it was ' + long.href.length + ')');
  assert.ok(long.cut === true && long.body.endsWith('…'), 'and it says it was cut');
  assert.strictEqual(f({}).cut, false);
});
test('v4.8.2: Send feedback sits in Settings › App & data, with its kinds, the tick box, and what it opens said under it', () => {
  const h = H.html();
  const row = h.slice(h.indexOf('id="fbRow"'), h.indexOf('</details>', h.indexOf('id="fbRow"')));
  for (const id of ['fbKind', 'fbText', 'fbTech', 'fbSend', 'fbCopy', 'fbNote', 'diagClear', 'diagNote']) assert.ok(row.includes('id="' + id + '"'), '#' + id);
  assert.deepStrictEqual([...row.matchAll(/data-k="(\w+)"/g)].map(m => m[1]), ['problem', 'idea', 'complaint', 'other']);
  assert.ok(/<input type="checkbox" id="fbTech">/.test(row), 'the tick box starts unticked');
  assert.ok(/data-i18n="fbPrivacy"/.test(row), 'what it opens and who sees it, under the buttons');
  const send = fnSrc('feedbackSend');
  assert.ok(/feedbackMail\(\{ to: '__CONTACT_EMAIL__'|feedbackMail\(\{ to: 'transportengist@gmail\.com'/.test(send), 'addressed to the contact address from legal-config.json');
  assert.ok(/tech: document\.getElementById\('fbTech'\)\.checked \? diagReportText\(\) : ''/.test(send), 'details only when ticked');
  assert.ok(/location\.href = m\.href;/.test(send), 'the person\'s own email app opens');
  assert.ok(!/issues\/new/.test(APP()), 'no button sends people to a public GitHub page any more');
});
test('v4.8.2: "Report a problem" under the notices opens the feedback form', () => {
  const ann = fnSrc('renderAnnouncements');
  assert.ok(/<a href="#feedback" data-fb-open>/.test(ann), 'the link is the feedback form now');
  assert.ok(/querySelectorAll\('\[data-fb-open\]'\)\.forEach\(el => el\.addEventListener\('click', e => \{ e\.preventDefault\(\); openFeedback\(\); \}\)\)/.test(ann), 'and a tap opens it');
  const o = fnSrc('openFeedback');
  assert.ok(/openSettings\(\)/.test(o) && /data-sec="app"/.test(o) && /fbText/.test(o), 'it opens Settings at the form');
});

/* ---- 1. the owner's developer switch ---- */
function devEnv(stored) {
  const cls = new Set(), store = { irn_dev: stored };
  const ctx = { Date, lsStr: k => (k in store ? store[k] : null), document: { documentElement: { classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } } } } };
  vm.createContext(ctx);
  vm.runInContext(region('DEVMODE-PURE') + '\n' + fnSrc('devOn') + '\n' + fnSrc('devApply') + '\nthis.api = { devTapNext, devApply, devOn };', ctx);
  return { api: ctx.api, cls };
}
test('v4.8.2: seven quick taps on the version line switch the developer options, a pause starts the count again', () => {
  const { api } = devEnv(null);
  let st = null, now = 1000, flips = 0;
  for (let i = 0; i < 6; i++) { st = api.devTapNext(st, now += 400); assert.strictEqual(st.toggle, false); }
  st = api.devTapNext(st, now += 400); assert.strictEqual(st.toggle, true, 'the seventh tap switches');
  st = null;
  for (let i = 0; i < 6; i++) st = api.devTapNext(st, now += 400);
  st = api.devTapNext(st, now += 5000); assert.strictEqual(st.toggle, false, 'a long pause before the seventh: nothing');
  for (let i = 0; i < 7; i++) { st = api.devTapNext(st, now += 300); if (st.toggle) flips++; }
  assert.strictEqual(flips, 1, 'and seven more quick taps do it');
});
test('v4.8.2: the developer options are off for everyone until switched on, and the page follows the setting', () => {
  const off = devEnv(null); off.api.devApply(); assert.ok(!off.cls.has('dev-on'));
  const on = devEnv('1'); on.api.devApply(); assert.ok(on.cls.has('dev-on'));
  const css = H.appStyle();
  for (const sel of ['#provRow', '#aiKeyRow', '#aiOrb', '#aiPanel', '[data-pin="N"]'])
    assert.ok(new RegExp('html:not\\(\\.dev-on\\) ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[,{]').test(css), sel + ' is hidden from everyone but the owner (that exact selector)');
  assert.ok(/devApply\(\);/.test(APP()), 'applied as the page starts');
});
test('v4.8.2: the privacy notice and the storage page say how feedback works and what the switch stores', () => {
  const read = f => fs.readFileSync(path.join(ROOT, 'legal', f), 'utf8');
  const en = read('privacy.html'), tr = read('privacy.tr.html');
  assert.ok(/Send feedback/.test(en) && en.includes('mailto:' + ADDRESS) && /Add technical details/.test(en) && /only as long as/.test(en), 'EN: what is sent, to whom, when details are added, how long it is kept');
  assert.ok(/Geri bildirim gönder/.test(tr) && tr.includes('mailto:' + ADDRESS) && /Teknik ayrıntıları ekle/.test(tr), 'TR');
  assert.ok(!/GitHub for "Report a problem"|public GitHub page/.test(en), 'the old GitHub route is gone from the notice');
  assert.ok(read('storage.html').includes('irn_dev') && read('storage.tr.html').includes('irn_dev'), 'the switch is listed with what it stores');
});
