/* Security (V4.3). The app has no server and no accounts, so the risks are: outside text turning into running markup, the page being
 * framed, a link giving a site control of the tab, a tampered build step or library, and a policy that quietly lets more through.
 * Each is checked here against the BUILT page and the repository files.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const script = () => H.appScript().replace(/\r\n/g, '\n');
const markup = () => H.html().replace(/\r\n/g, '\n').replace(/<script\b[\s\S]*?<\/script>/g, '');
function fnSource(s, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(s); assert.ok(m, 'function ' + name + ' is not in the built page');
  let i = s.indexOf('{', m.index + m[0].length), d = 0;
  for (; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(m.index, i + 1); }
  throw new Error('unbalanced ' + name);
}
const constLine = (s, name) => { const i = s.indexOf('const ' + name + ' ='); assert.ok(i >= 0, name + ' is missing'); return s.slice(i, s.indexOf('\n', i)); };

/* ---- text from outside is text ---------------------------------------------------------------------------------------------- */
const HOSTILE = [`<img src=x onerror=alert(1)>`, `"><script>alert(2)</script>`, `</div><svg onload=alert(3)>`, `' onmouseover='alert(4)`];
function noticeWorld() {
  const s = script();
  const ctx = vm.createContext({
    SEV_COLOR: { major: '#E5484D', partial: '#F5A623', minor: '#FFD400' }, BUS_COLOR: '#00AA55', colorForLine: () => '#123456', inkOn: () => '#fff', sevLabel: x => String(x), t: k => k,
    disTitle: d => d.title, disMsg: d => d.message, disTrTag: () => '', untilText: d => d.until || '' });
  vm.runInContext([constLine(s, 'svgEsc'), constLine(s, 'attrEsc'), fnSource(s, 'disrTip'), fnSource(s, 'annRowHTML'), fnSource(s, 'annBusGroupHTML')].join('\n'), ctx);
  return ctx;
}
const hostileNotice = p => ({ id: p, ref: p, mode: 'rail', severity: 'major', title: p, message: p, messageTr: p, until: p, route: p, kind: 'info', tpl: null });
/* real tags only (quote-aware), so "onerror=" sitting in escaped TEXT, or inside a quoted attribute value, is not mistaken for a handler */
const tagsOf = html => [...html.matchAll(/<[a-zA-Z][^\s>\/]*(?:"[^"]*"|'[^']*'|[^'">])*>/g)].map(m => m[0]);
const dangerous = html => [
  tagsOf(html).some(t => /^<(?:img|script|svg|iframe|object|embed|link|meta|style)\b/i.test(t)) && 'an injected element',
  /<(?:img|script|svg|iframe|object|embed)\b/i.test(html) && 'markup that survived as text (attrEsc must escape < and >)',
  tagsOf(html).some(t => /\son\w+\s*=/i.test(t.replace(/"[^"]*"|'[^']*'/g, '""'))) && 'an event handler',
  tagsOf(html).some(t => /\s(?:src|href|style)\s*=\s*"[^"]*"\s+\S*="/.test(t) && /"\s*>[^<]*onerror/i.test(t)) && 'a broken-out attribute'].filter(Boolean);

test('notice text from operators and feeds is escaped everywhere it reaches the page: the warning bubble, the announcement rows, the bus groups', () => {
  const w = noticeWorld();
  for (const p of HOSTILE) {
    const n = hostileNotice(p);
    for (const [what, html] of [['disrTip', vm.runInContext('disrTip(' + JSON.stringify(n) + ')', w)], ['annRowHTML', vm.runInContext('annRowHTML(' + JSON.stringify(n) + ')', w)],
        ['annBusGroupHTML', vm.runInContext('annBusGroupHTML({ key: ' + JSON.stringify(p) + ', d: ' + JSON.stringify(n) + ', items: [' + JSON.stringify(n) + '] })', w)]]) {
      const bad = dangerous(html);
      assert.deepStrictEqual(bad, [], what + ' lets "' + p + '" through as ' + bad.join(', ') + ': ' + html.slice(0, 160));
    }
  }
});

test('the live arrivals board escapes what the İBB API sends (times and destinations), and the Overpass, Photon and assistant paths escape names', () => {
  const s = script();
  assert.match(s, /svgEsc\(b\.times\[0\]\)[^\n]*svgEsc\(b\.times\[b\.times\.length-1\]\)/, 'the first and last departure times from the API are printed raw');
  assert.match(s, /→ \$\{svgEsc\(b\.dest\)\}/, 'a destination is printed raw');
  assert.match(s, /\$\{svgEsc\(pl\.name\)\}/, 'a place-search result is printed raw');
  assert.match(s, /svgEsc\(d\.title \|\| ""\)/, 'an assistant notice answer prints a title raw');
});

/* ---- the policy and the page ------------------------------------------------------------------------------------------------ */
const csp = () => /Content-Security-Policy" content="([^"]+)"/.exec(H.html())[1];
const directive = name => { const m = new RegExp('(?:^|;\\s*)' + name + '\\s([^;]*)').exec(csp()); return m ? m[1].trim() : null; };

test('the Content-Security-Policy forbids what the app never does, and allows only https hosts by name', () => {
  assert.strictEqual(directive('default-src'), "'self'");
  for (const [d, v] of [['frame-src', "'none'"], ['media-src', "'none'"], ['object-src', "'none'"], ['form-action', "'none'"], ['base-uri', "'self'"], ['worker-src', "'self'"], ['manifest-src', "'self'"]])
    assert.strictEqual(directive(d), v, d + ' is ' + directive(d) + ', expected ' + v);
  const sc = directive('script-src'); assert.ok(/^'self' 'sha256-[A-Za-z0-9+/=]+'$/.test(sc), 'script-src is not "self" plus one hash: ' + sc);
  for (const d of ['connect-src', 'img-src', 'font-src', 'style-src']) {
    const v = directive(d); assert.ok(v, d + ' is missing');
    assert.ok(!/(^|\s)\*(\s|$)|https?:\/\/\*|\bhttp:/.test(v), d + ' allows a wildcard or plain http: ' + v);
  }
  assert.ok(!/unsafe-eval|unsafe-hashes|\bblob:.*script/.test(csp()), 'the policy allows eval');
});

test('the page sets its referrer policy (origin only to other sites), and the legal pages send none', () => {
  assert.match(H.html(), /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  for (const f of fs.readdirSync(path.join(H.ROOT, 'legal'))) if (f.endsWith('.html')) assert.match(fs.readFileSync(path.join(H.ROOT, 'legal', f), 'utf8'), /<meta name="referrer" content="no-referrer">/, f + ' has no referrer policy');
});

test('the app takes over the window if it is framed, and hides itself if the browser will not let it (clickjacking)', () => {
  const s = script(), i = s.indexOf('if (window.top !== window.self) {');
  assert.ok(i > 0, 'there is no frame-busting code');
  assert.ok(s.indexOf('addEventListener("error"') < i && i < s.indexOf('const CITIES = '), 'the frame-buster is not between the error handlers and the app code');
  const code = s.slice(i, s.indexOf('\n}', i) + 2);
  const run = (framed, canNavigate) => {
    const nav = []; const self = { location: { href: 'https://site/app' } }, style = {};
    const top = framed ? { location: { set href(v) { if (!canNavigate) throw new Error('blocked'); nav.push(v); } } } : self;
    self.top = top; self.self = self;
    vm.runInContext(code, vm.createContext({ window: self, document: { documentElement: { style } } }));
    return { nav, hidden: style.display === 'none' };
  };
  assert.deepStrictEqual(run(false, true), { nav: [], hidden: false }, 'a page that is not framed was touched');
  assert.deepStrictEqual(run(true, true), { nav: ['https://site/app'], hidden: false }, 'a framed page did not take over the window');
  assert.deepStrictEqual(run(true, false), { nav: [], hidden: true }, 'a framed page that cannot break out did not hide itself');
});

test('the app uses no way of running a string as code, and no javascript: link', () => {
  const s = H.appScript();
  for (const re of [/\beval\s*\(/, /\bnew Function\s*\(/, /\bdocument\.write\s*\(/, /javascript:/i, /\bsetTimeout\s*\(\s*['"`]/, /\bsetInterval\s*\(\s*['"`]/, /\.outerHTML\s*=/, /\bexecScript\b/, /\bsrcdoc\b/])
    assert.ok(!re.test(s), 'the app script contains ' + re);
  assert.ok(!/<iframe|<object|<embed|<applet/i.test(markup()), 'the page embeds something');
});

test('every link that opens another site keeps it from controlling this tab, and none is plain http', () => {
  const pages = [markup()].concat(fs.readdirSync(path.join(H.ROOT, 'legal')).filter(f => f.endsWith('.html')).map(f => fs.readFileSync(path.join(H.ROOT, 'legal', f), 'utf8')));
  const inScript = [...script().matchAll(/<a\b[^>]*>/g)].map(m => m[0]);
  const tags = pages.flatMap(h => [...h.matchAll(/<a\b[^>]*>/g)].map(m => m[0])).concat(inScript);
  assert.ok(tags.length > 40, 'found only ' + tags.length + ' links');
  for (const t of tags) {
    if (/target="_blank"/.test(t)) assert.match(t, /rel="[^"]*noopener/, 'a link opens a new tab without noopener: ' + t.slice(0, 100));
    const href = (/href="([^"]*)"/.exec(t) || [])[1] || '';
    assert.ok(!/^http:\/\//i.test(href), 'a plain http link: ' + href);
  }
  for (const m of script().matchAll(/window\.open\(([^)]*)\)/g)) assert.match(m[1], /noopener/, 'window.open without noopener: ' + m[0]);
});

/* ---- the repository ---------------------------------------------------------------------------------------------------- */
test('every GitHub Action is pinned to an exact commit, every workflow limits its token, and nothing runs untrusted code with secrets', () => {
  const dir = path.join(H.ROOT, '.github', 'workflows'), files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 8, 'found only ' + files.length + ' workflows');
  for (const f of files) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of y.matchAll(/uses:\s*([^\s#]+)/g)) if (!m[1].startsWith('./')) assert.match(m[1], /@[0-9a-f]{40}$/, f + ': ' + m[1] + ' is pinned to a movable tag, not a commit');
    assert.match(y, /^permissions:/m, f + ' does not limit the token it gets');
    assert.ok(!/pull_request_target/.test(y), f + ' runs with secrets on code from a pull request');
  }
  const dep = fs.readFileSync(path.join(H.ROOT, '.github', 'dependabot.yml'), 'utf8');
  assert.match(dep, /package-ecosystem:\s*"github-actions"/, 'Dependabot is not watching the pinned actions');
});

test('SECURITY.md says how to report a vulnerability privately, and the contact is the one on the legal pages', () => {
  const md = fs.readFileSync(path.join(H.ROOT, 'SECURITY.md'), 'utf8'), cfg = H.json('legal-config.json');
  assert.ok(md.includes(cfg.contactEmail), 'SECURITY.md does not carry the contact address');
  assert.match(md, /do not open a public issue/i); assert.match(md, /Report a vulnerability/); assert.match(md, /frame-src 'none'/);
});

test('no secret-shaped string is anywhere in the committed files that ship or run', () => {
  const bad = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', '.claude', 'vendor'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|cjs|json|ya?ml|md|webmanifest|txt)$/.test(e.name) && fs.statSync(p).size < 4e6) { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/sk-ant-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,}/g)) bad.push(path.relative(H.ROOT, p) + ': ' + m[0].slice(0, 12) + '…'); } } };
  walk(H.ROOT);
  assert.deepStrictEqual(bad, [], 'secret-shaped strings found');
});
