// Build Turkey's intercity rail network (TCDD) from OSM route relations:
//   yht-geom.json    → high-speed (YHT) services
//   anahat-geom.json → mainline (Ana Hat) express / sleeper services
// Output: intercity-lines.json — same shape as the metro lines so the app can reuse
// project()/openLine(), but scope:'intercity' so it only draws on the new tab.
const fs = require('fs'); const path = require('path');
const DIR = __dirname;

const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]); return s; };

// order stations by their projected position ALONG the path (OSM member order is unsorted),
// so strip maps and endpoint labels read geographically instead of jumbled
function orderAlong(stations, path) {
  if (!path || path.length < 2) return stations;
  const cum = [0]; for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + meters(path[i - 1], path[i]);
  return stations.map(st => {
    let best = Infinity, s = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      let t = L2 ? ((st.lat - a[0]) * dx + (st.lng - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const px = a[0] + dx * t, py = a[1] + dy * t, d = (st.lat - px) ** 2 + (st.lng - py) ** 2;
      if (d < best) { best = d; s = cum[i] + meters(a, [px, py]); }
    }
    return { st, s };
  }).sort((x, y) => x.s - y.s).map(x => x.st);
}
// flip so the first station matches the first city named in `official` (e.g. İstanbul–Bükreş → Halkalı first)
function orientByOfficial(stations, official) {
  if (stations.length < 2) return stations;
  const first = ((official.split('·').pop() || '').split(/[–—-]/)[0] || '').trim().toLowerCase();
  const nm = s => s.name.toLowerCase();
  const hit = (s) => first && (nm(s).includes(first) || first.includes(nm(s)));
  const isIst = first.includes('istanbul') || first.includes('i̇stanbul');
  const endIsHalkali = /halkal/i.test(stations[stations.length - 1].name);
  const startIsHalkali = /halkal/i.test(stations[0].name);
  if ((isIst && endIsHalkali && !startIsHalkali) || (hit(stations[stations.length - 1]) && !hit(stations[0])))
    return stations.slice().reverse();
  return stations;
}

// merge ways by shared endpoints into connected chains (never bridge across gaps)
function buildChains(ways, tol) {
  let ch = ways.map(w => w.slice()); let merged = 1;
  while (merged) {
    merged = 0;
    for (let i = 0; i < ch.length && !merged; i++) for (let j = i + 1; j < ch.length; j++) {
      const A = ch[i], B = ch[j], a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1];
      let nc = null;
      if (meters(a1, b0) < tol) nc = A.concat(B.slice(1));
      else if (meters(a1, b1) < tol) nc = A.concat(B.slice().reverse().slice(1));
      else if (meters(a0, b1) < tol) nc = B.concat(A.slice(1));
      else if (meters(a0, b0) < tol) nc = B.slice().reverse().concat(A.slice(1));
      if (nc) { ch[i] = nc; ch.splice(j, 1); merged = 1; break; }
    }
  }
  return ch;
}
// Douglas–Peucker (national scale → a coarse tolerance keeps the payload small)
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = eps * eps, keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const st = [[0, pts.length - 1]];
  const sd = (p, a, b) => { const x = a[0], y = a[1]; let dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { dx = p[0] - b[0]; dy = p[1] - b[1]; }
      else if (t > 0) { dx = p[0] - (x + dx * t); dy = p[1] - (y + dy * t); }
      else { dx = p[0] - x; dy = p[1] - y; } }
    else { dx = p[0] - x; dy = p[1] - y; }
    return dx * dx + dy * dy; };
  while (st.length) {
    const [s, e] = st.pop(); let md = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const dd = sd(pts[i], pts[s], pts[e]); if (dd > md) { md = dd; idx = i; } }
    if (md > sq && idx !== -1) { keep[idx] = true; st.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function loadRels(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const nodeById = {};
  for (const n of raw.elements.filter(e => e.type === 'node')) nodeById[n.id] = n;
  return { rels: raw.elements.filter(e => e.type === 'relation'), nodeById };
}

// curated service facts. Durations/frequencies are TYPICAL published values and fares are the
// TCDD tariff effective 15 Jan 2026 (+19.23%) — both are shown with that date in the UI and
// linked to the official booking site, never presented as live availability.
const SERVICES = {
  18652772: { ref:'YHT İST–ANK', kind:'yht', color:'#C8102E', official:'YHT · İstanbul – Ankara',
              fare:930, mins:284, daily:17, first:'06:00', last:'22:00', spd:250, km:533 },
  18652775: { ref:'YHT İST–KON', kind:'yht', color:'#E4572E', official:'YHT · İstanbul – Konya',
              fare:1355, mins:301, daily:5, spd:250 },
  18652776: { ref:'YHT İST–SVS', kind:'yht', color:'#8E44AD', official:'YHT · İstanbul – Sivas',
              fare:null, mins:null, daily:2, spd:250, note:'via Ankara' },
  18652779: { ref:'YHT ANK–SVS', kind:'yht', color:'#2E86AB', official:'YHT · Ankara – Sivas',
              fare:940, mins:151, daily:7, first:'07:00', last:'19:10', spd:250, km:465 },
  18652780: { ref:'YHT ANK–KON', kind:'yht', color:'#F5A623', official:'YHT · Ankara – Konya',
              fare:430, mins:109, daily:7, first:'06:30', last:'21:20', spd:250, km:306 },
  18652782: { ref:'KON–KRM',     kind:'regional', color:'#7CB342', official:'Bölgesel · Konya – Karaman',
              fare:null, mins:65, spd:200, km:102 },
  18713200: { ref:'Doğu Ekspresi', kind:'mainline', color:'#0F7B6C', official:'Ana Hat · Ankara – Kars',
              mins:1500, daily:1, spd:120, sleeper:true },
  12158683: { ref:'Van Gölü Eksp.', kind:'mainline', color:'#1B6CA8', official:'Ana Hat · Ankara – Tatvan',
              mins:1560, spd:120, sleeper:true },
  16121736: { ref:'İzmir Mavi Treni', kind:'mainline', color:'#3B7DD8', official:'Ana Hat · Ankara – İzmir',
              mins:840, daily:1, spd:120, sleeper:true },
  18320312: { ref:'Pamukkale Eksp.', kind:'mainline', color:'#B8860B', official:'Ana Hat · Eskişehir – Denizli',
              mins:600, daily:1, spd:120 },
  1298494:  { ref:'Toros Ekspresi', kind:'mainline', color:'#C2410C', official:'Ana Hat · Adana – Konya',
              mins:450, daily:1, spd:120 },
  18430359: { ref:'Güney Kurtalan Eksp.', kind:'mainline', color:'#6D28D9', official:'Ana Hat · Ankara – Kurtalan',
              mins:1560, spd:120, sleeper:true },
  // regional additions (put Samsun & Malatya on the map)
  19785141: { ref:'Sivas–Samsun Böl.', kind:'regional', color:'#2E9E5B', official:'Bölgesel · Sivas – Samsun',
              spd:100 },
  20211500: { ref:'Sivas–Malatya Böl.', kind:'regional', color:'#8D6E63', official:'Bölgesel · Sivas – Malatya',
              spd:100 },
  // international sleeper — İstanbul → Bucharest (Bosfor Ekspresi). Real OSM geometry; the
  // Bucharest cars split from the Sofia train at Dimitrovgrad (used to build Sofya below).
  16225058: { ref:'Bosfor Ekspresi', kind:'intl', color:'#0057B7', official:'Uluslararası · İstanbul – Bükreş',
              flag:'🇷🇴', intl:true, border:'Kapıkule', mins:1260, daily:1, first:'22:40', spd:100, sleeper:true }
};
// curated İstanbul→Sofia (Sofya Ekspresi): no clean OSM relation exists, so its path reuses the
// REAL Bucharest corridor to Dimitrovgrad (shared train) then continues to Plovdiv→Sofia. Stations
// & endpoints are real; the Bulgaria-west leg is approximate. Coords from the Bucharest relation.
const SOFIA = {
  ref:'Sofya Ekspresi', mode:'intl', color:'#009B74', official:'Uluslararası · İstanbul – Sofya',
  flag:'🇧🇬', intl:true, approx:true, border:'Kapıkule', mins:600, daily:1, first:'22:40', spd:100, sleeper:true,
  splitAt:[42.0548, 25.5931],                                  // Dimitrovgrad — where it leaves the Bucharest track
  tail:[ {name:'Plovdiv', lat:42.1436, lng:24.7419}, {name:'Sofia', lat:42.7141, lng:23.3197} ],
  stations:[ {name:'Halkalı',lat:41.0184,lng:28.7663}, {name:'Çerkezköy',lat:41.2860,lng:28.0000},
             {name:'Kapıkule',lat:41.7191,lng:26.3616}, {name:'Svilengrad',lat:41.7744,lng:26.1439},
             {name:'Dimitrovgrad',lat:42.0548,lng:25.5931}, {name:'Plovdiv',lat:42.1436,lng:24.7419},
             {name:'Sofia',lat:42.7141,lng:23.3197} ]
};

const out = [];
let bucharestChain = null;                                     // captured to build the Sofia corridor
for (const file of ['yht-geom.json', 'anahat-geom.json', 'intl-geom.json']) {
  const { rels, nodeById } = loadRels(file);
  for (const rel of rels) {
    const svc = SERVICES[rel.id];
    if (!svc) { console.warn('  ! no service entry for relation', rel.id, rel.tags && rel.tags.name); continue; }
    const ways = (rel.members || []).filter(m => m.type === 'way' && m.geometry)
                                    .map(m => m.geometry.map(g => [g.lat, g.lon]));
    if (!ways.length) { console.warn('  ! no geometry', svc.ref); continue; }
    const chains = buildChains(ways, 120).sort((a, b) => chainLen(b) - chainLen(a));
    if (rel.id === 16225058) bucharestChain = chains[0];       // longest chain = the İstanbul↔Bucharest corridor
    // keep every substantial chain so a gapped route still draws end to end
    const paths = chains.filter(c => c.length > 1 && chainLen(c) > 2000)
                        .map(c => simplify(c, 0.0016).map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]));
    if (!paths.length) { console.warn('  ! no usable chain', svc.ref); continue; }

    // stations = named node members, ordered along the main path
    const seen = new Set(), stations = [];
    for (const m of (rel.members || [])) {
      if (m.type !== 'node') continue;
      const n = nodeById[m.ref]; if (!n || !n.tags || !n.tags.name) continue;
      // strip station-type suffixes; they stack ("Polatlı YHT Garı"), so strip repeatedly
      let nm = n.tags.name.trim();
      let prev;
      do { prev = nm; nm = nm.replace(/[\s,]+(YHT|Gar[ıi]|İstasyonu|Istasyonu|Tren\s+Garı)$/i, '').trim(); }
      while (nm !== prev && nm.length > 2);
      if (seen.has(nm)) continue; seen.add(nm);
      stations.push({ name: nm, lat: +n.lat.toFixed(5), lng: +n.lon.toFixed(5) });
    }
    // OSM route relations list their stop members in travel sequence, so member order is
    // reliable; only flip it so the first station matches the first city in `official`.
    // (projecting onto the gapped geometry actually MIS-orders it — Halkalı sits on a spur.)
    const ordered = orientByOfficial(stations.slice(), svc.official);   // copy: orient may return the same ref
    stations.length = 0; stations.push(...ordered);
    // route length is CURATED (published figures only). Deriving it from the stitched geometry
    // under-reports badly when the relation has gaps (İstanbul–Ankara stitched to 244 of 533 km),
    // so an unknown length stays null and the UI simply omits it rather than showing a wrong number.
    out.push({ ref: svc.ref, kind: 'intercity', mode: svc.kind, color: svc.color, paths, stations,
               scope: 'intercity', official: svc.official, operator: svc.intl ? 'TCDD · int’l' : 'TCDD Taşımacılık',
               km: svc.km ?? null, fare: svc.fare ?? null, mins: svc.mins ?? null, daily: svc.daily ?? null,
               first: svc.first || null, last: svc.last || null, spd: svc.spd || null,
               sleeper: !!svc.sleeper, note: svc.note || null,
               flag: svc.flag || null, intl: !!svc.intl, border: svc.border || null });
  }
}

