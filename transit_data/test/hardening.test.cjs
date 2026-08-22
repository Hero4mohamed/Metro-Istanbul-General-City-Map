/* Content-Security-Policy, licensing and diagnostics.
 *
 * The CSP checks exist because the first policy I shipped blocked the entire application in two
 * different ways at once, and only a browser run revealed it. These make both failures static.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const H = require('../testkit/helpers.cjs');

const csp = () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(H.html());
  return m ? m[1] : null;
};
const directive = name => {
  const m = new RegExp('(?:^|;\\s*)' + name + '\\s([^;]*)').exec(csp() || '');
  return m ? m[1].trim() : null;
};

test('the page ships a Content-Security-Policy', () => {
  assert.ok(csp(), 'no CSP meta tag — build.cjs should substitute __CSP__');
});

/* The hash must be of the text the PARSER sees. This repo checks out with CRLF on Windows, and
   the HTML parser normalises CRLF to LF before hashing — so hashing the bytes on disk yields a
   policy that blocks the whole app while looking perfectly correct in the source. */
test('the script hash matches the script the parser will see', () => {
  const script = H.appScript();
  const parsed = script.split('\r\n').join('\n');
  const want = "'sha256-" + crypto.createHash('sha256').update(parsed, 'utf8').digest('base64') + "'";
  const got = directive('script-src') || '';
  assert.ok(got.includes(want),
    'script-src does not carry the hash of the parsed script.\n  expected: ' + want + '\n  policy:   ' + got);
});

test('script-src grants neither unsafe-inline nor unsafe-eval', () => {
  const s = directive('script-src') || '';
  assert.ok(!s.includes("'unsafe-eval'"), "script-src grants 'unsafe-eval'");
  // a hash is present, so 'unsafe-inline' would be ignored by CSP3 browsers anyway — but its
  // presence would mean someone gave up on the hash, which is the whole point of this policy
  assert.ok(!s.includes("'unsafe-inline'"), "script-src grants 'unsafe-inline' — the hash is then pointless");
});

test('no inline event handlers, which no hash can ever allow', () => {
  const found = (H.html().match(/\son(?:click|load|error|change|input|submit|mouse\w+|key\w+)=/g) || []);
  assert.deepStrictEqual(found, [], found.length + ' inline handler(s) — delegate them instead');
});

/* The failure this is really for: adding a new API or CDN and forgetting the policy. The first
   version of the CSP omitted Leaflet's stylesheet host and the app rendered unstyled. */
test('every host the page loads from is permitted by the RIGHT directive', () => {
  const html = H.html();
  // Per-directive, not "anywhere in the policy". Checking the whole string is useless: when
  // style-src lost unpkg, the host was still listed under script-src and a whole-policy check
  // stayed green while the app rendered unstyled.
  const wanted = [];   // {origin, directive, what}

  for (const m of html.matchAll(/<script[^>]+src="(https:\/\/[^"/]+)/g)) {
    wanted.push({ origin: m[1], directive: 'script-src', what: 'script' });
  }
  for (const m of html.matchAll(/<link([^>]+)>/g)) {
    const tag = m[1];
    if (!/rel="[^"]*stylesheet/.test(tag)) continue;      // preconnect/icon are not CSP-governed
    const href = /href="(https:\/\/[^"/]+)/.exec(tag);
    if (href) wanted.push({ origin: href[1], directive: 'style-src', what: 'stylesheet' });
  }
  for (const m of H.codeOnly(H.appScript()).matchAll(/fetch\(\s*["'](https:\/\/[^"'/]+)/g)) {
    wanted.push({ origin: m[1], directive: 'connect-src', what: 'fetch' });
  }
  // Leaflet substitutes {s} with a real subdomain, so "{s}.example.com" is a request to some
  // *.example.com. Tiles load as <img>, and the offline save re-fetches them, so both apply.
  for (const m of H.appScript().matchAll(/L\.tileLayer\(\s*["']https:\/\/([^"'/]+)/g)) {
    const origin = 'https://' + m[1].replace(/^\{s\}\./, '*.');
    wanted.push({ origin, directive: 'img-src', what: 'tile' });
    wanted.push({ origin, directive: 'connect-src', what: 'tile prefetch' });
  }

  const allowedBy = (dir, origin) => {
    const list = directive(dir) || directive('default-src') || '';
    if (list.includes(origin)) return true;
    const host = origin.replace('https://', '');
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (list.includes('https://*.' + parts.slice(i).join('.'))) return true;
    }
    return false;
  };

  const missing = wanted
    .filter(w => !allowedBy(w.directive, w.origin))
    .map(w => w.what + ' ' + w.origin + ' not allowed by ' + w.directive);
  assert.deepStrictEqual([...new Set(missing)], [], missing.join('; '));
});

/* --- licensing ------------------------------------------------------------------------ */
test('the repository states its licence and its data terms', () => {
  assert.ok(H.exists('LICENSE'), 'no LICENSE file');
  assert.ok(H.exists('DATA-SOURCES.md'), 'no DATA-SOURCES.md');
  const lic = H.read('LICENSE');
  assert.match(lic, /MIT License/, 'LICENSE is not the MIT text');
  // the data is ODbL-derived; a bare MIT file would misstate what the repository grants
  assert.match(lic, /SOURCE CODE ONLY/i, 'LICENSE does not carve the data out of the code grant');
  assert.match(H.read('DATA-SOURCES.md'), /Open Database Licence|ODbL/,
    'DATA-SOURCES.md does not mention the ODbL obligation on OSM-derived data');
});

/* --- diagnostics ----------------------------------------------------------------------- */
test('fault capture is installed, and before anything can throw', () => {
  const s = H.appScript();
  assert.match(s, /addEventListener\("error"/, 'no window error handler');
  assert.match(s, /addEventListener\("unhandledrejection"/, 'no unhandled-rejection handler');
  // a handler installed halfway down the file cannot catch a fault during boot
  const at = s.indexOf('addEventListener("error"');
  assert.ok(at > -1 && at < 4000,
    'the error handler is ' + at + ' chars in — install it at the top so boot faults are caught');
});

test('a problem report cannot carry personal data', () => {
  const code = H.codeOnly(H.appScript());
  const fn = /function diagReportText\(\)\{[\s\S]*?\n\}/.exec(code);
  assert.ok(fn, 'diagReportText() not found');
  const body = fn[0];
  for (const forbidden of ['irn_home', 'irn_work', 'irn_trips', 'irn_ai_key', 'geoPos', 'irn_advfavs']) {
    assert.ok(!body.includes(forbidden),
      'the problem report reads ' + forbidden + ' — reports must never carry location, saved places or the key');
  }
});
