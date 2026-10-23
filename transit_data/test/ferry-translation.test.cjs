/* Şehir Hatları (city ferry) announcements, translated.
 *
 * They are not translated the way a rail fault is. A rail fault is one short sentence; a ferry notice carries TIMES
 * and DATES ("Heybeliada kalkış saati: 15.40 yerine 16.10"), which is where a wrong guess sends someone to a pier
 * at the wrong hour. So the ferry rules are whole-sentence templates that carry every number across by capture,
 * and bestEffortTranslation refuses any result whose numbers differ from the original. What the templates do not
 * know stays Turkish and says so — a notice about the operator's Belbim card check, or its general assembly, is
 * shown as written rather than turned into a half-English sentence.
 *
 * Checked against REAL notices: the fifteen newest on sehirhatlari.istanbul on 23 Oct 2026, as the scraper reads
 * them (fixtures/sehirhatlari-notices-2026-10-23.json).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');
const F = require('../scrape-ferry.cjs');

/* the translator as it ships inside the built page, not as it is in the scraper source */
function shipped() {
  const html = H.html();
  const a = html.indexOf('// ==TRANSLATOR-START=='), b = html.indexOf('// ==TRANSLATOR-END==');
  assert.ok(a > 0 && b > a, 'translator markers not found in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) +
    '\nmodule.exports={translateTR,bestEffortTranslation,bestEffortEnglish,TR_TARGETS,TR_FERRY,TR_WORDS};')(mod, mod.exports);
  return mod.exports;
}
const NOTICES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sehirhatlari-notices-2026-10-23.json'), 'utf8'));
const msg = id => { const n = NOTICES.find(x => x.id === id); assert.ok(n, 'fixture has no notice ' + id); return n.message; };

/* timetable change, event re-routing, season change, cancellation, extra trips, stop added, stop restored, service resumed */
const COVERED = ['3811', '3803', '3788', '3783', '3781', '3777', '3769', '3765', '3764', '3752', '2231'];
/* a card-check reminder, a call to a general assembly, a tour's ticket sales, and a season-change press release in
   wording the templates do not know — none of it formulaic transit wording */
const NOT_COVERED = ['3779', '3770', '3767', '3707'];

// Turkish that must not survive into a covered translation
const TURKISH_LEFT = /sefer|iskele|nedeniyle|sebebiyle|itibaren|güncellen|düzenlen|gerçekleştir|aşağıda|belirtil|kapsamında|uğraması|yerine|kalkış|varış/i;

test('every ferry notice the templates cover reads in all three languages', () => {
  const { bestEffortTranslation, TR_TARGETS } = shipped();
  const bad = [];
  for (const id of COVERED) {
    for (const tgt of TR_TARGETS) {
      const r = bestEffortTranslation(msg(id), [], tgt, 'ferry');
      if (r.lang !== tgt) { bad.push(id + ' fell back to ' + r.lang + ' in ' + tgt); continue; }
      if (tgt !== 'ar' && TURKISH_LEFT.test(r.text)) bad.push(id + ' ' + tgt + ' still holds Turkish: ' + r.text.slice(0, 120));
      // trains run on rails; the generic rail rule would say it of a ferry
      if (tgt === 'en' && /\btrains?\b/i.test(r.text)) bad.push(id + ' calls a ferry a train: ' + r.text.slice(0, 120));
      if (tgt === 'fr' && /\btrains?\b/i.test(r.text)) bad.push(id + ' fr calls a ferry a train');
    }
  }
  assert.deepStrictEqual(bad, [], bad.join(' | '));
});

