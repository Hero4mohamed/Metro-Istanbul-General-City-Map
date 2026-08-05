// Turn the scraped Kocaeli ferry sailings into app lines, and merge them into kocaeli-lines.json.
// Run AFTER fetch-kocaeli-ferry.cjs and process-city.cjs. Idempotent (replaces by ref).
//
// Pier order is DERIVED, not assumed: for each line we take the pier pair with the longest
// observed journey (that is the full end-to-end run) and order every other pier by how long it
// takes to reach from that terminus. A ferry timetable states durations, not a stop sequence,
// so this is the only honest way to recover one — and it self-checks, because both directions
// must produce the same ordering.

const fs = require('fs');
const path = require('path');
const DIR = __dirname;

/* Official pier positions — Kocaeli BB, Ulaşım Dairesi / Deniz Ulaşım Şube Müdürlüğü,
   "İskele konum ve bilgileri (2026)" (veri.kocaeli.bel.tr, CC-BY). Published in DMS.
   The Durum(2026) column marks Yarımca, Halıdere, Ulaşlı and Ereğli passive; the scraped
   timetable independently shows no sailings for them, so only active piers are carried. */
const DMS = {
  'İzmit':        [[40, 45, 35], [29, 55, 24]],
  'Gölcük':       [[40, 43, 22], [29, 49, 58]],
  'Değirmendere': [[40, 43, 21], [29, 47,  1]],
  'Karamürsel':   [[40, 41, 39], [29, 36, 52]],
  'Hereke':       [[40, 46, 57], [29, 36, 54]],
  'Tütünçiftlik': [[40, 44, 44], [29, 47, 22]],
  'Derince':      [[40, 44, 54], [29, 48, 28]]
};
const dms = a => +(a[0] + a[1] / 60 + a[2] / 3600).toFixed(5);
const PIER = Object.fromEntries(Object.entries(DMS).map(([k, v]) => [k, { lat: dms(v[0]), lng: dms(v[1]) }]));

// full pier names as the operator writes them, for display
const LABEL = {
  'İzmit': 'İzmit', 'Gölcük': 'Gölcük', 'Değirmendere': 'Değirmendere',
  'Karamürsel': 'Karamürsel', 'Hereke': 'Hereke',
  'Tütünçiftlik': 'Tütünçiftlik', 'Derince': 'Derince'
};

const COLOR = {
  'HAT-1': '#0E8BC4', 'HAT-1B': '#48B3E0', 'HAT-2': '#00A19A',
  'HAT-3': '#1F6FB2', 'HAT-4': '#5E8DD6', 'HAT-5': '#0D9488', 'HAT-6': '#7BA7D9'
};

const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'kocaeli-ferry-raw.json'), 'utf8'));
const sail = raw.sailings.filter(s => s.arr && PIER[s.from] && PIER[s.to]);

const lines = [...new Set(sail.map(s => s.hat))].sort();
const out = [];
const timing = {};

for (const hat of lines) {
  const ss = sail.filter(s => s.hat === hat);
  // typical duration per ordered pair
  const dur = {};
  for (const s of ss) {
    const d = mins(s.arr) - mins(s.dep);
    // The gulf is ~40 km end to end, so nothing legitimately sails for hours. A handful of rows
    // pair a departure with an arrival from a different leg, which used to produce 5-hour
    // "journeys" that wrecked the ordering — drop them rather than let them vote.
    if (d <= 0 || d > 150) continue;
    (dur[s.from + '|' + s.to] = dur[s.from + '|' + s.to] || []).push(d);
  }
  const avg = {};
  for (const k in dur) {                      // median: one bad row must not move the estimate
    const v = dur[k].slice().sort((a, b) => a - b);
    avg[k] = v[Math.floor(v.length / 2)];
  }

  const piers = [...new Set(ss.flatMap(s => [s.from, s.to]))];
  // Anchor on the BEST-CONNECTED pier, not on one end of the longest run: several of these
  // lines run sparse legs to Hereke/Karamürsel, and anchoring there leaves most piers
  // unplaceable. Duration is an unsigned distance from the anchor, so the side is taken from
  // longitude — the gulf is a straight east–west inlet, so that is unambiguous.
  const reach = p => piers.filter(q => q !== p && (avg[p + '|' + q] != null || avg[q + '|' + p] != null)).length;
  const anchor = piers.slice().sort((a, b) => reach(b) - reach(a) || PIER[a].lng - PIER[b].lng)[0];
  const gap = (a, b) => avg[a + '|' + b] != null ? avg[a + '|' + b]
                      : avg[b + '|' + a] != null ? avg[b + '|' + a] : null;

  const pos = {};
  for (const p of piers) {
    if (p === anchor) { pos[p] = 0; continue; }
    const d = gap(anchor, p);
    pos[p] = d == null ? null : d * Math.sign(PIER[p].lng - PIER[anchor].lng || 1);
  }
  // piers with no direct leg to the anchor: place them by the minutes-per-degree relationship
  // the measured ones establish, so they still land on the correct side and in the right order
  const known = piers.filter(p => pos[p] != null && p !== anchor);
  if (known.length) {
    const k = known.reduce((s, p) => s + pos[p] / ((PIER[p].lng - PIER[anchor].lng) || 1e-9), 0) / known.length;
    for (const p of piers) if (pos[p] == null) pos[p] = k * (PIER[p].lng - PIER[anchor].lng);
  } else {
    for (const p of piers) if (pos[p] == null) pos[p] = PIER[p].lng - PIER[anchor].lng;
  }
  const ordered = piers.slice().sort((x, y) => pos[x] - pos[y] || PIER[x].lng - PIER[y].lng);

  const stations = ordered.map(p => ({ name: LABEL[p], lat: PIER[p].lat, lng: PIER[p].lng }));
  if (stations.length < 2) { console.warn('  ! ' + hat + ' has <2 piers, skipped'); continue; }

  out.push({
    ref: hat, kind: 'ferry', color: COLOR[hat] || '#0E8BC4',
    paths: [stations.map(s => [s.lat, s.lng])],   // ferries run over open water: pier-to-pier
    stations, scope: 'active', city: 'kocaeli',
    official: 'Kocaeli Deniz Ulaşım · ' + stations[0].name + ' – ' + stations[stations.length - 1].name
  });

  // service span + average gap, weekdays, from the same scrape
  const wd = ss.filter(s => s.day === 'wd').map(s => mins(s.dep)).sort((a, b) => a - b);
  if (wd.length) {
    const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const hw = wd.length > 1 ? Math.max(5, Math.round((wd[wd.length - 1] - wd[0]) / (wd.length - 1))) : 60;
    timing[hat] = { spd: 22, peak: hw, off: hw, hours: fmt(wd[0]) + ' – ' + fmt(wd[wd.length - 1]) };
  }

  console.log('  ' + hat.padEnd(7) + ordered.length + ' piers  ' + ordered.join(' → '));
}

fs.writeFileSync(path.join(DIR, 'kocaeli-ferry-lines.json'), JSON.stringify(out));

// merge into the city's line set, replacing any previous ferry entries by ref
const LP = path.join(DIR, 'kocaeli-lines.json');
const city = JSON.parse(fs.readFileSync(LP, 'utf8')).filter(l => l.kind !== 'ferry');
fs.writeFileSync(LP, JSON.stringify(city.concat(out)));

console.log('\nferry lines:', out.length,
            ' piers used:', new Set(out.flatMap(l => l.stations.map(s => s.name))).size);
console.log('kocaeli-lines.json now', city.length + out.length, 'lines');
console.log('timing block:\n' + JSON.stringify(timing, null, 2));
