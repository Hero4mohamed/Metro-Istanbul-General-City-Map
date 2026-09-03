/* ===========================================================================
   3. ROUTING GRAPH (Dijkstra over per-line station nodes + transfers)
   =========================================================================== */
const G = {};            // nodeKey -> [{to,w}]
const nodeMeta = {};     // nodeKey -> {ref, idx, name, lat, lng}
const nameNodes = {};    // folded name -> [nodeKey]
const nkey = (ref,idx) => ref+"#"+idx;

liveLines.forEach(line => {
  const sp = KIND[line.kind].speed;
  line.stations.forEach((st,idx) => {
    const k = nkey(line.ref, idx);
    G[k] = []; nodeMeta[k] = { ref:line.ref, idx, name:st.name, lat:st.lat, lng:st.lng, s:st._s };
    (nameNodes[fold(st.name)] = nameNodes[fold(st.name)]||[]).push(k);
  });
  for(let i=0;i<line.stations.length-1;i++){
    const a=nkey(line.ref,i), b=nkey(line.ref,i+1);
    const dist = Math.abs(line.stations[i+1]._s - line.stations[i]._s);
    const w = (dist/1000)/sp*60 + DWELL/60;     // minutes
    G[a].push({to:b,w}); G[b].push({to:a,w});
  }
});
// transfer edges: ANY two stations on different lines within walking distance.
// Purely distance-gated, so same-named-but-distant stations never link (no
// Bosphorus teleports via name collisions like "Göztepe" / "Bahariye").
const allKeys = Object.keys(nodeMeta);
for(let i=0;i<allKeys.length;i++){
  for(let j=i+1;j<allKeys.length;j++){
    const a=nodeMeta[allKeys[i]], b=nodeMeta[allKeys[j]];
    if(a.ref===b.ref) continue;
    const d = metersBetween([a.lat,a.lng],[b.lat,b.lng]);
    if(d < TRANSFER_M){
      const w = TRANSFER_MIN + d/80;  // base penalty + walking minutes (~80 m/min)
      G[allKeys[i]].push({to:allKeys[j], w}); G[allKeys[j]].push({to:allKeys[i], w});
    }
  }
}

// ---- buses in the routing graph (multimodal planning) ----
// Runs once when the lazy bus data arrives (loadBusData in the boot section). Until then the
// planner is rail/ferry-only; afterwards bus nodes + walking transfers join the same graph.
const BUS_SPEED = 18;     // km/h commercial city-bus average
const BUS_DWELL = 0.45;   // minutes per stop
function integrateBuses(){
BUS_GRAPH.forEach((line, li) => {
  const st = line.stops;
  for(let i=0;i<st.length;i++){
    G['b'+li+'_'+i] = [];
    nodeMeta['b'+li+'_'+i] = { ref:line.ref, idx:i, name: st[i][2] || (line.ref+' durağı'), lat:st[i][0], lng:st[i][1], kind:'bus' };
  }
  for(let i=0;i<st.length-1;i++){
    const a='b'+li+'_'+i, b='b'+li+'_'+(i+1);
    const dm = metersBetween([st[i][0],st[i][1]],[st[i+1][0],st[i+1][1]]);
    const w = (dm/1000)/BUS_SPEED*60 + BUS_DWELL;
    G[a].push({to:b,w}); G[b].push({to:a,w});
  }
});
// walking transfers involving buses (bus↔bus & bus↔rail) via a spatial grid, capped per stop
  const CELL = 0.0022, grid = new Map(), all = Object.keys(nodeMeta);
  for(const k of all){ const m=nodeMeta[k]; const ck=Math.round(m.lat/CELL)+'_'+Math.round(m.lng/CELL);
    let arr=grid.get(ck); if(!arr){ arr=[]; grid.set(ck,arr); } arr.push(k); }
  const TR = 170;
  for(const k of all){
    const m=nodeMeta[k]; if(m.kind!=='bus') continue;
    const ci=Math.round(m.lat/CELL), cj=Math.round(m.lng/CELL), cands=[];
    for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){
      const arr=grid.get((ci+di)+'_'+(cj+dj)); if(!arr) continue;
      for(const k2 of arr){ if(k2===k) continue; const m2=nodeMeta[k2]; if(m2.ref===m.ref) continue;
        const dd=metersBetween([m.lat,m.lng],[m2.lat,m2.lng]); if(dd<TR) cands.push([dd,k2]); }
    }
    cands.sort((a,b)=>a[0]-b[0]);
    for(let n=0;n<Math.min(cands.length,5);n++){ const dd=cands[n][0], k2=cands[n][1], w=TRANSFER_MIN+dd/80;
      G[k].push({to:k2,w}); G[k2].push({to:k,w}); }
  }
  registerBusPlaces();   // late bus stops join place search + the door-to-door spatial grid
}

// binary min-heap (graph is now ~15k nodes → linear-scan Dijkstra too slow)
function MinHeap(){ this.a=[]; }
MinHeap.prototype.push=function(k,p){ const a=this.a; a.push([p,k]); let i=a.length-1;
  while(i>0){ const par=(i-1)>>1; if(a[par][0]<=a[i][0]) break; const t=a[par];a[par]=a[i];a[i]=t; i=par; } };
