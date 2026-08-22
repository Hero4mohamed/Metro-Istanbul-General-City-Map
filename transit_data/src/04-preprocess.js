/* ===========================================================================
   1. PREPROCESS each line: cumulative distances, station projections
   =========================================================================== */
function project(line){
  line.coords = line.paths[0];        // main continuous path drives sim + projection
  const c = line.coords;
  const cum = [0];
  for(let i=1;i<c.length;i++) cum[i] = cum[i-1] + metersBetween(c[i-1], c[i]);
  line._cum = cum;
  line._len = cum[c.length-1] || 0;

  // project each station onto the polyline → cumulative distance s
  line.stations.forEach(st => {
    let best = Infinity, bestS = 0;
    for(let i=0;i<c.length-1;i++){
      const ax=c[i][0], ay=c[i][1], bx=c[i+1][0], by=c[i+1][1];
      let dx=bx-ax, dy=by-ay;
      const segLen2 = dx*dx+dy*dy;
      let t = segLen2 ? ((st.lat-ax)*dx+(st.lng-ay)*dy)/segLen2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px=ax+dx*t, py=ay+dy*t;
      const d = (st.lat-px)**2 + (st.lng-py)**2;
      if(d<best){ best=d; bestS = cum[i] + metersBetween([ax,ay],[px,py]); }
    }
    st._s = bestS;
  });
  // station stop-distances sorted along the line (fallback to endpoints)
  let stops = line.stations.map(s=>s._s).sort((a,b)=>a-b);
  if(stops.length < 2) stops = [0, line._len];
  line._stops = stops;
}

// position (lat,lng) at distance s along a line
function posAt(line, s){
  const c = line.coords, cum = line._cum;
  if(s<=0) return c[0];
  if(s>=line._len) return c[c.length-1];
  let lo=0, hi=c.length-1;
  while(lo<hi-1){ const m=(lo+hi)>>1; if(cum[m]<=s) lo=m; else hi=m; }
  const seg = cum[hi]-cum[lo] || 1;
  const t = (s-cum[lo])/seg;
  return [ c[lo][0]+(c[hi][0]-c[lo][0])*t, c[lo][1]+(c[hi][1]-c[lo][1])*t ];
}

// extract sub-polyline between distances s0..s1 (for route highlight)
function subPath(line, s0, s1){
  const lo = Math.min(s0,s1), hi = Math.max(s0,s1);
  const c = line.coords, cum = line._cum, out = [posAt(line, lo)];
  for(let i=0;i<c.length;i++){ if(cum[i]>lo && cum[i]<hi) out.push(c[i]); }
  out.push(posAt(line, hi));
  return out;
}

NETWORK.forEach(project);

/* scope: a line is operational *now* if it's active, or a planned line whose
   launch date has passed (the "launch hook" — e.g. M11X flips live on 19 Jun 2026). */
function isLive(line){
  if(line.scope!=='planned') return true;
  if(line.launch) return Date.now() >= Date.parse(line.launch+'T00:00:00');
  return false;
}
// Intercity (TCDD national rail) is its OWN scope: it must stay out of liveLines, which drives
// the station registry, the routing graph, carriage sim, legend and the headline stats — a YHT
// stop 500 km away has no business in the İstanbul trip planner.
const intercityLines = NETWORK.filter(l => l.scope==='intercity');
const liveLines   = NETWORK.filter(l => isLive(l) && l.scope!=='intercity');
const visionLines = NETWORK.filter(l => !isLive(l) && l.scope!=='intercity');

