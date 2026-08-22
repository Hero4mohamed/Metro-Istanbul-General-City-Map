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
const SUITE = path.join(ROOT, 'transit_data', 'test', 'structure.test.cjs');

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
    name: 'bake an API key into the page',
    expect: 'no API key is baked into the shipped page',
    apply: h => h.replace('const AI_MODEL',
      'const LEAKED = "sk-ant-abcdef123456";\n  const AI_MODEL'),
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
    out = execFileSync(process.execPath, ['--test', SUITE], {
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
