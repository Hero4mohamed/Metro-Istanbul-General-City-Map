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
// searchable places: unique named stops across rail + ferry + bus (rail wins name clashes)
const PLACES = (()=>{ const seen=new Set(), arr=[];
  for(const k in nodeMeta){ const m=nodeMeta[k]; if(!m.name) continue;
    if(m.kind==='bus' && m.name===m.ref+' durağı') continue;       // skip auto-named placeholder stops
    const f=fold(m.name); if(seen.has(f)) continue; seen.add(f);
    arr.push({ name:m.name, lat:m.lat, lng:m.lng, ref:m.ref, bus:m.kind==='bus', _f:f, _q:foldQ(m.name) }); }
  // curated landmarks so "Hagia Sophia", "Galata Tower", "Grand Bazaar" resolve instantly & offline
  ATTRACTIONS.forEach(a=>{ const f=fold(a.name); if(seen.has(f)) return; seen.add(f);
    arr.push({ name:a.name, lat:a.lat, lng:a.lng, poi:true, cat:a.cat, _f:f, _q:foldQ(a.name) }); });
  arr.sort((a,b)=>trCmp(a.name,b.name)); return arr; })();
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
// shared stop search: diacritic-insensitive prefix > substring > small-typo fallback
function searchPlaces(q){
  const f=foldQ(q); if(!f) return [];
  const pre=[], sub=[];
  for(const pl of PLACES){ if(pl._q.startsWith(f)) pre.push(pl); else if(pl._q.includes(f)) sub.push(pl); }
  let out=pre.concat(sub);
  if(!out.length && f.length>=3){                       // no direct hit → tolerate 1–2 typos
    const maxD=f.length<=5?1:2, scored=[];
    for(const pl of PLACES){
      let best=3;
      for(const tok of pl._q.split(/[\s\-–—\/().]+/)){
        if(!tok || Math.abs(tok.length-f.length)>maxD) continue;
        const d=editDist2(f,tok); if(d<best) best=d;
      }
      if(best<=maxD) scored.push([best,pl]);
    }
    // rank: closer edit distance, then rail stations before bus streets, then shorter names
    scored.sort((a,b)=> a[0]-b[0] || (a[1].bus?1:0)-(b[1].bus?1:0) || a[1].name.length-b[1].name.length);
    out=scored.map(x=>x[1]);
  }
  return out.slice(0,30);
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
const ACCESS = 1100;  // max access-walk to the first/last stop (m)
// route between two arbitrary points (or selected stops): walk to nearby stops → Dijkstra → walk out.
// penalty = optional Set of line refs to discourage boarding (used to surface alternative routes).
// expected wait when boarding a line = half its headway, capped so a rare service doesn't
// dominate the search. Cached per ref (headways are static); cleared when the lazy bus
// schedules arrive so bus waits stop using the fallback.
const HW_CACHE = {};
function waitFor(ref, isBus){
  if(ref in HW_CACHE) return HW_CACHE[ref];
  let hw;
  if(isBus) hw = (typeof busHeadway==='function' && busHeadway(ref)) || 20;
  else { const lt = lineTiming(ref); hw = (lt && lt.hwMin) || 10; }
  return HW_CACHE[ref] = Math.min(12, hw/2);
}
function routeXY(o, d, penalty){
  const srcs = nearbyNodes(o.lat,o.lng,ACCESS,12);
  const dArr = nearbyNodes(d.lat,d.lng,ACCESS,12);
  if(!srcs.length || !dArr.length) return null;
  const pen = penalty && penalty.size ? penalty : null;
  const avoid = avoidModes.size ? avoidModes : null;             // Settings → Avoid ferries/buses
  // a mode switched off for this trip, or a specific line the traveller chose to avoid
  const noLine = tripAvoidLines.size ? tripAvoidLines : null;
  const blocked = (avoid || noLine)
    ? (k=>{ const m=nodeMeta[k]; if(!m) return false;
            if(avoid && avoid.has(nodeMode(k))) return true;
            return !!(noLine && noLine.has(m.ref)); })
    : (()=>false);
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
  const dist={}, prev={}, done={}, h=new MinHeap();
  srcs.forEach(([k,mm])=>{ if(blocked(k)) return; let w=mm/WALK; if(pen && pen.has(nodeMeta[k].ref)) w+=45;   // discourage starting on a used line
    if(sfBad && sfBad(nodeMeta[k].name)) w+=SF_PEN;
    if(dist[k]===undefined||w<dist[k]){ dist[k]=w; prev[k]=null; h.push(k,w); } });
  let best=Infinity, bestEnd=null;
  while(true){ const top=h.pop(); if(!top) break; const du=top[0], u=top[1];
    if(done[u]) continue; done[u]=true; if(du>best) break;
    if(dsts.has(u)){ const tot=du+dsts.get(u); if(tot<best){ best=tot; bestEnd=u; } }
    const adj=G[u]||[]; for(const e of adj){ if(done[e.to] || blocked(e.to)) continue; let nd=du+e.w;
      const vm=nodeMeta[e.to], um=nodeMeta[u];
      if(vm.ref!==um.ref){                       // this edge is a CHANGE of vehicle
        nd += XFER_PREF + waitFor(vm.ref, vm.kind==='bus');
        if(pen && pen.has(vm.ref)) nd+=45;       // discourage re-boarding a line used by a previous option
      }
      if(sfBad && vm.ref!==um.ref && sfBad(vm.name)) nd+=SF_PEN;  // penalise transferring at a non-step-free station
      if(dist[e.to]===undefined||nd<dist[e.to]){ dist[e.to]=nd; prev[e.to]=u; h.push(e.to,nd); } }
  }
  if(bestEnd===null) return null;
  const path=[]; let cur=bestEnd; while(cur!=null){ path.unshift(cur); cur=prev[cur]; }
  const first=nodeMeta[path[0]], lastN=nodeMeta[bestEnd];
  // recompute real total without the synthetic penalty so ETA stays truthful
  let realTotal = metersBetween([o.lat,o.lng],[first.lat,first.lng])/WALK + metersBetween([lastN.lat,lastN.lng],[d.lat,d.lng])/WALK;
  for(let i=1;i<path.length;i++){ const a=path[i-1], b=path[i]; const adj=G[a]||[]; let w=Infinity;
    for(const e of adj) if(e.to===b && e.w<w) w=e.w; if(w<Infinity) realTotal+=w; }
  return { path, total:realTotal,
           oWalk: metersBetween([o.lat,o.lng],[first.lat,first.lng])/WALK,
           dWalk: metersBetween([lastN.lat,lastN.lng],[d.lat,d.lng])/WALK,
           origin:o, dest:d };
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

