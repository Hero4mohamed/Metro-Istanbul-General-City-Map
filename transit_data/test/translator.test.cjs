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
  new Function('module', 'exports', html.slice(a, b) + '\nmodule.exports={translateTR};')(mod, mod.exports);
  return mod.exports.translateTR;
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
  const translateTR = shippedTranslator();
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
  const translateTR = shippedTranslator();
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
