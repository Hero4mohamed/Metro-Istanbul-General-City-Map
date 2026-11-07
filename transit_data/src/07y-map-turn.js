/* ===========================================================================
   TURNING THE MAP (V4.2) — the part that teaches Leaflet to show its map at an angle.
   Leaflet has no notion of a turned map. Everything it draws is placed in "layer space" (pixels from the map's origin), and the
   layer space is shifted as a whole to pan. Turning is added without touching that idea:

     • A "rotor" element is put between Leaflet's map pane and all of its panes (tiles, lines, markers...). The pane is still
       panned in screen pixels, exactly as Leaflet does it, so dragging, inertia and animated panning work unchanged; only the rotor
       is turned (by CSS, about the middle of the screen), so turning costs the browser one transform and nothing is redrawn.
       A point at layer position L is on the screen at   pos + C + R(a)(L - C)   with C the screen centre, pos the pane's pan
       and a the angle. The two conversions Leaflet uses between screen and layer pixels are rewritten as that formula and its
       inverse; the rest of the places that care (the pixel origin, the size of what is visible, zoom-about-a-point) follow.
     • Markers, tooltips and popups are drawn upright on a turned map: each is turned back about its own anchor by the opposite
       angle, through one CSS variable on the rotor, so a change of angle is a single write whatever the number of markers.
     • The line and station canvases cover a square that reaches every corner of the screen at ANY angle, so turning never needs a
       redraw. The raster tile layers load the tiles of the turned screen's bounding box. The vector base map (MapLibre) does its
       own turning, natively, so its names stay upright and sharp: it is told the angle and its canvas is turned back to the screen.

   While the map is NOT turned (angle 0) every method below hands over to Leaflet's own, so north-up is exactly the stock map.
   Written for Leaflet 1.9.4 and MapLibre GL 4; it replaces nothing it does not have to, and keeps the originals to call.
   ========================================================================== */
