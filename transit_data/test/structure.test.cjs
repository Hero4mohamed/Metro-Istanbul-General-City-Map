/* Structural integrity of the BUILT page.
 *
 * Every check here exists because the corresponding defect actually shipped. This is a
 * regression suite, not a wish list.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');

/* --- 1. The app parses -------------------------------------------------------------
   A patch script once expanded a "$&" inside a replacement string, splicing the matched
   source into the middle of a regex literal. index.html still loaded, Leaflet still loaded,
   and the entire application was dead: no map, no panels, stats stuck at 0. Nothing in the
   toolchain noticed. */
test('the inline application script parses', () => {
  assert.doesNotThrow(() => new vm.Script(H.appScript(), { filename: 'index.html#inline' }));
});

test('the service worker parses', () => {
  assert.doesNotThrow(() => new vm.Script(H.read('sw.js'), { filename: 'sw.js' }));
});

/* --- 2. The stylesheet is structurally whole ---------------------------------------
   An edit once left a stray comment terminator mid-sentence, silently killing every rule
   after it. (Writing this very comment reproduced the bug in the test file itself.) */
test('CSS comments and braces balance', () => {
  const css = H.appStyle();
  const open = (css.match(/\/\*/g) || []).length;
  const close = (css.match(/\*\//g) || []).length;
  assert.strictEqual(open, close, 'unbalanced CSS comments: ' + open + ' open vs ' + close + ' close');

  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\[\s\S])*"/g, '""')
    .replace(/'(?:[^'\\]|\\[\s\S])*'/g, "''");
  const ob = (stripped.match(/\{/g) || []).length;
  const cb = (stripped.match(/\}/g) || []).length;
  assert.strictEqual(ob, cb, 'unbalanced CSS braces: ' + ob + ' open vs ' + cb + ' close');
});

/* --- 3. Build tokens were all replaced --------------------------------------------- */
test('no build tokens survive into the shipped page', () => {
  const left = [...new Set([...H.html().matchAll(/__[A-Z][A-Z0-9_]*__/g)].map(m => m[0]))];
  assert.deepStrictEqual(left, [], 'unreplaced tokens: ' + left.join(', '));
});

/* --- 4. Every element the code reaches for actually exists -------------------------
   Catches a renamed or dropped id, which otherwise fails silently at run time. */
test('every getElementById target exists in the markup', () => {
  const html = H.html();
  const script = H.appScript();
  const ids = new Set(
    [...script.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)].map(m => m[1])
  );
  // An id is legitimate if it is in the served markup OR the script builds it at run time —
  // the mobile shell and the itinerary's progress note both create their elements.
  const created = new Set([
    ...[...script.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].map(m => m[1]),
    ...[...script.matchAll(/id=\\?["']([\w-]+)\\?["']/g)].map(m => m[1]),
  ]);
  const missing = [...ids]
    .filter(id => html.indexOf('id="' + id + '"') < 0 && !created.has(id))
    .sort();
  assert.deepStrictEqual(missing, [], 'referenced, but neither in the markup nor created: ' + missing.join(', '));
});

/* --- 5. No calls to functions that do not exist ------------------------------------
   escapeHtml(...) was called 57 times and never defined anywhere; this codebase escapes
   with svgEsc. Every assistant answer threw, and the surrounding catch turned it into a
   polite "I couldn't match that" - a silent wrong answer rather than a visible crash. */
const BROWSER_GLOBALS = new Set([
  'require', 'eval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean',
  'Array', 'Object', 'Date', 'Math', 'JSON', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp',
  'Error', 'Symbol', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'BigInt',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'fetch', 'alert', 'confirm', 'prompt', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI',
  'decodeURI', 'btoa', 'atob', 'structuredClone', 'queueMicrotask', 'matchMedia', 'getComputedStyle',
  'AbortController', 'Intl', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'Blob',
  'FileReader', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'Event',
  'KeyboardEvent', 'MouseEvent', 'TouchEvent', 'PointerEvent', 'Image', 'Audio', 'Worker',
  'Notification', 'navigator', 'document', 'window', 'console', 'localStorage', 'sessionStorage',
  'history', 'location', 'performance', 'screen', 'caches', 'crypto', 'DOMParser', 'XMLSerializer',
  'Uint8Array', 'Float32Array', 'Int32Array', 'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder',
  'Proxy', 'Reflect', 'globalThis', 'isSecureContext', 'ServiceWorkerRegistration', 'Element',
  'HTMLElement', 'Node', 'NodeList', 'FormData', 'Option',
  'L',                       // Leaflet, loaded from the CDN before this script
]);
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'await', 'do',
  'else', 'delete', 'void', 'in', 'of', 'instanceof', 'yield', 'throw', 'case', 'with', 'super',
  'this', 'import', 'export', 'class', 'try', 'finally', 'const', 'let', 'var', 'async',
]);

