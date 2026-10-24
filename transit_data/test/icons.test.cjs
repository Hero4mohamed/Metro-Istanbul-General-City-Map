/* The app and website icon (V4.0): the picture the user supplied replaced the old red "M".
 *
 * An icon is easy to break without noticing: a size in the manifest that does not match the file makes Android reject or
 * squash it, a favicon link left pointing at the old inline picture keeps the old icon in browser tabs, and a 600 KB file in the
 * wrong place slows every first visit. These tests read the real files and the real page.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const png = f => {
  const b = fs.readFileSync(path.join(ROOT, f));
  assert.deepStrictEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], f + ' is not a PNG');
  const colourType = b[25];
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length, hasAlpha: colourType === 6 || colourType === 4 };
};

test('the manifest names real files whose sizes are the ones it says', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.icons.length >= 3);
  for (const ic of m.icons) {
    const p = png(ic.src), [w, h] = ic.sizes.split('x').map(Number);
    assert.deepStrictEqual([p.w, p.h], [w, h], ic.src + ' is ' + p.w + 'x' + p.h + ' but the manifest says ' + ic.sizes);
  }
  assert.ok(m.icons.some(i => i.purpose === 'maskable') && m.icons.some(i => i.purpose === 'any'), 'an app needs a plain icon and a maskable one');
});

test('the page links the PNG icons, not the old inline picture, and the Apple icon is the right size', () => {
  const html = H.html();
  assert.ok(/<link rel="icon" type="image\/png" sizes="32x32" href="assets\/favicon-32\.png">/.test(html), 'the 32 px favicon is not linked');
  assert.ok(/<link rel="icon" type="image\/png" sizes="16x16" href="assets\/favicon-16\.png">/.test(html), 'the 16 px favicon is not linked');
  assert.ok(!/<link rel="icon" type="image\/svg\+xml" href="data:/.test(html), 'the old red "M" favicon is still linked');
  assert.ok(/<link rel="apple-touch-icon" href="assets\/apple-touch-icon\.png">/.test(html));
  assert.deepStrictEqual([png('assets/favicon-32.png').w, png('assets/favicon-32.png').h], [32, 32]);
  assert.deepStrictEqual([png('assets/favicon-16.png').w, png('assets/favicon-16.png').h], [16, 16]);
  assert.deepStrictEqual([png('assets/apple-touch-icon.png').w, png('assets/apple-touch-icon.png').h], [180, 180]);
});

test('the full-bleed icons have no see-through corners to show a black or white square; the plain icon keeps its rounded shape', () => {
  // Apple and Android mask these themselves, so a transparent corner would be filled with black or white
  const px = (f, x, y) => { // read one pixel of a 32-bit RGBA PNG by inflating it (small files only: the 180 px Apple icon)
    const zlib = require('node:zlib'); const b = fs.readFileSync(path.join(ROOT, f));
    let pos = 8, idat = [], w = 0, h = 0;
    while (pos < b.length) { const len = b.readUInt32BE(pos), type = b.toString('latin1', pos + 4, pos + 8);
      if (type === 'IHDR') { w = b.readUInt32BE(pos + 8); h = b.readUInt32BE(pos + 12); }
      if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len));
      pos += 12 + len; }
    const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp;
    const rows = []; let prev = Buffer.alloc(stride);
    for (let r = 0; r < h; r++) { const ft = raw[r * (stride + 1)], line = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
      for (let i = 0; i < stride; i++) { const a = i >= bpp ? line[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (ft === 1) v += a; else if (ft === 2) v += up; else if (ft === 3) v += (a + up) >> 1;
        else if (ft === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : ul); }
        line[i] = v & 255; }
      rows.push(line); prev = line; }
    const o = x * bpp; return { r: rows[y][o], g: rows[y][o + 1], b: rows[y][o + 2], a: rows[y][o + 3] };
  };
  for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) assert.strictEqual(px('assets/apple-touch-icon.png', x, y).a, 255, 'the Apple icon has a see-through corner at ' + x + ',' + y);
  assert.ok(px('assets/icon-512.png', 0, 0).a < 20, 'the plain icon lost its rounded corners');
  // the supplied picture has a soft glow around its rounded square; left in, it shows as a faint square haze on a dark background
  for (const [x, y] of [[8, 8], [20, 4], [4, 20], [503, 503], [491, 507], [507, 491]]) assert.ok(px('assets/icon-512.png', x, y).a <= 8, 'a haze is left in the corner of the plain icon at ' + x + ',' + y + ' (alpha ' + px('assets/icon-512.png', x, y).a + ')');
  assert.strictEqual(px('assets/icon-512.png', 256, 256).a, 255, 'the middle of the icon is not solid');
});

test('the mark inside the app (top bar and welcome dialog) is the new icon, not the old drawn "M"', () => {
  const html = H.html();
  assert.ok(/<h1><img class="logo" src="assets\/logo-96\.png" width="30" height="30"/.test(html), 'the top-bar mark is not the new icon');
  assert.ok(/<img class="wc-logo" src="assets\/logo-96\.png" width="44" height="44"/.test(html), 'the welcome-dialog mark is not the new icon');
  assert.ok(!/<svg class="logo"/.test(html) && !/<svg class="wc-logo"/.test(html) && !/id="lgM"/.test(html), 'the old drawn "M" is still in the page');
  assert.deepStrictEqual([png('assets/logo-96.png').w, png('assets/logo-96.png').h], [96, 96]);
  assert.ok(png('assets/logo-96.png').bytes <= 50e3, 'the in-app mark is heavier than it should be for a 30 px picture');
  assert.ok(!fs.existsSync(path.join(ROOT, 'assets', 'logo.svg')), 'the old logo file is back');
});

test('the preview card shown when the link is shared is 1200 x 630, matches the page\'s tags, and carries the new icon', () => {
  const card = png('assets/og-card.png');
  assert.deepStrictEqual([card.w, card.h], [1200, 630]);
  assert.ok(card.bytes < 600e3, 'the card is too heavy for chat apps: ' + card.bytes);
  const html = H.html();
  assert.ok(/og:image" content="https:\/\/hero4mohamed\.github\.io\/Metro-Istanbul-General-City-Map\/assets\/og-card\.png"/.test(html) && /og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html), 'the page tags do not describe the card');
  // the new icon is blue and green and red; the old card had none of the strong blue: sample the icon's middle-left (sea) area
  const zlib = require('node:zlib'); const b = fs.readFileSync(path.join(ROOT, 'assets', 'og-card.png'));
  let pos = 8; const idat = []; while (pos < b.length) { const len = b.readUInt32BE(pos), type = b.toString('latin1', pos + 4, pos + 8); if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len)); pos += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = 1200 * 3 + 1;
  const at = (x, y) => [raw[y * stride + 1 + x * 3], raw[y * stride + 1 + x * 3 + 1], raw[y * stride + 1 + x * 3 + 2]];
  const sea = at(385, 360); assert.ok(sea[2] > sea[0] + 40, 'the icon is not on the card (no blue where the sea should be): ' + sea);
  const corner = at(72, 127), outside = at(40, 100);
  assert.ok(Math.abs(corner[0] - outside[0]) < 40 && Math.abs(corner[2] - outside[2]) < 40, 'the empty corner of the icon shows a box against the glow: ' + corner + ' vs ' + outside);
  const word = at(560, 224); assert.ok(word[0] > 200 && word[1] > 200, 'the wordmark is missing or has moved: ' + word);
});

test('the icon files are not so heavy that they slow a first visit', () => {
  for (const [f, max] of [['assets/icon-192.png', 160e3], ['assets/apple-touch-icon.png', 160e3], ['assets/favicon-32.png', 10e3], ['assets/favicon-16.png', 5e3], ['assets/icon-512.png', 900e3], ['assets/icon-maskable-512.png', 900e3]])
    assert.ok(png(f).bytes <= max, f + ' is ' + png(f).bytes + ' bytes (limit ' + max + ')');
});
