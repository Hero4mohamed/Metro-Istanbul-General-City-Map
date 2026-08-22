/* Data and translation invariants.
 *
 * These are the defects that reach users as WRONG CONTENT rather than as a crash: a raw i18n
 * key printed in the UI, another province's buses in a city's directory, a disruption that
 * cannot be drawn. Every check below corresponds to something that actually shipped.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.cjs');

/* --- i18n -------------------------------------------------------------------------
   t() falls back to English and, failing that, returns the KEY ITSELF. A key that exists
   in no dictionary is therefore printed to the user verbatim — the empty search panel once
   read "omniHint" in production for exactly this reason. English is the fallback of record,
   so every key the code or markup asks for must exist there. */
test('every translation key the app asks for exists in English', () => {
  const dicts = H.i18n();
  assert.ok(dicts.en && dicts.en.size > 50, 'English dictionary not found or implausibly small');

  const script = H.codeOnly(H.appScript());
  const html = H.html();

  const asked = new Set();
  for (const m of H.appScript().matchAll(/\bt\(\s*['"]([A-Za-z_][\w]*)['"]\s*\)/g)) asked.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-html|-ph|-title)?="([A-Za-z_][\w]*)"/g)) asked.add(m[1]);

  const missing = [...asked].filter(k => !dicts.en.has(k)).sort();
  assert.deepStrictEqual(missing, [], 'asked for but absent from English: ' + missing.join(', '));
});

test('Turkish covers the keys English defines', () => {
  const d = H.i18n();
  assert.ok(d.tr && d.tr.size > 50, 'Turkish dictionary not found');
  // ar/fr legitimately fall back to English; Turkish is a primary language of this product,
  // so a gap there is a real hole rather than a graceful default.
  const missing = [...d.en].filter(k => !d.tr.has(k)).sort();
  assert.ok(missing.length <= 12,
    'Turkish is missing ' + missing.length + ' keys: ' + missing.slice(0, 20).join(', '));
});

/* --- network geometry --------------------------------------------------------------
   A bounding box does not respect a city boundary. İzmir's box covers Manisa, and an OSM
   pull once put 22 Manisa co-operative routes into İzmir's bus directory. Coordinates that
   fall outside the city's own box are the cheapest possible detector for that whole class. */
test('every station sits inside its city bounding box', () => {
  const cities = H.cities();
  const strays = [];
  for (const [name, city] of Object.entries(cities)) {
    const b = city.box;
    if (!b) continue;
    for (const line of city.lines || []) {
      for (const st of line.stations || []) {
        if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) {
          strays.push(name + '/' + line.ref + '/' + st.name + ' (non-finite)');
          continue;
        }
        // a small margin: a terminus can legitimately sit just past a rounded box edge
        const m = 0.05;
        if (st.lat < b.s - m || st.lat > b.n + m || st.lng < b.w - m || st.lng > b.e + m) {
          strays.push(name + '/' + line.ref + '/' + st.name);
        }
      }
    }
  }
  assert.deepStrictEqual(strays.slice(0, 15), [], strays.length + ' station(s) outside their city box');
});

test('line refs are unique within each city', () => {
  const dupes = [];
  for (const [name, city] of Object.entries(H.cities())) {
    const seen = new Set();
    for (const line of city.lines || []) {
      if (seen.has(line.ref)) dupes.push(name + '/' + line.ref);
      seen.add(line.ref);
    }
  }
  assert.deepStrictEqual(dupes, [], 'duplicate line refs: ' + dupes.join(', '));
});

test('every city can price a journey', () => {
  const broken = [];
  for (const [name, city] of Object.entries(H.cities())) {
    if (!city.card) broken.push(name + ' (no fare card)');
    if (!city.fare || typeof city.fare.base !== 'number') broken.push(name + ' (no base fare)');
  }
  assert.deepStrictEqual(broken, [], 'fare data missing: ' + broken.join(', '));
});

/* --- disruptions -------------------------------------------------------------------
   A "segment" whose two ends are the SAME station is zero-length: it draws no caution band,
   and the warning marker falls through to the line's midpoint, pointing at track that is not
   affected. M7 shipped in exactly that state. */
test('no disruption describes a zero-length segment', () => {
  const bad = H.json('disruptions.json')
    .filter(d => d.scope === 'segment' && d.from && d.to && d.from.trim() === d.to.trim())
    .map(d => d.ref);
  assert.deepStrictEqual(bad, [],
    'segment disruptions with identical endpoints (use scope "stations"): ' + bad.join(', '));
});

test('disruption scope and severity are values the renderer understands', () => {
  const SCOPES = new Set(['line', 'segment', 'stations']);
  const SEVS = new Set(['major', 'partial', 'minor']);
  const bad = [];
  for (const d of H.json('disruptions.json')) {
    if (!SCOPES.has(d.scope)) bad.push(d.ref + ': scope "' + d.scope + '"');
    if (!SEVS.has(d.severity)) bad.push(d.ref + ': severity "' + d.severity + '"');
    if (d.scope === 'stations' && !(Array.isArray(d.stations) && d.stations.length))
      bad.push(d.ref + ': scope "stations" with no stations listed');
  }
  assert.deepStrictEqual(bad, [], bad.join('; '));
});

/* --- translated operator text -------------------------------------------------------
   The phrase translator once produced "Hava muhalefeti due to services cannot operate." —
   half Turkish, half English. One coherent language beats half of each. */
test('no disruption message is a Turkish-English hybrid', () => {
  const TURKISH = /\b(nedeniyle|sebebiyle|muhalefeti|seferler|yapılamamaktadır|istasyonları|çalışması|arızası)\b/i;
  const ENGLISH = /\b(due to|services|cannot|operate|between|maintenance|station|works)\b/i;
  const hybrids = H.json('disruptions.json')
    .filter(d => d.message && TURKISH.test(d.message) && ENGLISH.test(d.message))
    .map(d => d.ref + ': ' + d.message.slice(0, 60));
  assert.deepStrictEqual(hybrids, [], 'half-translated message(s):\n  ' + hybrids.join('\n  '));
});

/* --- bus datasets ------------------------------------------------------------------- */
/* A RATCHET, not a clean assertion.
 *
 * İstanbul's İETT graph contains 40 route refs (14E, 19FB, 29Ş, 34A and others) that the
 * directory scrape never picked up. The planner can route over them; the Buses list cannot
 * show or search them. That is a real pre-existing gap in fetch-bus-gtfs.cjs, not something
 * to paper over — but it also predates this suite, so failing the build on it would only
 * teach people to skip tests. The number is pinned instead: it may shrink, never grow.
 *
 * Lower BASELINE whenever the pipeline improves. Do not raise it.
 */
const ORPHAN_BASELINE = 65;   // graph directions whose ref is absent from the directory

test('bus routes missing from their directory do not increase', () => {
  const SETS = [
    ['istanbul', 'bus-directory.json', 'bus-graph.json'],
    ['kocaeli', 'kocaeli-bus-directory.json', 'kocaeli-bus-graph.json'],
    ['ankara', 'ankara-bus-directory.json', 'ankara-bus-graph.json'],
  ];
  const orphans = [];
  for (const [city, dirFile, graphFile] of SETS) {
    if (!H.exists('transit_data/' + dirFile) || !H.exists('transit_data/' + graphFile)) continue;
    const refs = new Set(H.json(dirFile).map(d => String(d.ref)));
    for (const g of H.json(graphFile)) {
      if (!refs.has(String(g.ref))) orphans.push(city + '/' + g.ref);
    }
  }
  assert.ok(orphans.length <= ORPHAN_BASELINE,
    'orphaned bus routes rose from ' + ORPHAN_BASELINE + ' to ' + orphans.length +
    ' — e.g. ' + orphans.slice(0, 6).join(', '));
  if (orphans.length < ORPHAN_BASELINE) {
    console.log('    note: orphans down to ' + orphans.length + ' — lower ORPHAN_BASELINE to lock the gain in');
  }
});

test('bus stops carry usable coordinates', () => {
  const bad = [];
  for (const f of ['bus-graph.json', 'kocaeli-bus-graph.json', 'ankara-bus-graph.json']) {
    if (!H.exists('transit_data/' + f)) continue;
    for (const g of H.json(f)) {
      for (const s of g.stops || []) {
        if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) { bad.push(f + '/' + g.ref); break; }
        // Turkey, generously bounded — catches a swapped lat/lng pair immediately
        if (s[0] < 35 || s[0] > 43 || s[1] < 25 || s[1] > 45) { bad.push(f + '/' + g.ref + ' @' + s[0] + ',' + s[1]); break; }
      }
    }
  }
  assert.deepStrictEqual(bad.slice(0, 10), [], bad.length + ' bus route(s) with bad coordinates');
});
