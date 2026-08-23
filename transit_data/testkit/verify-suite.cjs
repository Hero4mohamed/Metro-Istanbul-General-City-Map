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

  /* --- timing engine ---------------------------------------------------------------------
     These reproduce how the planner was wrong before it had a departure oracle, plus the ways
     it could quietly become wrong again. The theme is the same throughout: a confident number
     with nothing behind it is worse than an admitted estimate. */
  {
    // the original defect: every change cost half a headway and none could ever be missed
    name: 'make every change safe so no connection can be missed',
    expect: 'transfer verdicts follow the slack, and a missed connection is reachable',
    apply: h => h.replace("{ id: 'infeasible', maxSlack: 0 },", "{ id: 'safe', maxSlack: 0 },"),
  },
  {
    name: 'take the strongest leg confidence instead of the weakest',
    expect: 'journey confidence is the weakest leg, never an average',
    apply: h => h.replace('if (CONF_RANK[c] < CONF_RANK[worst]) worst = c;',
                          'if (CONF_RANK[c] > CONF_RANK[worst]) worst = c;'),
  },
  {
    name: 'drop the wait cap so one rare bus dominates every route',
    expect: 'expected wait on a frequency is half the headway, and capped',
    apply: h => h.replace('return Math.min(WAIT_CAP_MIN, Math.max(0.5, headwayMin / 2));',
                          'return Math.max(0.5, headwayMin / 2);'),
  },
  {
    name: "read the operator's 24:15 as a quarter past midnight this morning",
    expect: 'operator times past midnight are read as the next day, not rejected',
    apply: h => h.replace('  return h * 60 + mm;', '  return (h * 60 + mm) % 1440;'),
  },
  {
    name: 'badge the modelled arrivals board as LIVE again',
    expect: 'the modelled arrivals board is not badged as live',
    apply: h => h.replace('<span class="modelled" data-i18n="modelled">MODELLED</span>',
                          '<span class="live" data-i18n="live">LIVE</span>'),
  },
  {
    name: 'give a transfer a verdict with no timetable behind it',
    expect: 'a transfer onto a line with no timetable yields no verdict',
    apply: h => h.replace("verdict: 'frequency', departMin: null", "verdict: 'ok', departMin: null"),
  },
  {
    // the mean would call a line with one overnight gap "every four hours"
    name: 'use the mean gap instead of the median',
    expect: 'the typical gap ignores the overnight hole at the ends of a timetable',
    apply: h => h.replace('return gaps[Math.floor(gaps.length / 2)];',
                          'return gaps.reduce((a,b)=>a+b,0)/gaps.length;'),
  },
  {
    // claiming a named train was missed on the strength of an ESTIMATED arrival minute
    name: 'declare a missed connection from an estimated arrival time',
    expect: 'a missed connection is only claimed when both times are known',
    apply: h => h.replace('if (slack < 0 && arrivalExact) {', 'if (slack < 0) {'),
  },
  {
    /* --- trip matching. The failure mode is always the same shape: a confident arrival time
       produced from data that cannot support one. */
    name: 'accept an aliased offset instead of refusing an ambiguous window',
    expect: 'an offset is refused when a whole headway makes two answers equally good',
    apply: h => h.replace('if (secondN > 0 && bestN < secondN * 1.5) return null;', ''),
  },
  {
    name: 'accept a run time only a quarter of the trips agree with',
    expect: 'an offset is refused when the timetables do not really agree',
    apply: h => h.replace('if (support < 0.6) return null;', 'if (support < 0.05) return null;'),
  },
  {
    name: 'derive a run time from two departures',
    expect: 'trip matching declines rather than guessing on thin or missing data',
    apply: h => h.replace('fromTimes.length < 3 || toTimes.length < 3', 'false'),
  },
  {
    // the M1B bug: the operator's terminus is not on our station list, so name and index
    // matching both fail and every leg on the line silently loses its timetable
    name: 'drop the geometric direction fallback',
    expect: 'direction is decided by position or geography, never by terminus name alone',
    apply: h => h.replace('    const c = stationCoordsByName(d.towards);', '    const c = null;'),
  },
  {
    name: 'exclude a direction the operator describes unusually',
    expect: 'direction is decided by position or geography, never by terminus name alone',
    apply: h => h.replace('if (!d || !d.towards) return true;', 'if (!d || !d.towards) return false;'),
  },
  {
    name: 'trip-match a leg even when one end has no usable direction',
    expect: 'a leg that ends at a terminus keeps an estimated arrival',
    apply: h => h.replace('if (!ta || !tb) return null;', 'if (!ta && !tb) return null;'),
  },
  {
    name: 'rate a shut line as a high-confidence departure',
    expect: 'a journey through a shut line does not claim timetable-grade confidence',
    apply: h => h.replace(
      "return { source: 'modeDefault', confidence: 'low', exact: false, headwayMin: null,\n             times: null, next: null, waitMin: null, reason: 'closed', closed };",
      "return { source: 'modeDefault', confidence: 'high', exact: false, headwayMin: null,\n             times: null, next: null, waitMin: null, reason: 'closed', closed };"),
  },
  {
    name: 'put second-level precision back on a modelled arrivals board',
    expect: 'the modelled board does not quote seconds',
    apply: h => h.replace("  return {t:'~'+Math.max(1, Math.round(sec/60))+' '+t('minUnit'), now:false};",
      '  const m=Math.floor(sec/60), s=Math.floor(sec%60);\n' +
      '  return {t:(m>0?m+"m ":"")+String(s).padStart(2,"0")+"s", now:false};'),
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
