// Build ANKARA and İZMİR urban rail networks from OSM route relations (city-geom.json)
// → ankara-lines.json / izmir-lines.json, same shape as İstanbul's lines.json so the app can
// reuse project()/openLine()/the routing graph unchanged when the user switches city.
const fs = require('fs'); const path = require('path');
const DIR = __dirname;

const Rm = 6371000, toRad = d => d * Math.PI / 180;
function meters(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]), la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Rm * Math.asin(Math.sqrt(h));
}
const chainLen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]); return s; };
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
// order stations along the path (member order is usually travel order, but verify by projection
// for these city relations — unlike the gapped intercity ones these are single clean chains)
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
/* Two Akçaray stops whose raw OSM name does not survive cleaning. Keyed on the exact raw
   string, so if OSM is corrected upstream the entry simply stops matching rather than
   silently re-imposing a stale name.
     "Tren Garı"            → stripping the "Garı" suffix leaves a bare "Tren" ("train").
                              UlaşımPark's own station list calls the stop "Gar".
     "Seka Devlet Hatanesi" → typo for "Hastanesi"; the M2 relation spells the same
                              station correctly, so this is an upstream slip, not a variant. */
const NAME_FIX = {
  'Tren Garı': 'Gar',
  'Seka Devlet Hatanesi': 'Seka Devlet Hastanesi'
};
function cleanName(raw) {
  const fixed = NAME_FIX[String(raw || '').trim()];
  if (fixed) return fixed;
  // Bursa's tram stops are tagged "T1-Gazcılar" / "T3-Kayhan" — drop the line-ref prefix
  let nm = String(raw || '').trim().replace(/^[A-ZİĞÜŞÖÇ]{1,2}\d[A-Z]?\s*[-–]\s*/i, '');
  let prev;
  do { prev = nm;
    nm = nm.replace(/[\s,]+(Metro\s+İstasyonu|Metro\s+Istasyonu|İstasyonu|Istasyonu|Metro|Gar[ıi]|Tramvay\s+Dura[ğg][ıi]|Dura[ğg][ıi])$/i, '').trim();
  } while (nm !== prev && nm.length > 2);
  return nm;
}

// colour sources: OSM `colour` where the relation carries a real per-line value (A1/M4/B1/T1/T2),
// otherwise the published EGO / İzmir Metro map convention. Colours are cosmetic — geometry,
// stations and fares are the data that must be right.
/* Each *-geom.json is raw Overpass `out geom` output. kocaeli-geom.json came from:
     [out:json][timeout:240];
     ( relation(13772560); relation(19531211); relation(19531294); relation(19531295);
       relation(19531296); relation(19697950); relation(19675921); relation(19664874);
       relation(19675941); relation(19676169); )->.r;
     .r out geom; node(r.r); out;
   Fetch it to a FILE, not through a shell string. Overpass sends no charset, so Windows
   PowerShell decodes the body as Latin-1 and every Turkish name silently becomes mojibake
   ("Kuruçeşme" → "KuruÃ§eÅme"). Invoke-WebRequest -OutFile writes the raw bytes. */
const CITY_SRC = { ankara:'city-geom.json', izmir:'city-geom.json',
                   bursa:'city2-geom.json', antalya:'city2-geom.json',
                   kocaeli:'kocaeli-geom.json' };
