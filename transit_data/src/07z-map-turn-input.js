/* ===========================================================================
   TURNING THE MAP: FINGERS, MOUSE, WHEEL, KEYS (V4.2)
   Two fingers do three things at once — move the map with them, zoom by the spread, turn by the twist — and the place under the
   fingers stays under the fingers. A pinch that wobbles a few degrees must not turn the map, so the turn only begins after a
   clear twist and then follows from there (no jump). Let go close to north-up and the map settles to it.
   On a computer: right-drag (or Ctrl + drag) sideways, or Shift + wheel; Shift + left/right arrows turn it in steps.
   Everything goes through map.setRotation(), so the layers need no knowledge of which input turned the map.
   ========================================================================== */
L.Map.mergeOptions({ irnPinch:false, irnMouse:false });
const TURN_START_DEG = 7;       // a twist smaller than this is a wobble of a pinch, not a turn
const TURN_SNAP_DEG = 5;        // within this of north-up, the map settles onto it

L.Map.include({
  /* turn to `deg` the short way round, over `ms` (at once if the page is hidden or the person asked for less motion) */
  rotateTo: function(deg, ms){
    cancelAnimationFrame(this._irnTween || 0);
    const from = this.getRotation(), diff = ((deg - from + 540) % 360) - 180;
    const calm = document.hidden || document.body.classList.contains('reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if(!ms || calm){ this.setRotation(from + diff); this._irnSettled(); return this; }
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      this.setRotation(from + diff * e);
      if(k < 1) this._irnTween = requestAnimationFrame(step); else { this._irnTween = 0; this._irnSettled(); }
    };
    this._irnTween = requestAnimationFrame(step);
    return this;
  },
  /* a turn is over: let the tile layers and the canvases catch up with where the map is now, once */
  _irnSettled: function(){ this.fire('moveend'); this.fire('rotateend', { rotation: this.getRotation() }); },
  /* close to north-up, go to it */
  _irnSnap: function(){ const r = this.getRotation(); if(r && Math.abs(r) < TURN_SNAP_DEG) this.rotateTo(0, 160); else this._irnSettled(); },
});
/* the person's setting (Settings > Map): the handlers stay quiet when it is off */
const turnAllowed = map => map._irnTurnOn !== false;

L.Map.IrnPinch = L.Handler.extend({
  addHooks: function(){ L.DomEvent.on(this._map._container, 'touchstart', this._onStart, this); },
  removeHooks: function(){ L.DomEvent.off(this._map._container, 'touchstart', this._onStart, this); },
  _points: function(e){ const m = this._map; return [m.mouseEventToContainerPoint(e.touches[0]), m.mouseEventToContainerPoint(e.touches[1])]; },
  _onStart: function(e){
    const map = this._map;
    if(!e.touches || e.touches.length !== 2 || map._animatingZoom || this._on) return;
    cancelAnimationFrame(map._irnTween || 0);
    const p = this._points(e), mid = p[0].add(p[1])._divideBy(2);
    this._startDist = p[0].distanceTo(p[1]) || 1;
    this._lastAngle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    this._twist = 0; this._turning = false; this._turnFrom = 0;
    this._startZoom = map.getZoom(); this._startRot = map.getRotation();
    this._anchor = map.containerPointToLatLng(mid);       // the place under the fingers: it stays there
    this._on = true; this._moved = false;
    map._stop();
    L.DomEvent.on(document, 'touchmove', this._onMove, this).on(document, 'touchend touchcancel', this._onEnd, this);
    L.DomEvent.preventDefault(e);
  },
  _onMove: function(e){
    if(!this._on || !e.touches || e.touches.length !== 2) return;
    const map = this._map, p = this._points(e), mid = p[0].add(p[1])._divideBy(2);
    // the twist so far, kept continuous (an angle that wraps from 180 to -180 must not jump)
    const ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    let d = ang - this._lastAngle; if(d > Math.PI) d -= 2 * Math.PI; else if(d < -Math.PI) d += 2 * Math.PI;
    this._twist += d; this._lastAngle = ang;
    if(map.options.irnTurn && turnAllowed(map)){
      if(!this._turning && Math.abs(this._twist) > TURN_START_DEG * MAP_TURN.RAD){ this._turning = true; this._turnFrom = this._twist; }
      if(this._turning) map.setRotation(this._startRot + (this._twist - this._turnFrom) / MAP_TURN.RAD);
    }
    const zoom = map.getScaleZoom(p[0].distanceTo(p[1]) / this._startDist, this._startZoom);
    // put the place that was under the fingers at the start under their middle now, whatever the angle and zoom have become
    const c = map.getSize().divideBy(2), a = map._irnTheta || 0;
    const center = map.unproject(map.project(this._anchor, zoom).subtract(MAP_TURN.turn(mid.subtract(c), -a)), zoom);
    this._center = center; this._zoom = zoom;
    if(!this._moved){ map._moveStart(true, false); this._moved = true; }
    L.Util.cancelAnimFrame(this._raf);
    this._raf = L.Util.requestAnimFrame(L.Util.bind(map._move, map, center, zoom, { pinch:true, round:false }, undefined), this, true);
    L.DomEvent.preventDefault(e);
  },
  _onEnd: function(){
    const map = this._map;
    L.DomEvent.off(document, 'touchmove', this._onMove, this).off(document, 'touchend touchcancel', this._onEnd, this);
    if(!this._on) return;
    this._on = false;
    L.Util.cancelAnimFrame(this._raf);
    if(!this._moved) return;
    const zoom = map._limitZoom(this._zoom);
    // settle: first the zoom (it also puts the map back inside its limits), then the angle onto north if it is close
    const snap = () => map._irnSnap();
    if(map.options.irnTurn && map.getRotation()) map.once('zoomend', snap);
    if(map.options.zoomAnimation) map._animateZoom(this._center, zoom, true, map.options.zoomSnap);
    else { map._resetView(this._center, zoom); snap(); }
  },
});
L.Map.addInitHook('addHandler', 'irnPinch', L.Map.IrnPinch);

