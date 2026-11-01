/* ===========================================================================
   TURNING THE MAP: THE COMPASS (V4.2)
   A turned map needs one way back to "north is up". The button appears when the map is turned, its needle always points at north,
   and a press turns the map back (the short way round). It is hidden at north-up so it takes no room when it is not needed.
   ========================================================================== */
const compassBtn = document.getElementById('compassBtn'), compassNeedle = document.getElementById('compassNeedle');
function syncCompass(){
  if(!compassBtn) return;
  const r = map.getRotation(), show = !!(map.options.irnTurn && mapTurnPref && Math.abs(r) >= 0.5);
  compassBtn.hidden = !show;
  compassNeedle.setAttribute('transform', 'rotate(' + r.toFixed(1) + ' 12 12)');
}
if(compassBtn){
  map.on('rotate', syncCompass);
  compassBtn.addEventListener('click', () => map.rotateTo(0, 280));
}