MinHeap.prototype.pop=function(){ const a=this.a; if(!a.length) return null; const top=a[0], last=a.pop();
  if(a.length){ a[0]=last; let i=0; const n=a.length; while(true){ let l=2*i+1,r=2*i+2,s=i;
    if(l<n&&a[l][0]<a[s][0])s=l; if(r<n&&a[r][0]<a[s][0])s=r; if(s===i)break; const t=a[s];a[s]=a[i];a[i]=t; i=s; } }
  return top; };

function dijkstra(oName, dName){
  if(fold(oName)===fold(dName)) return null;
  const dest = new Set(nameNodes[fold(dName)]||[]);
  if(!dest.size) return null;
  const dist={}, prev={}, done={}, h=new MinHeap();
  (nameNodes[fold(oName)]||[]).forEach(k=>{ dist[k]=0; prev[k]=null; h.push(k,0); });
  let end=null;
  while(true){
    const top=h.pop(); if(!top) break;
    const du=top[0], u=top[1];
    if(done[u]) continue; done[u]=true;
    if(dest.has(u)){ end=u; break; }
    const adj=G[u]||[];
    for(const e of adj){ if(done[e.to]) continue; const nd=du+e.w;
      if(dist[e.to]===undefined || nd<dist[e.to]){ dist[e.to]=nd; prev[e.to]=u; h.push(e.to,nd); } }
  }
  if(end===null) return null;
  const path=[]; let cur=end; while(cur!=null){ path.unshift(cur); cur=prev[cur]; }
  return { path, total:dist[end] };
}

// ---- spatial index for arbitrary-point (door-to-door) routing + place search ----
const GCELL = 0.0022, nodeGrid = new Map();
for(const k in nodeMeta){ const m=nodeMeta[k]; const ck=Math.round(m.lat/GCELL)+'_'+Math.round(m.lng/GCELL);
  let a=nodeGrid.get(ck); if(!a){ a=[]; nodeGrid.set(ck,a); } a.push(k); }
function nearbyNodes(lat,lng,radius,cap){
  const ci=Math.round(lat/GCELL), cj=Math.round(lng/GCELL), rings=Math.ceil(radius/180)+1, out=[];
  for(let di=-rings;di<=rings;di++) for(let dj=-rings;dj<=rings;dj++){
    const a=nodeGrid.get((ci+di)+'_'+(cj+dj)); if(!a) continue;
    for(const k of a){ const m=nodeMeta[k]; const d=metersBetween([lat,lng],[m.lat,m.lng]); if(d<=radius) out.push([k,d]); }
  }
  out.sort((a,b)=>a[1]-b[1]);
  // Keep the nearest node PER LINE, not simply the nearest N nodes. A busy stop carries a
  // separate node for every line serving it, so a plain "12 nearest" was filled entirely with
  // duplicate bus nodes 50 m away and silently excluded the Metrobüs stop 750 m down the road —
  // the router could then never even consider the one-vehicle ride. One node per ref keeps every
  // MODE reachable while staying the same size for the search.
  const seen=new Set(), rail=[], bus=[];
  for(const e of out){ const m=nodeMeta[e[0]], r=m.ref;
    if(seen.has(r)) continue; seen.add(r);
    (m.kind==='bus' ? bus : rail).push(e);
  }
  // Rail/BRT/ferry lines are few, so take ALL of them — a hub like Avcılar has 40+ bus lines
  // within walking distance, and capping by distance alone pushed the Metrobüs stop 750 m away
  // out of the candidate set entirely, hiding the obvious one-vehicle ride. Buses stay capped.
  return rail.concat(bus.slice(0, cap||12));
}
// query-side folding: ALSO strips Turkish diacritics, so a visitor without a Turkish
// keyboard can type "sisli" / "uskudar" / "kadikoy" and still find Şişli / Üsküdar / Kadıköy.
// (fold() itself must stay diacritic-preserving — station clustering & routing key on it.)
const _foldQMemo = new Map();
const foldQ = s => {
  if(!s) return "";
  let v = _foldQMemo.get(s);
  if(v === undefined){
    v = fold(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0131/g,'i');
    if(_foldQMemo.size > 40000) _foldQMemo.clear();
    _foldQMemo.set(s, v);
  }
  return v;
};
/* The curated landmarks are stored under their ENGLISH names, which means a Turkish speaker —
   most of this map's audience — could not find one of them by the name they actually use.
   "Ayasofya", "Kapalıçarşı", "Kız Kulesi", "Sultanahmet Camii" all returned bus stops instead.
   These are the real Turkish names for those same places, not translations invented here; a
   landmark keeps every name it is genuinely known by, in both directions. */
