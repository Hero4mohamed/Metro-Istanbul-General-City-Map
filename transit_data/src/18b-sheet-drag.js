/* ===========================================================================
   SHEETS AND PANELS THAT LEAVE THE MAP IN VIEW, AND MOVE WITH A FINGER (V4.6.2)
   Asked for as: "whenever I pull a panel like the layers panel it doesn't cover the whole screen", and "give me the ability to pull
   the [line] panel up and down". So on a phone the Layers and Alerts sheets, the Buses/Boats sheet, and the line and station panels
   open at a LOW height with the map above them, undimmed and usable; a drag (or a tap on the grip) takes them to a HIGH height for
   reading, and a drag down past the low height closes them. The planner keeps its own three heights (18-mobile-shell.js).
   Heights are set as max-height, so a sheet with little in it stays as small as its content.
   ========================================================================== */
/* the two heights, in px, for this screen. A panel sits above the bottom bar and stops below the top bar. */
function dragHeights(el){
  const vh = window.innerHeight, kind = el.dataset.dragKind, tb = document.querySelector('.topbar');
  const top = tb ? Math.max(0, tb.getBoundingClientRect().bottom) : 60;
  if(kind === 'panel') return { low: Math.round(vh * 0.44), high: Math.max(Math.round(vh * 0.44) + 40, Math.round(vh - top - 104)) };
  if(kind === 'modes') return { low: Math.round(vh * 0.46), high: Math.round(vh * 0.86) };
  return { low: Math.round(vh * 0.55), high: Math.round(vh * 0.86) };
}
/* `instant`: no animation. Used when a panel or sheet opens or closes, so it never opens squashed at the height a drag left it at
   while the animation back catches up. */
function setDragDetent(el, d, instant){
  el.dataset.detent = d === 'high' ? 'high' : 'low';
  const H = dragHeights(el);
  if(instant) el.classList.add('dragging');
  el.style.maxHeight = (el.dataset.detent === 'high' ? H.high : H.low) + 'px';
  if(instant){ void el.offsetHeight; el.classList.remove('dragging'); }
  if(el.dataset.detent === 'low') el.scrollTop = 0;
  const g = el.querySelector(':scope > .sgrab-btn, :scope > .mgrab-btn');
  if(g) g.setAttribute('aria-expanded', el.dataset.detent === 'high' ? 'true' : 'false');
}
/* Where a drag settles. `h0` and `h` are the heights at the start and the end, `v` the speed at the end in px/ms (+ = growing),
   `from` the height it started at, `H` the two heights. null = close. A short sheet (its content smaller than the low height)
   cannot be closed by a drag UP: nothing shrank. */
