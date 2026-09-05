/* Are the basemaps still serving map data?
 *
 * CARTO began enforcing its API-key requirement and the app did not notice for days. Nothing
 * failed: every tile came back HTTP 200, a valid PNG of plausible size. Roughly one tile in
 * three simply contained the words "API KEY REQUIRED" instead of İstanbul. The in-page
 * tileerror retry never fired, the service worker cached the placeholders, and the map went on
 * "working" while a third of it was advertising.
 *
 * Measured on the live service before the switch: 48 tiles across one z12 İstanbul viewport
 * returned 35 distinct images — because 14 of them were the SAME 1970-byte placeholder.
 *
 * That measurement is the test. A status code cannot see it. Nor can a byte-size threshold you
 * have to guess: an ocean tile is legitimately tiny. What a placeholder cannot fake is being
 * DIFFERENT every time. Two tiles over dense city are never byte-identical — unless they are
 * not tiles. So: sample a grid, hash each one, and fail if any image appears twice.
 *
 * Sample size is chosen from that measured rate, not by feel. At a 29% placeholder share, two
 * samples would catch it under one time in ten; twenty samples catch it better than 99 times in
 * a hundred. A detector that only sometimes notices a live outage is the thing being fixed here.
 *
 * What this CANNOT promise: the degradation is intermittent. Sampled over one hour the same
 * viewport gave 29%, then 15-25%, then 0%. A single run during a good window passes, so a green
 * result means "not placeholding right now", not "healthy". That is why it runs daily rather
 * than once — over a week of runs an enforcement rollout has nowhere to hide, and one clean
 * sample was never the claim being made.
 *
 * The second check is the ceiling. Esri's Dark Gray Canvas advertises LOD 23 in its own service
 * metadata and stops carrying data at z16 — above that it returns, again with HTTP 200, a
 * "Map data not yet available" placeholder. maxNativeZoom in 08-map.js is what stops Leaflet
 * requesting those. This asserts the measured ceiling is still where we think it is. If a
 * provider EXTENDS coverage this fails too, which is the right kind of failure: it means we are
 * upscaling tiles that no longer need it.
 *
 * Needs the network, so it is deliberately not part of `npm test` — that suite is zero-
 * dependency and runs offline. Run `npm run check-tiles`, or let the scheduled workflow do it.
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

/* Bağcılar/Esenler: dense, built-up, and about 10 km from any coast.

   Both halves of that matter. It has to be İstanbul, because the degradation was not uniform —
   sampled minutes apart, İstanbul showed placeholders while Ankara and rural Anatolia showed
   none, so a check aimed at a quieter city would have sat green through the outage. And it has
   to be inland, because two identical tiles prove a placeholder only where no two real tiles
   could ever match: centred on İstanbul proper this cried wolf at once, flagging four
   byte-identical 2419B tiles of the Marmara. Open water is a flat fill and matches itself. */
const CITY = { name: 'İstanbul (Bağcılar)', lat: 41.0400, lng: 28.8700 };
const GRID = 20;                 // sized from the measured 29% placeholder rate — see above

/* maxNative is the deepest zoom we believe carries data; it must match 08-map.js. */
const LAYERS = [
  { key: 'dark',    maxNative: 16, url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}' },
  { key: 'voyager', maxNative: 19, url: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}' },
  { key: 'sat',     maxNative: 19, url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}' },
];

function tileXY(lat, lng, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

function fetchTile(url) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'raynet-tile-check' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, bytes: body.length,
                  hash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 12) });
      });
    });
    req.on('error', e => resolve({ status: 0, error: e.message, bytes: 0, hash: null }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, error: 'timeout', bytes: 0, hash: null }); });
  });
}

const fill = (tpl, z, xy) => tpl.replace('{z}', z).replace('{x}', xy.x).replace('{y}', xy.y);

// a GRID-sized block of adjacent tiles around the city centre
function grid(z, n) {
  const c = tileXY(CITY.lat, CITY.lng, z);
  const side = Math.ceil(Math.sqrt(n));
  const out = [];
  for (let dx = 0; dx < side && out.length < n; dx++)
    for (let dy = 0; dy < side && out.length < n; dy++)
      out.push({ x: c.x + dx - (side >> 1), y: c.y + dy - (side >> 1) });
  return out;
}

/* The layers under test must be the layers we ship. A check that drifts from the page is worse
   than no check: it goes on passing for a basemap nobody uses any more. */
function assertLayersMatchSource(problems) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '08-map.js'), 'utf8');
  for (const l of LAYERS) {
    const service = l.url.replace(ESRI, '').split('/MapServer')[0];
    if (!src.includes(service))
      problems.push(`08-map.js no longer uses ${service} — this check is testing the wrong layer`);
    if (!new RegExp('maxNativeZoom:' + l.maxNative + '\\b').test(src))
      problems.push(`08-map.js does not declare maxNativeZoom:${l.maxNative} anywhere (${l.key})`);
  }
  if (/cartocdn/.test(src))
    problems.push('08-map.js references cartocdn again — it serves placeholders without an API key');
}

(async () => {
  const problems = [];
  assertLayersMatchSource(problems);
  console.log(`Basemap health — ${GRID} tiles over ${CITY.name}; a placeholder repeats, a map never does.\n`);

  for (const l of LAYERS) {
    const z = l.maxNative;
    const counts = new Map();
    let bad = 0;
    for (const xy of grid(z, GRID)) {
      const r = await fetchTile(fill(l.url, z, xy));
      if (r.status !== 200) { bad++; continue; }
      const e = counts.get(r.hash) || { n: 0, bytes: r.bytes };
      e.n++; counts.set(r.hash, e);
    }
    if (bad) problems.push(`${l.key}: ${bad}/${GRID} tiles did not return HTTP 200 at z${z}`);

    const repeats = [...counts].filter(([, e]) => e.n > 1);
    if (repeats.length) {
      const worst = repeats.sort((a, b) => b[1].n - a[1].n)[0];
      const share = Math.round((repeats.reduce((a, [, e]) => a + e.n, 0) / GRID) * 100);
      problems.push(`${l.key}: ${share}% of tiles are repeated images at z${z} ` +
        `(${worst[1].n}x ${worst[1].bytes}B, hash ${worst[0]}) — the provider is serving a placeholder`);
    }

    // one zoom deeper must NOT carry data, or maxNativeZoom is leaving real coverage unused
    const deep = z + 1;
    const dg = grid(deep, 4);
    const dh = [];
    for (const xy of dg) { const r = await fetchTile(fill(l.url, deep, xy)); if (r.status === 200) dh.push(r.hash); }
    const deepReal = dh.length === dg.length && new Set(dh).size === dh.length;
    if (deepReal)
      problems.push(`${l.key}: z${deep} now carries real data — maxNativeZoom:${z} in 08-map.js is ` +
        'upscaling tiles that no longer need it');

    const ok = !repeats.length && !bad;
    console.log(`  ${ok ? 'ok ' : '!! '} ${l.key.padEnd(8)} z${z}  ` +
      `${counts.size}/${GRID} distinct   ` +
      `| z${deep} ${deepReal ? 'HAS DATA' : 'placeholder (expected)'}`);
  }

  if (problems.length) {
    console.log('\n' + problems.length + ' problem(s):\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('\nAll basemaps are serving real map data.');
})();