const PLACE_ALIASES = {
  'Hagia Sophia':                 ['Ayasofya', 'Ayasofya Camii', 'Ayasofya Müzesi'],
  'Blue Mosque':                  ['Sultanahmet Camii', 'Sultan Ahmet Camii'],
  'Topkapı Palace':               ['Topkapı Sarayı'],
  'Basilica Cistern':             ['Yerebatan Sarnıcı', 'Bazilika Sarnıcı'],
  'Hippodrome (Sultanahmet Sq.)': ['Sultanahmet Meydanı', 'At Meydanı', 'Hipodrom'],
  'Gülhane Park':                 ['Gülhane Parkı'],
  'Grand Bazaar':                 ['Kapalıçarşı', 'Kapalı Çarşı'],
  'Spice Bazaar':                 ['Mısır Çarşısı'],
  'Süleymaniye Mosque':           ['Süleymaniye Camii'],
  'Galata Bridge':                ['Galata Köprüsü'],
  'Galata Tower':                 ['Galata Kulesi'],
  'İstiklal Avenue':              ['İstiklal Caddesi', 'İstiklal Cad'],
  'Taksim Square':                ['Taksim Meydanı'],
  'Dolmabahçe Palace':            ['Dolmabahçe Sarayı'],
  'Yıldız Park':                  ['Yıldız Parkı'],
  'Ortaköy Mosque':               ['Ortaköy Camii', 'Büyük Mecidiye Camii'],
  'Bebek Bay':                    ['Bebek Koyu'],
  'Rumeli Fortress':              ['Rumeli Hisarı'],
  'Emirgan Park':                 ['Emirgan Korusu'],
  "Maiden's Tower":               ['Kız Kulesi'],
  'Beylerbeyi Palace':            ['Beylerbeyi Sarayı'],
  'Büyük Çamlıca Hill':           ['Büyük Çamlıca Tepesi', 'Çamlıca Tepesi'],
  'Çamlıca Mosque':               ['Çamlıca Camii'],
  'Üsküdar Waterfront':           ['Üsküdar Sahili'],
  'Chora (Kariye) Mosque':        ['Kariye Camii', 'Kariye Müzesi', 'Chora Church'],
  'Eyüp Sultan Mosque':           ['Eyüp Sultan Camii', 'Eyüpsultan Camii'],
  'Pierre Loti Hill':             ['Piyer Loti Tepesi', 'Piyerloti'],
  'Panorama 1453':                ['Panorama 1453 Tarih Müzesi'],
  "Princes' Islands (ferry)":     ['Adalar', 'Büyükada', 'Prens Adaları'],
};
/* Category words, so "müze" lists the museums and "cami" the mosques instead of matching
   whichever bus stop happens to carry the word. Both languages, since the UI ships both. */
const CAT_WORDS = {
  museum:     ['müze', 'muze', 'museum', 'müzesi'],
  mosque:     ['cami', 'camii', 'mosque', 'camisi'],
  palace:     ['saray', 'sarayı', 'palace'],
  market:     ['çarşı', 'carsi', 'çarşısı', 'pazar', 'bazaar', 'market'],
  park:       ['park', 'parkı', 'korusu', 'bahçe'],
  viewpoint:  ['manzara', 'tepe', 'tepesi', 'seyir', 'viewpoint', 'kule', 'kulesi'],
  waterfront: ['sahil', 'sahili', 'kıyı', 'waterfront', 'koy'],
  historic:   ['tarihi', 'tarih', 'historic', 'antik'],
  landmark:   ['landmark', 'simge'],
};
// folded category word -> [cat], built once
const CAT_LOOKUP = (()=>{ const m=new Map();
  for(const cat in CAT_WORDS) for(const w of CAT_WORDS[cat]){
    const f=foldQ(w); if(!m.has(f)) m.set(f,[]); if(!m.get(f).includes(cat)) m.get(f).push(cat); }
  return m; })();
// searchable places: unique named stops across rail + ferry + bus (rail wins name clashes)
const PLACES = (()=>{ const seen=new Set(), arr=[];
  for(const k in nodeMeta){ const m=nodeMeta[k]; if(!m.name) continue;
    if(m.kind==='bus' && m.name===m.ref+' durağı') continue;       // skip auto-named placeholder stops
    const f=fold(m.name); if(seen.has(f)) continue; seen.add(f);
    arr.push({ name:m.name, lat:m.lat, lng:m.lng, ref:m.ref, bus:m.kind==='bus', _f:f, _q:foldQ(m.name) }); }
  // curated landmarks so "Hagia Sophia", "Galata Tower", "Grand Bazaar" resolve instantly & offline
  ATTRACTIONS.forEach(a=>{ const f=fold(a.name); if(seen.has(f)) return; seen.add(f);
    arr.push({ name:a.name, lat:a.lat, lng:a.lng, poi:true, cat:a.cat, _f:f, _q:foldQ(a.name),
               _alias:(PLACE_ALIASES[a.name]||[]).map(foldQ) }); });
  arr.sort((a,b)=>trCmp(a.name,b.name)); return arr; })();
/* How many distinct line-nodes share a stop name — an interchange is a more likely search
   target than a single-line halt with the same word in it. Counted from nodeMeta rather than
   guessed, and only for rail: every bus line serving a street produces its own node, so the
   same count would just measure how busy the road is. */
