/* The third-party files the app ships itself (V4.3): Leaflet and the three typefaces.
 *
 * Until V4.3 the page loaded Leaflet from unpkg.com and the typefaces from Google Fonts on every visit, which told two companies
 * the address of every visitor and was written nowhere in the privacy documents. They are shipped with the app now. These tests
 * keep that true: the files are exactly the ones whose hashes vendor/README.md records, the stylesheet points at files that exist,
 * and neither the page nor the policy nor the service worker can quietly name a third-party file host again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const VENDOR = path.join(H.ROOT, 'vendor');
const readme = () => fs.readFileSync(path.join(VENDOR, 'README.md'), 'utf8');
const sha384 = file => crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64');

/** The hash a README table row records for a file, looked up by the file's name in backticks. */
function recorded(name) {
  const m = new RegExp('\\|\\s*`' + name.replace(/[.+*?^${}()|[\]\\/]/g, '\\$&') + '`[^\\n]*`([A-Za-z0-9+/=]{64})`').exec(readme());
  return m && m[1];
}
const csp = () => /Content-Security-Policy" content="([^"]+)"/.exec(H.html())[1];
const directive = name => { const m = new RegExp('(?:^|;\\s*)' + name + '\\s([^;]*)').exec(csp()); return m ? m[1].trim() : null; };

test('every typeface file is exactly the one whose hash vendor/README.md records, and nothing unrecorded is shipped', () => {
  const dir = path.join(VENDOR, 'fonts');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.woff2'));
  assert.ok(files.length >= 6, 'the typeface files are missing');
  for (const f of files) {
    const want = recorded(f);
    assert.ok(want, f + ' has no recorded hash in vendor/README.md');
    assert.strictEqual(sha384(path.join(dir, f)), want, f + ' has changed since its hash was recorded');
  }
  const licence = fs.readFileSync(path.join(dir, 'LICENSE-OFL.txt'), 'utf8');
  for (const family of ['Inter', 'Space Grotesk', 'JetBrains Mono']) assert.ok(licence.includes(family), 'LICENSE-OFL.txt does not name ' + family);
  assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i, 'the Open Font Licence text is not shipped beside the fonts');
});

test('Leaflet is exactly the file whose hash vendor/README.md records, with its licence and images', () => {
  const dir = path.join(VENDOR, 'leaflet');
  const names = ['leaflet.js', 'leaflet.css', 'LICENSE', ...['layers', 'layers-2x', 'marker-icon', 'marker-icon-2x', 'marker-shadow'].map(n => 'images/' + n + '.png')];
  for (const f of names) {
    const want = recorded(f);
    assert.ok(want, f + ' has no recorded hash in vendor/README.md');
    assert.strictEqual(sha384(path.join(dir, f)), want, f + ' has changed since its hash was recorded (edited by hand, or upgraded without updating the README)');
  }
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /BSD|Redistribution and use/i, 'the Leaflet licence is not shipped beside it');
});

test('every @font-face file exists, and the two the first paint needs are preloaded', () => {
  const css = H.appStyle();
  const urls = [...css.matchAll(/@font-face\s*\{[^}]*?url\(([^)]+)\)/g)].map(m => m[1].replace(/["']/g, ''));
  assert.ok(urls.length >= 6, 'the page declares ' + urls.length + ' font files, expected all six');
  for (const u of urls) {
    assert.ok(/^vendor\/fonts\/[\w-]+\.woff2$/.test(u), 'a font is not loaded from vendor/fonts: ' + u);
    assert.ok(fs.existsSync(path.join(H.ROOT, u)), 'the stylesheet names a font file that is not there: ' + u);
  }
  const html = H.html();
  for (const f of ['Inter-latin', 'SpaceGrotesk-latin']) {
    assert.ok(new RegExp('<link rel="preload" as="font" type="font/woff2" href="vendor/fonts/' + f + '\\.woff2" crossorigin>').test(html),
      f + ' is not preloaded (a font preload needs crossorigin even from the same host, or the file is fetched twice)');
  }
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) assert.match(m[1], /font-display:\s*swap/, 'a font face blocks the text while it loads');
});

test('every vendor/ file the page names exists', () => {
  const html = H.html();
  const refs = new Set([...html.matchAll(/(?:src|href)="(vendor\/[^"?#]+)/g)].map(m => m[1]));
  assert.ok(refs.has('vendor/leaflet/leaflet.js') && refs.has('vendor/leaflet/leaflet.css'), 'Leaflet is not loaded from vendor/leaflet');
  for (const r of refs) assert.ok(fs.existsSync(path.join(H.ROOT, r)), 'the page names a file that is not shipped: ' + r);
});

test('neither the page, its policy nor its service worker names a third-party file host', () => {
  const html = H.html(), sw = H.read('sw.js');
  for (const host of ['unpkg.com', 'googleapis.com', 'gstatic.com', 'cdnjs.cloudflare.com', 'jsdelivr.net', 'fonts.google']) {
    assert.ok(!html.includes(host), 'the page names ' + host + ' again (a visit would tell it the visitor\'s address)');
    assert.ok(!sw.includes(host), 'the service worker names ' + host);
  }
  const styleSrc = directive('style-src'), fontSrc = directive('font-src'), scriptSrc = directive('script-src');
  assert.ok(!/https?:/.test(styleSrc), 'style-src allows another host: ' + styleSrc);
  assert.ok(!/https?:/.test(fontSrc), 'font-src allows another host: ' + fontSrc);
  assert.ok(!/https?:/.test(scriptSrc), 'script-src allows another host: ' + scriptSrc);
  assert.match(sw, /const STATIC_HOSTS = \[\];/, 'the service worker caches files from another host');
});
