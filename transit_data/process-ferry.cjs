// Build the Istanbul ferry (vapur) network from real OSM pier coordinates,
// connected per actual operator routes. Ferries travel ~straight over open
// water, so pier-to-pier segments are geographically faithful.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'piers.json'), 'utf8'));

// pier list: {name, lat, lng}
const piers = [];
for (const e of raw.elements){
  const name = e.tags && e.tags.name; if(!name) continue;
  const lat = e.lat != null ? e.lat : (e.center && e.center.lat);
  const lng = e.lon != null ? e.lon : (e.center && e.center.lon);
  if (lat == null || lng == null) continue;
  piers.push({ name, lat, lng });
}

// ---- real OSM ferry-path geometry (for accurate curves over water) ----
const Rm = 6371000, toRad = d => d*Math.PI/180;
function meters(a,b){ const dLat=toRad(b[0]-a[0]),dLng=toRad(b[1]-a[1]),la1=toRad(a[0]),la2=toRad(b[0]);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*Rm*Math.asin(Math.sqrt(h)); }
const chainLen = c => { let s=0; for(let i=1;i<c.length;i++) s+=meters(c[i-1],c[i]); return s; };
function buildChains(ways, tol){
  let ch = ways.map(w=>w.slice()); let merged=true;
  while(merged){ merged=false;
    for(let i=0;i<ch.length && !merged;i++) for(let j=i+1;j<ch.length;j++){
      const A=ch[i],B=ch[j],a0=A[0],a1=A[A.length-1],b0=B[0],b1=B[B.length-1]; let nc=null;
      if(meters(a1,b0)<tol)nc=A.concat(B.slice(1)); else if(meters(a1,b1)<tol)nc=A.concat(B.slice().reverse().slice(1));
      else if(meters(a0,b1)<tol)nc=B.concat(A.slice(1)); else if(meters(a0,b0)<tol)nc=B.slice().reverse().concat(A.slice(1));
      if(nc){ ch[i]=nc; ch.splice(j,1); merged=true; break; } }
  }
  return ch;
}
// merge ALL chains of a relation into one continuous path (greedy nearest-endpoint).
// OSM island/long ferry routes are split into fragments (separate open-water ways);
// this joins them so e.g. Kabataş→Kadıköy→…→Büyükada becomes one smooth line.
function stitchAll(ways){
  let ch = buildChains(ways, 80).filter(c=>c.length>=2);
  if(!ch.length) return [];
  ch.sort((a,b)=>chainLen(b)-chainLen(a));
  let path = ch.shift();
  while(ch.length){
    const pa=path[0], pb=path[path.length-1];
    let bi=-1, bd=Infinity, bend='end', bflip=false;
    for(let i=0;i<ch.length;i++){
      const c=ch[i], ca=c[0], cb=c[c.length-1];
      const cand=[[meters(pb,ca),'end',false],[meters(pb,cb),'end',true],[meters(pa,cb),'start',false],[meters(pa,ca),'start',true]];
      for(const [d,end,flip] of cand){ if(d<bd){ bd=d; bi=i; bend=end; bflip=flip; } }
    }
    let c=ch.splice(bi,1)[0];
    if(bflip) c=c.slice().reverse();
    path = (bend==='end') ? path.concat(c) : c.concat(path);
  }
  return path;
}
function simplify(pts,eps){ if(pts.length<3)return pts; const sq=eps*eps; const keep=new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true; const st=[[0,pts.length-1]];
  const sd=(p,a,b)=>{const x=a[0],y=a[1];let dx=b[0]-x,dy=b[1]-y; if(dx||dy){const t=((p[0]-x)*dx+(p[1]-y)*dy)/(dx*dx+dy*dy);
    if(t>1){dx=p[0]-b[0];dy=p[1]-b[1];}else if(t>0){dx=p[0]-(x+dx*t);dy=p[1]-(y+dy*t);}else{dx=p[0]-x;dy=p[1]-y;}}else{dx=p[0]-x;dy=p[1]-y;}return dx*dx+dy*dy;};
  while(st.length){const[s,e]=st.pop();let md=0,idx=-1;for(let i=s+1;i<e;i++){const dd=sd(pts[i],pts[s],pts[e]);if(dd>md){md=dd;idx=i;}}
    if(md>sq&&idx!==-1){keep[idx]=true;st.push([s,idx],[idx,e]);}}
  return pts.filter((_,i)=>keep[i]); }

