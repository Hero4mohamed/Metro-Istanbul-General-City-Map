#!/usr/bin/env node
'use strict';
/* Builds the offline map packs: offline/<city>.pack and offline/packs.json (V4.4.1).
 *
 * Why: the base map is drawn from vector tiles fetched as you look at them, so with no connection there was no map except where you
 * had already looked. A pack is the base map of one city in one file, served from the app's own address, which the app keeps on the
 * device: the whole city at overview zooms, and full street detail (zoom 14, the most the tiles carry) around every line and station.
 *
 *   node transit_data/build-offline-packs.cjs            build every city's pack (needs the network; four requests at a time)
 *   node transit_data/build-offline-packs.cjs --count    only say how many tiles each pack would hold
 *   node transit_data/build-offline-packs.cjs izmir      one city
 *
 * Which tiles: zooms 0-9, the tiles the city's box touches; 10-12, every tile of the box; 13 and 14, every tile within one tile of a
 * line or a station (about 2 to 4 km either side). Elsewhere in the city the map is drawn from zoom 12, enlarged.
 *
 * The file: 'RNP1', a 4-byte length, an index as JSON ({ tiles: { "z/x/y": [offset, length] } }), then the tiles one after another,
 * each gzipped as the tile service stores them. sw.js reads a tile straight out of the stored file (pack tiles are only ever used
 * when the live tile cannot be fetched).
 *
 * Tiles: OpenFreeMap (openfreemap.org), OpenMapTiles schema; data (c) OpenStreetMap contributors, ODbL. Both are credited on the map
 * and the credits page; redistribution with credit is what their licences allow. Run it by hand a few times a year: it is not part of
 * the build, and the packs are committed.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'offline');
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const MARGIN = 0.035;                                  // degrees of room around the network's box (about 3 km)

const lng2x = (lng, z) => (lng + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };

/** the tiles of one city's pack, as "z/x/y" strings, from its lines (paths and stations) */
function tilesFor(lines) {
  const pts = [];
  for (const l of lines) {
    if (l.scope === 'intercity') continue;
    for (const p of l.paths || []) for (const q of p) pts.push(q);
    for (const s of l.stations || []) pts.push([s.lat, s.lng]);
  }
  if (!pts.length) return [];
  let s = 90, w = 180, n = -90, e = -180;
  for (const [la, ln] of pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, ln); e = Math.max(e, ln); }
  s -= MARGIN; n += MARGIN; w -= MARGIN; e += MARGIN;
  const set = new Set();
  for (let z = 0; z <= 12; z++) {
    const x0 = Math.floor(lng2x(w, z)), x1 = Math.floor(lng2x(e, z)), y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(z + '/' + x + '/' + y);
  }
  for (const z of [13, 14]) {
    /* densify the lines so a long straight stretch between two points does not skip a tile */
    const mark = (la, ln) => { const x = Math.floor(lng2x(ln, z)), y = Math.floor(lat2y(la, z)); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.add(z + '/' + (x + dx) + '/' + (y + dy)); };
    for (const l of lines) {
      if (l.scope === 'intercity') continue;
      for (const s2 of l.stations || []) mark(s2.lat, s2.lng);
      for (const p of l.paths || []) for (let i = 0; i < p.length; i++) {
        mark(p[i][0], p[i][1]);
        if (i) { const k = Math.ceil(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / 0.008); for (let t = 1; t < k; t++) mark(p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t / k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t / k); }
      }
    }
  }
  return [...set].sort((a, b) => { const A = a.split('/').map(Number), B = b.split('/').map(Number); return A[0] - B[0] || A[1] - B[1] || A[2] - B[2]; });
}

/** pack bytes from { "z/x/y": Buffer (gzipped tile) } */
function packBytes(meta, tiles) {
  const keys = Object.keys(tiles), index = {}; let off = 0;
  for (const k of keys) { index[k] = [off, tiles[k].length]; off += tiles[k].length; }
  const head = Buffer.from(JSON.stringify(Object.assign({}, meta, { tiles: index })), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length, 0);
  return Buffer.concat([Buffer.from('RNP1'), len, head].concat(keys.map(k => tiles[k])));
}
/** the reverse (used by the tests): { meta, tile(key) -> Buffer|null } */
function readPack(buf) {
  if (buf.subarray(0, 4).toString() !== 'RNP1') throw new Error('not a pack');
  const n = buf.readUInt32LE(4), meta = JSON.parse(buf.subarray(8, 8 + n).toString('utf8')), base = 8 + n;
  return { meta, tile: k => { const e = meta.tiles[k]; return e ? buf.subarray(base + e[0], base + e[0] + e[1]) : null; } };
}

module.exports = { tilesFor, packBytes, readPack, lng2x, lat2y };

if (require.main === module) {
  const args = process.argv.slice(2), countOnly = args.includes('--count'), only = args.filter(a => !a.startsWith('--'));
  const cities = require('./testkit/helpers.cjs').cities();
  const get = url => new Promise((resolve, reject) => {
    execFile('curl', ['-s', '--fail', '-m', '60', '--retry', '3', '-A', 'raynet-offline-pack (github.com/Hero4mohamed/Metro-Istanbul-General-City-Map)', url],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, out) => err ? reject(new Error(url + ': ' + err.message)) : resolve(out));
  });
  (async () => {
    const ids = Object.keys(cities).filter(id => !only.length || only.includes(id));
    if (countOnly) { for (const id of ids) { const t = tilesFor(cities[id].lines); const by = {}; t.forEach(k => { const z = k.split('/')[0]; by[z] = (by[z] || 0) + 1; }); console.log(id.padEnd(9), String(t.length).padStart(5), 'tiles ', JSON.stringify(by)); } return; }
    const tj = JSON.parse((await get(TILEJSON)).toString('utf8')), tpl = tj.tiles[0], source = tpl.replace(/\/\{z\}.*$/, '');
    fs.mkdirSync(OUT, { recursive: true });
    const manifestFile = path.join(OUT, 'packs.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { packs: {} };
    for (const id of ids) {
      const keys = tilesFor(cities[id].lines), tiles = {}, queue = keys.slice();
      let done = 0, missing = 0;
      const worker = async () => {
        for (let k; (k = queue.shift());) {
          const [z, x, y] = k.split('/');
          try {
            let buf = await get(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
            if (!(buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gzipSync(buf, { level: 9 });      // always gzipped inside the pack
            tiles[k] = buf;
          } catch (e) { missing++; }                                                                  // sea or empty land: the service has no tile
          if (++done % 200 === 0) console.log('  ' + id, done + '/' + keys.length);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      const ordered = {}; for (const k of keys) if (tiles[k]) ordered[k] = tiles[k];
      const buf = packBytes({ v: 1, city: id, source, built: new Date().toISOString().slice(0, 10) }, ordered);
      fs.writeFileSync(path.join(OUT, id + '.pack'), buf);
      manifest.packs[id] = { file: 'offline/' + id + '.pack', bytes: buf.length, tiles: Object.keys(ordered).length, built: new Date().toISOString().slice(0, 10) };
      console.log('WROTE offline/' + id + '.pack', (buf.length / 1048576).toFixed(1), 'MB,', Object.keys(ordered).length, 'tiles (' + missing + ' not served)');
    }
    manifest.source = source; manifest._about = 'The offline base-map packs (build-offline-packs.cjs). bytes and tiles are checked against the files by test/offline-packs.test.cjs.';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n');
  })().catch(e => { console.error(e.message); process.exit(1); });
}
