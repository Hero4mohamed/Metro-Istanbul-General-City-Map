/* ===========================================================================
   BUS ROUTES, DRAWN SO THAT BOTH DIRECTIONS CAN BE SEEN (V4.2)
   A route runs one way and comes back, and in most cities both run along the same street. The old drawing put the two on the very
   same line — the going route first, the returning one over it in dashes — so one hid the other and neither could be followed.
   Now each direction is drawn on its own side of the road, the side its buses really use (the right, in Turkey), with arrowheads
   showing which way it goes, and its own stops sit on its own line. A control above the route list can show one direction at a
   time, the other fading back. All of it is worked out in screen pixels at the zoom the map is at, so the gap between the two lines
   is the same on a street and on a whole city, and it is redone when the zoom changes. The lines are built once per zoom; the
   arrowheads and stops are only drawn near what is on screen, and redrawn as the map moves, so a route of a thousand stops stays
   cheap to pan across.
   ========================================================================== */
const BUS_VIEW = { v:'both' };        // 'both', or 0 / 1: the direction to show at full strength
/* `var`, not `let`: applyMapTone() asks paintBus() to redraw while 08-map.js is still being read, long before this file; a `let`
   would still be in its temporal dead zone and stop the app starting. */
var busDraw = null;                   // { dirs, chains, paths, key, rows } of the route on the map now, kept so it can be redrawn
var busRouteGroup = null;             // the two lines (rebuilt when the zoom, the scope of direction or the map's tone changes)
var busMarkGroup = null;              // arrowheads and stops (rebuilt whenever the map moves)
const busW = z => z <= 10 ? 2.6 : z <= 12 ? 3.4 : z <= 14 ? 4.2 : z <= 16 ? 5.2 : 6.2;

/* A path shifted `px` screen pixels to the right of its own direction of travel. Corners are mitred, but a sharp one is capped so
   it cannot throw a spike across the street; points on top of each other have no direction and are dropped. */