function dragSettle(h0, h, v, from, H){
  const shrink = h0 - h;
  if(shrink > 0){
    if((shrink > 80 && h < H.low - 60) || (from === 'low' && v < -0.6 && shrink > 24)) return null;
    if(from === 'high' && (v < -0.45 || h < (H.low + H.high) / 2)) return 'low';
    return from;
  }
  return (v > 0.45 || h > (H.low + H.high) / 2) ? 'high' : 'low';
}
/* `el` follows the finger from its grip, or from anywhere while its content is scrolled to the top */
function makeDraggable(el, kind, close){
  el.dataset.dragKind = kind;
  el.classList.add('draggable');
  let grip = el.querySelector(':scope > .mgrab, :scope > .sgrab');
  if(grip){
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sgrab-btn';
    btn.setAttribute('data-i18n-aria', 'sheetResize'); btn.setAttribute('aria-label', t('sheetResize')); btn.setAttribute('aria-expanded', 'false');
    el.replaceChild(btn, grip); btn.appendChild(grip);
    btn.addEventListener('click', () => setDragDetent(el, el.dataset.detent === 'high' ? 'low' : 'high'));
  }
  setDragDetent(el, 'low');
  let y0 = null, h0 = 0, moved = false, t0 = 0, H = null, onGrip = false;
  el.addEventListener('touchstart', e => {
    y0 = null;
    if(e.touches.length !== 1 || e.target.closest('input,select,textarea,.ac-list,.jmap,.lp-strip,.bd-cs-l,.leaflet-container')) return;
    onGrip = !!e.target.closest('.sgrab-btn');
    if(!onGrip && el.scrollTop > 0) return;                 // scrolled content scrolls; only the top of it drags
    y0 = e.touches[0].clientY; h0 = el.getBoundingClientRect().height; moved = false; t0 = performance.now(); H = dragHeights(el);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if(y0 === null) return;
    const dy = e.touches[0].clientY - y0;
    if(!moved){
      if(Math.abs(dy) < 6) return;
      if(dy < 0 && !onGrip && el.dataset.detent === 'high'){ y0 = null; return; }   // at the high height an upward finger scrolls
    }
    moved = true; el.classList.add('dragging');
    el.style.maxHeight = Math.max(60, Math.min(H.high, h0 - dy)) + 'px';
  }, { passive: true });
  const end = () => {
    if(y0 === null) return;
    y0 = null;
    /* measured BEFORE the animation is switched back on: otherwise the browser can animate from the height it last drew and this
       reads that old height, not where the finger left the panel */
    const h = el.getBoundingClientRect().height;
    el.classList.remove('dragging');
    if(!moved) return;
    const v = (h - h0) / Math.max(1, performance.now() - t0);
    const to = dragSettle(h0, h, v, el.dataset.detent, H);
    if(to === null){ close(); setDragDetent(el, 'low', true); } else setDragDetent(el, to);
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', end, { passive: true });
  window.addEventListener('resize', () => setDragDetent(el, el.dataset.detent));
}
/* the line and station panels: draggable on a phone, and back at the low height each time they open */
function setupPanelDrag(){
  if(!IS_MOBILE) return;
  [['linp', 'linpX'], ['stn', 'stnX']].forEach(([id, x]) => {
    const el = document.getElementById(id); if(!el) return;
    makeDraggable(el, 'panel', () => { const b = document.getElementById(x); if(b) b.click(); });
    /* back at the low height when it OPENS (not on every class change: the end of a drag changes the class too, and would undo it) */
    let shown = el.classList.contains('show');
    if(typeof MutationObserver !== 'undefined') new MutationObserver(() => { const now = el.classList.contains('show'); if(now && !shown) setDragDetent(el, 'low', true); shown = now; })
      .observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}
/* Show a line in the part of the map nothing covers (V4.6.2: "not only it highlights, the screen pans to the line"). On a phone that is
   between the top bar and the panel; on a computer, between the panel on the left and the column of cards on the right. */
function fitLineInView(line){
  if(!line || typeof map === 'undefined') return;
  const pts = [];
  (line.paths || []).forEach(p => (p || []).forEach(q => pts.push(q)));
  if(pts.length < 2) (line.stations || []).forEach(s => { if(isFinite(s.lat) && isFinite(s.lng)) pts.push([s.lat, s.lng]); });
  if(pts.length < 2) return;
  const W = window.innerWidth, Hh = window.innerHeight, p = document.getElementById('linp');
  const pr = p && p.classList.contains('show') ? p.getBoundingClientRect() : null;
  let tl, br;
  if(IS_MOBILE){
    const tb = document.querySelector('.topbar');
    tl = [24, (tb ? Math.max(0, tb.getBoundingClientRect().bottom) : 60) + 12];
    br = [24, pr ? Math.max(40, Hh - pr.top + 12) : 100];
  } else {
    const c = document.querySelector('.controls'), cr = c ? c.getBoundingClientRect() : null;
    tl = [pr ? pr.right + 24 : 30, 30];
    br = [cr && cr.width ? Math.max(30, W - cr.left + 24) : 30, 30];
    if(tl[0] + br[0] > W - 160){ tl[0] = 30; }               // a narrow window: better the whole line under the panel than none
  }
  map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: 15 });
}
/* Planner mode, from the search bar (V4.6.2). The bottom bar has no Planner button any more: the button beside the search box opens
   the planner (on a phone, its sheet; on a computer, the Trip Planner card), and on a phone pressing it again closes it. */
function plannerFromSearch(){
  const scoped = ['weather', 'bus', 'boat', 'intercity', 'airport'];
  if(IS_MOBILE){
    if(mSheets.planner && mSheets.planner.classList.contains('open')){ openSheet(null); return; }
    if(scoped.indexOf(currentTab) >= 0) setTab('active');      // the planner works on the metro network: leave any other view first
    openSheet('planner');
    return;
  }
  if(scoped.indexOf(currentTab) >= 0) setTab('active');
  if(typeof openPlannerCard === 'function') openPlannerCard();
  const c = document.getElementById('cardPlanner'); if(c) try{ c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }catch(e){}
  const i = document.getElementById('selO'); if(i) try{ i.focus({ preventScroll: true }); }catch(e){}
}
(function(){
  const b = document.getElementById('omniPlan'); if(b) b.addEventListener('click', plannerFromSearch);
})();