const MAP_TURN = (function(){
  const RAD = Math.PI / 180;
  /* a point turned about the origin by `a` radians, clockwise as it looks on a screen (y points down) */
  const turn = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return L.point(p.x * c - p.y * s, p.x * s + p.y * c); };
  /* the size of the smallest upright box that holds the screen when it is turned by `a` */
  const boxOf = (size, a) => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return L.point(size.x * c + size.y * s, size.x * s + size.y * c); };
  const wrap = a => { a = a % (2 * Math.PI); if(a > Math.PI) a -= 2 * Math.PI; if(a <= -Math.PI) a += 2 * Math.PI; return a; };

  /* ---------- the map ---------- */
  const mapOrig = L.extend({}, L.Map.prototype);
  L.Map.mergeOptions({ irnTurn:false });          // may this map be turned? (decided when it is made: the panes are built for it)
  L.Map.include({
    _irnTheta: 0,
    getRotation: function(){ return (this._irnTheta || 0) / RAD; },
    /* degrees, clockwise; the middle of the screen stays where it is */
    setRotation: function(deg){
      if(!this.options.irnTurn) return this;
      let a = wrap(deg * RAD); if(Math.abs(a) < 1e-5) a = 0;
      if(a === this._irnTheta) return this;
      // turning about the screen centre also turns the pane's pan, or the centre would drift off its place
      const pos = this._getMapPanePos(), was = this._irnTheta;
      this._irnTheta = a;
      if(this._loaded && (pos.x || pos.y)) L.DomUtil.setPosition(this._mapPane, turn(pos, a - was));
      this._irnSyncRotor();
      this.fire('rotate', { rotation: this.getRotation() });
      return this;
    },
    _initPanes: function(){
      mapOrig._initPanes.call(this);
      if(!this.options.irnTurn) return;
      const rotor = this._irnRotor = L.DomUtil.create('div', 'leaflet-pane irn-rotor', this._mapPane);
      for(const name in this._panes) if(name !== 'mapPane' && this._panes[name].parentNode === this._mapPane) rotor.appendChild(this._panes[name]);
      this._irnSyncRotor();
      this.on('resize', this._irnSyncRotor, this);
    },
    createPane: function(name, container){            // a pane made later (the names pane, the stations pane) is turned with the rest
      if(this._irnRotor && !container && name !== 'mapPane') container = this._irnRotor;
      return mapOrig.createPane.call(this, name, container);
    },
    _irnSyncRotor: function(){
      const rotor = this._irnRotor; if(!rotor) return;
      const c = this.getSize().divideBy(2);
      rotor.style.transformOrigin = c.x + 'px ' + c.y + 'px';
      rotor.style[L.DomUtil.TRANSFORM] = this._irnTheta ? 'rotate(' + this._irnTheta + 'rad)' : '';
      rotor.style.setProperty('--irn-up', (-this._irnTheta) + 'rad');     // what a marker turns itself by to stay upright
    },
    containerPointToLayerPoint: function(point){
      const a = this._irnTheta; if(!a) return mapOrig.containerPointToLayerPoint.call(this, point);
      const c = this.getSize().divideBy(2);
      return turn(L.point(point).subtract(this._getMapPanePos()).subtract(c), -a).add(c);
    },
    layerPointToContainerPoint: function(point){
      const a = this._irnTheta; if(!a) return mapOrig.layerPointToContainerPoint.call(this, point);
      const c = this.getSize().divideBy(2);
      return turn(L.point(point).subtract(c), a).add(c).add(this._getMapPanePos());
    },
    /* the layer point at the middle of the screen is c - R(-a)pos; the origin that puts the centre there is: */
    _getNewPixelOrigin: function(center, zoom){
      const a = this._irnTheta; if(!a) return mapOrig._getNewPixelOrigin.call(this, center, zoom);
      return this.project(center, zoom)._subtract(this.getSize()._divideBy(2))._add(turn(this._getMapPanePos(), -a))._round();
    },
    /* how far a place is from the centre, on the SCREEN (panBy takes screen pixels) */
    _getCenterOffset: function(latlng){
      const off = mapOrig._getCenterOffset.call(this, latlng), a = this._irnTheta;
      return a ? turn(off, a) : off;
    },
    /* the box, in projected pixels, that holds everything on the turned screen */
    getPixelBounds: function(center, zoom){
      const a = this._irnTheta; if(!a) return mapOrig.getPixelBounds.call(this, center, zoom);
      const origin = center && zoom !== undefined ? this._getNewPixelOrigin(center, zoom) : this.getPixelOrigin();
      const size = this.getSize(), c = size.divideBy(2), pos = this._getMapPanePos();
      const corners = [[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]].map(p => turn(L.point(p).subtract(pos).subtract(c), -a).add(c).add(origin));
      return L.bounds(corners);
    },
    /* fitting an upright box into a turned screen: measure the box as the turned screen sees it */
    getBoundsZoom: function(bounds, inside, padding){
      const a = this._irnTheta; if(!a) return mapOrig.getBoundsZoom.call(this, bounds, inside, padding);
      bounds = L.latLngBounds(bounds); padding = L.point(padding || [0, 0]);
      let zoom = this.getZoom() || 0;
      const min = this.getMinZoom(), max = this.getMaxZoom(), size = this.getSize().subtract(padding), snap = L.Browser.any3d ? this.options.zoomSnap : 1;
      const corners = [bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast()].map(ll => turn(this.project(ll, zoom), a));
      const bsize = L.bounds(corners).getSize(), sx = size.x / bsize.x, sy = size.y / bsize.y, scale = inside ? Math.max(sx, sy) : Math.min(sx, sy);
      zoom = this.getScaleZoom(scale, zoom);
      if(snap){ zoom = Math.round(zoom / (snap / 100)) * (snap / 100); zoom = inside ? Math.ceil(zoom / snap) * snap : Math.floor(zoom / snap) * snap; }
      return Math.max(min, Math.min(max, zoom));
    },
    _irnTurnedSize: function(){ return boxOf(this.getSize(), this._irnTheta || 0); },
  });

  /* ---------- raster tiles: load what the turned screen needs ---------- */
  const gridOrig = L.extend({}, L.GridLayer.prototype);
  L.GridLayer.include({
    getEvents: function(){
      const ev = gridOrig.getEvents.call(this);
      if(this._map && this._map.options.irnTurn && !this.options.updateWhenIdle){
        this._irnOnTurn = this._irnOnTurn || L.Util.throttle(this._onMoveEnd, this.options.updateInterval || 200, this);
        ev.rotate = this._irnOnTurn;
      }
      return ev;
    },
    _getTiledPixelBounds: function(center){
      const map = this._map; if(!map._irnTheta) return gridOrig._getTiledPixelBounds.call(this, center);
      const mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom(), scale = map.getZoomScale(mapZoom, this._tileZoom);
      const mid = map.project(center, this._tileZoom).floor(), half = map._irnTurnedSize().divideBy(scale * 2);
      return new L.Bounds(mid.subtract(half), mid.add(half));
    },
  });

  /* ---------- the line and station canvases: one square that covers the screen at every angle ---------- */
  const rendererOrig = L.extend({}, L.Renderer.prototype);
  L.Renderer.include({
    _update: function(){
      const map = this._map;
      if(!map.options.irnTurn) return rendererOrig._update.call(this);
      const size = map.getSize(), side = Math.ceil(Math.hypot(size.x, size.y) + 0.4 * Math.max(size.x, size.y)), h = Math.ceil(side / 2);
      const c = map.containerPointToLayerPoint(size.divideBy(2)).round();
      this._bounds = new L.Bounds(L.point(c.x - h, c.y - h), L.point(c.x + h, c.y + h));
      this._center = map.getCenter();
      this._zoom = map.getZoom();
    },
    _updateTransform: function(center, zoom){
      const map = this._map; if(!map.options.irnTurn) return rendererOrig._updateTransform.call(this, center, zoom);
      const scale = map.getZoomScale(zoom, this._zoom), half = this._bounds.getSize().multiplyBy(0.5);
      const offset = half.multiplyBy(-scale).add(map.project(this._center, zoom)).subtract(map._getNewPixelOrigin(center, zoom));
      L.DomUtil.setTransform(this._container, offset, scale);
    },
  });

  /* ---------- markers, tooltips, popups stay upright ---------- */
  const upright = (el, ax, ay) => {
    el.style.transformOrigin = ax + 'px ' + ay + 'px';
    el.style[L.DomUtil.TRANSFORM] += ' rotate(var(--irn-up,0rad))';
  };
  const markerOrig = L.extend({}, L.Marker.prototype);
  L.Marker.include({
    _setPos: function(pos){
      markerOrig._setPos.call(this, pos);
      const icon = this._icon;
      if(icon && this._map && this._map.options.irnTurn) upright(icon, -(parseFloat(icon.style.marginLeft) || 0), -(parseFloat(icon.style.marginTop) || 0));
    },
  });
  const tooltipOrig = L.extend({}, L.Tooltip.prototype);
  L.Tooltip.include({
    _setPosition: function(pos){
      tooltipOrig._setPosition.call(this, pos);
      if(this._map && this._map.options.irnTurn){
        const at = L.DomUtil.getPosition(this._container);       // where its corner went; the place it points at is `pos`
        upright(this._container, pos.x - at.x, pos.y - at.y);
      }
    },
  });
  const divUpdate = L.DivOverlay.prototype._updatePosition, popupZoom = L.Popup.prototype._animateZoom, popupPan = L.Popup.prototype._adjustPan;
  const uprightPopup = p => { if(p._map && p._map.options.irnTurn && p._container && p._zoomAnimated) upright(p._container, -p._container.offsetLeft, -p._container.offsetTop); };
  L.Popup.include({
    _updatePosition: function(){ divUpdate.call(this); uprightPopup(this); },
    _animateZoom: function(e){ popupZoom.call(this, e); uprightPopup(this); },
    _adjustPan: function(){ if(this._map && this._map._irnTheta) return; popupPan.call(this); },   // it reckons in an upright screen
  });

  /* ---------- the MapLibre base map and its names ---------- */
  if(L.MaplibreGL){
    const glOrig = L.extend({}, L.MaplibreGL.prototype);
    const bearingOf = map => (map && map._irnTheta) ? -map._irnTheta / RAD : 0;      // MapLibre turns the other way round
    L.MaplibreGL.include({
      getEvents: function(){ const ev = glOrig.getEvents.call(this); ev.rotate = this._throttledUpdate; return ev; },
      _transformGL: function(gl){ glOrig._transformGL.call(this, gl); gl.transform.bearing = bearingOf(this._map); },
      /* its container is a screen-shaped box centred on the middle of the screen, turned back by the angle of the map, so on the
         screen it is upright and what MapLibre draws into it (already turned, natively) lines up with the rest of the map */
      _irnPlace: function(topLeft, scale){
        const c = this._container;
        L.DomUtil.addClass(c, 'leaflet-zoom-animated');
        c.style.transformOrigin = '50% 50%';
        c.style[L.DomUtil.TRANSFORM] = 'translate3d(' + Math.round(topLeft.x) + 'px,' + Math.round(topLeft.y) + 'px,0) rotate(' + (-this._map._irnTheta) + 'rad) scale(' + (scale || 1) + ')';
        c._leaflet_pos = topLeft;
      },
      _update: function(e){
        const map = this._map; if(!map) return;
        if(!map._irnTheta){
          if(this._container && this._container._irnTurned){ this._container._irnTurned = false; L.DomUtil.removeClass(this._container, 'leaflet-zoom-animated'); this._container.style.transformOrigin = ''; }
          return glOrig._update.call(this, e);
        }
        this._offset = map.containerPointToLayerPoint([0, 0]);
        if(this._zooming) return;
        const size = this.getSize(), gl = this._glMap, container = this._container;
        container._irnTurned = true;
        this._irnPlace(map.containerPointToLayerPoint(map.getSize().divideBy(2)).subtract(size.divideBy(2)), 1);
        this._transformGL(gl);
        if(gl.transform.width !== size.x || gl.transform.height !== size.y){
          container.style.width = size.x + 'px'; container.style.height = size.y + 'px';
          if(gl._resize !== null && gl._resize !== undefined) gl._resize(); else gl.resize();
        } else if(gl._update !== null && gl._update !== undefined) gl._update(); else gl.update();
      },
      _pinchZoom: function(e){
        const map = this._map, c = this._container;
        if(!map._irnTheta){
          // the twist came back to exactly north-up while the fingers are still down: the canvas is upright again
          if(c && c._irnTurned){ c._irnTurned = false; L.DomUtil.removeClass(c, 'leaflet-zoom-animated'); c.style.transformOrigin = ''; L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0])); }
          return glOrig._pinchZoom.call(this, e);
        }
        this._glMap.jumpTo({ zoom: map.getZoom() - 1, center: map.getCenter(), bearing: bearingOf(map) });
        /* While two fingers are down `_zooming` is set and _update() leaves the canvas alone, which is right for a pinch that only
           zooms. A pinch that also TURNS the map changes the angle every frame, and the canvas has to be turned back by the angle
           the map has NOW: left at the angle it had when the fingers went down (0, for a first twist) the base map and its names
           turned twice as far as the lines, and snapped into line only when the fingers lifted (found on a phone, V4.3). */
        c._irnTurned = true;
        this._irnPlace(map.containerPointToLayerPoint(map.getSize().divideBy(2)).subtract(this.getSize().divideBy(2)), 1);
      },
      _animateZoom: function(e){
        const map = this._map; if(!map._irnTheta) return glOrig._animateZoom.call(this, e);
        // the picture the container holds is centred on where the map is centred now; carry that point to where it will be
        const there = map._latLngToNewLayerPoint(map.getCenter(), e.zoom, e.center);
        this._container._irnTurned = true;
        this._irnPlace(there.subtract(this.getSize().divideBy(2)), map.getZoomScale(e.zoom));
      },
      _zoomEnd: function(){
        const map = this._map; if(!map || !map._irnTheta) return glOrig._zoomEnd.call(this);
        this._zooming = false; this._update();
      },
      _transitionEnd: function(e){
        if(!this._map || !this._map._irnTheta) return glOrig._transitionEnd.call(this, e);
        L.Util.requestAnimFrame(function(){
          const map = this._map; if(!map || !this._glMap) return;
          this._glMap.once('moveend', L.Util.bind(this._zoomEnd, this));
          this._glMap.jumpTo({ center: map.getCenter(), zoom: map.getZoom() - 1, bearing: bearingOf(map) });
        }, this);
      },
    });
  }
  return { RAD, turn, boxOf, wrap };
})();
