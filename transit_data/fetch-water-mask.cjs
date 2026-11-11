#!/usr/bin/env node
'use strict';
/* Builds water-mask.json: where the sea is, as the app's own base map draws it.
 *
 * Why: ferry lines are drawn pier to pier over a base map, and "over water" has to mean the water THE USER SEES. The first ferry
 * builder judged land by the nearest OpenStreetMap coastline segment, which goes wrong at islands, breakwaters and harbour walls,
 * and nothing checked the result, so lines crossed Moda, Sarayburnu and the islands. This takes the water polygons out of the very
 * vector tiles the map is drawn from (OpenFreeMap, OpenMapTiles schema, zoom 14 = the most detailed they carry) and turns them into
 * a small bitmap: one bit per ~15 m square, 1 = water.
 *
 *   node transit_data/fetch-water-mask.cjs            (needs the network; about 170 small files, four at a time)
 *
 * The result is committed, so the build (ferry-water.cjs) and the test that keeps every ferry line on water
 * (test/ferry.test.cjs) need no network. Data: (c) OpenStreetMap contributors, ODbL; tiles (c) OpenMapTiles; both credited in the app.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const DIR = __dirname;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
const PX = 128;                                  // mask cells per tile side (a z14 tile is ~1.85 km here, so ~14.5 m a cell)
/* every pier of every ferry line in each city that has ferries, with room to route around headlands and islands */
const REGIONS = {
  istanbul: { south: 40.84, west: 28.90, north: 41.24, east: 29.18 },
  kocaeli:  { south: 40.66, west: 29.55, north: 40.82, east: 29.98 },
  izmir:    { south: 38.36, west: 27.02, north: 38.50, east: 27.20 },
};

const lng2x = (lng, z) => (lng + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };

/* curl, not fetch: on the author's PC an antivirus re-signs HTTPS and Node's own certificate list refuses it; curl uses the system's */
const get = url => new Promise((resolve, reject) => {
  execFile('curl', ['-s', '--fail', '--compressed', '-m', '40', '-A', 'raynet-water-mask (github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)', url],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (err, out) => err ? reject(new Error(url + ': ' + err.message)) : resolve(out));
});

/* ---- a minimal Mapbox Vector Tile reader: only what the water layer needs ---- */
function reader(buf) {
  let p = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  return { varint, bytes: () => { const n = varint(); const b = buf.subarray(p, p + n); p += n; return b; }, skip: wire => { if (wire === 0) varint(); else if (wire === 2) { const n = varint(); p += n; } else if (wire === 5) p += 4; else if (wire === 1) p += 8; else throw new Error('wire ' + wire); }, more: () => p < buf.length };
}
/** the polygons of one named layer, as rings of [x, y] in the layer's own 0..extent square */
function layerPolygons(tile, name) {
  const out = []; let extent = 4096;
  const t = reader(tile);
  while (t.more()) {
    const tag = t.varint(), f = tag >> 3, w = tag & 7;
    if (f !== 3 || w !== 2) { t.skip(w); continue; }
    const lb = t.bytes(), l = reader(lb); let lname = '', feats = [];
    while (l.more()) {
      const tg = l.varint(), lf = tg >> 3, lw = tg & 7;
      if (lf === 1 && lw === 2) lname = Buffer.from(l.bytes()).toString('utf8');
      else if (lf === 2 && lw === 2) feats.push(l.bytes());
      else if (lf === 5 && lw === 0) extent = l.varint();
      else l.skip(lw);
    }
    if (lname !== name) continue;
    for (const fb of feats) {
      const fr = reader(fb); let type = 0, geom = null;
      while (fr.more()) {
        const tg = fr.varint(), ff = tg >> 3, fw = tg & 7;
        if (ff === 3 && fw === 0) type = fr.varint();
        else if (ff === 4 && fw === 2) geom = fr.bytes();
        else fr.skip(fw);
      }
      if (type !== 3 || !geom) continue;                      // polygons only
      const g = reader(geom); let x = 0, y = 0, ring = null; const rings = [];
      while (g.more()) {
        const cmd = g.varint(), id = cmd & 7, n = cmd >> 3;
        if (id === 1 || id === 2) for (let i = 0; i < n; i++) {
          const dx = g.varint(), dy = g.varint();
          x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
          if (id === 1) { ring = [[x, y]]; rings.push(ring); } else ring.push([x, y]);
        }
      }
      out.push(rings);
    }
  }
  return { polygons: out, extent };
}
/** even-odd scanline fill of every ring of every polygon into a PX x PX bitmap (a hole is just another ring) */
function rasterise(polygons, extent) {
  const bits = new Uint8Array(PX * PX), k = PX / extent;
  for (const rings of polygons) {
    const cover = new Uint8Array(PX * PX);
    for (let row = 0; row < PX; row++) {
      const yy = (row + 0.5) / k, xs = [];
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x1, y1] = r[i], [x2, y2] = r[j];
        if ((y1 > yy) !== (y2 > yy)) xs.push(x1 + (yy - y1) / (y2 - y1) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = Math.max(0, Math.ceil(xs[i] * k - 0.5)), b = Math.min(PX - 1, Math.floor(xs[i + 1] * k - 0.5));
        for (let c = a; c <= b; c++) cover[row * PX + c] = 1;
      }
    }
    for (let i = 0; i < cover.length; i++) if (cover[i]) bits[i] = 1;
  }
  return bits;
}