const PLACE_DEGREE = (()=>{ const m=new Map();
  for(const k in nodeMeta){ const n=nodeMeta[k]; if(!n.name || n.kind==='bus') continue;
    const f=fold(n.name); if(!f) continue;
    let s=m.get(f); if(!s){ s=new Set(); m.set(f,s); } s.add(n.ref); }
  const out=new Map(); m.forEach((s,f)=>out.set(f,s.size)); return out; })();
// bus stops arrive AFTER first paint (lazy bus-data-<city>.json) → register them into the search
// list + the door-to-door spatial grid once integrateBuses has built their nodes
function registerBusPlaces(){
  const seen=new Set(PLACES.map(p=>p._f));
  for(const k in nodeMeta){ const m=nodeMeta[k]; if(m.kind!=='bus') continue;
    // EVERY bus node joins the routing grid (same stop name is served by many line-nodes)
    const ck=Math.round(m.lat/GCELL)+'_'+Math.round(m.lng/GCELL);
    let a=nodeGrid.get(ck); if(!a){ a=[]; nodeGrid.set(ck,a); } a.push(k);
    // …but the search list only wants one entry per unique real name
    if(!m.name || m.name===m.ref+' durağı') continue;
    const f=fold(m.name); if(seen.has(f)) continue; seen.add(f);
    PLACES.push({ name:m.name, lat:m.lat, lng:m.lng, ref:m.ref, bus:true, _f:f, _q:foldQ(m.name) });
  }
  PLACES.sort((a,b)=>trCmp(a.name,b.name));
}
// banded Levenshtein, early-exit past 2 — cheap enough for a no-match fallback sweep
function editDist2(a,b){
  const n=a.length, m=b.length; if(Math.abs(n-m)>2) return 3;
  let prev=Array.from({length:m+1},(_,j)=>j), cur=new Array(m+1);
  for(let i=1;i<=n;i++){ cur[0]=i; let rowMin=i;
    for(let j=1;j<=m;j++){ cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
      if(cur[j]<rowMin) rowMin=cur[j]; }
    if(rowMin>2) return 3; const t2=prev; prev=cur; cur=t2; }
  return prev[m];
}
/* Where the search is measured from, so that among equally good matches the near one wins.
   The map centre is what the user is actually looking at; their own position beats it when
   they have shared it. Never a network call, and safe before the map exists. */
function searchOrigin(){
  try{ if(typeof myPos!=='undefined' && myPos && isFinite(myPos.lat)) return {lat:myPos.lat, lng:myPos.lng}; }catch(e){}
  try{ const c=map.getCenter(); if(c && isFinite(c.lat)) return {lat:c.lat, lng:c.lng}; }catch(e){}
  return { lat:CITY.center[0], lng:CITY.center[1] };
}
/* Ranking. The previous order was "every prefix match, then every substring match, each
   alphabetically". That accidentally looked right whenever a station's name was a strict
   prefix of the bus stops around it — "Kadıköy" does sort before "KADIKÖY ANADOLU…" — and
   fell over everywhere else: "sahil" buried the first rail stop at rank 15, "havalimanı" put
   a taxi rank above both airports, "marmaray" found no rail at all, and a query that hit the
   30-result cap, like "camii", returned an alphabetical slice of 30 mosques with no regard
   for which one you were standing next to. So score, and sort by the score.

   Deliberately mild on distance: someone in Beşiktaş typing "Kadıköy" still means Kadıköy, so
   proximity only settles ties between matches of similar quality — it never outranks a better
   name match. */
const _MATCH_EXACT=1000, _MATCH_ALIAS=900, _MATCH_PREFIX=700, _MATCH_WORD=500,
      _MATCH_CAT=430, _MATCH_SUB=300, _MATCH_TYPO=150;