function busOffset(P, px){
  const Q = P.length ? [P[0]] : [];
  for(let i = 1; i < P.length; i++) if(P[i].distanceTo(Q[Q.length - 1]) > 0.4) Q.push(P[i]);
  if(Q.length < 2 || !px) return Q;
  const N = [];
  for(let i = 0; i < Q.length - 1; i++){ const dx = Q[i+1].x - Q[i].x, dy = Q[i+1].y - Q[i].y, l = Math.hypot(dx, dy); N.push([-dy / l, dx / l]); }
  return Q.map((p, i) => {
    let nx, ny, k = 1;
    if(i === 0){ nx = N[0][0]; ny = N[0][1]; }
    else if(i === Q.length - 1){ nx = N[N.length-1][0]; ny = N[N.length-1][1]; }
    else {
      const a = N[i-1], b = N[i], sx = a[0] + b[0], sy = a[1] + b[1], sl = Math.hypot(sx, sy);
      if(sl < 1e-6){ nx = a[0]; ny = a[1]; }                               // a U-turn has no bisector
      else { nx = sx / sl; ny = sy / sl; k = Math.min(2.2, 1 / Math.max(0.45, nx * a[0] + ny * a[1])); }
    }
    return L.point(p.x + nx * px * k, p.y + ny * px * k);
  });
}
/* where on `base` (the route's own centre line) a stop is, moved over to the side its direction uses */
function busSnap(base, px, p){
  let best = Infinity, fx = p.x, fy = p.y, nx = 0, ny = 0;
  for(let i = 0; i < base.length - 1; i++){
    const a = base[i], b = base[i+1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if(l2 < 1e-9) continue;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = a.x + dx * t, qy = a.y + dy * t, d = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
    if(d < best){ best = d; fx = qx; fy = qy; const l = Math.sqrt(l2); nx = -dy / l; ny = dx / l; }
  }
  return L.point(fx + nx * px, fy + ny * px);
}
/* arrowheads (three points each: the tip, then the two corners of the base) at even distances along a path, `alen` long and `hb`
   either side of the line; only those inside `vb` (a pixel box), because a route can be thousands of arrowheads long */
function busArrows(P, spacing, alen, hb, vb){
  const out = []; let carry = spacing * 0.5;
  for(let i = 0; i < P.length - 1; i++){
    const a = P[i], b = P[i+1], dx = b.x - a.x, dy = b.y - a.y, seg = Math.hypot(dx, dy);
    if(seg < 1e-6) continue;
    const hx = dx / seg, hy = dy / seg, nx = -hy, ny = hx;
    let d = carry;
    // a segment wholly outside the box only has to be walked past, not drawn
    const out_ = Math.max(a.x, b.x) < vb.min.x || Math.min(a.x, b.x) > vb.max.x || Math.max(a.y, b.y) < vb.min.y || Math.min(a.y, b.y) > vb.max.y;
    while(d <= seg){
      const cx = a.x + hx * d, cy = a.y + hy * d;
      if(!out_ && cx >= vb.min.x && cx <= vb.max.x && cy >= vb.min.y && cy <= vb.max.y){
        out.push([L.point(cx + hx * alen * 0.6, cy + hy * alen * 0.6),
                  L.point(cx - hx * alen * 0.4 + nx * hb, cy - hy * alen * 0.4 + ny * hb), L.point(cx - hx * alen * 0.4 - nx * hb, cy - hy * alen * 0.4 - ny * hb)]);
      }
      d += spacing;
    }
    carry = d - seg;
  }
  return out;
}
/* the two lines, per zoom: projected, shifted to their own side, kept until the zoom changes */
function busRows(z, off){
  if(busDraw.rows && busDraw.rowsZ === z && busDraw.rowsOff === off) return busDraw.rows;
  busDraw.rowsZ = z; busDraw.rowsOff = off;
  return busDraw.rows = busDraw.dirs.map((d, di) => {
    const base = busDraw.paths[di].map(p => map.project(p, z));
    return { d, di, base, P: busOffset(base, off), col: BUS_DIR_COLOR[di % BUS_DIR_COLOR.length] };
  });
}
function paintBus(){
  if(!busDraw || !busRouteGroup || !busLayer.hasLayer(busRouteGroup)) return;
  const z = map.getZoom(), w = busW(z), tone = MAP_T(), two = busDraw.dirs.length > 1, off = two ? w * 0.62 + 1 : 0, view = BUS_VIEW.v;
  const rows = busRows(z, off);
  const toLL = P => P.map(p => map.unproject(p, z));
  rows.forEach(r => { r.dim = view !== 'both' && view !== r.di; });
  // the lines: only when something that changes how they look has changed
  const key = z + '|' + view + '|' + tone.casing;
  if(busDraw.key !== key){
    busDraw.key = key; busRouteGroup.clearLayers();
    // one dark (or pale, on a light map) edge under BOTH lines, so that the pair reads as a route and the two stay apart from the map
    rows.forEach(r => L.polyline(toLL(r.P), { color:tone.casing, weight:w + 3.4, opacity:r.dim ? 0.18 : tone.casingOp, lineCap:'round', lineJoin:'round', interactive:false }).addTo(busRouteGroup));
    rows.forEach(r => L.polyline(toLL(r.P), { color:r.col, weight:w, opacity:r.dim ? 0.3 : 0.98, lineCap:'round', lineJoin:'round' })
      .bindTooltip(svgEsc((r.d.ref || '') + ' → ' + (r.d.head || '')), { sticky:true, className:'lt' }).addTo(busRouteGroup));
  }
  // the arrowheads and the stops: what is on screen, and a little more
  busMarkGroup.clearLayers();
  const vb = map.getPixelBounds(), pad = 160, box = { min:{ x:vb.min.x - pad, y:vb.min.y - pad }, max:{ x:vb.max.x + pad, y:vb.max.y + pad } };
  const inside = p => p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
  if(z >= 12) rows.forEach(r => {
    if(r.dim) return;
    busArrows(r.P, 84, w * 1.4 + 2, w * 0.5, box).forEach(c => L.polygon(toLL(c), { color:'#10151F', weight:0.9, opacity:0.85, fillColor:'#FFFFFF', fillOpacity:0.97,
      lineJoin:'round', interactive:false }).addTo(busMarkGroup));
  });
  rows.forEach(r => {
    if(r.dim) return;
    const last = r.d.stops.length - 1;
    r.d.stops.forEach((s, i) => {
      const end = i === 0 || i === last;
      if(z < 12 && !end) return;                                  // a whole city: just where it starts and ends
      const sp = map.project([s[0], s[1]], z);
      if(!end && !inside(sp)) return;
      L.circleMarker(map.unproject(busSnap(r.base, off, sp), z), { radius:end ? w * 1.15 + 1.6 : (z < 14 ? 2.3 : z < 16 ? 3.4 : 4.6), color:end ? tone.hole : r.col, weight:end ? 2.2 : 1.8,
        fillColor:end ? r.col : tone.hole, fillOpacity:1, bubblingMouseEvents:false })
        .bindTooltip(svgEsc(s[2] || ''), { className:'lt', direction:'top' }).addTo(busMarkGroup);
    });
  });
}
/* Draw a route's directions; returns every point drawn, for fitting the view. */
function drawBusDirs(dirs, chains){
  busLayer.clearLayers();
  busRouteGroup = L.layerGroup().addTo(busLayer);
  busMarkGroup = L.layerGroup().addTo(busLayer);
  busDraw = { dirs, chains, paths:dirs.map(d => busDirPath(d, chains)), key:null, rows:null };
  paintBus();
  return [].concat.apply([], busDraw.paths);
}
/* zoom changes everything; a pan only moves which arrowheads and stops are near. The two events come together after a zoom, so they
   are folded into one repaint. */
let busPaintTimer = 0;
const busPaintSoon = () => { clearTimeout(busPaintTimer); busPaintTimer = setTimeout(paintBus, 0); };
map.on('zoomend', busPaintSoon);
map.on('moveend', busPaintSoon);
/* which direction is shown at full strength: the control at the top of the route's details */
function busDirToggleHTML(dirs){
  if(!dirs || dirs.length < 2) return '';
  const b = (v, col, label) => '<button data-v="' + v + '"' + (BUS_VIEW.v === v ? ' class="active"' : '') + '>' + (col ? '<span class="bd-sw" style="background:' + col + '"></span>' : '') + '<span class="bd-t">' + label + '</span></button>';
  return '<div class="seg bd-dirs" role="group" aria-label="' + attrEsc(t('busDirections')) + '">' + b('both', '', svgEsc(t('busBothDirs')))
    + dirs.map((d, i) => b(String(i), BUS_DIR_COLOR[i % BUS_DIR_COLOR.length], '→ ' + svgEsc(d.head || (i ? t('busReturn') : t('busOutbound'))))).join('') + '</div>';
}
function busPathPoints(v){ return busDraw ? (v === 'both' ? [].concat.apply([], busDraw.paths) : busDraw.paths[v] || []) : []; }
function setBusView(v, box){
  BUS_VIEW.v = v;
  (box || document).querySelectorAll('.bd-dirs button').forEach(b => b.classList.toggle('active', b.dataset.v === String(v)));
  paintBus();
  const pts = busPathPoints(v); if(pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
}
function wireBusDirToggle(box){
  box.querySelectorAll('.bd-dirs button').forEach(b => b.addEventListener('click', () => setBusView(b.dataset.v === 'both' ? 'both' : +b.dataset.v, box)));
}
