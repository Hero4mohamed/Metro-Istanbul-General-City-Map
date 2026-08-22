/* Shared loaders for the test suite.
 *
 * Everything here reads the BUILT artifact (index.html + sw.js), not the template. The
 * template is the source you edit; index.html is what a user actually receives, and every
 * outage this project has had was a defect that existed only after the build step ran.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'transit_data');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readData = f => fs.readFileSync(path.join(DATA, f), 'utf8');
const json = f => JSON.parse(readData(f));
const exists = p => fs.existsSync(path.join(ROOT, p));

// RAYNET_HTML lets the mutation check point the suite at a deliberately broken copy, so we can
// prove each test fails when its defect is present. A green suite that cannot fail proves nothing.
let _html = null;
const html = () => (_html ??= process.env.RAYNET_HTML
  ? fs.readFileSync(process.env.RAYNET_HTML, 'utf8')
  : read('index.html'));

/** The one inline <script> that is the entire application. */
function appScript() {
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html());
  if (!m) throw new Error('no inline <script> found in index.html');
  return m[1];
}

/** The one <style> block. */
function appStyle() {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html());
  if (!m) throw new Error('no <style> found in index.html');
  return m[1];
}

/** Cities as the app sees them, evaluated out of the built page. */
let _cities = null;
function cities() {
  if (_cities) return _cities;
  const m = /const CITIES\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html());
  if (!m) throw new Error('CITIES literal not found in index.html');
  return (_cities = eval('(' + m[1] + ')'));   // our own build output, not third-party input
}

/** Every i18n dictionary in the built page, keyed by language code. */
function i18n() {
  const s = appScript();
  const start = s.indexOf('const I18N');
  if (start < 0) throw new Error('I18N not found');
  const out = {};
  // each dictionary opens with `  en:{` / `  tr:{` at a known indent inside I18N
  const re = /\n\s{2,4}([a-z]{2}):\s*\{/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(s))) {
    const lang = m[1];
    let i = s.indexOf('{', m.index + m[0].length - 1), depth = 0, end = -1;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    const body = s.slice(i + 1, end);
    const keys = new Set();
    for (const km of body.matchAll(/(?:^|[,{]\s*)\n?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.add(km[1]);
    out[lang] = keys;
    if (Object.keys(out).length > 12) break;      // I18N holds a handful of languages, not dozens
  }
  return out;
}

/**
 * Executable code only: comments and literal string bodies blanked out, so a scanner does not
 * mistake prose for source. `${...}` interpolations inside template literals are KEPT — a large
 * share of this codebase's real calls live in there, and dropping them would hide true defects.
 * Regex literals are skipped too, since alternations like /(a|b)/ read as calls otherwise.
 */
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // a '/' starts a regex (not a division) when the last meaningful char opens an expression
  const REGEX_OK = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n']);
  let lastReal = '\n';

  const skipString = (quote) => {
    i++;                                        // opening quote
    while (i < n && src[i] !== quote) {
      if (src[i] === '\\') { i += 2; continue; }
      if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        out += ' ';
        i += 2;
        let depth = 1;
        const start = i;
        while (i < n && depth > 0) {            // copy the interpolation through verbatim
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          if (depth > 0) i++;
        }
        out += src.slice(start, i);
        i++;                                    // closing }
        continue;
      }
      i++;
    }
    i++;                                        // closing quote
    out += ' ';
  };

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') { skipString(c); lastReal = '"'; continue; }
    if (c === '/' && REGEX_OK.has(lastReal)) {  // regex literal
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '[') inClass = true;
        else if (e === ']') inClass = false;
        else if (e === '/' && !inClass) { closed = true; break; }
        else if (e === '\n') break;
        j++;
      }
      if (closed) { i = j + 1; while (i < n && /[a-z]/.test(src[i])) i++; out += ' '; lastReal = ')'; continue; }
    }
    out += c;
    if (!/\s/.test(c)) lastReal = c;
    i++;
  }
  return out;
}

module.exports = { ROOT, DATA, read, readData, json, exists, html, appScript, appStyle, cities, i18n, codeOnly };
