// fetch-accessibility.cjs — build per-station step-free / accessibility data from real sources:
//   (1) İBB Open Data · "Raylı Sistemlere Ait İstasyon Bilgileri" — authoritative elevator + escalator
//       counts per rail station (CKAN datastore, clean JSON). 177 metro/rail stations.
//   (2) OpenStreetMap (Overpass) — wheelchair=yes/limited/no tags on rail stations (adds coverage for
//       trams/Marmaray/funiculars the İBB set may omit, and an accessibility semantic beyond raw counts).
// Output: transit_data/accessibility.json  — an ARRAY of records with the ORIGINAL station names, so the
//   app folds them with its own fold() at runtime (no build-time name-matching drift).
//
// Run:  node transit_data/fetch-accessibility.cjs
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'accessibility.json');

// same normalisation the app's fold() uses (Turkish lowercase + collapse spaces), for internal merging
const fold = s => (s || '').toString().toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

const IBB = 'https://data.ibb.gov.tr/api/3/action/datastore_search?resource_id=9baff1fa-54f3-480c-91ae-986e582d42c7&limit=1000';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

async function fetchIBB() {
  const r = await fetch(IBB, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error('İBB HTTP ' + r.status);
  const j = await r.json();
  const recs = (j.result && j.result.records) || [];
  const map = new Map();   // foldedName -> {name, lines:Set, elevators, escalators, size, district}
  for (const rec of recs) {
    const name = (rec['Istasyon Adi'] || rec['Istasyon_Adi'] || '').trim();
    if (!name) continue;
    const key = fold(name);
    const ele = num(rec['Asansor Sayisi']);
    const esc = num(rec['Yuruyen Merdiven Sayisi']);
    const size = num(rec['Istasyon Buyuklugu']);
    const line = (rec['Hat Adi'] || rec['Hat_Adi'] || '').trim();
    const dist = (rec['Ilce Adi'] || '').trim();
    let e = map.get(key);
    if (!e) { e = { name, lines: new Set(), elevators: 0, escalators: 0, size: 0, district: dist }; map.set(key, e); }
    // physical station facilities = the max reported across its lines
    if (ele != null) e.elevators = Math.max(e.elevators, ele);
    if (esc != null) e.escalators = Math.max(e.escalators, esc);
    if (size != null) e.size = Math.max(e.size, size);
    if (line) e.lines.add(line);
    if (!e.district && dist) e.district = dist;
  }
  return map;
}
const num = v => { if (v == null || v === '') return null; const n = +('' + v).replace(/[^\d.-]/g, ''); return isNaN(n) ? null : n; };

async function fetchOSM() {
  // rail stations across the İstanbul metropolitan bbox (south,west,north,east)
  const q = `[out:json][timeout:120];
(
  node["railway"="station"](40.75,28.30,41.40,29.80);
  node["railway"="halt"](40.75,28.30,41.40,29.80);
  node["station"="subway"](40.75,28.30,41.40,29.80);
  node["public_transport"="station"]["train"="yes"](40.75,28.30,41.40,29.80);
);
out tags;`;
  const endpoints = [OVERPASS, 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let j = null, lastErr;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json(); break;
    } catch (e) { lastErr = e; }
  }
  if (!j) throw lastErr || new Error('all Overpass endpoints failed');
  const wc = new Map();  // foldedName -> {name, wheelchair}
  for (const el of (j.elements || [])) {
    const tg = el.tags || {}; const name = (tg.name || tg['name:tr'] || '').trim();
    if (!name || !tg.wheelchair) continue;
    const key = fold(name);
    if (!wc.has(key)) wc.set(key, { name, wheelchair: tg.wheelchair });
  }
  return wc;
}

function stepFreeOf(ele, wheelchair) {
  if (ele != null && ele > 0) return true;
  if (wheelchair === 'yes') return true;
  if (ele === 0) return false;
  if (wheelchair === 'no') return false;
  return null;                                   // unknown — never asserted
}

(async () => {
  let ibb, osm = new Map();
  try { ibb = await fetchIBB(); console.log('İBB stations:', ibb.size); }
  catch (e) { console.error('İBB fetch failed:', e.message); process.exit(1); }
  try { osm = await fetchOSM(); console.log('OSM stations with wheelchair tag:', osm.size); }
  catch (e) { console.warn('OSM enrichment skipped:', e.message); }

  const out = new Map();   // foldedName -> record
  for (const [key, e] of ibb) {
    out.set(key, { name: e.name, elevators: e.elevators, escalators: e.escalators,
                   size: e.size || null, district: e.district || null, wheelchair: null, lines: [...e.lines] });
  }
  for (const [key, w] of osm) {
    let r = out.get(key);
    if (r) r.wheelchair = w.wheelchair;
    else out.set(key, { name: w.name, elevators: null, escalators: null, size: null, district: null, wheelchair: w.wheelchair, lines: [] });
  }
  const arr = [...out.values()].map(r => ({ ...r, stepFree: stepFreeOf(r.elevators, r.wheelchair) }))
                               .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const stats = { total: arr.length,
    withElevatorData: arr.filter(r => r.elevators != null).length,
    stepFree: arr.filter(r => r.stepFree === true).length,
    notStepFree: arr.filter(r => r.stepFree === false).length,
    unknown: arr.filter(r => r.stepFree === null).length,
    withWheelchairTag: arr.filter(r => r.wheelchair).length };
  fs.writeFileSync(OUT, JSON.stringify(arr));
  console.log('WROTE', OUT, '·', arr.length, 'stations');
  console.log('stats:', JSON.stringify(stats));
})();
