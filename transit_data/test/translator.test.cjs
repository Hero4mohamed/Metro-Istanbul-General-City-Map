/* The Turkish→English disruption translator, tested against the page that actually ships.
 *
 * It is a phrase-substitution translator, so it will always leave some Turkish behind. That is
 * fine and deliberate: an untranslated clause is honest. What is NOT fine is a rule that eats
 * a word's stem and leaves its Turkish suffix welded to an English one. That shipped — a real
 * M2 alert rendered as "Sanayi stationnda bir yolcunun…", because the rule for "istasyonu"
 * matched inside "istasyonunda" and stranded the "nda". A reader cannot tell a mangled word
 * from a typo in the source, and it appears in the assistant, the alert bar and the line panel.
 *
 * The rules are ordered, so this is a real hazard on every edit: adding a short pattern above a
 * longer one silently truncates the longer one's matches. Both directions are checked below.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

/* Pull the translator out of the SHIPPED page, not out of the scraper source: build.cjs splices
   it between markers, and a splice that lost a rule would be invisible to a test of the source. */
function shippedTranslator() {
  const html = H.html();
  const a = html.indexOf('// ==TRANSLATOR-START==');
  const b = html.indexOf('// ==TRANSLATOR-END==');
  assert.ok(a > 0 && b > a, 'translator markers not found in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) + '\nmodule.exports={translateTR,turkishShare,bestEffortEnglish,bestEffortTranslation,TR_TARGETS,TR_PHRASES,TR_WORDS,TR_FALLBACK_SHARE};')(mod, mod.exports);
  return mod.exports;
}

/* Real phrasings from metro.istanbul, covering the inflections that actually appear: locative
   (-nda, "at"), ablative (-ndan, "from"), plural (-ları), and the operator's first-person
   possessive (-umuz, "our station"), each of which contains a shorter form as a prefix. */
const CORPUS = [
  'Sanayi istasyonunda bir yolcunun rahatsızlanması nedeniyle seferler aksamaktadır.',
  'Vezneciler istasyonumuzda bakım çalışması yapılmaktadır.',
  'Taksim istasyonundan seferler durdurulmuştur.',
  'Mecidiyeköy istasyonumuzdan seferler yapılamamaktadır.',
  'Şişli istasyonlarında onarım çalışması vardır.',
  'Levent istasyonlarından seferler yapılamamaktadır.',
  'Kadıköy istasyonu kapalıdır.',
  'Onarım çalışması nedeniyle seferler Çağlayan-Mahmutbey istasyonları arasında yapılmaktadır.',
  'Yenikapı istasyonumuz geçici olarak hizmet dışıdır.',
  'M2 hattında arıza nedeniyle seferler geçici süreyle durdurulmuştur.',
];

/* An English stem immediately followed by more letters. Longest alternative FIRST — with the
   short one first, "station" matches inside "stations" and the plural "s" reads as a stranded
   suffix, which would make this test fail on correct output. */
const STEMS = ['stations', 'station', 'services', 'service', 'trains', 'train',
               'lines', 'line', 'works', 'work', 'passengers', 'passenger'];
const MANGLE = new RegExp('\\b(?:' + STEMS.join('|') + ')[a-zA-Zçğıöşü]+', 'i');
// a stem followed by a legitimate English continuation is not mangled
const ENGLISH = new RegExp('^(?:' + STEMS.join('|') + '|working|worked|serviced|lined|lining|trained)$', 'i');

test('the disruption translator never welds a Turkish suffix onto an English word', () => {
  const { translateTR } = shippedTranslator();
  const bad = [];
  for (const src of CORPUS) {
    const out = String(translateTR(src) || '');
    const m = MANGLE.exec(out);
    if (m && !ENGLISH.test(m[0])) bad.push(m[0] + '  ←  ' + out.trim().slice(0, 80));
  }
  assert.deepStrictEqual(bad, [], 'mangled word(s):\n  ' + bad.join('\n  '));
});

/* The inflections above are the whole point of the rule ordering, so prove they are handled
   rather than merely not-mangled: a rule set that deleted them all would pass the check above. */
test('the disruption translator resolves the Turkish case endings it claims to', () => {
  const { translateTR } = shippedTranslator();
  const expect = [
    ['Sanayi istasyonunda bakım vardır.',        /at the station/i],
    ['Taksim istasyonundan seferler kalkar.',    /from the station/i],
    ['Vezneciler istasyonumuzda bakım vardır.',  /at our station/i],
    ['Şişli istasyonlarında onarım vardır.',     /at the stations/i],
  ];
  const missed = [];
  for (const [src, want] of expect) {
    const out = String(translateTR(src) || '');
    if (!want.test(out)) missed.push(String(want) + '  not in  "' + out.trim().slice(0, 70) + '"');
  }
  assert.deepStrictEqual(missed, [], 'case ending(s) no longer translated:\n  ' + missed.join('\n  '));
});

/* The shipped alerts themselves — the corpus above is representative, this is what users see. */
test('no shipped disruption message contains a mangled word', () => {
  const bad = [];
  for (const d of H.json('disruptions.json')) {
    for (const field of ['message', 'messageTr', 'title']) {
      const v = d[field];
      if (!v) continue;
      const m = MANGLE.exec(String(v));
      if (m && !ENGLISH.test(m[0])) bad.push(d.ref + '.' + field + ': ' + m[0]);
    }
  }
  assert.deepStrictEqual(bad, [], 'mangled word(s) in shipped alerts: ' + bad.join(', '));
});

/* --- coverage, not correctness ------------------------------------------------------------
 * The rules are ordered phrase substitutions, so they cover the formulaic half of these
 * announcements and nothing else. When a real alert says something the table never anticipated
 * the output is not so much wrong as unusable — a live M2 alert rendered as
 *
 *   "Sanayi at the station bir yolcunun intihar girişiminde bulunması due to Sanayi our
 *    station işletmeye has been closed."
 *
 * Half of each language and readable in neither. Inventing the English the rules do not know
 * is out of the question here, so the only honest options are the hybrid or the clean original
 * — and past some amount of surviving Turkish the original wins, labelled.
 *
 * "Some amount" is a number: turkishShare() reports the fraction of classifiable words the
 * rules left alone, TR_FALLBACK_SHARE is where the fallback starts. The tests below pin the
 * decision AND the margin either side of it, because a threshold with real inputs sitting on
 * top of it is a coin-flip dressed up as a rule.
 */

// the real alert this fallback exists for, verbatim from metro.istanbul
const UNCOVERED = 'Sanayi istasyonunda bir yolcunun intihar girişiminde bulunması nedeniyle ' +
                  'Sanayi istasyonumuz işletmeye kapatılmıştır.';
const UNCOVERED_NAMES = ['Sanayi mahallesi', 'M2'];

/* Alerts the phrase table genuinely covers. The last is deliberately imperfect — one word
   ("vardır") survives — because the occasional untranslated word is the accepted cost of a
   phrase translator, and a threshold tight enough to reject it would throw away most of the
   good translations this app produces. */
const COVERED = [
  ['Kadıköy istasyonu kapalıdır.', ['Kadıköy']],
  ['Yenikapı istasyonumuz geçici olarak hizmet dışıdır.', ['Yenikapı']],
  ['M2 hattında arıza nedeniyle seferler geçici süreyle durdurulmuştur.', ['M2']],
  ['Onarım çalışması nedeniyle seferler Yıldız-Mecidiyeköy ve Nurtepe istasyonundan aktarmalı ' +
   'olarak Çağlayan-Mahmutbey istasyonları arasında yapılmaktadır.', ['M7', 'Mecidiyeköy']],
  ['Şişli istasyonlarında onarım çalışması vardır.', ['Şişli']],
];

test('an alert the rules cannot carry into English is shown in Turkish, not as a hybrid', () => {
  const { bestEffortEnglish } = shippedTranslator();
  const r = bestEffortEnglish(UNCOVERED, UNCOVERED_NAMES);
  assert.strictEqual(r.lang, 'tr',
    'shipped a Turkish-English hybrid (' + r.share.toFixed(2) + ' of it still Turkish): ' + r.text);
});

/* The fallback must hand back the ORIGINAL, byte for byte. Returning the half-translation and
   merely labelling it Turkish would be the same defect wearing a badge, and returning anything
   else at all would mean this app had written a service announcement of its own. */
test('the Turkish fallback is the untouched original, never a rewrite', () => {
  const { bestEffortEnglish } = shippedTranslator();
  const r = bestEffortEnglish(UNCOVERED, UNCOVERED_NAMES);
  assert.strictEqual(r.text, UNCOVERED,
    'the text presented as "the Turkish original" is not the Turkish original');
});

test('an alert the rules do cover is still translated', () => {
  const { bestEffortEnglish } = shippedTranslator();
  const dropped = [];
  for (const [src, names] of COVERED) {
    const r = bestEffortEnglish(src, names);
    if (r.lang !== 'en') dropped.push(src.slice(0, 46) + '…  (' + r.share.toFixed(2) + ')');
  }
  assert.deepStrictEqual(dropped, [],
    'gave up on wording the rules handle — the threshold is too tight:\n  ' + dropped.join('\n  '));
});

/* A threshold is worth something only if real inputs are not clustered around it. Measure both
   populations and require daylight on both sides, so that one unusual word in an otherwise
   good translation — or one lucky match in an otherwise untranslated one — cannot tip it. */
test('the fallback threshold sits in a gap, not in the middle of the data', () => {
  const { turkishShare, translateTR, TR_FALLBACK_SHARE } = shippedTranslator();
  const share = ([src, names]) => turkishShare(translateTR(src), names);
  const worstCovered  = Math.max(...COVERED.map(share));
  const bestUncovered = share([UNCOVERED, UNCOVERED_NAMES]);

  assert.ok(TR_FALLBACK_SHARE - worstCovered >= 0.05,
    'covered alerts reach ' + worstCovered.toFixed(2) + ' against a threshold of ' +
    TR_FALLBACK_SHARE + ' — a good translation is one stray word from being thrown away');
  assert.ok(bestUncovered - TR_FALLBACK_SHARE >= 0.05,
    'the uncovered alert measures ' + bestUncovered.toFixed(2) + ' against a threshold of ' +
    TR_FALLBACK_SHARE + ' — no margin, so the fallback fires on a coin-flip');
});

/* Station and line names pass through untranslated BY DESIGN. Counting them as leftover
   Turkish would make an alert look worse the more places it names — and the ones naming the
   most places are exactly the ones a visitor most needs translated. */
test('station and line names do not count against translation coverage', () => {
  const { turkishShare, translateTR } = shippedTranslator();
  const src = 'Onarım çalışması nedeniyle seferler Yıldız-Mecidiyeköy ve Nurtepe istasyonundan ' +
              'aktarmalı olarak Çağlayan-Mahmutbey istasyonları arasında yapılmaktadır.';
  const en = translateTR(src);
  assert.strictEqual(turkishShare(en, ['M7', 'Mecidiyeköy']), 0,
    'five station names were read as untranslated Turkish in: ' + en);
});

/* The live feed, checked against the rules that actually ship.
 *
 * disruptions.json is written by the scraper and the page is built separately, so the two can
 * drift: a feed regenerated by an older or newer scraper can leave a stored message that the
 * shipped rules would never produce. Manual entries are exempt — a person wrote those in both
 * languages and the rules were never involved — and so are LLM translations, which are better
 * English than these rules can manage and use vocabulary the rules have never heard of. */
test('every machine-translated alert in the live feed matches the shipped rules', () => {
  const { bestEffortEnglish } = shippedTranslator();
  const bad = [];
  for (const d of H.json('disruptions.json')) {
    if (d.source === 'manual' || d.translatedBy === 'llm' || !d.messageTr) continue;
    const names = [d.ref, d.from, d.to].concat(d.stations || []).filter(Boolean);
    const best = bestEffortEnglish(d.messageTr, names);
    if (d.message !== best.text)
      bad.push(d.ref + ': stored message is not what the shipped rules produce');
    // an alert shown in Turkish has to SAY it is in Turkish, or an English reader is simply
    // handed a foreign sentence with no explanation
    if (best.lang === 'tr' && d.messageLang !== 'tr' && d.translatedBy !== 'none')
      bad.push(d.ref + ': Turkish original with nothing to label it');
  }
  assert.deepStrictEqual(bad, [], 'in the shipped feed: ' + bad.join(' | '));
});

/* --- every language the app offers, not just English ---------------------------------------
 *
 * The rules used to carry one English replacement each, and the app ran them once, into
 * English, and cached the result on the entry. That quietly made English the only language a
 * disruption could be read in: a reader on the Arabic or French UI got the English sentence,
 * or the untranslated Turkish, but never their own language — while the rest of the interface
 * around it was fully translated.
 *
 * These are the checks that keep that from coming back. The structural one matters most: a
 * rule added with only an English replacement would silently degrade Arabic and French for
 * every announcement it matched, and nothing else in the suite would notice.
 */

/* Formulaic operator wording the rules are supposed to cover. Each entry is a real announcement
   shape from metro.istanbul, with the names that are meant to survive translation unchanged. */
const COVERED_ALL = [
  ['Onarım çalışması nedeniyle seferler Yıldız-Mecidiyeköy ve Nurtepe istasyonundan aktarmalı olarak Çağlayan-Mahmutbey istasyonları arasında yapılmaktadır.',
   ['M7', 'Yıldız-Mecidiyeköy', 'Nurtepe', 'Çağlayan', 'Mahmutbey']],
  ['B2 Halkalı–Bahçeşehir hattı altyapı çalışmaları nedeniyle çalışmamaktadır.',
   ['B2', 'Halkalı', 'Bahçeşehir']],
  ['Olumsuz hava koşulları nedeniyle seferler geçici süreyle durdurulmuştur.', []],
  ['Kadıköy istasyonu kapalıdır.', ['Kadıköy']],
  ['Seferler normale dönmüştür.', []],
];

test('every rule says what it produces in every language, not only in English', () => {
  const { TR_PHRASES, TR_WORDS, TR_TARGETS } = shippedTranslator();
  assert.ok(Array.isArray(TR_PHRASES) && TR_PHRASES.length > 50, 'phrase table not found');
  assert.deepStrictEqual(TR_TARGETS.slice().sort(), ['ar', 'en', 'fr'],
    'the translator no longer targets the three languages this test assumes');

  const gaps = [];
  TR_PHRASES.forEach(([re, rep], i) => {
    for (const tgt of TR_TARGETS)
      if (typeof rep[tgt] !== 'string' || !rep[tgt].trim())
        gaps.push('phrase #' + i + ' (' + String(re).slice(0, 40) + ') has no ' + tgt);
  });
  for (const k of Object.keys(TR_WORDS))
    for (const tgt of TR_TARGETS)
      if (typeof TR_WORDS[k][tgt] !== 'string' || !TR_WORDS[k][tgt].trim())
        gaps.push('word "' + k + '" has no ' + tgt);

  assert.deepStrictEqual(gaps, [], gaps.length + ' rule(s) incomplete: ' + gaps.slice(0, 6).join(' | '));
});

test('a covered alert is translated into each language, not handed over in English', () => {
  const { bestEffortTranslation, TR_TARGETS } = shippedTranslator();
  const bad = [];
  for (const [src, names] of COVERED_ALL) {
    const out = {};
    for (const tgt of TR_TARGETS) {
      const r = bestEffortTranslation(src, names, tgt);
      out[tgt] = r.text;
      // covered wording must actually reach the target language, not fall back to Turkish
      if (r.lang !== tgt) bad.push(tgt + ' fell back to ' + r.lang + ': ' + src.slice(0, 40));
    }
    // three languages, three different sentences — identical output means one table is a copy
    for (const [a, b] of [['en', 'ar'], ['en', 'fr'], ['ar', 'fr']])
      if (out[a] === out[b]) bad.push(a + ' and ' + b + ' produced identical text for: ' + src.slice(0, 40));
  }
  assert.deepStrictEqual(bad, [], bad.join(' | '));
});

/* Arabic is the case a Latin-alphabet test suite is most likely to let through: an output that
   quietly stayed English still looks like "a translation" to any check that only asks whether
   the Turkish went away. */
test('the Arabic translation is actually in Arabic', () => {
  const { bestEffortTranslation } = shippedTranslator();
  const ARABIC = /[؀-ۿ]/;
  for (const [src, names] of COVERED_ALL) {
    const r = bestEffortTranslation(src, names, 'ar');
    assert.ok(ARABIC.test(r.text), 'no Arabic script in the Arabic output for: ' + src.slice(0, 40));
    // every Latin word left in it must be one of the names that were meant to survive
    const kept = new Set(names.flatMap(n => String(n).split(/[^A-Za-zÇĞİIÖŞÜçğıöşü0-9]+/))
                              .filter(Boolean).map(w => w.toLocaleLowerCase('tr')));
    const strays = (r.text.match(/[A-Za-zÇĞİIÖŞÜçğıöşü][A-Za-zÇĞİIÖŞÜçğıöşü0-9]*/g) || [])
                     .filter(w => !kept.has(w.toLocaleLowerCase('tr')));
    assert.deepStrictEqual(strays, [], 'untranslated Latin words in Arabic output: ' + strays.join(', '));
  }
});

/* The fallback is a per-language judgement. The rules can cover an announcement well in one
   language and badly in another, and a reader is owed the honest answer for the language they
   are actually reading — not for English. */
test('an alert the rules cannot carry falls back to Turkish in every language', () => {
  const { bestEffortTranslation, TR_TARGETS } = shippedTranslator();
  for (const tgt of TR_TARGETS) {
    const r = bestEffortTranslation(UNCOVERED, UNCOVERED_NAMES, tgt);
    assert.strictEqual(r.lang, 'tr', tgt + ' claimed to translate wording the rules do not cover');
    assert.strictEqual(r.text, UNCOVERED.trim(),
      tgt + ' altered the Turkish original instead of passing it through');
  }
});

/* Every translation is derived from messageTr. An entry without one can only ever be shown in
   the language it happens to be stored in, which for a hand-written entry means English text
   under an Arabic heading — with nothing to tell the reader why. */
test('every alert in the live feed carries the Turkish original its translations come from', () => {
  const missing = H.json('disruptions.json')
    .filter(d => d.message && !d.messageTr)
    .map(d => d.ref || d.id);
  assert.deepStrictEqual(missing, [],
    'no Turkish original to translate from: ' + missing.join(', '));
});

/* Arabic و ("and") is a proclitic: it is written joined to the word that follows, including a
   Latin station name. The tokeniser therefore sees "وMahmutbey" as a single word, which is in
   neither the Arabic vocabulary nor the list of names, and does not begin with a Latin capital
   — so on the vocabulary test alone it scores as source text nobody translated. Every station
   named after a conjunction quietly cost the alert coverage, and an announcement listing
   enough of them would have been thrown back to Turkish for a reader it was translated for. */
test('an Arabic conjunction joined to a station name is not read as untranslated Turkish', () => {
  const { turkishShare } = shippedTranslator();
  const share = turkishShare('تسير الرحلات بين Çağlayan وMahmutbey.', ['Çağlayan', 'Mahmutbey'], 'ar');
  assert.strictEqual(share, 0,
    'a fused conjunction+name token was counted against translation coverage (share ' + share + ')');
});
