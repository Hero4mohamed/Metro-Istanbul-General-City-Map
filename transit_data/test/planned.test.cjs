/* The Vision tab: planned and under-construction projects.
 *
 * What goes wrong here reaches users as a CONFIDENT FALSEHOOD, not a crash: a line shown "under
 * construction" with a date nobody stated, a hand-typed straight line passing for a surveyed
 * route, a source link that is not there. So these checks are about provenance and shape:
 * every claim has a source and a day, every line is real geometry, and what is NOT verified
 * says so.
 *
 * Three layers feed the tab (see process-planned.cjs): geometry from OpenStreetMap, facts from
 * Metro İstanbul's project pages, and claims curated in planned-registry.json. The scheduled job
 * refreshes the first two and commits only if this file passes, so it is also the guard that
 * stops a half-failed fetch from deleting lines from the map.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');
const P = require('../process-planned.cjs');

const registry = H.json('planned-registry.json');
const planned = H.json('planned-lines.json');
const allLines = Object.entries(planned.cities).flatMap(([city, ls]) => ls.map(l => Object.assign({ _city: city }, l)));
const cityDefs = H.json('cities.json');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = s => ISO.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/* --- the registry: what a person typed ------------------------------------------------ */
test('every registry project has a unique id, a known city and a valid status', () => {
  const ids = new Set(), perCityRef = new Set();
  for (const p of registry.projects) {
    assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(p.id), 'bad id: ' + p.id);
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id); ids.add(p.id);
    assert.ok(cityDefs[p.city], p.id + ': unknown city ' + p.city);
    assert.ok(P.STATUS.includes(p.status), p.id + ': status "' + p.status + '" is not one of ' + P.STATUS.join(' | '));
    const k = p.city + '|' + p.ref;
    assert.ok(!perCityRef.has(k), p.id + ': two projects in ' + p.city + ' are both called "' + p.ref + '"');
    perCityRef.add(k);
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(p.color), p.id + ': colour must be #RRGGBB');
    assert.ok(p.colorSource || p.partOf, p.id + ': say where the colour came from (an infobox, the line it extends, or "assigned"), unless it is a stage of a line that already did');
    assert.ok(P.PHASE[p.status], p.id + ': no phase for status');
  }
});

