/* ==========================================================================
   V4.1 — dismissing the loading screen
   The screen itself is plain HTML and CSS at the top of the page (#bootSplash), so it paints before any of this runs. Here it is told
   when to go: when the first map is ready, but never sooner than 0.7 s after the page began (so it does not flash), and never later
   than 6 s (a hidden tab, a tile service that does not answer). The CSS removes it by itself after 12 s as a last resort.
   ========================================================================== */
(function(){
  const el = document.getElementById('bootSplash');
  if(!el) return;
  const t0 = (window.performance && performance.timing && performance.timing.navigationStart) || Date.now();
  let gone = false;
  function dismiss(){
    if(gone) return; gone = true;
    const wait = Math.max(0, 700 - (Date.now() - t0));
    setTimeout(function(){
      el.classList.add('done');
      setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 800);   // after its fade, out of the way for good
    }, wait);
  }
  function whenMapReady(){
    setTimeout(dismiss, 6000);                                // the ceiling
    // the vector map's own "once('load')" waits for it to finish drawing; the raster map's fires when its tiles are in
    if(typeof curBase !== 'undefined' && curBase && typeof curBase.once === 'function') curBase.once('load', dismiss);
    else dismiss();
  }
  if(document.readyState === 'complete') whenMapReady(); else window.addEventListener('load', whenMapReady);
})();