// CENTRIPETAL Catmull-Rom (alpha=0.5) — unlike the uniform form it provably never
// forms cusps or self-intersections/loops, so sharp pier turns stay clean.
function catmullRom(pts, seg){
  if (pts.length < 3) return pts.slice();
  const a=0.5, out=[];
  const P=i=>pts[Math.max(0,Math.min(pts.length-1,i))];
  const tnext=(ti,A,B)=>{ const d=Math.hypot(B[0]-A[0],B[1]-A[1]); return ti + Math.pow(d<1e-9?1e-9:d, a); };
  const L=(A,B,f)=>[A[0]+(B[0]-A[0])*f, A[1]+(B[1]-A[1])*f];
  for(let i=0;i<pts.length-1;i++){
    const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    const t0=0, t1=tnext(t0,p0,p1), t2=tnext(t1,p1,p2), t3=tnext(t2,p2,p3);
    for(let s=0;s<seg;s++){
      const t=t1+(t2-t1)*(s/seg);
      const A1=L(p0,p1,(t-t0)/(t1-t0)), A2=L(p1,p2,(t-t1)/(t2-t1)), A3=L(p2,p3,(t-t2)/(t3-t2));
      const B1=L(A1,A2,(t-t0)/(t2-t0)), B2=L(A2,A3,(t-t1)/(t3-t1));
      out.push(L(B1,B2,(t-t1)/(t2-t1)));
    }
  }
  out.push(pts[pts.length-1]);
  return out;
}
// insert an offset midpoint between each pier so the route bows into open water
function offsetMidpoints(pts, dLat, dLng){
  const out = [];
  for (let i=0;i<pts.length;i++){
    out.push(pts[i]);
    if (i<pts.length-1) out.push([ (pts[i][0]+pts[i+1][0])/2 + dLat, (pts[i][1]+pts[i+1][1])/2 + dLng ]);
  }
  return out;
}
// push intermediate piers (not the terminals) into open water, then bow the midpoints —
// keeps a shore-following line (Bosphorus banks) consistently off the land.
function offsetShore(pts, dLat, dLng){
  const moved = pts.map((p,i)=> (i===0||i===pts.length-1) ? p.slice() : [p[0]+dLat, p[1]+dLng]);
  return offsetMidpoints(moved, dLat*0.5, dLng*0.5);
}
// per-route nudge toward the channel/sea (keeps shore lines off land)
const OFFSETS = {
  'Boğaz (Avrupa)':   [0,  0.0042],
  'Boğaz (Anadolu)':  [0, -0.0042],
  'Bostancı–Kadıköy': [-0.007, 0.003],
  'Üsküdar–Beşiktaş': [0.0010, 0.0024]   // bow the short cross-strait hop into the channel
};
const SHORE = new Set(['Boğaz (Avrupa)','Boğaz (Anadolu)']);   // long bank-hugging lines