test('every claim names a source that exists and carries the day it was made', () => {
  const src = registry.sources;
  for (const [id, s] of Object.entries(src)) {
    assert.ok(/^https:\/\//.test(s.url), id + ': source URL must be https');
    assert.ok(s.label && s.label.length > 5, id + ': source needs a label');
    assert.ok(validDay(s.date), id + ': source date "' + s.date + '" is not a real YYYY-MM-DD day');
  }
  for (const p of registry.projects) {
    for (const id of p.sources || []) assert.ok(src[id], p.id + ': unknown source "' + id + '"');
    assert.ok((p.sources || []).length > 0, p.id + ': a project with no source at all');
    assert.ok(validDay(p.verified), p.id + ': `verified` must be the day a human last checked it');
    for (const k of ['target', 'progress']) {
      const c = p[k];
      if (!c) continue;
      assert.ok(src[c.src], p.id + '.' + k + ' cites an unknown source "' + c.src + '"');
      assert.ok(validDay(c.asOf), p.id + '.' + k + ' has no valid asOf day');
    }
    if (p.facts) assert.ok(src[p.facts.src], p.id + '.facts cites an unknown source');
  }
});

test('a vague target is shown as "by", a precise one as "on"', () => {
  for (const p of registry.projects) {
    const t = p.target;
    if (!t) continue;
    if (t.date) assert.ok(validDay(t.date), p.id + ': target.date must be a real day');
    else {
      assert.ok(t.text, p.id + ': a target needs a date or text');
      assert.ok(validDay(t.end), p.id + ': a target stated only as a period needs `end`, the last day of that period');
    }
    assert.ok(!('launch' in p), p.id + ': never set `launch` here: a planned line goes live by being moved into the live data, not because a date passed');
  }
});

test('progress is a percentage', () => {
  for (const p of registry.projects) if (p.progress) {
    assert.ok(typeof p.progress.pct === 'number' && p.progress.pct >= 0 && p.progress.pct <= 100, p.id + ': progress.pct out of range');
  }
});

/* --- the generated data: what the map draws -------------------------------------------- */
test('every curated project resolved to real geometry (a failed fetch must not drop lines)', () => {
  const have = new Map(allLines.map(l => [l.id, l]));
  const missing = registry.projects.filter(p => !have.has(p.id) || !(have.get(p.id).paths || []).length || !have.get(p.id).paths[0].length);
  assert.deepStrictEqual(missing.map(p => p.id), [], 'registry projects with no drawn line: the OSM match failed or a fetch was partial');
});

test('a curated line carries its sources; an automatic one is marked unverified and says why', () => {
  for (const l of allLines) {
    if (l.auto) {
      assert.strictEqual(l.verified, null, l.ref + ': an OpenStreetMap-only entry must not claim to be verified');
      assert.ok(!l.target && !l.progress, l.ref + ': an automatic entry may not invent a target or progress');
      assert.ok(l.sources.length === 1 && l.sources[0].label === 'OpenStreetMap', l.ref + ': its only source is OpenStreetMap, and it must say so');
    } else {
      assert.ok(validDay(l.verified), l.ref + ': a curated line has a verified day');
      assert.ok(l.sources.length >= 1, l.ref + ': no sources');
    }
    for (const s of l.sources) assert.ok(/^https:\/\//.test(s.url), l.ref + ': source without an https URL');
  }
});

test('refs are unique within a city, live lines included, so a chip always opens the right line', () => {
  for (const city of Object.keys(cityDefs)) {
    const seen = new Set();
    for (const f of ({ istanbul: ['lines.json', 'b2-line.json'], ankara: ['ankara-lines.json'], izmir: ['izmir-lines.json'],
                       bursa: ['bursa-lines.json'], antalya: ['antalya-lines.json'], kocaeli: ['kocaeli-lines.json'] })[city]) {
      for (const l of H.json(f)) if (l.scope !== 'planned') seen.add(l.ref);
    }
    for (const l of (planned.cities[city] || [])) {
      assert.ok(!seen.has(l.ref), city + ': "' + l.ref + '" is already a line in that city');
      seen.add(l.ref);
    }
  }
});

/* --- shape: the user's rule is "no random straight lines" ---------------------------- */
const hav = (a, b) => P.meters(a, b);
function shape(paths) {
  let km = 0, maxSeg = 0, long = 0, pts = 0;
  for (const p of paths) { pts += p.length; for (let i = 1; i < p.length; i++) { const m = hav(p[i - 1], p[i]); km += m; maxSeg = Math.max(maxSeg, m); if (m > 500) long += m; } }
  return { km: km / 1000, maxSeg, longPct: km ? 100 * long / km : 0, pts };
}

test('no line is a hand-drawn straight segment: each has real vertices, or is marked indicative', () => {
  for (const l of allLines) {
    assert.strictEqual(l.geometry.kind, 'osm', l.ref + ': geometry must come from OpenStreetMap, never typed in');
    const s = shape(l.paths);
    assert.ok(s.pts >= 4, l.ref + ': only ' + s.pts + ' vertices - that is a ruler line, not an alignment');
    const looksStraight = s.maxSeg > 2000 || s.longPct >= 70;
    if (!looksStraight) assert.ok(s.pts / Math.max(s.km, 0.1) >= 2.5, l.ref + ': ' + s.pts + ' vertices over ' + s.km.toFixed(1) + ' km is too few to be a surveyed route');
    assert.strictEqual(!!l.geometry.schematic, looksStraight,
      l.ref + ': a sparsely mapped alignment (longest run ' + Math.round(s.maxSeg) + ' m, ' + Math.round(s.longPct) + '% in runs over 500 m) must be flagged indicative, and only those');
  }
});

test('every drawn line lies in its own city (the İstanbul / Kocaeli overlap resolved once)', () => {
  const PAD = 0.12;
  for (const l of allLines) {
    const b = cityDefs[l._city].box;
    for (const p of l.paths) for (const [la, lo] of p) {
      assert.ok(la >= b.s - PAD && la <= b.n + PAD && lo >= b.w - PAD && lo <= b.e + PAD, l._city + ' / ' + l.ref + ': a point at ' + la + ',' + lo + ' is outside the city');
    }
  }
  // the same OSM way must not be drawn twice, once per city file
  const seen = new Map();
  for (const l of allLines) {
    const first = l.paths[0][0].join(',');
    const k = l.ref + '|' + first;
    assert.ok(!seen.has(first) || seen.get(first) === l._city, 'a line starting at ' + first + ' appears in both ' + seen.get(first) + ' and ' + l._city);
    seen.set(first, l._city);
  }
});

test('mapped stations sit on the drawn alignment', () => {
  for (const l of allLines) for (const s of l.stations || []) {
    let best = Infinity;
    for (const p of l.paths) best = Math.min(best, P.nearestOn(p, [s.lat, s.lng]).d);
    assert.ok(best <= 160, l.ref + ': station "' + s.name + '" is ' + Math.round(best) + ' m from the line');
  }
});

test('the published length is within reach of the mapped length, or the gap is on record', () => {
  // a line whose OSM alignment is half the published length is probably the wrong way, not a rounding difference
  const bad = [];
  for (const l of allLines) {
    if (l.auto || !l.km) continue;
    const mapped = l.geometry.mappedKm, ratio = mapped / l.km;
    if (ratio < 0.4 || ratio > 1.6) bad.push(l.ref + ': ' + l.km + ' km published vs ' + mapped + ' km mapped');
  }
  assert.deepStrictEqual(bad, []);
});

/* --- the pipeline's pure helpers -------------------------------------------------------- */
test('dedupTubes keeps one of two parallel tubes and chainPaths stitches pieces end to end', () => {
  const a = [[41.000, 29.000], [41.000, 29.010], [41.000, 29.020]];
  const b = a.map(([x, y]) => [x + 0.0003, y]);                 // ~33 m away: the second bore of the same tunnel
  assert.strictEqual(P.dedupTubes([a, b], 100).length, 1);
  const far = a.map(([x, y]) => [x + 0.01, y]);                // ~1.1 km away: a different line
  assert.strictEqual(P.dedupTubes([a, far], 100).length, 2);
  const p1 = [[41, 29], [41, 29.01]], p2 = [[41, 29.0101], [41, 29.02]];   // a ~10 m gap
  const chains = P.chainPaths([p1, p2], 120);
  assert.strictEqual(chains.length, 1);
  assert.ok(P.chainLen(chains[0]) > 1500);
});

test('clipPath cuts between two points and chaikin smooths without moving the ends', () => {
  const line = [[41, 29.00], [41, 29.01], [41, 29.02], [41, 29.03]];
  const part = P.clipPath(line, [41, 29.009], [41, 29.021]).path;
  assert.ok(part[0][1] > 29.0085 && part[part.length - 1][1] < 29.0215, 'the clip should end near the requested points');
  assert.ok(P.chainLen(part) < P.chainLen(line));
  const bent = [[41, 29], [41.01, 29.01], [41, 29.02]];
  const sm = P.chaikin(bent, 2);
  assert.ok(sm.length > bent.length, 'smoothing adds vertices');
  assert.deepStrictEqual(sm[0], bent[0]); assert.deepStrictEqual(sm[sm.length - 1], bent[bent.length - 1]);
});

test('fold treats Turkish letters and spacing the way a person reads them', () => {
  assert.strictEqual(P.fold('Üsküdar'), P.fold('USKUDAR'));
  assert.strictEqual(P.fold('IŞIK'), P.fold('ışık'));
});

test('autoRef turns an OpenStreetMap name into a short, readable chip', () => {
  assert.strictEqual(P.autoRef('M İncirli - Söğütlüçeşme Metro Hattı'), 'İncirli–Söğütlüçeşme');
  assert.strictEqual(P.autoRef('M2-M3 Bağlantı Hattı'), 'M2-M3 Bağlantı');
  assert.strictEqual(P.autoRef('M3 (Gebze – Sabiha Gökçen Havalimanı) Hattı'), 'M3 Gebze–Sabiha Gökçen Havalimanı');
  assert.ok(P.autoRef('Yıldırım Beyazıt Üniversitesi - Çubuk Raylı Sistem Bağlantı Projesi').length <= 34);
});

test('isSchematic flags a long straight run and leaves a curved alignment alone', () => {
  const straight = [[[41, 29], [41, 29.03]]];                              // one ~2.5 km segment
  assert.ok(P.isSchematic(straight));
  const curved = [[...Array(60).keys()].map(i => [41 + 0.002 * Math.sin(i / 5), 29 + i * 0.002])];
  assert.ok(!P.isSchematic(curved));
});

/* --- the built page -------------------------------------------------------------------- */
test('the built page ships exactly the committed planned lines (no build drift)', () => {
  const built = H.cities();
  for (const [city, ls] of Object.entries(planned.cities)) {
    const inPage = (built[city].lines || []).filter(l => l.scope === 'planned').map(l => l.ref).sort();
    assert.deepStrictEqual(inPage, ls.map(l => l.ref).sort(), city + ': the page and planned-lines.json disagree');
  }
});

test('the page keeps unverified entries flagged and draws indicative alignments as indicative', () => {
  const built = H.cities();
  const inPage = Object.values(built).flatMap(c => (c.lines || []).filter(l => l.scope === 'planned'));
  const autos = inPage.filter(l => l.auto);
  assert.ok(autos.length > 0, 'no unverified entries reached the page');
  assert.ok(autos.every(l => l.verified === null), 'an unverified entry reached the page marked as verified');

  const script = H.appScript();
  assert.ok(/\$\{l\.verified\?'':' unv'\}/.test(script), 'the legend must mark a chip whose project is unverified');
  assert.ok(/line\.geometry && line\.geometry\.schematic/.test(script), 'a schematic alignment must be drawn as indicative');
  assert.ok(/vision:\s*\{[^}]*bare:true/.test(script), 'long-term plans are drawn bare (a halo under faint dots reads as a white line)');
});

test('the panel never prints an empty or "unknown" fact, and always shows who said the target and when', () => {
  const script = H.appScript();
  const fn = /function plannedPanelHTML\(line\)\{[\s\S]*?\n\}\n/.exec(script);
  assert.ok(fn, 'plannedPanelHTML not found');
  assert.ok(/t\('vAsOf'\)/.test(fn[0]), 'a target must be shown with its as-of day');
  assert.ok(/function planFact\(label, value\)\{\s*if\(value === undefined \|\| value === null \|\| value === '' \|\| value === false\) return '';/.test(script),
    'a fact with no value must be left out, not shown as a dash');
});