L.Map.IrnMouse = L.Handler.extend({
  addHooks: function(){
    const c = this._map._container;
    this._down = e => this._onDown(e); this._wheel = e => this._onWheel(e); this._key = e => this._onKey(e); this._menu = e => { if(turnAllowed(this._map)) e.preventDefault(); };
    // on the capture phase, so that these win over Leaflet's own dragging, wheel zoom and keyboard panning on the same element
    c.addEventListener('mousedown', this._down, true);
    c.addEventListener('wheel', this._wheel, { capture:true, passive:false });
    c.addEventListener('keydown', this._key, true);
    c.addEventListener('contextmenu', this._menu, true);
  },
  removeHooks: function(){
    const c = this._map._container;
    c.removeEventListener('mousedown', this._down, true); c.removeEventListener('wheel', this._wheel, true);
    c.removeEventListener('keydown', this._key, true); c.removeEventListener('contextmenu', this._menu, true);
  },
  _onDown: function(e){
    const map = this._map;
    if(!turnAllowed(map) || !(e.button === 2 || (e.button === 0 && e.ctrlKey))) return;
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(map._irnTween || 0);
    this._x0 = e.clientX; this._r0 = map.getRotation(); this._dragging = true; this._moved = false;
    this._mm = ev => { if(!this._dragging) return; this._moved = true; map.setRotation(this._r0 + (ev.clientX - this._x0) * 0.3); };
    this._mu = () => {
      this._dragging = false; document.removeEventListener('mousemove', this._mm, true); document.removeEventListener('mouseup', this._mu, true);
      if(this._moved){
        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };      // the click that ends a ctrl + drag is not a click on the map
        document.addEventListener('click', swallow, { capture:true, once:true }); setTimeout(() => document.removeEventListener('click', swallow, true), 0);
        map._irnSnap();
      }
    };
    document.addEventListener('mousemove', this._mm, true); document.addEventListener('mouseup', this._mu, true);
  },
  _onWheel: function(e){
    const map = this._map;
    if(!e.shiftKey || !turnAllowed(map)) return;
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(map._irnTween || 0);
    const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    map.setRotation(map.getRotation() + dy * 0.12);
    clearTimeout(this._wheelEnd); this._wheelEnd = setTimeout(() => map._irnSnap(), 180);
  },
  _onKey: function(e){
    const map = this._map;
    if(!turnAllowed(map) || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === 'ArrowLeft' ? -15 : e.key === 'ArrowRight' ? 15 : 0;
    if(!step) return;
    e.preventDefault(); e.stopPropagation();        // not Leaflet's "pan three times as far"
    map.rotateTo(Math.round((map.getRotation() + step) / 15) * 15, 160);
  },
});
L.Map.addInitHook('addHandler', 'irnMouse', L.Map.IrnMouse);
