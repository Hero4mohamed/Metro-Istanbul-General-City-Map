/* A small stand-in for the parts of Leaflet 1.9.4 that the map-turning code (07y-map-turn.js, 07z-map-turn-input.js) wraps.
 *
 * Leaflet itself is a browser library the test run does not have, so this file re-states, in a few dozen lines each, the stock
 * methods the turning code replaces or calls through to — with the same formulas Leaflet 1.9.4 uses (the layer/container point
 * conversions are a plain translation by the pane's position, the pixel origin puts the centre in the middle of the screen, a
 * renderer covers the screen padded on every side, and so on). The turning code is then loaded unchanged from the built page and
 * run against it. What this proves is the geometry of the turned map; that the stock methods are as written here is checked
 * against the real library in the running app (see the notes in the journal), not by this file.
 * Only enumerable prototype properties are used (not `class`), because the code under test copies them with L.extend.
 */
function mini() {
  const L = {};
  function Point(x, y) { this.x = x; this.y = y; }
  const pt = (x, y) => x instanceof Point ? x : Array.isArray(x) ? new Point(x[0], x[1]) : (x && typeof x === 'object' && 'x' in x) ? new Point(x.x, x.y) : new Point(x, y);
  Point.prototype = {
    clone() { return new Point(this.x, this.y); },
    add(p) { p = pt(p); return new Point(this.x + p.x, this.y + p.y); }, _add(p) { p = pt(p); this.x += p.x; this.y += p.y; return this; },
    subtract(p) { p = pt(p); return new Point(this.x - p.x, this.y - p.y); }, _subtract(p) { p = pt(p); this.x -= p.x; this.y -= p.y; return this; },
    multiplyBy(n) { return new Point(this.x * n, this.y * n); }, divideBy(n) { return new Point(this.x / n, this.y / n); }, _divideBy(n) { this.x /= n; this.y /= n; return this; },
    round() { return new Point(Math.round(this.x), Math.round(this.y)); }, _round() { this.x = Math.round(this.x); this.y = Math.round(this.y); return this; },
    floor() { return new Point(Math.floor(this.x), Math.floor(this.y)); },
    distanceTo(p) { p = pt(p); return Math.hypot(this.x - p.x, this.y - p.y); }, equals(p) { p = pt(p); return p.x === this.x && p.y === this.y; },
  };
  function Bounds(a, b) { this.min = null; this.max = null; (Array.isArray(a) && !b ? a : [a, b]).forEach(p => this.extend(p)); }
  Bounds.prototype = {
    extend(p) { p = pt(p); if (!this.min) { this.min = p.clone(); this.max = p.clone(); } else { this.min.x = Math.min(p.x, this.min.x); this.max.x = Math.max(p.x, this.max.x); this.min.y = Math.min(p.y, this.min.y); this.max.y = Math.max(p.y, this.max.y); } return this; },
    getSize() { return this.max.subtract(this.min); }, getCenter() { return this.min.add(this.max).divideBy(2); },
  };
  function LatLngBounds(a) { this.pts = a; const lats = a.map(p => p[0]), lngs = a.map(p => p[1]); this.s = Math.min(...lats); this.n = Math.max(...lats); this.w = Math.min(...lngs); this.e = Math.max(...lngs); }
  LatLngBounds.prototype = { getNorthWest() { return [this.n, this.w]; }, getNorthEast() { return [this.n, this.e]; }, getSouthWest() { return [this.s, this.w]; }, getSouthEast() { return [this.s, this.e]; } };

  L.extend = (d, ...ss) => { for (const s of ss) for (const k in s) d[k] = s[k]; return d; };
  L.point = pt; L.Point = Point; L.Bounds = Bounds; L.bounds = (a, b) => new Bounds(a, b); L.latLngBounds = a => a instanceof LatLngBounds ? a : new LatLngBounds(a);
  L.Browser = { any3d: true };
  L.Util = { throttle: fn => fn, bind: (fn, ...a) => fn.bind(...a), requestAnimFrame: (fn, ctx) => setTimeout(() => fn.call(ctx), 0), cancelAnimFrame: id => clearTimeout(id) };

  // a DOM element stand-in: a style bag, children, class list
  const el = (cls) => { const e = { className: cls || '', children: [], parentNode: null, offsetLeft: 0, offsetTop: 0, style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    appendChild(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = e; e.children.push(c); return c; } }; return e; };
  L.DomUtil = {
    TRANSFORM: 'transform', create(tag, cls, parent) { const e = el(cls); if (parent) parent.appendChild(e); return e; },
    setPosition(e, p) { e._leaflet_pos = p; e.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)'; }, getPosition(e) { return e._leaflet_pos || pt(0, 0); },
    setTransform(e, off, scale) { const p = off || pt(0, 0); e.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)' + (scale ? ' scale(' + scale + ')' : ''); },
    addClass(e, c) { e.className += ' ' + c; }, removeClass(e, c) { e.className = e.className.split(' ').filter(x => x !== c).join(' '); },
  };

  // ---- the map: Leaflet's own formulas ----
  function Map(opts) {
    this.options = Object.assign({ zoomSnap: 1 }, Map._defaults, opts); this._size = pt(400, 800); this._zoom = 12; this._pixelOrigin = pt(0, 0); this._loaded = true;
    this._ev = {}; this._container = { listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); } }; this._initPanes();
  }
  Map._defaults = {};
  Map.mergeOptions = o => Object.assign(Map._defaults, o);
  Map.include = o => Object.assign(Map.prototype, o);
  const hooks = []; Map.addInitHook = (kind, name, H) => hooks.push([name, H]);
  Map.prototype = {
    on(t, f) { (this._ev[t] = this._ev[t] || []).push(f); return this; }, fire(t, d) { (this._ev[t] || []).forEach(f => f.call(this, d)); return this; },
    getSize() { return this._size.clone(); },
    _getMapPanePos() { return L.DomUtil.getPosition(this._mapPane); },
    project(ll, z) { const s = Math.pow(2, z === undefined ? this._zoom : z) * 100; return pt(ll[1] * s, -ll[0] * s); },
    unproject(p, z) { const s = Math.pow(2, z === undefined ? this._zoom : z) * 100; return [-p.y / s, p.x / s]; },
    getPixelOrigin() { return this._pixelOrigin; },
    latLngToLayerPoint(ll) { return this.project(ll)._round()._subtract(this.getPixelOrigin()); },
    layerPointToLatLng(p) { return this.unproject(pt(p).add(this.getPixelOrigin())); },
    containerPointToLayerPoint(p) { return pt(p).subtract(this._getMapPanePos()); },
    layerPointToContainerPoint(p) { return pt(p).add(this._getMapPanePos()); },
    latLngToContainerPoint(ll) { return this.layerPointToContainerPoint(this.latLngToLayerPoint(ll)); },
    containerPointToLatLng(p) { return this.layerPointToLatLng(this.containerPointToLayerPoint(p)); },
    _getCenterLayerPoint() { return this.containerPointToLayerPoint(this.getSize()._divideBy(2)); },
    getCenter() { return this.layerPointToLatLng(this._getCenterLayerPoint()); },
    _getCenterOffset(ll) { return this.latLngToLayerPoint(ll).subtract(this._getCenterLayerPoint()); },
    _getNewPixelOrigin(center, zoom) { return this.project(center, zoom)._subtract(this.getSize()._divideBy(2))._add(this._getMapPanePos())._round(); },
    _latLngToNewLayerPoint(ll, zoom, center) { return this.project(ll, zoom)._subtract(this._getNewPixelOrigin(center, zoom)); },
    _getTopLeftPoint(center, zoom) { const o = center && zoom !== undefined ? this._getNewPixelOrigin(center, zoom) : this.getPixelOrigin(); return o.subtract(this._getMapPanePos()); },
    getPixelBounds(center, zoom) { const t = this._getTopLeftPoint(center, zoom); return new Bounds(t, t.add(this.getSize())); },
    getZoom() { return this._zoom; }, getMinZoom() { return 2; }, getMaxZoom() { return 20; },
    getZoomScale(to, from) { return Math.pow(2, to - (from === undefined ? this._zoom : from)); },
    getScaleZoom(scale, from) { return (from === undefined ? this._zoom : from) + Math.log(scale) / Math.LN2; },
    getBoundsZoom(bounds, inside, padding) {
      bounds = L.latLngBounds(bounds); padding = pt(padding || [0, 0]);
      let zoom = this.getZoom() || 0; const size = this.getSize().subtract(padding), snap = this.options.zoomSnap;
      const bsize = new Bounds(this.project(bounds.getSouthEast(), zoom), this.project(bounds.getNorthWest(), zoom)).getSize();
      const sx = size.x / bsize.x, sy = size.y / bsize.y, scale = inside ? Math.max(sx, sy) : Math.min(sx, sy);
      zoom = this.getScaleZoom(scale, zoom);
      if (snap) { zoom = Math.round(zoom / (snap / 100)) * (snap / 100); zoom = inside ? Math.ceil(zoom / snap) * snap : Math.floor(zoom / snap) * snap; }
      return Math.max(this.getMinZoom(), Math.min(this.getMaxZoom(), zoom));
    },
    _move(center, zoom) { this._zoom = zoom; this._pixelOrigin = this._getNewPixelOrigin(center); this.moved = (this.moved || 0) + 1; },
    setView(center, zoom) { this._zoom = zoom; L.DomUtil.setPosition(this._mapPane, pt(0, 0)); this._pixelOrigin = this._getNewPixelOrigin(center); },
    panBy(off) { L.DomUtil.setPosition(this._mapPane, this._getMapPanePos().subtract(off)); },
    createPane(name, container) { const e = L.DomUtil.create('div', 'leaflet-pane leaflet-' + name, container || this._mapPane); this._panes[name] = e; return e; },
    _initPanes() { this._panes = {}; this._mapPane = this.createPane('mapPane', { appendChild() {} }); this._mapPane.parentNode = null; L.DomUtil.setPosition(this._mapPane, pt(0, 0));
      this._mapPane.parentNode = null; ['tilePane', 'overlayPane', 'markerPane', 'tooltipPane', 'popupPane'].forEach(n => this.createPane(n)); },
    _stop() {}, _limitZoom(z) { return Math.round(z); }, _moveStart() {}, _animateZoom(c, z) { this.animated = [c, z]; }, _resetView() {}, once(t, f) { const g = d => { f.call(this, d); this._ev[t] = this._ev[t].filter(x => x !== g); }; this.on(t, g); },
    mouseEventToContainerPoint(e) { return pt(e.clientX, e.clientY); },
  };
  L.Map = Map;
  /** a map made as the app makes it (hooks run, panes built) */
  L.makeMap = opts => { const m = new Map(opts); hooks.forEach(([name, H]) => { const h = m[name] = new H(m); if (m.options[name]) h.enable(); }); return m; };

  L.Handler = { extend(proto) { function H(map) { this._map = map; this._on = false; } H.prototype = Object.assign({ enable() { if (this._enabled) return; this._enabled = true; this.addHooks(); }, disable() { this._enabled = false; this.removeHooks(); } }, proto); return H; } };
  L.DomEvent = (() => { const reg = []; const api = { on(t, type, fn, ctx) { type.split(' ').forEach(x => reg.push({ t, type: x, fn: ctx ? fn.bind(ctx) : fn, orig: fn })); return api; },
    off(t, type, fn) { type.split(' ').forEach(x => { const i = reg.findIndex(r => r.t === t && r.type === x && r.orig === fn); if (i >= 0) reg.splice(i, 1); }); return api; },
    preventDefault(e) { e.defaultPrevented = true; }, _reg: reg, fire(t, type, ev) { reg.filter(r => r.t === t && r.type === type).forEach(r => r.fn(ev)); } }; return api; })();

  // ---- layers the code wraps ----
  L.Renderer = function () {}; L.Renderer.prototype = {
    options: { padding: 0.5 }, _update() { const p = this.options.padding, size = this._map.getSize(), min = this._map.containerPointToLayerPoint(size.multiplyBy(-p)).round(); this._bounds = new Bounds(min, min.add(size.multiplyBy(1 + p * 2)).round()); this._center = this._map.getCenter(); this._zoom = this._map.getZoom(); },
    _updateTransform(center, zoom) { const scale = this._map.getZoomScale(zoom, this._zoom), viewHalf = this._map.getSize().multiplyBy(0.5 + this.options.padding), cur = this._map.project(this._center, zoom), off = viewHalf.multiplyBy(-scale).add(cur).subtract(this._map._getNewPixelOrigin(center, zoom)); L.DomUtil.setTransform(this._container, off, scale); },
  };
  L.GridLayer = function () {}; L.GridLayer.prototype = {
    options: { updateInterval: 200, updateWhenIdle: false }, getEvents() { return { viewprereset: 1, moveend: this._onMoveEnd }; }, _onMoveEnd() {},
    _getTiledPixelBounds(center) { const map = this._map, scale = map.getZoomScale(map.getZoom(), this._tileZoom), c = map.project(center, this._tileZoom).floor(), half = map.getSize().divideBy(scale * 2); return new Bounds(c.subtract(half), c.add(half)); },
  };
  L.Marker = function () {}; L.Marker.prototype = { _setPos(pos) { if (this._icon) L.DomUtil.setPosition(this._icon, pos); this._zIndex = pos.y; } };
  L.DivOverlay = function () {}; L.DivOverlay.prototype = { _updatePosition() { const pos = this._map.latLngToLayerPoint(this._latlng); L.DomUtil.setPosition(this._container, pos); this._container.style.left = '-60px'; } };
  L.Tooltip = function () {}; L.Tooltip.prototype = { _setPosition(pos) { const w = this._container.offsetWidth, h = this._container.offsetHeight; L.DomUtil.setPosition(this._container, pos.subtract(pt(w / 2, h)).add(pt(this.options.offset || [0, 0]))); } };
  L.Popup = function () {}; L.Popup.prototype = Object.assign(Object.create(L.DivOverlay.prototype), { _animateZoom(e) { L.DomUtil.setPosition(this._container, this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center)); }, _adjustPan() { this._panned = true; } });
  L.MaplibreGL = function () {}; L.MaplibreGL.prototype = {
    options: { padding: 0.1 }, _throttledUpdate() {}, getEvents() { return { move: this._throttledUpdate }; },
    getSize() { return this._map.getSize().multiplyBy(1 + this.options.padding * 2); },
    _transformGL(gl) { gl.transform.center = this._map.getCenter(); gl.transform.zoom = this._map.getZoom() - 1; },
    _update() { this.stockUpdate = true; }, _pinchZoom() { this.stockPinch = true; }, _animateZoom() { this.stockAnim = true; }, _zoomEnd() { this.stockZoomEnd = true; }, _transitionEnd() { this.stockTransition = true; },
  };
  for (const C of [L.Renderer, L.GridLayer, L.Marker, L.DivOverlay, L.Tooltip, L.Popup, L.MaplibreGL]) C.include = o => Object.assign(C.prototype, o);   // Leaflet's Class.include
  return L;
}
module.exports = { mini };
