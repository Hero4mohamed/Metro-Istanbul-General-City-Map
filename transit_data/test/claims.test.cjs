/* What the app says about itself must be something it does (V4.3, "no unsupported claims").
 *
 * The carriages on the map are a SIMULATION worked out from published timetables and frequencies; the arrivals board already labels
 * itself MODELLED. The app used to call them "Live carriages" and "real-time carriages" in its settings, welcome dialog, page title,
 * share card text and install manifest, in four languages. "Live" stays for the things that really are: service notices (with their
 * age shown), weather, bus notices and the journey that follows the phone's own position.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

const LIVE = /\blive\b|real-?time|canlı|gerçek zamanlı|مباشر|en direct|temps réel/i;
const SIMULATED = { en: /simulat/i, tr: /simüle/i, ar: /محاكاة/, fr: /simulé/i };

test('no language calls the carriages live or real-time, and the two that describe them say simulated', () => {
  const dict = H.i18nValues();
  for (const lang of ['en', 'tr', 'ar', 'fr']) {
    assert.ok(dict[lang], 'no ' + lang + ' dictionary');
    for (const key of ['liveCarr', 'wcLive', 'wcTap', 'liveNet']) {
      assert.ok(dict[lang][key], lang + ' has no ' + key);
      assert.ok(!LIVE.test(dict[lang][key]), lang + '.' + key + ' claims something is live: "' + dict[lang][key] + '"');
    }
    for (const key of ['liveCarr', 'wcLive']) {
      assert.ok(SIMULATED[lang].test(dict[lang][key]), lang + '.' + key + ' does not say the carriages are simulated: "' + dict[lang][key] + '"');
    }
  }
});

test('the page title, description, share text and install manifest do not claim live or real-time vehicles', () => {
  const head = H.html().split('</head>')[0];
  const texts = [...head.matchAll(/<title>([^<]*)<\/title>/g)].map(m => m[1])
    .concat([...head.matchAll(/<meta\s+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"\s+content="([^"]*)"/g)].map(m => m[1]));
  assert.strictEqual(texts.length, 6, 'expected the title, description and four share texts, found ' + texts.length);
  for (const t of texts) assert.ok(!LIVE.test(t), 'the page head claims something is live / real-time: "' + t + '"');
  const manifest = JSON.parse(H.read('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'description']) assert.ok(!LIVE.test(manifest[k] || ''), 'the install manifest ' + k + ' claims something is live: "' + manifest[k] + '"');
});

test('the title the app sets at run time does not claim live or real-time vehicles either', () => {
  // the static <title> is replaced the moment the app starts (18-mobile-shell.js), so what people see in the tab is THIS one
  const sets = [...H.appScript().matchAll(/document\.title\s*=\s*([^;\n]+)/g)].map(m => m[1]);
  assert.ok(sets.length >= 1, 'no run-time document.title assignment found; has it moved?');
  for (const s of sets) assert.ok(!LIVE.test(s), 'a run-time page title claims something is live / real-time: ' + s);
});

test('the arrivals board still labels itself modelled, in every language', () => {
  const dict = H.i18nValues();
  for (const lang of ['en', 'tr', 'ar', 'fr']) {
    assert.ok(dict[lang].modelled && dict[lang].boardModelled, lang + ' lost the MODELLED label on the arrivals board');
    // the board may SAY it is not from live positions; it may not claim to be live
    assert.ok(!LIVE.test(dict[lang].boardModelled.replace(/not from live vehicle positions|canlı araç konumundan değil|ليس من مواقع المركبات المباشرة/i, '')),
      lang + '.boardModelled calls itself live');
  }
});
