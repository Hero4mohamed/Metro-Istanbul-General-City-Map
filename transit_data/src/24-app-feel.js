/* ===========================================================================
   AN APP, NOT A WEB PAGE (V4.3)
   The CSS (touch-action, selection, overscroll) and the viewport do most of it. What they cannot do:
   - iOS Safari ignores user-scalable=no and touch-action for its own pinch, and reports it as "gesture" events instead. A pinch that
     starts anywhere but on the map is cancelled, so the tabs and panels never zoom and distort the page; the map keeps its own.
   - A double tap on a control is a double tap on the app, not a request to zoom (touch-action covers it where it is supported).
   Desktop is left alone: Ctrl + wheel / Ctrl + plus still zoom the page there, which is what a person with low vision expects.
   ========================================================================== */
(function(){
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, e => {
      const inMap = e.target && e.target.closest && e.target.closest('#map');
      if(!inMap) e.preventDefault();
    }, { passive: false });
  });
  // a long press on a picture or a link is not a request for the browser's own menu
  document.addEventListener('contextmenu', e => {
    const t = e.target;
    if(t && t.closest && !t.closest('input, textarea, #map')) { if(window.matchMedia && matchMedia('(pointer: coarse)').matches) e.preventDefault(); }
  });
})();