test('a ferry timetable change keeps every time on the right side of "instead of"', () => {
  const { translateTR } = shipped();
  assert.strictEqual(translateTR(msg('3811'), 'en', 'ferry'),
    'The times of the Heybeliada-Büyükada-Maltepe trip on the Maltepe-Adalar line will be updated from 12 October 2026 as follows: ' +
    'Heybeliada departure: 16.10 instead of 15.40; Büyükada departure: 16.25 instead of 15.55; Maltepe arrival: 16.45 instead of 16.15; ' +
    'The current trip times are listed below.');
  // the same three pairs in French and Arabic: the NEW time is the one first named, the old one follows "au lieu de" / "بدلًا من"
  const fr = translateTR(msg('3811'), 'fr', 'ferry');
  assert.ok(/départ de Heybeliada : 16\.10 au lieu de 15\.40/.test(fr) && /arrivée à Maltepe : 16\.45 au lieu de 16\.15/.test(fr), 'French: ' + fr);
  const ar = translateTR(msg('3811'), 'ar', 'ferry');
  assert.ok(/16\.10 بدلًا من 15\.40/.test(ar) && /16\.45 بدلًا من 16\.15/.test(ar) && /12 أكتوبر 2026/.test(ar), 'Arabic: ' + ar);
});

test('a season change and an event cancellation read as sentences', () => {
  const { translateTR } = shipped();
  assert.strictEqual(translateTR(msg('3788'), 'en', 'ferry'),
    'The summer timetable of Şehir Hatları AŞ, an affiliate of İstanbul Metropolitan Municipality, is ending. ' +
    'The newly arranged winter timetable will apply between 7 September 2026 and 27 June 2027. ' +
    'Şehir Hatları, Europe’s largest public sea transport provider, which has provided sea transport in İstanbul for 175 years, ' +
    'since the Şirket-i Hayriye, is switching to the winter timetable from Monday 7 September.');
  assert.strictEqual(translateTR(msg('3783'), 'en', 'ferry'),
    'In line with the decision taken by İstanbul Governorate, the Provincial Directorate of Youth and Sports, due to the ' +
    '"38. Boğaziçi Kıtalararası Yüzme Yarışı" on Sunday 23 August 2026, the trips detailed below and the long Bosphorus Tour cannot be run.');
  // the sentence after a full stop starts with a capital, and a list is still a list
  const reroute = translateTR(msg('3803'), 'en', 'ferry');
  assert.ok(/12-13 September 2026\. Accordingly, Üsküdar-Haliç line trips will run as far as Balat Pier, Kadıköy-Haliç line trips will run as far as Fener Pier, while Beşiktaş-Haliç line trips will run as far as Kasımpaşa Pier\.$/.test(reroute), reroute);
});

test('a ferry notice the templates do not cover is shown in Turkish, unchanged, in every language', () => {
  const { bestEffortTranslation, TR_TARGETS } = shipped();
  for (const id of NOT_COVERED) for (const tgt of TR_TARGETS) {
    const r = bestEffortTranslation(msg(id), [], tgt, 'ferry');
    assert.strictEqual(r.lang, 'tr', id + ' claimed to be translated into ' + tgt);
    assert.strictEqual(r.text, msg(id).trim(), id + ' was altered instead of passed through');
  }
});

test('a translation whose numbers differ from the original is not shown', () => {
  const { bestEffortTranslation, TR_FERRY } = shipped();
  // a rule that drops a number still produces a sentence; only the comparison can tell
  const src = 'ZZQ 15 ve 16 Eylül';
  assert.strictEqual(bestEffortTranslation(src, [], 'en', 'ferry').lang, 'en', 'the probe sentence should translate before the bad rule is added');
  TR_FERRY.unshift([/ZZQ (\d+)/g, { en: 'dropped', ar: 'x', fr: 'x' }]);
  const r = bestEffortTranslation(src, [], 'en', 'ferry');
  assert.strictEqual(r.lang, 'tr', 'a translation that lost a number was shown: ' + r.text);
  assert.strictEqual(r.text, src);
});

test('a name capture never reaches over Arabic punctuation', () => {
  const { translateTR } = shipped();
  /* "وبناءً على ذلك،" is written by the "Bu kapsamda" rule before the line-name rules run; a name class that did not
     exclude the Arabic comma took "ذلك،" into the next line's name and put it inside the sentence */
  const ar = translateTR(msg('3803'), 'ar', 'ferry');
  assert.ok(ar.indexOf('وبناءً على ذلك،') >= 0, 'the connective was split: ' + ar);
  assert.ok(/رحلات خط Üsküdar-Haliç حتى رصيف Balat/.test(ar), 'the first line name was not captured cleanly: ' + ar);
  assert.ok(!/خط\s+ذلك/.test(ar), 'a word of the connective ended up in a line name: ' + ar);
});