(async () => {
  const tj = JSON.parse((await get(TILEJSON)).toString('utf8'));
  const tpl = tj.tiles[0];
  const regions = {};
  for (const [name, BBOX] of Object.entries(REGIONS)) {
    const x0 = Math.floor(lng2x(BBOX.west, Z)), x1 = Math.floor(lng2x(BBOX.east, Z));
    const y0 = Math.floor(lat2y(BBOX.north, Z)), y1 = Math.floor(lat2y(BBOX.south, Z));
    const W = (x1 - x0 + 1) * PX, H = (y1 - y0 + 1) * PX;
    const grid = new Uint8Array(W * H);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
    console.log(name + ': tiles', jobs.length, ' grid', W, 'x', H);
    let empty = 0;
    const worker = async () => {
      for (let job; (job = jobs.pop());) {
        const [x, y] = job;
        let buf = await get(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);     // the tiles are stored gzipped and sent as plain bytes
        const { polygons, extent } = layerPolygons(buf, 'water');
        if (!polygons.length) empty++;
        const bits = rasterise(polygons, extent);
        for (let r = 0; r < PX; r++) grid.set(bits.subarray(r * PX, (r + 1) * PX), ((y - y0) * PX + r) * W + (x - x0) * PX);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);            // four at a time, the tile service's own limit
    const packed = Buffer.alloc(Math.ceil(grid.length / 8));
    for (let i = 0; i < grid.length; i++) if (grid[i]) packed[i >> 3] |= 1 << (i & 7);
    const water = grid.reduce((a, b) => a + b, 0);
    console.log('   water share', (100 * water / grid.length).toFixed(1) + '%', ' tiles with no water polygon:', empty);
    regions[name] = { z: Z, px: PX, x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1, width: W, height: H, bits: zlib.gzipSync(packed, { level: 9 }).toString('base64') };
  }
  const out = {
    _about: 'Where the sea is, as the base map of the app draws it: one bit per cell (about 15 m), 1 = water, for each city that has ferries. Made by fetch-water-mask.cjs from the water polygons of OpenFreeMap vector tiles (OpenMapTiles schema; data (c) OpenStreetMap contributors, ODbL). Used by ferry-water.cjs (the build keeps ferry lines on water with it) and test/ferry.test.cjs.',
    source: tpl.replace(/\/\{z\}.*$/, ''), fetched: new Date().toISOString().slice(0, 10), regions,
  };
  fs.writeFileSync(path.join(DIR, 'water-mask.json'), JSON.stringify(out) + '\n');
  console.log('WROTE water-mask.json', (fs.statSync(path.join(DIR, 'water-mask.json')).size / 1024).toFixed(1), 'KB');
})().catch(e => { console.error(e.message); process.exit(1); });
