/* Mutation check: does the suite actually catch the defects it claims to?
 *
 * Each mutation reintroduces a bug that really shipped. We break a COPY of index.html, run the
 * suite against it, and require the named test to fail. A suite that stays green no matter what
 * you do to the build is worse than no suite, because it buys false confidence.
 *
 * Two of these mutations were themselves wrong on the first attempt, and the check caught that
 * too: one anchored on a function form that does not exist, and one stripped SRI from the CSS
 * link rather than the script. That is the point — the mutations are tested as much as the tests.
 *
 * Usage: node transit_data/test/verify-suite.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'index.html');
const TMP = path.join(os.tmpdir(), 'raynet-mutant.html');
const TESTS = path.join(ROOT, 'transit_data', 'test');
const SUITES = fs.readdirSync(TESTS).filter(f => f.endsWith('.test.cjs')).map(f => path.join(TESTS, f));

const SRI_ON_SCRIPT = new RegExp('(<script[^>]+unpkg\\.com[^>]*?)\\s+integrity="[^"]*"');

const MUTATIONS = [
  {
    name: 'corrupt a statement (the "$&" splice that killed the whole app)',
    expect: 'the inline application script parses',
    apply: h => h.replace('const svgEsc = s =>', 'const svgEsc = s => ) BROKEN'),
  },
  {
    name: 'drop a CSS comment terminator',
    expect: 'CSS comments and braces balance',
    apply: h => h.replace('/* Right control stack */', '/* Right control stack'),
  },
  {
    name: 'call a function that does not exist (the escapeHtml regression)',
    expect: 'no call to an undefined global',
    apply: h => h.replace('svgEsc(t("aiNoIdea"))', 'escapeHtml(t("aiNoIdea"))'),
  },
  {
    name: 'rename an element the script binds to',
    expect: 'every getElementById target exists in the markup',
    apply: h => h.replace('id="aiOrb"', 'id="aiOrbRenamed"'),
  },
  {
    name: 'strip Subresource Integrity from the Leaflet script',
    expect: 'every CDN resource is integrity-pinned',
    apply: h => h.replace(SRI_ON_SCRIPT, (m, keep) => keep),
  },
  {
    name: 'leave a build token unreplaced',
    expect: 'no build tokens survive into the shipped page',
    apply: h => h.replace('const OPENINGS',
      'const OPENINGS_PLACEHOLDER = __OPENINGS_JSON__;\nconst OPENINGS'),
  },
  {
    name: 'drop a CDN host from the directive that governs it',
    expect: 'every host the page loads from is permitted by the RIGHT directive',
    // the exact first-attempt CSP bug: the host stayed in script-src, so a whole-policy
    // check saw it and stayed green while every stylesheet was blocked
    apply: h => h.replace(new RegExp('(style-src[^;]*?) https://unpkg\\.com'), (m, keep) => keep),
  },
  {
    name: 'hash the bytes on disk instead of the text the parser sees',
    expect: 'the script hash matches the script the parser will see',
    apply: h => h.replace(/(script-src [^;]*)'sha256-[^']*'/, (m, keep) => keep + "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"),
  },
  {
    name: 'bake an API key into the page',
    expect: 'no API key is baked into the shipped page',
    apply: h => h.replace('const AI_MODEL',
      'const LEAKED = "sk-ant-abcdef123456";\n  const AI_MODEL'),
  },
  {
    // renaming a landmark breaks its Turkish aliases silently: nothing throws, the alias just
    // stops matching anything and Turkish speakers quietly lose the place
    name: 'rename a landmark out from under its Turkish aliases',
    expect: 'every search alias points at a landmark that still exists',
    apply: h => h.replace("'Galata Tower':", "'Galata Tower (old)':"),
  },
  {
    name: 'add an alias that just repeats the name it points at',
    expect: 'no search alias merely repeats the name it points at',
    apply: h => h.replace(/('Galata Tower':\s*\['Galata Kulesi')\]/,
                          (m, keep) => keep + ", 'Galata Tower']"),
  },
  {
    /* Reproduce the defect as it actually shipped: no locative rule, and the general rule left
       unanchored. Either half alone is now survivable — the \b stops the mangling even with the
       locative gone — so the mutation has to undo both to prove the check still bites. */
    name: 'restore the unanchored rule that rendered "istasyonunda" as "stationnda"',
    expect: 'the disruption translator never welds a Turkish suffix onto an English word',
    apply: h => h
      .replace("[/[İi]stasyon(?:umuz|u)?nda\\b/gi, 'at the station'], [/[İi]stasyonda\\b/gi, 'at the station'],", '')
      .replace("[/[İi]stasyon(?:umuz|u)?\\b/gi, 'station'],", "[/[İi]stasyon(?:umuz|u)?/gi, 'station'],"),
  },
  {
    // a rule that deletes the ending instead of translating it: nothing is mangled, but the
    // meaning is gone — which the mangle check alone would not notice
    name: 'translate a case ending to nothing instead of to English',
    expect: 'the disruption translator resolves the Turkish case endings it claims to',
    apply: h => h.replace("[/[İi]stasyon(?:umuz|u)?ndan\\b/gi, 'from the station']",
                          "[/[İi]stasyon(?:umuz|u)?ndan\\b/gi, 'station']"),
  },
  /* The four ways the coverage fallback can be got wrong. It decides whether an alert is
     shown in English or in the operator's own Turkish, so both directions of the threshold
     matter, and so does what the "Turkish" branch actually hands back. */
  {
    // too loose: back to shipping "Sanayi at the station bir yolcunun … has been closed."
    name: 'let a half-translated alert through as English',
    expect: 'an alert the rules cannot carry into English is shown in Turkish, not as a hybrid',
    apply: h => h.replace('const TR_FALLBACK_SHARE = 0.25;', 'const TR_FALLBACK_SHARE = 1;'),
  },
  {
    // too tight: one surviving word now condemns an otherwise good translation, and English
    // readers lose every alert the app CAN translate — a quieter failure than the hybrid
    name: 'tighten the coverage threshold until good translations are thrown away',
    expect: 'an alert the rules do cover is still translated',
    apply: h => h.replace('const TR_FALLBACK_SHARE = 0.25;', 'const TR_FALLBACK_SHARE = 0.1;'),
  },
  {
    // the fallback labels the text as the Turkish original but returns the hybrid: the same
    // defect wearing a badge, and invisible to any check that only looks at the label
    name: 'label the hybrid as the Turkish original instead of returning the original',
    expect: 'the Turkish fallback is the untouched original, never a rewrite',
    apply: h => h.replace("? { text:src, lang:'tr', share:share }", "? { text:en, lang:'tr', share:share }"),
  },
  {
    // station names pass through the translator untouched by design; counting them as
    // untranslated Turkish makes an alert score worse the more places it names
    name: 'count proper nouns as untranslated Turkish',
    expect: 'station and line names do not count against translation coverage',
    apply: h => h.replace('    if(TR_CAPPED.test(w)) continue;', '    if(false) continue;'),
  },
];