const _WORD_BREAK = " -–—/().,'&";
function placeScore(pl, f, org){
  let m = 0;
  if(pl._q === f) m = _MATCH_EXACT;
  else if(pl._alias && pl._alias.length){
    for(const a of pl._alias){
      if(a === f){ m = Math.max(m, _MATCH_ALIAS); break; }
      if(a.startsWith(f)) m = Math.max(m, _MATCH_ALIAS - 60);
      else if(a.includes(f)) m = Math.max(m, _MATCH_ALIAS - 160);
    }
  }
  if(!m || m < _MATCH_PREFIX){
    /* A prefix match is scaled by how much of the name the query actually covers. Flat-scoring
       every prefix put "HAVALİMANI TAKSİ KOOPERATİFİ" — a taxi rank — above both airports,
       because a 200-point prefix-over-word-match gap outweighed everything else. Covering the
       whole name still scores the full prefix bonus; covering a third of it barely beats a
       word match, which is the honest reading of that match. */
    if(pl._q.startsWith(f))
      m = Math.max(m, _MATCH_WORD + (_MATCH_PREFIX - _MATCH_WORD) * (f.length / pl._q.length));
    else {
      // does it start a word anywhere in the name? scan occurrences — no regex is built per
      // place per keystroke, which at 6,000+ places would be felt on every character typed
      let i = pl._q.indexOf(f), best = 0;
      while(i > 0){
        best = Math.max(best, _WORD_BREAK.indexOf(pl._q.charAt(i-1)) >= 0 ? _MATCH_WORD : _MATCH_SUB);
        if(best === _MATCH_WORD) break;
        i = pl._q.indexOf(f, i + 1);
      }
      if(best) m = Math.max(m, best);
    }
  }
  if(!m) return 0;
  // kind: a rail/ferry station is a likelier destination than one of the many bus stops on a street
  m += pl.bus ? 0 : (pl.poi ? 100 : 130);
  // interchanges outrank single-line halts of the same name
  const deg = PLACE_DEGREE.get(pl._f) || 1;
  m += Math.min(48, (deg - 1) * 12);
  // the shorter of two matching names is usually the canonical one ("Levent" over "LEVENT CAMİİ").
  // Kept small: for prefix matches the coverage scaling above already carries most of this.
  m -= Math.min(20, Math.max(0, pl._q.length - f.length) * 0.4);
  // proximity, as a tie-breaker only
  if(org && isFinite(pl.lat)) m -= Math.min(45, metersBetween([org.lat,org.lng],[pl.lat,pl.lng]) / 1000 * 1.5);
  return m;
}
// shared stop search: scored over name, Turkish alias and category, with a small-typo fallback
function searchPlaces(q){
  const f=foldQ(q); if(!f) return [];
  const org=searchOrigin();
  const cats=CAT_LOOKUP.get(f);
  const scored=[];
  for(const pl of PLACES){
    let s=placeScore(pl, f, org);
    // "müze" should list the museums even though no landmark is literally called that
    if(cats && pl.poi && cats.includes(pl.cat)) s=Math.max(s, _MATCH_CAT + 100 -
      (org && isFinite(pl.lat) ? Math.min(45, metersBetween([org.lat,org.lng],[pl.lat,pl.lng])/1000*1.5) : 0));
    if(s>0) scored.push([s,pl]);
  }
  if(!scored.length && f.length>=3){                    // no direct hit → tolerate 1–2 typos
    const maxD=f.length<=5?1:2;
    for(const pl of PLACES){
      let best=3;
      for(const tok of pl._q.split(/[\s\-–—\/().]+/)){
        if(!tok || Math.abs(tok.length-f.length)>maxD) continue;
        const d=editDist2(f,tok); if(d<best) best=d;
      }
      if(best<=maxD) scored.push([_MATCH_TYPO - best*40 + (pl.bus?0:(pl.poi?100:130))
        - Math.min(35, Math.max(0, pl._q.length-f.length)*0.6), pl]);
    }
  }
  scored.sort((a,b)=> b[0]-a[0] || trCmp(a[1].name, b[1].name));
  return scored.slice(0,30).map(x=>x[1]);
}
/* ---- live place/address geocoder — lets people TYPE any destination (a landmark, a
   neighbourhood, a street) instead of pinning it on the map. Photon (photon.komoot.io) is
   keyless, CORS-open and built for search-as-you-type over OpenStreetMap; results are biased
   to İstanbul's centre and clipped to the city bounds (the door-to-door planner is city-scoped).
   Cached per query, debounced by the caller, aborts after 4.5 s, and fails silently so the
   local stop/landmark search always works offline / on file://. No API key — fits the static site. ---- */