const CITY_LINES = {
  // Bursa — BursaRay light metro (B1/B2) + city trams. Burulaş's T2 (Kent Meydanı–Terminal)
  // is omitted: its OSM relation carries no station nodes, and a line you can see but cannot
  // route on would be worse than leaving it out.
  bursa: [
    { rel:7868620,  ref:'B1', kind:'subway', color:'#E30613', official:'BursaRay B1 · Geçit/Balat – Arabayatağı' },
    { rel:7869620,  ref:'B2', kind:'subway', color:'#8A90A0', official:'BursaRay B2 · Üniversite – Kestel' },
    { rel:11322581, ref:'T1', kind:'tram',   color:'#A0522D', official:'T1 · Bursa Tramvayı (nostaljik ring)' },
    { rel:19781239, ref:'T3', kind:'tram',   color:'#0EA5A5', official:'T3 · Bursa Tramvayı' }
  ],
  // Antalya — AntRay light rail. T1A is the airport branch, T1B the Expo branch.
  antalya: [
    { rel:11813037, ref:'T1A', kind:'tram', color:'#E4032E', official:'AntRay T1A · Fatih – Havalimanı' },
    { rel:11813036, ref:'T1B', kind:'tram', color:'#F5871F', official:'AntRay T1B · Fatih – Expo' },
    { rel:11813041, ref:'T2',  kind:'tram', color:'#2E7D32', official:'T2 · Müze – Zerdalilik (nostaljik)' },
    { rel:10651839, ref:'T3',  kind:'tram', color:'#0072BC', official:'AntRay T3 · Müze – Varsak' }
  ],
  // Kocaeli — Akçaray tram (UlaşımPark) plus the metro projects. Station counts cross-check
  // exactly against UlaşımPark's published lines: T1=16, T2=18, T3=7.
  kocaeli: [
    { rel:13772560, ref:'T1', kind:'tram', color:'#1E9E48', official:'Akçaray T1 · Otogar – Kuruçeşme', order:'members' },
    { rel:19531294, ref:'T2', kind:'tram', color:'#00A0C6', official:'Akçaray T2 · Kuruçeşme – Şehir Hastanesi', order:'members' },
    // OSM tags this relation ref=T1, but it ends at Kocaelispor (the stadium) over 7 stations,
    // which is UlaşımPark's T3 exactly. Labelled by what it actually serves, not by the tag.
    { rel:19531296, ref:'T3', kind:'tram', color:'#E8A33D', official:'Akçaray T3 · Otogar – Kocaeli Stadyumu', order:'members' },
    // Kocaeli's first metro: 11 stations over 15.4 km, ~87% built, council target 29 Oct 2026.
    // Ships as planned and flips live by itself on that date via isLive()'s launch hook.
    { rel:19675921, ref:'M1', kind:'subway', color:'#C2185B', official:'M1 · Darıca Sahil – Gebze OSB',
      scope:'planned', status:'Under construction', launch:'2026-10-29', order:'members' },
    // Körfezray has no published opening date, and its OSM geometry is one schematic way rather
    // than surveyed track — flagged as an approximate alignment so the map does not overstate it.
    { rel:19664874, ref:'M2', kind:'subway', color:'#7E57C2', official:'M2 Körfezray · Derince – İzmit Doğu',
      scope:'planned', status:'Approximate alignment' }
    // Omitted deliberately: M3 Gebze–Sabiha Gökçen (rel 19675941), M4 İzmit–Gölcük (rel 19676169)
    // and the T3 Kartepe extension (rel 19697950). All three carry ZERO station nodes in OSM, so
    // they would draw as a line you can see but cannot route on — worse than leaving them out.
  ],
  ankara: [
    { rel:456707,   ref:'M1', kind:'subway',   color:'#BF0E1C', official:'M1 · Kızılay – Batıkent' },
    { rel:3604162,  ref:'M2', kind:'subway',   color:'#0B4EA2', official:'M2 · Kızılay – Koru' },
    { rel:7878077,  ref:'M3', kind:'subway',   color:'#00A3E0', official:'M3 · Batıkent – OSB Törekent' },
    { rel:7981739,  ref:'M4', kind:'subway',   color:'#EDAF2E', official:'M4 · Kızılay – Keçiören' },
    { rel:456693,   ref:'A1', kind:'subway',   color:'#056D2E', official:'Ankaray · AŞTİ – Dikimevi' },
    { rel:14118633, ref:'B1', kind:'suburban', color:'#00A49F', official:'Başkentray · Sincan – Kayaş' }
  ],
  izmir: [
    { rel:2707717,  ref:'M1',    kind:'subway',   color:'#005BAA', official:'M1 · Fahrettin Altay – Evka 3' },
    { rel:15423228, ref:'İZBAN', kind:'suburban', color:'#D6001C', official:'İZBAN · Aliağa – Tepeköy' },
    { rel:12342705, ref:'T2',    kind:'tram',     color:'#50AB43', official:'T2 · Konak Tramvayı' },
    { rel:12378469, ref:'T1',    kind:'tram',     color:'#508243', official:'T1 · Karşıyaka Tramvayı' },
    { rel:16998062, ref:'T3',    kind:'tram',     color:'#2E9E8F', official:'T3 · Çiğli Tramvayı' }
  ]
};

