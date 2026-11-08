/* ===========================================================================
   THE MAP'S STATIONS BY KEYBOARD AND SCREEN READER (V4.3)
   Stations are circles painted on a canvas: nothing a keyboard or a screen reader can land on. People reached a station only
   through search, the planner or a line's list. Now, with the map focused:
     N / P    step to the next / previous station in view, nearest the centre first. A ring and the station's name are drawn on
              the map, and it is announced ("Kadıköy, interchange. Lines M4, M4A. 2 of 14 nearest the centre. Press Enter to open.")
     Enter    open the chosen station (the same panel a tap opens)
     L        a list of the stations in view, as buttons (also reachable as "Browse the stations in view" with Tab, or by a screen
              reader's own navigation, without knowing any key)
     Escape   clear the choice
   "In view" means what is drawn: a plain stop only from zoom 12 (interchanges always), only on lines that are switched on, only
   inside the screen, nothing while a route is being focused. On the Vision tab it is the planned stops, and Enter opens their line.
   ========================================================================== */
/* real function declarations (the structure test, like the history module, needs one to see a definition); they hand over to the
   handlers made below, which need the module's own state. `var`: the history module (21) names closeFinder before this file runs. */
var kmOpenFinder = null;
var kmCloseFinder = null;
function openFinder(){ if(kmOpenFinder) kmOpenFinder(); }
function closeFinder(){ if(kmCloseFinder) kmCloseFinder(); }
(function(){
  const live = document.getElementById('mapLive'), cont = map.getContainer();
  const say = msg => { if(live){ live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); } };
  let ring = null, halo = null, snap = null, idx = -1;

  /* the stations that are drawn and on the screen, nearest the middle of it first */
  function eligible(){
    const out = [];
    if(typeof focusRefs !== 'undefined' && focusRefs) return out;
    const s = map.getSize(), c = s.divideBy(2), z = map.getZoom();
    const add = (r, lines, ix) => {
      const p = map.latLngToContainerPoint([r.lat, r.lng]);
      if(p.x < 8 || p.y < 8 || p.x > s.x - 8 || p.y > s.y - 8) return;
      out.push({ r, lines, ix, d: p.distanceTo(c) });
    };
    const on = ref => !!(lineLayers[ref] && lineLayers[ref].on);
    if(currentTab === 'active'){
      stationList.forEach(r => { const lines = [...r.lines]; if(!lines.some(on)) return; if(lines.length < 2 && z < STOP_MIN_ZOOM) return; add(r, lines, lines.length > 1); });
    } else if(currentTab === 'vision'){
      plannedStationList.forEach(r => { if(on(r.ref)) add(r, [r.ref], false); });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  const viewKey = () => [currentTab, map.getZoom().toFixed(2), map.getCenter().lat.toFixed(4), map.getCenter().lng.toFixed(4), Math.round(map.getRotation ? map.getRotation() : 0)].join('|');

  function unmark(){                 // take the ring off the map (the choice itself is kept)
    if(ring){ map.removeLayer(ring); ring = null; }
    if(halo){ map.removeLayer(halo); halo = null; }
  }
  function clear(){ unmark(); idx = -1; }   // and forget which station was chosen
  function mark(e){
    unmark();
    const ll = [e.r.lat, e.r.lng], ink = getComputedStyle(document.body).getPropertyValue('--accent-ink').trim() || '#34D399';
    // a pale ring under a coloured one, so it reads on a light map, a dark map and satellite alike
    halo = L.circleMarker(ll, { renderer: stationRenderer, radius: 13, color: '#FFFFFF', weight: 7, opacity: .9, fill: false, interactive: false }).addTo(map);
    ring = L.circleMarker(ll, { renderer: stationRenderer, radius: 13, color: ink, weight: 3.4, fill: false, interactive: false }).addTo(map);
    ring.bindTooltip(svgEsc(e.r.name), { permanent: true, direction: 'top', offset: [0, -12], className: 'lt', interactive: false }).openTooltip();
  }
  const describe = (e, n, total) => t('stnPick').replace('{name}', e.r.name).replace('{ix}', e.ix ? t('stnIx') : '').replace('{lines}', e.lines.join(', ')).replace('{n}', n).replace('{total}', total);

  function step(dir){
    const key = viewKey();
    if(!snap || snap.key !== key){ snap = { key, list: eligible() }; idx = -1; }
    const list = snap.list;
    if(!list.length){ clear(); say(t('finderNone')); return; }
    idx = idx < 0 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
    mark(list[idx]); say(describe(list[idx], idx + 1, list.length));
  }
  function openEntry(e){
    if(currentTab === 'vision' && lineByRef[e.r.ref]) openLine(lineByRef[e.r.ref]); else openStation(e.r);
    say(t('stnOpened').replace('{name}', e.r.name));
  }

  cont.addEventListener('keydown', ev => {
    if(ev.target !== cont || ev.ctrlKey || ev.altKey || ev.metaKey) return;          // only when the map itself has focus
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if(k === 'n' || k === 'p'){ ev.preventDefault(); ev.stopPropagation(); step(k === 'n' ? 1 : -1); }
    else if(k === 'Enter' && snap && idx >= 0 && snap.list[idx]){ ev.preventDefault(); ev.stopPropagation(); openEntry(snap.list[idx]); }
    else if(k === 'l'){ ev.preventDefault(); ev.stopPropagation(); openFinder(); }
    else if(k === 'Escape' && ring){ ev.preventDefault(); ev.stopPropagation(); clear(); say(t('stnCleared')); }
  });

  /* ---- the list ---- */
  const panel = document.getElementById('stnFinder'), overlay = document.getElementById('finderOverlay'), listEl = document.getElementById('finderList'), noneEl = document.getElementById('finderNone');
  kmOpenFinder = function(){
    const list = eligible().slice(0, 40);
    snap = { key: viewKey(), list: eligible() };
    listEl.innerHTML = list.map((e, i) => '<li><button type="button" data-i="' + i + '"><span>' + svgEsc(e.r.name) + (e.ix ? ' ◆' : '') + '</span><span class="fl-lines">' + svgEsc(e.lines.join(' · ')) + '</span></button></li>').join('');
    noneEl.hidden = list.length > 0;
    panel.classList.add('open'); overlay.classList.add('on');
    panel._entries = list;
  };
  kmCloseFinder = function(){ panel.classList.remove('open'); overlay.classList.remove('on'); };
  listEl.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-i]'); if(!b) return;
    const e = panel._entries[+b.dataset.i]; if(!e) return;
    closeFinder(); idx = snap.list.findIndex(x => x.r === e.r); mark(e); openEntry(e);
  });
  document.getElementById('finderX').addEventListener('click', closeFinder);
  overlay.addEventListener('click', closeFinder);
  document.getElementById('stnFinderBtn').addEventListener('click', openFinder);
  map.on('moveend zoomend', () => { if(snap && snap.key !== viewKey()) snap = null; });
})();