test('the four spellings of an event clause place the date, the weekday and the place correctly', () => {
  const { translateTR } = shipped();
  const tail = ' sebebiyle aşağıda belirtilen ek seferler yapılacaktır.';
  const cases = [
    ['16 Ağustos 2026 Pazar günü Beşiktaş Stadyumu’nda gerçekleştirilecek konser' + tail,
      'Due to the concert on Sunday 16 August 2026 at Beşiktaş Stadyumu, the extra trips listed below will be run.'],
    ['13 Haziran 2026 Cumartesi günü düzenlenecek olan LGS sınavı' + tail,
      'Due to the LGS exam on Saturday 13 June 2026, the extra trips listed below will be run.'],
    ['24 Haziran 2026 (Bugün) tarihinde Beşiktaş Stadyumu’nda gerçekleştirilecek konser' + tail,
      'Due to the concert on 24 June 2026 at Beşiktaş Stadyumu, the extra trips listed below will be run.'],
    ['5 Kasım 2026 tarihinde düzenlenecek konser' + tail,
      'Due to the concert on 5 November 2026, the extra trips listed below will be run.'],
  ];
  for (const [src, want] of cases) assert.strictEqual(translateTR(src, 'en', 'ferry'), want, src);
  const fr = translateTR(cases[0][0], 'fr', 'ferry'), ar = translateTR(cases[0][0], 'ar', 'ferry');
  assert.ok(/le dimanche 16 août 2026 à Beşiktaş Stadyumu/.test(fr), 'French: ' + fr);
  assert.ok(/يوم الأحد 16 أغسطس 2026 في Beşiktaş Stadyumu/.test(ar), 'Arabic: ' + ar);
});

test('every ferry template says what it produces in every language', () => {
  const { TR_FERRY, TR_TARGETS, TR_WORDS } = shipped();
  assert.ok(Array.isArray(TR_FERRY) && TR_FERRY.length > 25, 'ferry template table not found');
  const gaps = [];
  TR_FERRY.forEach(([re, rep], i) => {
    for (const tgt of TR_TARGETS)
      if (typeof rep[tgt] !== 'string' || !rep[tgt].trim()) gaps.push('template #' + i + ' (' + String(re).slice(0, 40) + ') has no ' + tgt);
  });
  // months, weekdays and seasons come from the word table: a gap there leaves a Turkish month inside a translated date
  ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık',
   'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar', 'yaz', 'kış'].forEach(k => {
    for (const tgt of TR_TARGETS) if (!TR_WORDS[k] || !TR_WORDS[k][tgt]) gaps.push('word "' + k + '" has no ' + tgt);
  });
  assert.deepStrictEqual(gaps, [], gaps.join(' | '));
});

test('the app translates a ferry notice with the ferry templates, and the scraper stores the same text', () => {
  const html = H.html();
  assert.ok(html.indexOf('bestEffortTranslation(d.messageTr, disNames(d), lang, d.mode)') > 0,
    'disText no longer tells the translator which kind of notice it is — a ferry notice would be run through the rail rules');
  const { bestEffortEnglish } = shipped();
  const stale = H.json('disruptions.json').filter(d => d.mode === 'ferry').filter(d => {
    const want = bestEffortEnglish(d.messageTr, [d.ref].concat(d.lines || []).filter(Boolean), 'ferry');
    return d.message !== want.text || d.messageLang !== want.lang;
  }).map(d => d.id);
  assert.deepStrictEqual(stale, [], 'stored ferry text is not what the shipped templates produce: ' + stale.join(', '));
});

test('a quoted event name survives the page: the operator\'s &ldquo; and &rdquo; are decoded', () => {
  assert.strictEqual(F.decodeEntities('&ldquo;Uluslararası Triatlon&rdquo; imk&acirc;nı'), '“Uluslararası Triatlon” imkânı');
  // and the notice that carries one (16 Aug 2026) reads as one, not as "&ldquo;…" in the middle of a sentence
  assert.ok(!/&[a-z]+;/i.test(msg('3781')) && !/&[a-z]+;/i.test(msg('3777')), 'an HTML entity reached the notice text');
});
