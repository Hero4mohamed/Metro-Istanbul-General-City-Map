// Kocaeli's bus network from Kocaeli Büyükşehir Belediyesi's own route pages.
//
// There is no GTFS for Kocaeli: the city's open-data portal (veri.kocaeli.bel.tr) publishes
// tram, ferry and teleferik datasets but nothing for buses, and OSM carries only ~28 Kocaeli
// bus relations against a real network of ~375. The municipality's route browser at
// kocaeli.bel.tr/hatlar IS complete, and every route page carries, per direction:
//   • the ordered stop list  — stop id, name, and lat/lng inside a Google Maps link
//   • the departure board    — weekday / Saturday / Sunday+holiday columns
// so it yields the same shape the İETT GTFS gives İstanbul.
//
// Emits kocaeli-bus-directory.json / -graph.json / -schedules.json.
// Polite by design: small concurrency, a delay between requests, and resumable via cache.

const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const CACHE = path.join(DIR, '.cache-kocaeli-bus');

const ROOT = 'https://www.kocaeli.bel.tr/hatlar/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CONCURRENCY = 4;
const DELAY_MS = 120;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function grab(url, cacheKey) {
  const cf = cacheKey && path.join(CACHE, cacheKey + '.html');
  if (cf && fs.existsSync(cf)) return fs.readFileSync(cf, 'utf8');
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      if (cf) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cf, t); }
      return t;
    } catch (e) {
      if (a === 3) { console.warn('  ! failed', url, e.message); return null; }
      await sleep(600 * a);
    }
  }
}

const dec = s => String(s || '')
  .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// pull out every <table>…</table> block
function tables(html) {
  const out = []; const re = /<table[\s\S]*?<\/table>/gi; let m;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}
function rows(tbl) {
  const out = []; const re = /<tr[\s\S]*?<\/tr>/gi; let m;
  while ((m = re.exec(tbl))) {
    const cells = []; const cre = /<t[dh][\s\S]*?<\/t[dh]>/gi; let c;
    while ((c = cre.exec(m[0]))) cells.push(c[0]);
    if (cells.length) out.push(cells);
  }
  return out;
}

/* one stop row: index | stop id | <a … maps/place/LAT,LNG …>NAME</a> */
function parseStops(tbl) {
  const out = [];
  for (const cells of rows(tbl)) {
    if (cells.length < 3) continue;
    const link = cells[2];
    const ll = link.match(/place\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    const name = dec(link);
    if (!ll || !name) continue;
    const lat = +ll[1], lng = +ll[2];
    if (!(lat > 40.2 && lat < 41.4 && lng > 28.9 && lng < 30.8)) continue;   // inside Kocaeli
    out.push([+lat.toFixed(5), +lng.toFixed(5), name.toLocaleUpperCase('tr')]);
  }
  return out;
}

/* departure board: index | weekday | saturday | sunday+holiday */
function parseTimes(tbl) {
  const wd = [], sat = [], sun = [];
  for (const cells of rows(tbl)) {
    if (cells.length < 2) continue;
    const v = cells.map(dec);
    if (!/^\d+$/.test(v[0])) continue;                       // skip the header row
    const t = s => /^\d{1,2}:\d{2}$/.test(s || '') ? s.padStart(5, '0') : null;
    if (t(v[1])) wd.push(t(v[1]));
    if (t(v[2])) sat.push(t(v[2]));
    if (t(v[3])) sun.push(t(v[3]));
  }
  return { wd, sat, sun };
}

// {first,last,hw,n} — hw is the AVERAGE gap across the service span, matching the shape the
// İstanbul GTFS pipeline emits. Null when a day has no service at all.
function band(list) {
  if (!list.length) return null;
  const mins = list.map(s => +s.slice(0, 2) * 60 + +s.slice(3, 5)).sort((a, b) => a - b);
  const first = mins[0], last = mins[mins.length - 1];
  const hw = mins.length > 1 ? Math.max(1, Math.round((last - first) / (mins.length - 1))) : null;
  const fmt = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  return { first: fmt(first), last: fmt(last), hw, n: mins.length };
}

(async function main() {
  console.log('route list …');
  const idx = await grab(ROOT, 'index');
  if (!idx) { console.error('could not load the route index'); process.exit(1); }

  const refs = [];
  const sel = idx.match(/<select[^>]*name=["']hat["'][\s\S]*?<\/select>/i);
  if (!sel) { console.error('route <select> not found — page structure changed'); process.exit(1); }
  const ore = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi; let m;
  while ((m = ore.exec(sel[0]))) {
    const ref = m[1].trim(), label = dec(m[2]);
    if (!ref) continue;
    const parts = label.split(' - ');
    const op = parts.length > 2 ? parts[parts.length - 1] : '';
    const desc = parts.slice(1, parts.length > 2 ? -1 : undefined).join(' - ');
    refs.push({ ref, desc, op });
  }
  // the three trams already ship as rail lines; buses only here
  const buses = refs.filter(r => !/^T\d$/i.test(r.ref));
  console.log('  ' + refs.length + ' routes listed, ' + buses.length + ' non-tram');

  const directory = [], graph = [], schedules = {};
  let done = 0, noStops = 0;

  async function one(r) {
    const html = await grab(ROOT + encodeURIComponent(r.ref) + '/', 'r_' + r.ref.replace(/[^\w-]/g, '_'));
    await sleep(DELAY_MS);
    done++;
    if (!html) return;
    const tb = tables(html);
    const stopTables = tb.filter(t => /Durak\s*Ad/i.test(t)).map(parseStops).filter(s => s.length > 1);
    const timeTables = tb.filter(t => /Hafta\s*İçi/i.test(t)).map(parseTimes);
    if (!stopTables.length) { noStops++; return; }

    const heads = stopTables.map(s => s[s.length - 1][2]);
    directory.push({ ref: r.ref, from: stopTables[0][0][2], to: heads[0], id: 0, op: r.op, desc: r.desc });
    stopTables.forEach((stops, i) => graph.push({ ref: r.ref, dir: i, head: heads[i], stops }));

    const sc = [];
    stopTables.forEach((stops, i) => {
      const t = timeTables[i] || timeTables[0];
      if (!t) return;
      const e = { dir: i, head: heads[i] };
      const w = band(t.wd), sa = band(t.sat), su = band(t.sun);
      if (w) e.wd = w; if (sa) e.sat = sa; if (su) e.sun = su;
      if (e.wd || e.sat || e.sun) sc.push(e);
    });
    if (sc.length) schedules[r.ref] = sc;

    if (done % 40 === 0) console.log('  ' + done + '/' + buses.length + ' …');
  }

  // bounded concurrency
  const queue = buses.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await one(queue.shift());
  }));

  directory.sort((a, b) => a.ref.localeCompare(b.ref, 'tr', { numeric: true }));
  graph.sort((a, b) => a.ref.localeCompare(b.ref, 'tr', { numeric: true }) || a.dir - b.dir);

  const w = (f, o) => { fs.writeFileSync(path.join(DIR, f), JSON.stringify(o));
    console.log('WROTE', f, (fs.statSync(path.join(DIR, f)).size / 1024).toFixed(1), 'KB'); };
  w('kocaeli-bus-directory.json', directory);
  w('kocaeli-bus-graph.json', graph);
  w('kocaeli-bus-schedules.json', schedules);

  const stops = graph.reduce((s, g) => s + g.stops.length, 0);
  console.log('routes:', directory.length, ' directions:', graph.length,
              ' stop entries:', stops, ' with schedules:', Object.keys(schedules).length,
              ' no-stop pages:', noStops);
})();