// ---- coastline-aware water snapping: pull any vertex that lands on shore into the sea ----
// OSM coastline convention: land is on the LEFT of a way's direction, water on the RIGHT.
let coastSegs = [];
try {
  const craw = JSON.parse(fs.readFileSync(path.join(DIR,'coastline.json'),'utf8'));
  for (const w of craw.elements){ if(w.type!=='way'||!w.geometry) continue; const g=w.geometry;
    for(let i=1;i<g.length;i++) coastSegs.push([g[i-1].lon,g[i-1].lat,g[i].lon,g[i].lat]); }   // [ax,ay,bx,by] = lng,lat
} catch(e){ /* coastline.json optional — without it, no snapping */ }
const DEG = 92000;   // ~metres per degree at this latitude (lng-ish)
// nearest coastline segment to a point; returns closest point, unit water-normal, side, distance(m)
function coastInfo(px, py){
  let bd=Infinity, cx=0, cy=0, nx=0, ny=0, land=false;
  for(const s of coastSegs){
    const ax=s[0],ay=s[1],bx=s[2],by=s[3]; const dx=bx-ax,dy=by-ay; const L=dx*dx+dy*dy||1e-12;
    let t=((px-ax)*dx+(py-ay)*dy)/L; t=t<0?0:t>1?1:t;
    const qx=ax+t*dx, qy=ay+t*dy; const ex=px-qx, ey=py-qy; const d=ex*ex+ey*ey;
    if(d<bd){ bd=d; cx=qx; cy=qy; const len=Math.sqrt(dx*dx+dy*dy)||1e-9;
      nx=dy/len; ny=-dx/len;                                   // right-hand (water) normal
      land = ((bx-ax)*(py-ay)-(by-ay)*(px-ax)) > 0; }          // >0 ⇒ left ⇒ land
  }
  return { cx, cy, nx, ny, land, distM:Math.sqrt(bd)*DEG };
}
// move a point to the water side, at least MARGIN metres off the nearest shore
function pushToWater(px, py){
  const MARGIN=130, m=MARGIN/DEG;
  let c=coastInfo(px,py);
  if(!coastSegs.length) return [px,py];
  if(!c.land && c.distM>=MARGIN) return [px,py];
  for(let k=1;k<=30;k++){                                       // step outward along the water normal
    const qx=c.cx+c.nx*m*k, qy=c.cy+c.ny*m*k; const cc=coastInfo(qx,qy);
    if(!cc.land && cc.distM>=MARGIN*0.7) return [qx,qy];
  }
  return [c.cx+c.nx*m*3, c.cy+c.ny*m*3];
}
// pull a whole densified path off land (keep the terminal piers where they dock)
function repelToWater(latlngs){
  if(!coastSegs.length) return latlngs;
  return latlngs.map((p,i)=>{
    if(i===0 || i===latlngs.length-1) return p;
    const w=pushToWater(p[1], p[0]);                            // p=[lat,lng] → coast uses lng,lat
    return [w[1], w[0]];
  });
}
// push a point toward the channel along a FIXED direction (stable for bank-hugging
// lines: coast-normal pushing flips direction near coves/headlands and self-crosses).
function pushDir(lng, lat, dir){
  if(!coastSegs.length) return [lng,lat];
  const c=coastInfo(lng,lat); if(!c.land && c.distM>=130) return [lng,lat];
  const step=130/DEG;
  for(let k=1;k<=45;k++){ const ql=lng+dir[1]*step*k, qa=lat+dir[0]*step*k;
    const cc=coastInfo(ql,qa); if(!cc.land && cc.distM>=110) return [ql,qa]; }
  return [lng+dir[1]*step*10, lat+dir[0]*step*10];
}
// Clean pier-to-pier routing that stays on water: keep every pier exact, and between
// each pair insert a FEW control points (≈1 per 850 m) nudged into open water, then
// spline. Few moved points ⇒ smooth line, no per-vertex scribble. `dir` (optional, toward
// the channel) gives a stable push for shore lines; otherwise the coastline normal is used.
function waterRoute(piers, dir){
  if(piers.length<2) return piers;
  const ctrl=[piers[0].slice()];
  for(let i=0;i<piers.length-1;i++){
    const A=piers[i], B=piers[i+1], segM=meters(A,B);
    const n=Math.min(9, Math.max(1, Math.round(segM/850)));
    for(let s=1;s<=n;s++){
      const t=s/(n+1), lat=A[0]+(B[0]-A[0])*t, lng=A[1]+(B[1]-A[1])*t;
      const w = dir ? pushDir(lng,lat,dir) : pushToWater(lng,lat);   // [lng,lat] on water
      ctrl.push([w[1],w[0]]);
    }
    ctrl.push(B.slice());
  }
  return catmullRom(ctrl, 12);
}