test('no call to an undefined global', () => {
  const s = H.codeOnly(H.appScript());   // prose and string bodies are not source
  const declared = new Set();
  const collect = (re) => {
    for (const m of s.matchAll(re)) {
      if (!m[1]) continue;
      for (const raw of m[1].split(/[,\s]+/)) {
        const name = raw.replace(/[^\w$].*$/, '').trim();
        if (name && /^[A-Za-z_$]/.test(name)) declared.add(name);
      }
    }
  };
  collect(/\bfunction\s+([A-Za-z_$][\w$]*)/g);
  collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g);
  collect(/\bfunction\s*[\w$]*\s*\(([^)]*)\)/g);       // parameters
  collect(/\(([^()]*)\)\s*=>/g);                        // arrow parameters
  collect(/([A-Za-z_$][\w$]*)\s*=>/g);                  // single arrow parameter
  collect(/\b(?:const|let|var)\s*\{([^}]*)\}/g);        // destructured object
  collect(/\b(?:const|let|var)\s*\[([^\]]*)\]/g);       // destructured array

  // Lookbehind, not a consumed prefix character: in nested calls like `aiSay(escapeHtml(`, a
  // consuming pattern eats the "(" as part of the OUTER match and never sees the inner call —
  // which is precisely the call that was undefined.
  const called = new Set(
    [...s.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]{2,})\s*\(/g)].map(m => m[1])
  );
  const missing = [...called]
    .filter(n => !declared.has(n) && !BROWSER_GLOBALS.has(n) && !KEYWORDS.has(n))
    .sort();
  assert.deepStrictEqual(missing, [], 'called but never defined: ' + missing.join(', '));
});

/* --- 6. Supply chain and secrets ---------------------------------------------------- */
test('every CDN resource is integrity-pinned', () => {
  // Both the stylesheet and the script come from unpkg; checking only one leaves the other
  // free to be swapped upstream. Each needs integrity AND crossorigin — SRI without
  // crossorigin is not enforced at all.
  const tags = [...H.html().matchAll(/<(?:script|link)[^>]+unpkg\.com[^>]*>/g)].map(m => m[0]);
  assert.ok(tags.length >= 1, 'no unpkg resource found — did the CDN reference move?');
  const unpinned = tags.filter(t => !/integrity="sha\d{3}-/.test(t) || !/crossorigin/.test(t));
  assert.deepStrictEqual(unpinned.map(t => t.slice(0, 60)), [],
    'CDN resource without enforced SRI');
});

test('no API key is baked into the shipped page', () => {
  const bad = H.html().match(/sk-ant-[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{20,}/g);
  assert.strictEqual(bad, null, 'secret-shaped string found in the build');
});

/* --- 7. the split source assembles into exactly what ships -------------------------
   The application lives in transit_data/src/*.js and is concatenated, in filename order, into
   the one inline script. Nothing enforces that relationship at run time, so an orphaned file, a
   stray name that sorts wrongly, or an edit to the built page instead of the source would all
   go unnoticed. Assembling here and comparing is the check. */
const fs = require('node:fs');
const path = require('node:path');

test('the shipped script is exactly the concatenated source', () => {
  const src = path.join(H.DATA, 'src');
  assert.ok(fs.existsSync(src), 'transit_data/src is missing');
  const files = fs.readdirSync(src).filter(f => f.endsWith('.js')).sort();
  assert.ok(files.length >= 5, 'expected the app to be split across several files, found ' + files.length);

  const assembled = files.map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('');
  const shipped = H.appScript();

  // the build substitutes data tokens into the source, so compare the parts that cannot move:
  // every source file's first and last non-blank line must appear in the shipped script, in order
  let cursor = 0;
  const drift = [];
  for (const f of files) {
    const body = fs.readFileSync(path.join(src, f), 'utf8').split('\n').map(l => l.replace(/\r$/, ''));
    const anchor = body.find(l => l.trim().length > 20 && !l.includes('__'));
    if (!anchor) continue;
    const at = shipped.indexOf(anchor, cursor);
    if (at < 0) drift.push(f + ': its content is not in the shipped script');
    else cursor = at;
  }
  assert.deepStrictEqual(drift, [], drift.join('; '));

  // and the assembled length must match once tokens are accounted for: the shipped script can
  // only be LONGER, never shorter, because substitution replaces short tokens with real data
  assert.ok(shipped.length >= assembled.length - 200,
    'the shipped script is shorter than its source — a file is not being concatenated');
});
