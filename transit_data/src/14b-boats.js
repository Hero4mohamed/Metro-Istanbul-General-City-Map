/* ===========================================================================
   THE BOATS TAB (V4.5)
   On the default map the ferry lines are quiet dotted lanes, and lines that share a stretch of sea share one lane (V4.4.1): right for
   a map whose subject is the railways. Asked for here is the opposite view: ONLY the boats, every line told apart.

   So in this tab each ferry line has its own colour and its own lane. Where several lines share the water they run SIDE BY SIDE, a
   few pixels apart, in a fixed order, instead of on top of each other; where a line is alone it runs down the middle of its route.
   The shared geometry (built over water by ferry-water.cjs) is what makes that possible: two lines on the same stretch have exactly
   the same points, so "the same stretch" can be recognised and each line given its place across it.

   The offsets are in screen pixels, so the lanes are the same distance apart at every zoom; they are worked out again when the zoom
   changes. Nothing here changes a line's stops, its panel or the planner: it is a way of drawing.
   =========================================================================== */
/* ==BOATS-PURE-START== */
/* told apart on dark and on light water, and from each other when they run side by side (no two neighbours alike) */
const BOAT_COLOURS = ['#38BDF8', '#F472B6', '#FBBF24', '#34D399', '#A78BFA', '#FB7185', '#F97316', '#22D3EE', '#A3E635', '#E879F9', '#60A5FA', '#FACC15', '#2DD4BF', '#C084FC', '#F87171', '#4ADE80'];
const BOAT_GAP = 5.5;                       // pixels between the middles of two neighbouring lanes
const boatSegKey = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])) ? a[0] + ',' + a[1] + '|' + b[0] + ',' + b[1] : b[0] + ',' + b[1] + '|' + a[0] + ',' + a[1];
/* which lines use each stretch between two neighbouring points: key -> [line index, …] in a fixed order */
function boatLanes(paths) {
  const seg = new Map();
  paths.forEach((p, li) => { for (let i = 1; i < p.length; i++) { const k = boatSegKey(p[i - 1], p[i]); let a = seg.get(k); if (!a) seg.set(k, a = []); if (a.indexOf(li) < 0) a.push(li); } });
  seg.forEach(a => a.sort((x, y) => x - y));
  return seg;
}
/**
 * One line's path moved sideways into its lane. `pts`: the path as pixel points [{x, y}], `geo`: the same path as [lat, lng] (for the
 * stretch keys), `li`: the line's index, `seg`: boatLanes(). Returns pixel points. A stretch's sideways direction is taken from its
 * canonical direction (the same whichever way a line sails it), so two lines on one stretch always agree which side is which.
 */
function boatOffsetPath(pts, geo, li, seg, gap, pins, reach) {
  const n = pts.length, off = [];                      // per segment: the sideways vector to add
  for (let i = 1; i < n; i++) {
    const a = geo[i - 1], b = geo[i], users = seg.get(boatSegKey(a, b)) || [li];
    const rank = users.indexOf(li), d = (rank - (users.length - 1) / 2) * gap;
    const fwd = (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]));           // is this the canonical direction?
    let dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y; const len = Math.hypot(dx, dy) || 1;
    if (!fwd) { dx = -dx; dy = -dy; }
    off.push([-dy / len * d, dx / len * d]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = off[Math.max(0, i - 1)], q = off[Math.min(n - 2, i)];        // the stretch before and the stretch after this point
    /* near a pier the lanes come together: every line docks at the pier itself, and the last few metres of water are too short to
       hold a lane each (they turned into little hooks). The sideways shift fades to nothing over `reach` pixels from a pier. */
    let k = 1;
    if (pins && reach) for (const pin of pins) { const d = Math.hypot(pts[i].x - pin.x, pts[i].y - pin.y); if (d < reach) k = Math.min(k, d / reach); }
    k = k * k * (3 - 2 * k);                                               // eased, so the lanes leave the pier without a corner
    out.push({ x: pts[i].x + (p[0] + q[0]) / 2 * k, y: pts[i].y + (p[1] + q[1]) / 2 * k });
  }
  return out;
}
/* ==BOATS-PURE-END== */