// stitched paths from the OSM route=ferry relations (real over-water geometry),
// tagged with their from/to terminals so each route matches the RIGHT relation
// (endpoint-distance matching cross-assigned Beşiktaş↔Kabataş, ~1.5 km apart).
const relInfos = [];
try {
  const fraw = JSON.parse(fs.readFileSync(path.join(DIR,'ferry.json'),'utf8'));
  fraw.elements.filter(e=>e.type==='relation').forEach(rel=>{
    const ways=(rel.members||[]).filter(m=>m.type==='way'&&m.geometry).map(m=>m.geometry.map(g=>[g.lat,g.lon]));
    if(!ways.length) return;
    const coords = stitchAll(ways);
    if(coords.length<2) return;
    const t = rel.tags||{};
    let from=t.from, to=t.to;
    if(!from || !to){                                      // derive terminals from the name
      const parts=(t.name||'').split(/[-–—→>]/).map(s=>s.trim()).filter(Boolean);
      if(parts.length>=2){ from=from||parts[0]; to=to||parts[parts.length-1]; }
    }
    relInfos.push({ from, to, coords, len:chainLen(coords) });
  });
} catch(e){ /* ferry.json optional */ }

function nameHit(a,b){ a=norm(a||''); b=norm(b||''); return !!a && !!b && (a===b || a.includes(b) || b.includes(a)); }
// match by terminal NAME (either direction); among matches prefer the most direct
// geometry (length closest to the straight pier-to-pier distance).
function findGeom(start, end, first, last){
  const straight = meters(start,end); let best=null, bestScore=Infinity;
  for(const r of relInfos){
    if(!r.from || !r.to) continue;
    const fwd = nameHit(r.from,first) && nameHit(r.to,last);
    const rev = nameHit(r.from,last) && nameHit(r.to,first);
    if(!fwd && !rev) continue;
    if(r.len < straight*0.6 || r.len > straight*3.2) continue;   // sanity vs crossing distance
    const score = Math.abs(r.len - straight);
    if(score < bestScore){ bestScore=score; best={ coords: rev?r.coords.slice().reverse():r.coords, len:r.len }; }
  }
  return best;
}