// ---- build İstanbul→Sofia from the real Bucharest corridor (shared to Dimitrovgrad) + tail ----
if (bucharestChain) {
  // orient the chain so index 0 is the İstanbul (Halkalı) end
  const halkali = [41.0184, 28.7663];
  let chain = bucharestChain.slice();
  if (meters(chain[0], halkali) > meters(chain[chain.length - 1], halkali)) chain.reverse();
  // cut at the point nearest Dimitrovgrad (where Sofia leaves the Bucharest track)
  let cut = chain.length - 1, best = Infinity;
  chain.forEach((p, i) => { const d = meters(p, SOFIA.splitAt); if (d < best) { best = d; cut = i; } });
  const shared = chain.slice(0, cut + 1);
  const full = shared.concat(SOFIA.tail.map(s => [s.lat, s.lng]));
  const sofiaPath = simplify(full, 0.0016).map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
  out.push({ ref: SOFIA.ref, kind: 'intercity', mode: SOFIA.mode, color: SOFIA.color, paths: [sofiaPath],
             stations: SOFIA.stations, scope: 'intercity', official: SOFIA.official, operator: 'TCDD · int’l',
             km: null, fare: null, mins: SOFIA.mins, daily: SOFIA.daily, first: SOFIA.first, last: null,
             spd: SOFIA.spd, sleeper: SOFIA.sleeper, note: null, flag: SOFIA.flag, intl: true,
             border: SOFIA.border, approx: true });
  console.log('  Sofia: reused', shared.length, 'real corridor pts +', SOFIA.tail.length, 'tail →', sofiaPath.length, 'pts');
} else console.warn('  ! Bucharest chain missing — Sofia not built');

const MODE_ORDER = { yht:0, intl:1, mainline:2, regional:3 };   // YHT first, international next, then domestic long/regional
out.sort((a, b) => (MODE_ORDER[a.mode] - MODE_ORDER[b.mode]) || a.ref.localeCompare(b.ref, 'tr'));
fs.writeFileSync(path.join(DIR, 'intercity-lines.json'), JSON.stringify(out));
console.log('REF'.padEnd(22), 'MODE'.padEnd(9), 'PTS'.padEnd(5), 'STOPS'.padEnd(6), 'KM'.padEnd(5), 'FARE');
for (const l of out)
  console.log(l.ref.padEnd(22), l.mode.padEnd(9), String(l.paths.reduce((s, p) => s + p.length, 0)).padEnd(5),
              String(l.stations.length).padEnd(6), String(l.km).padEnd(5), l.fare ? l.fare + ' TL' : '—');
console.log('\nLINES:', out.length, ' SIZE:', (fs.statSync(path.join(DIR, 'intercity-lines.json')).size / 1024).toFixed(1), 'KB');