const original = fs.readFileSync(SRC, 'utf8');
let caughtCount = 0;
const problems = [];

console.log('Mutation check - each row must FAIL the named test.\n');

for (const m of MUTATIONS) {
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log('  ??  ' + m.name);
    console.log('      SKIPPED - the anchor no longer exists in index.html; update the mutation.');
    problems.push(m.name + ' (stale anchor)');
    continue;
  }
  fs.writeFileSync(TMP, mutated);

  let out = '';
  try {
    out = execFileSync(process.execPath, ['--test', ...SUITES], {
      cwd: ROOT,
      env: { ...process.env, RAYNET_HTML: TMP },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }

  const escaped = m.expect.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch);
  const caught = new RegExp('^not ok \\d+ - ' + escaped, 'm').test(out);
  if (caught) {
    console.log('  ok  ' + m.name);
    console.log('      caught by: "' + m.expect + '"');
    caughtCount++;
  } else {
    console.log('  !!  ' + m.name);
    console.log('      expected "' + m.expect + '" to fail, but the suite stayed green');
    problems.push(m.name + ' (not caught)');
  }
}

try { fs.unlinkSync(TMP); } catch { /* best effort */ }

console.log('\n' + caughtCount + '/' + MUTATIONS.length + ' defects caught');
if (problems.length) {
  console.log('unresolved:\n  - ' + problems.join('\n  - '));
}
process.exit(problems.length ? 1 : 0);