function norm(s){
  return s.normalize('NFC').toLocaleLowerCase('tr')
    .replace(/[()]/g,' ')
    .replace(/\b(i̇skelesi|iskelesi|i̇skesi|iskesi|vapur|motor|deniz otobüsü|denizotobüsü|şehir hatları|şehir hatlari|sehir hatlari|turyol|i̇do|ido|dentur|terminali|terminalı|limanı|prenstur|araba|net|mavimarmara|galataport)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}

// approximate location per place — disambiguates OSM noise (e.g. a mislabelled
// "Kabataş İskelesi" node that actually sits at Kadıköy). The real OSM pier
// nearest the hint is used.
const HINTS = {
  'Eminönü':[41.017,28.974],'Karaköy':[41.022,28.977],'Kabataş':[41.033,28.994],
  'Beşiktaş':[41.041,29.005],'Üsküdar':[41.026,29.015],'Kadıköy':[40.992,29.022],
  'Bostancı':[40.954,29.094],'Ortaköy':[41.047,29.027],'Arnavutköy':[41.067,29.043],
  'Bebek':[41.078,29.043],'Emirgan':[41.108,29.055],'İstinye':[41.109,29.058],
  'Yeniköy':[41.121,29.060],'Sarıyer':[41.167,29.058],'Rumeli Kavağı':[41.196,29.066],
  'Beylerbeyi':[41.045,29.045],'Çengelköy':[41.051,29.051],'Kandilli':[41.075,29.058],
  'Anadolu Hisarı':[41.083,29.067],'Kanlıca':[41.100,29.065],'Çubuklu':[41.108,29.082],
  'Paşabahçe':[41.117,29.093],'Beykoz':[41.134,29.090],'Anadolu Kavağı':[41.173,29.088],
  'Kasımpaşa':[41.034,28.965],'Hasköy':[41.043,28.951],'Fener':[41.034,28.949],
  'Balat':[41.031,28.949],'Ayvansaray':[41.035,28.943],'Sütlüce':[41.046,28.948],
  'Eyüp':[41.048,28.933],'Kınalıada':[40.9105,29.0518],'Burgazada':[40.8807,29.0667],
  'Heybeliada':[40.8745,29.0905],'Büyükada':[40.8767,29.1230]
};
const dist2 = (p,h) => { const dx=p.lat-h[0], dy=p.lng-h[1]; return dx*dx+dy*dy; };

// exact İskele coordinates where the OSM pier nodes are wrong/ambiguous (picked a marina
// or a node deep in a cove). These override findPier so the line docks at the real pier.
const PIER_FIX = {
  'Emirgan':[41.10305,29.05609],   // OSM 'Emirgan Vapur İskelesi'
  'İstinye':[41.10920,29.05790],   // no OSM node — hand-placed at the bay mouth on the channel
  'Yeniköy':[41.12171,29.07119],   // OSM 'Yeniköy Şehir Hatları İskelesi'
  'Sarıyer':[41.16716,29.05768],   // OSM 'İDO Sarıyer İskelesi'
  'Rumeli Kavağı':[41.18164,29.07520]
};

// find the best pier coordinate for a place name: name match, then nearest to hint
function findPier(place){
  if(PIER_FIX[place]) return { name:place, lat:PIER_FIX[place][0], lng:PIER_FIX[place][1] };
  const np = norm(place), hint = HINTS[place];
  const cands = piers.filter(p => { const n = norm(p.name); return n===np || n.includes(np) || np.includes(n); });
  if (!cands.length) return null;
  const pick = hint
    ? cands.reduce((a,b) => dist2(b,hint) < dist2(a,hint) ? b : a)
    : cands.reduce((a,b) => norm(b.name).length < norm(a.name).length ? b : a);
  const off = hint ? Math.round(Math.sqrt(dist2(pick,hint))*111000) : 0;   // metres from hint
  if (off > 2500) console.warn('  ! '+place+' pick '+off+'m from hint ('+pick.name+')');
  return { name:place, lat:+pick.lat.toFixed(5), lng:+pick.lng.toFixed(5) };
}

// canonical routes (accurate to Şehir Hatları / Turyol / İDO / Dentur services)
// all ferries share one light-blue, thin, dotted style (matching the Golden Horn look)
const FX = '#4AB8E8';
const ROUTES = [
  { ref:'Üsküdar–Eminönü',  color:FX,        official:'Şehir Hatları · Üsküdar – Eminönü',         places:['Üsküdar','Eminönü'] },
  { ref:'Kadıköy–Eminönü',  color:FX,        official:'Şehir Hatları · Kadıköy – Eminönü',         places:['Kadıköy','Eminönü'] },
  { ref:'Kadıköy–Karaköy',  color:FX,        official:'Şehir Hatları · Kadıköy – Karaköy',         places:['Kadıköy','Karaköy'] },
  { ref:'Üsküdar–Beşiktaş', color:FX,        official:'Şehir Hatları · Üsküdar – Beşiktaş',        places:['Üsküdar','Beşiktaş'] },
  { ref:'Kadıköy–Beşiktaş', color:FX,        official:'Şehir Hatları · Kadıköy – Beşiktaş',        places:['Kadıköy','Beşiktaş'] },
  { ref:'Üsküdar–Kabataş',  color:FX,        official:'Dentur Avrasya · Üsküdar – Kabataş',         places:['Üsküdar','Kabataş'] },
  { ref:'Kadıköy–Kabataş',  color:FX,        official:'Dentur Avrasya · Kadıköy – Kabataş',         places:['Kadıköy','Kabataş'] },
  { ref:'Bostancı–Kadıköy', color:FX,        official:'Şehir Hatları · Bostancı – Kadıköy – Karaköy', places:['Bostancı','Kadıköy','Karaköy'] },
  { ref:'Boğaz (Avrupa)',   color:'#1B6CA8', official:'Boğaz Hattı · European shore',
    places:['Eminönü','Beşiktaş','Ortaköy','Arnavutköy','Bebek','Emirgan','İstinye','Yeniköy','Sarıyer','Rumeli Kavağı'] },
  { ref:'Boğaz (Anadolu)',  color:'#1B6CA8', official:'Boğaz Hattı · Asian shore',
    places:['Üsküdar','Beylerbeyi','Çengelköy','Kandilli','Anadolu Hisarı','Kanlıca','Çubuklu','Paşabahçe','Beykoz','Anadolu Kavağı'] },
  { ref:'Haliç Hattı',      color:'#3FB6C9', official:'Golden Horn · Üsküdar – Karaköy – Eyüp',
    places:['Üsküdar','Karaköy','Kasımpaşa','Hasköy','Fener','Balat','Ayvansaray','Sütlüce','Eyüp'] },
  { ref:'Adalar (Kabataş)', color:'#5AC8E8', official:'Şehir Hatları · Kabataş – Kadıköy – Adalar',
    places:['Kabataş','Kadıköy','Kınalıada','Burgazada','Heybeliada','Büyükada'] },
  { ref:'Adalar (Bostancı)',color:'#5AC8E8', official:'Şehir Hatları · Bostancı – Adalar',
    places:['Bostancı','Kınalıada','Burgazada','Heybeliada','Büyükada'] }
];

const out = [];
const missing = [];
let geomUsed = 0;
for (const r of ROUTES){
  const stations = r.places.map(p => { const f = findPier(p); if(!f) missing.push(r.ref+': '+p); return f; }).filter(Boolean);
  if (stations.length < 2) continue;
  const start = [stations[0].lat, stations[0].lng];
  const end   = [stations[stations.length-1].lat, stations[stations.length-1].lng];
  // prefer real OSM over-water geometry (matched by terminal name); else pier-to-pier on water.
  // island routes are FORCED synthetic — their OSM relations are fragmented and stitch into
  // straight chords that slice across Heybeliada/Burgazada; waterRoute goes around on water.
  const FORCE_PIERS = new Set(['Adalar (Kabataş)','Adalar (Bostancı)']);
  const g = FORCE_PIERS.has(r.ref) ? null : findGeom(start, end, r.places[0], r.places[r.places.length-1]);
  const round = p => [ +p[0].toFixed(5), +p[1].toFixed(5) ];
  let path, src;
  if (g){ path = simplify(g.coords, 0.00006).map(round); src='osm'; geomUsed++; }
  else {
    const piers = stations.map(s => [s.lat, s.lng]);
    const DIR_PUSH = { 'Boğaz (Avrupa)':[0,1], 'Boğaz (Anadolu)':[0,-1] };   // toward the channel
    path = simplify(waterRoute(piers, DIR_PUSH[r.ref]), 0.00003).map(round);  // clean line on water
    src='piers';
  }
  out.push({ ref:r.ref, kind:'ferry', color:FX, paths:[path], stations,
             scope:'active', official:r.official, geom:src });
}

fs.writeFileSync(path.join(DIR,'ferry-lines.json'), JSON.stringify(out));
console.log('REF'.padEnd(18),'PIERS','GEOM','PTS','OFFICIAL');
for (const l of out) console.log(l.ref.padEnd(18), String(l.stations.length).padEnd(5), (l.geom||'').padEnd(5), String(l.paths[0].length).padEnd(4), l.official);
if (missing.length) console.log('\nMISSING PIERS:', missing.join(' | '));
console.log('\nTOTAL FERRY LINES:', out.length, ' USING OSM GEOMETRY:', geomUsed, ' RELINFOS:', relInfos.length);