const boatLines = NETWORK.filter(l => l.kind === 'ferry' && isLive(l) && Array.isArray(l.paths) && l.paths.length && l.paths[0].length > 1);
const boatLayer = L.layerGroup();
const boatColour = new Map(boatLines.map((l, i) => [l.ref, BOAT_COLOURS[i % BOAT_COLOURS.length]]));
/* every pier once, with the lines that call there (the names the map prints in this tab) */
const PIER_DOT = 6, PIER_DOT_MULTI = 8;      // px across, the same at every zoom (V4.6.2)
const boatStations = (function () {
  const by = new Map();
  boatLines.forEach(l => (l.stations || []).forEach(s => { const k = s.lat + ',' + s.lng; let e = by.get(k); if (!e) by.set(k, e = { name: s.name, lat: s.lat, lng: s.lng, lines: new Set() }); e.lines.add(l.ref); }));
  return [...by.values()];
})();
let boatSeg = null, boatFocusRef = null, boatDrawn = new Map();              // ref -> the offset path last drawn, as [lat, lng]
/* the path a line is drawn on in this tab (so the glow of an opened line follows the lane, not the shared middle) */
function boatColourFor(line) { return (currentTab === 'boat' && line && boatColour.get(line.ref)) || null; }
function boatPathFor(line) { return (currentTab === 'boat' && line && boatDrawn.get(line.ref)) || null; }
function renderBoats() {
  boatLayer.clearLayers(); boatDrawn = new Map();
  if (!boatLines.length) return;
  if (!boatSeg) boatSeg = boatLanes(boatLines.map(l => l.paths[0]));
  const z = map.getZoom(), tone = (typeof mapTone === 'function') ? mapTone() : 'night';
  const gap = z >= 13 ? BOAT_GAP : z >= 11.5 ? BOAT_GAP * .8 : BOAT_GAP * .6, w = z >= 13 ? 3.4 : z >= 11.5 ? 2.8 : 2.2;
  const casing = tone === 'day' ? '#FFFFFF' : '#060A12';
  boatLines.forEach((l, li) => {
    const geo = l.paths[0], px = geo.map(q => map.project(q, z));
    const pins = (l.stations || []).map(s => map.project([s.lat, s.lng], z));
    const ll = boatOffsetPath(px, geo, li, boatSeg, gap, pins, z >= 13 ? 46 : 30).map(q => { const u = map.unproject(q, z); return [u.lat, u.lng]; });
    boatDrawn.set(l.ref, [ll]);
    const dim = boatFocusRef && boatFocusRef !== l.ref, col = boatColour.get(l.ref);
    const tip = () => lineTooltip(l);
    L.polyline(ll, { renderer: lineRenderer, color: casing, weight: w + 2.4, opacity: dim ? .12 : .75, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(boatLayer);
    const core = L.polyline(ll, { renderer: lineRenderer, color: col, weight: w, opacity: dim ? .22 : 1, lineCap: 'round', lineJoin: 'round' });
    const hit = L.polyline(ll, { renderer: lineRenderer, color: col, weight: 14, opacity: 0, lineCap: 'round' });
    [hit, core].forEach(pl => { pl.bindTooltip(tip, { sticky: true, className: 'lt' }); pl.on('click', e => { openLine(l); L.DomEvent.stop(e); }); pl.addTo(boatLayer); });
  });
  /* the piers: one small white dot each, a little larger where several lines call. ONE size at every zoom (V4.6.2: they were drawn
     on the map's own canvas, which is scaled while a zoom animates, and looked large and crowded zoomed out); an element of its own
     is moved by a zoom but never scaled. */
  boatStations.forEach(s => {
    const d = s.lines.size > 1 ? PIER_DOT_MULTI : PIER_DOT;
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'pier-dot', html: '<i style="width:' + d + 'px;height:' + d + 'px"></i>', iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
      interactive: false, keyboard: false }).addTo(boatLayer);
  });
}
/* an opened line stands out among the boats too: called by setLineGlow (12a-line-glow.js) with the line's ref, or null */
function boatFocus(ref) {
  const want = (currentTab === 'boat' && ref && boatColour.has(ref)) ? ref : null;
  if (want === boatFocusRef) return;
  boatFocusRef = want;
  if (currentTab === 'boat') renderBoats();
}
function renderBoatList() {
  const el = document.getElementById('boatList'); if (!el) return;
  el.innerHTML = boatLines.map(l => {
    const st = l.stations || [], ends = st.length ? svgEsc(st[0].name) + ' → ' + svgEsc(st[st.length - 1].name) : '';
    return '<button type="button" class="boat-row" data-ref="' + attrEsc(l.ref) + '"><span class="boat-sw" style="background:' + boatColour.get(l.ref) + '"></span>' +
      '<span class="boat-t"><b>' + svgEsc(l.ref) + '</b><small>' + ends + ' · ' + svgEsc(t('boatPiers').replace('{n}', st.length)) + '</small></span>' +
      noticePillHTML(lineNotices(l.ref, 'ferry')) + '</button>';
  }).join('');
  const c = document.getElementById('boatCount'); if (c) c.textContent = t('boatCount').replace('{n}', boatLines.length);
}
function fitBoats() {
  const pts = []; boatLines.forEach(l => l.paths[0].forEach(q => pts.push(q)));
  if (!pts.length) return;
  const pad = (typeof mapFitPad === 'function') ? mapFitPad() : null;
  map.fitBounds(L.latLngBounds(pts).pad(pad ? .03 : .12), pad || {});
}
(function () {
  const list = document.getElementById('boatList');
  if (list) list.addEventListener('click', e => {
    const b = e.target.closest('.boat-row'); if (!b) return;
    const l = lineByRef[b.dataset.ref]; if (!l) return;
    openLine(l);
    const pad = (typeof mapFitPad === 'function') ? mapFitPad() : null;
    map.fitBounds(L.latLngBounds(l.paths[0]).pad(pad ? .05 : .2), pad || {});
  });
  map.on('zoomend', () => { if (currentTab === 'boat') renderBoats(); });
})();