const SRC_CACHE = {};
function loadSrc(file){
  if (SRC_CACHE[file]) return SRC_CACHE[file];
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const relById = {}, nodeById = {};
  for (const e of raw.elements) { if (e.type === 'relation') relById[e.id] = e; else if (e.type === 'node') nodeById[e.id] = e; }
  return (SRC_CACHE[file] = { relById, nodeById });
}

for (const city of Object.keys(CITY_LINES)) {
  const { relById, nodeById } = loadSrc(CITY_SRC[city] || 'city-geom.json');
  const out = [];
  for (const cfg of CITY_LINES[city]) {
    const rel = relById[cfg.rel];
    if (!rel) { console.warn('  ! missing relation', cfg.rel, cfg.ref); continue; }
    const ways = (rel.members || []).filter(m => m.type === 'way' && m.geometry)
                                    .map(m => m.geometry.map(g => [g.lat, g.lon]));
    if (!ways.length) { console.warn('  ! no geometry', cfg.ref); continue; }
    const chains = buildChains(ways, 60).sort((a, b) => chainLen(b) - chainLen(a));
    const paths = chains.filter(c => c.length > 1 && chainLen(c) > 300)
                        .map(c => simplify(c, 0.00004).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));
    if (!paths.length) { console.warn('  ! no usable chain', cfg.ref); continue; }

    const seen = new Set(); let stations = [];
    for (const m of (rel.members || [])) {
      if (m.type !== 'node') continue;
      const n = nodeById[m.ref]; if (!n || !n.tags || !n.tags.name) continue;
      const nm = cleanName(n.tags.name);
      const f = nm.toLocaleLowerCase('tr');
      if (!nm || seen.has(f)) continue; seen.add(f);
      stations.push({ name: nm, lat: +n.lat.toFixed(5), lng: +n.lon.toFixed(5) });
    }
    // A fragmented relation (İZBAN stitches into 41 chains) means chains[0] covers only part of
    // the corridor, so projecting onto it mis-sorts the rest. For those, order along the axis
    // between the two farthest-apart stations — correct for a linear commuter corridor.
    if (cfg.order === 'members') {
      /* keep OSM member order verbatim */
    } else if (paths.length > 3 && stations.length > 2) {
      let a = 0, b = 1, far = -1;
      for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
        const d = (stations[i].lat - stations[j].lat) ** 2 + (stations[i].lng - stations[j].lng) ** 2;
        if (d > far) { far = d; a = i; b = j; }
      }
      const A = stations[a], B = stations[b], vx = B.lat - A.lat, vy = B.lng - A.lng, L2 = vx * vx + vy * vy || 1;
      stations = stations.map(st => ({ st, s: ((st.lat - A.lat) * vx + (st.lng - A.lng) * vy) / L2 }))
                         .sort((x, y) => x.s - y.s).map(x => x.st);
    } else {
      stations = orderAlong(stations, chains[0]);
    }
    out.push({ ref: cfg.ref, kind: cfg.kind, color: cfg.color, paths, stations,
               scope: cfg.scope || 'active', official: cfg.official, city,
               status: cfg.status || undefined, launch: cfg.launch || undefined });
  }
  const file = path.join(DIR, city + '-lines.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const km = out.reduce((s, l) => s + chainLen(l.paths[0]) / 1000, 0);
  console.log(city.toUpperCase().padEnd(8), out.length, 'lines,',
              out.reduce((s, l) => s + l.stations.length, 0), 'stations,',
              km.toFixed(1), 'km,', (fs.statSync(file).size / 1024).toFixed(1), 'KB');
  for (const l of out)
    console.log('   ', l.ref.padEnd(6), (l.scope==='active'?'    ':'plan'), String(l.stations.length).padStart(2), 'stops  ',
                (l.stations[0] ? l.stations[0].name : '?'), '→', (l.stations.length ? l.stations[l.stations.length - 1].name : '?'));
}