const GEO_CACHE = new Map();
const IST_C = { lat:CITY.center[0], lng:CITY.center[1] };   // geocoder bias = active city centre
const IST_BOX = CITY.box;                                   // clip results to the active city
function geoName(p){
  const ctx = p.district || p.city || p.county || p.state;
  return [p.name, (ctx && ctx!==p.name) ? ctx : null].filter(Boolean).join(', ') || p.name || '—';
}
async function geocode(q){
  const key = foldQ(q);
  if(!key || key.length < 3) return [];
  if(GEO_CACHE.has(key)) return GEO_CACHE.get(key);
  const langP = /^(en|de|fr|it)$/.test(lang) ? '&lang='+lang : '';   // Photon's supported UI languages
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${IST_C.lat}&lon=${IST_C.lng}${langP}`;
  const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), 4500);
  try{
    const r = await fetch(url, { signal:ctrl.signal });
    clearTimeout(timer);
    if(!r.ok) throw 0;
    const gj = await r.json();
    const out = [];
    for(const f of (gj.features||[])){
      const c = f.geometry && f.geometry.coordinates; if(!c) continue;
      const lng = +c[0], lat = +c[1];
      if(lat < IST_BOX.s || lat > IST_BOX.n || lng < IST_BOX.w || lng > IST_BOX.e) continue;   // İstanbul only
      const p = f.properties || {};
      out.push({ name: geoName(p), lat, lng, geo:true, ctx: p.district || p.city || p.county || '' });
    }
    GEO_CACHE.set(key, out);
    return out;
  }catch(e){ clearTimeout(timer); GEO_CACHE.set(key, []); return []; }   // offline / blocked / timeout → local only
}
let WALK = 80;        // metres / minute (adjustable via Settings → Walking pace)
/* The fastest thing on THIS city's network, derived rather than assumed. The A* heuristic
   below divides by it, so it must never be lower than a mode's real speed: underestimating the
   remaining travel time is what keeps the heuristic admissible, and an admissible heuristic is
   what keeps the route optimal. It was hard-coded to 100 km/h, which held for metro and
   Marmaray and quietly broke for intercity rail at 200. Reading it off KIND means a city that
   adds a faster mode cannot silently invalidate the search. */
const FASTEST_KMH = (() => { let m = 60;
  for(const l of (typeof liveLines !== 'undefined' ? liveLines : []))
    { const s = KIND[l.kind] && KIND[l.kind].speed; if(s > m) m = s; }
  return m * 1.05;                                // a little headroom, so equality never rounds the wrong way
})();
const ACCESS = 1100;  // max access-walk to the first/last stop (m)
// route between two arbitrary points (or selected stops): walk to nearby stops → Dijkstra → walk out.
// penalty = optional Set of line refs to discourage boarding (used to surface alternative routes).
// expected wait when boarding a line = half its headway, capped so a rare service doesn't
// dominate the search. Cached per ref (headways are static); cleared when the lazy bus
// schedules arrive so bus waits stop using the fallback.
/* Waiting, as the SEARCH sees it — deliberately line-level, not station-level.

   82% of this graph's 780,000 edges are boardings: every bus line owns its own node at every
   stop it serves, so a busy street is a small clique. Asking the full departure oracle per
   relaxation would mean roughly 640,000 station lookups per search, and a search runs eight
   times per request to build the alternatives. The search only needs enough to RANK — does this
   line run at this hour, and how long is a typical wait for it. The exact per-station departure
   is applied afterwards by itinPlan, which deals in a handful of legs rather than a whole graph.

   Time-dependent, which the old version was not: it charged half a headway for every line at
   every hour, so at 01:50 a route needing a four-hour wait for the first morning bus scored the
   same as one running right now, and duly outranked it. */
const WAIT_HORIZON = 360;        // 6 h. Past this a journey is really "tomorrow", and modelling
                                 // the exact overnight gap only distorts the ranking.
/* Every node carries a numeric refId so the per-line facts below can be reached by array index
   rather than by hashing a string on each of a search's ~50,000 relaxations. */
let _refIds = null, _refCount = 0, _refsBuiltWithBuses = null;
const _waitFacts = [];   // per refId; cleared whenever the ids are rebuilt or a new request starts
function ensureRefIds(){
  const busesIn = (typeof busReady !== 'undefined') ? busReady : false;
  if(_refIds && _refsBuiltWithBuses === busesIn) return;
  _refIds = Object.create(null); _refCount = 0;
  for(const k in nodeMeta){
    const m = nodeMeta[k];
    if(!m || !m.ref) continue;
    // bus and rail are kept apart: the same ref string can name both, and they do not share a timetable
    const key = (m.kind === 'bus' ? 'b:' : 'r:') + m.ref;
    let id = _refIds[key];
    if(id === undefined) id = _refIds[key] = _refCount++;
    m.refId = id;
  }
  _refsBuiltWithBuses = busesIn;
  _waitFacts.length = 0;
}
function clearWaitCache(){ ensureRefIds(); _waitFacts.length = 0; }
/* A line's service window and its typical wait, resolved once per line.

   The bucketed table above was solving the wrong problem. Within its service hours a line's
   expected wait does not vary with the clock at all — it is half the published headway, whatever
   the time. The ONLY time-dependence that matters for ranking is whether the line is running
   yet, which is a pair of comparisons. Recomputing that per ten-minute bucket meant thousands
   of oracle calls on a night-time search, which is why 03:00 cost 394 ms against 65 ms at 09:00.

   The headway and the service window still come from the same places the timeline uses —
   lineHours() for rail, the operator's own first/last for a bus — so the search and the
   timeline cannot drift apart about when a line runs. */
function waitFacts(ref, isBus, refId){
  const hit = _waitFacts[refId];
  if(hit) return hit;
  const h = lineHours(ref);
  let start = h.start, end = h.end, hw = null;
  if(isBus && typeof BUS_SCHED !== 'undefined' && BUS_SCHED[ref]){
    // the operator's own first/last is better than any generic hours string
    const day = depDayType();
    let bestFirst = null, bestLast = null;
    for(const dir of BUS_SCHED[ref]){
      const col = dir && dir[day];
      if(!col || !col.first) continue;
      const f = hhmmToMin(col.first), l = hhmmToMin(col.last);
      if(f != null && (bestFirst == null || f < bestFirst)) bestFirst = f;
      if(l != null && (bestLast == null || l > bestLast)) bestLast = l;
      if(col.hw && (hw == null || col.hw < hw)) hw = col.hw;
    }
    if(bestFirst != null){ start = bestFirst; end = (bestLast != null ? bestLast : null); }
  }
  if(hw == null) hw = (isBus && typeof busHeadway === 'function' && busHeadway(ref)) || (lineTiming(ref).hwMin || 10);
  return _waitFacts[refId] = { always: h.always, start, end, expWait: expectedWaitFor(hw) };
}
function waitAt(ref, isBus, atMin, refId){
  const f = _waitFacts[refId] || waitFacts(ref, isBus, refId);
  if(f.always || f.start == null) return f.expWait;
  const now = ((atMin % 1440) + 1440) % 1440;
  const end = (f.end == null) ? f.start : f.end;
  // service windows may run past midnight, which is why this is not a simple range test
  const running = (f.start <= end) ? (now >= f.start && now < end) : (now >= f.start || now < end);
  if(running) return f.expWait;
  let until = f.start - now;
  if(until < 0) until += 1440;
  return Math.min(WAIT_HORIZON, until);
}
/* Lines a major disruption has taken out of service. Routing someone onto a suspended line is
   worse than telling them there is no route: the plan looks ordinary and cannot be travelled.
   Scope and severity are the operator's own, and an expired `until` releases the line. */
/* Which nodes this search may not use, precomputed ONTO the node objects.

   Written as a predicate first, and that cost six times the whole search: `blocked(e.to)` ran
   on all 780,000 relaxations, each one a nodeMeta hash lookup plus a Set.has. Marking the nodes
   once — 71,000 property writes — turns the inner loop into a boolean read. The signature guard
   means the eight searches behind one request share the work, since only the line penalty
   differs between them. */
let _blkSig = null;
function markBlocked(avoid, noLine, susp){
  const sig = (avoid ? [...avoid].sort().join(',') : '') + '|' +
              (noLine ? [...noLine].sort().join(',') : '') + '|' +
              (susp ? [...susp].sort().join(',') : '');
  if(sig === _blkSig) return sig !== '||';
  for(const k in nodeMeta){
    const m = nodeMeta[k];
    m._blk = !!((avoid && avoid.has(nodeMode(k))) ||
                (susp && susp.size && susp.has(m.ref)) ||
                (noLine && noLine.has(m.ref)));
  }
  _blkSig = sig;
  return sig !== '||';
}
function suspendedRefs(){
  const out = new Set();
  for(const d of (DISRUPTIONS || [])){
    if(d.scope !== 'line' || d.severity !== 'major') continue;
    if(!disruptionActive(d)) continue;
    if(d.ref) out.add(d.ref);
  }
  return out;
}
// when a search is anchored: the clock for "now", or the departure the traveller chose
function searchStartMin(){
  try{
    if(typeof planWhen !== 'undefined' && planWhen && planWhen.mode === 'depart' && planWhen.min != null)
      return planWhen.min;
  }catch(e){}
  return nowIstanbulMin();
}
function routeXY(o, d, penalty, startMin){
  const srcs = nearbyNodes(o.lat,o.lng,ACCESS,12);
  const dArr = nearbyNodes(d.lat,d.lng,ACCESS,12);
  if(!srcs.length || !dArr.length) return null;
  const pen = penalty && penalty.size ? penalty : null;
  const avoid = avoidModes.size ? avoidModes : null;             // Settings → Avoid ferries/buses
  // a mode switched off for this trip, or a specific line the traveller chose to avoid
  const noLine = tripAvoidLines.size ? tripAvoidLines : null;
  ensureRefIds();
  const susp = suspendedRefs();
  const t0 = (startMin != null) ? startMin : searchStartMin();
  const anyBlocked = markBlocked(avoid, noLine, susp);
  const blocked = anyBlocked ? (k=>{ const m=nodeMeta[k]; return !!(m && m._blk); }) : (()=>false);
  // Settings → Prefer step-free: bias away from boarding/alighting/transferring at a
  // station we KNOW has no elevator (stepFree===false). A soft penalty, never a block.
  const SF_PEN = 10;
  const sfBad = stepFreePref ? (name=>{ const r=accByStation.get(fold(name)); return !!(r && r.stepFree===false); }) : null;
  // ---- transfer cost. The graph only charges the WALK across an interchange (TRANSFER_MIN),
  // which made a change nearly free, so the router happily chained 4 vehicles to save a few
  // minutes. A real change also costs the WAIT for the next service (~half its headway), and
  // the "Fewest changes" preference adds a heavy weight on top so the search itself — not just
  // the final sort — hunts for a one-vehicle ride. Both are synthetic: realTotal below re-sums
  // the graph weights only, so the quoted ETA stays truthful.
  const XFER_PREF = routePref==='easy' ? 20 : 0;
  const dsts = new Map(); dArr.forEach(([k,dist])=>{ if(blocked(k)) return; let w=dist/WALK; if(sfBad && sfBad(nodeMeta[k].name)) w+=SF_PEN; dsts.set(k, w); });
  if(!dsts.size) return null;
  /* A*, not plain Dijkstra. The heuristic is the straight-line distance to the destination at
     the fastest speed anything on this network travels, so it can never overestimate and the
     result stays optimal — but it points the search at the destination instead of growing a
     circle around the origin.

     It matters most at night. Once waiting dominates, every frontier node is expensive and a
     blind search expands most of the city before it reaches ANY candidate, which is what took a
     02:20 request to three and a half seconds. Reaching a candidate early gives `best` a real
     value, and `best` is what prunes everything else. */
  const hOf = k => { const m=nodeMeta[k];
    return m ? metersBetween([m.lat,m.lng],[d.lat,d.lng])/1000/FASTEST_KMH*60 : 0; };
  const dist={}, prev={}, done={}, h=new MinHeap();
  srcs.forEach(([k,mm])=>{ if(blocked(k)) return; let w=mm/WALK; if(pen && pen.has(nodeMeta[k].ref)) w+=45;   // discourage starting on a used line
    if(sfBad && sfBad(nodeMeta[k].name)) w+=SF_PEN;
    /* The FIRST boarding costs a wait too. Charging it only at changes made starting a journey
       free, which is where the ranking bug bit hardest: at 01:50 a route beginning on a line
       that does not run until 06:00 opened at zero cost and won. */
    w += waitAt(nodeMeta[k].ref, nodeMeta[k].kind==='bus', t0 + w, nodeMeta[k].refId);
    if(dist[k]===undefined||w<dist[k]){ dist[k]=w; prev[k]=null; h.push(k, w + hOf(k)); } });
  let best=Infinity, bestEnd=null;
  while(true){ const top=h.pop(); if(!top) break; const u=top[1];
    if(done[u]) continue; done[u]=true;
    const du=dist[u];
    if(top[0]>best) break;                       // nothing still queued can beat the best found
    if(dsts.has(u)){ const tot=du+dsts.get(u); if(tot<best){ best=tot; bestEnd=u; } }
    const adj=G[u]||[]; const um=nodeMeta[u];
    for(const e of adj){ if(done[e.to]) continue;
      /* One nodeMeta lookup per edge. It used to be two — once inside blocked(), once here —
         and at 780,000 relaxations a redundant hash lookup is not a rounding error. */
      const vm=nodeMeta[e.to];
      if(anyBlocked && vm && vm._blk) continue;
      let nd=du+e.w;
      if(vm.ref!==um.ref){                       // this edge is a CHANGE of vehicle
        // the wait depends on WHEN you get here, which is what makes the search time-dependent
        nd += XFER_PREF + waitAt(vm.ref, vm.kind==='bus', t0 + du, vm.refId);
        if(pen && pen.has(vm.ref)) nd+=45;       // discourage re-boarding a line used by a previous option
      }
      if(sfBad && vm.ref!==um.ref && sfBad(vm.name)) nd+=SF_PEN;  // penalise transferring at a non-step-free station
      if(dist[e.to]===undefined||nd<dist[e.to]){ dist[e.to]=nd; prev[e.to]=u; h.push(e.to, nd + hOf(e.to)); } }
  }
  if(bestEnd===null) return null;
  const path=[]; let cur=bestEnd; while(cur!=null){ path.unshift(cur); cur=prev[cur]; }
  const first=nodeMeta[path[0]], lastN=nodeMeta[bestEnd];
  /* Re-sum the real graph weights, dropping the synthetic preference penalties so the quoted
     journey time stays truthful. Waiting is accumulated SEPARATELY: `total` keeps its long
     standing meaning of travel plus walking, which is what the headline shows, while
     `waitTotal` carries what the clock costs. Ranking uses their sum — a route that is quick
     once you are moving but starts with a four-hour wait is not a good route. */
  const oWalk = metersBetween([o.lat,o.lng],[first.lat,first.lng])/WALK;
  const dWalk = metersBetween([lastN.lat,lastN.lng],[d.lat,d.lng])/WALK;
  let realTotal = oWalk + dWalk;
  let waitTotal = waitAt(first.ref, first.kind==='bus', t0 + oWalk, first.refId);
  for(let i=1;i<path.length;i++){ const a=path[i-1], b=path[i]; const adj=G[a]||[]; let w=Infinity;
    for(const e of adj) if(e.to===b && e.w<w) w=e.w; if(w<Infinity) realTotal+=w;
    const am=nodeMeta[a], bm=nodeMeta[b];
    if(am && bm && bm.ref!==am.ref)
      waitTotal += waitAt(bm.ref, bm.kind==='bus', t0 + realTotal + waitTotal, bm.refId);
  }
  return { path, total:realTotal, waitTotal, doorTotal: realTotal + waitTotal, startMin: t0,
           oWalk, dWalk, origin:o, dest:d };
}
// other bus lines that also connect a leg's boarding & alighting stops (direction-agnostic)
function siblingBuses(b, a, exclude){
  const R=300, out=new Set();
  for(const line of BUS_GRAPH){
    if(line.ref===exclude) continue;
    let bi=-1, ai=-1;
    for(let i=0;i<line.stops.length;i++){ const s=line.stops[i];
      if(bi<0 && metersBetween([s[0],s[1]],b)<=R) bi=i;
      if(ai<0 && metersBetween([s[0],s[1]],a)<=R) ai=i;
      if(bi>=0 && ai>=0) break; }
    if(bi>=0 && ai>=0 && bi!==ai) out.add(line.ref);
  }
  return [...out].sort((x,y)=>(parseInt(x)||1e9)-(parseInt(y)||1e9)||trCmp(x,y));
}

