/* ===========================================================================
   THE LINE YOU ARE LOOKING AT GLOWS (V4.5)
   Opening a line (a tap on it, a row of the legend, a search result) showed its panel and its list of stations, and left the map as it
   was: on a map of ninety lines it was not obvious WHICH one the panel was about. While a line's panel is open, that line gets a soft
   halo in its own colour and every other line steps back to a third of its strength; closing the panel puts everything back.

   The halo is drawn UNDER everything (bringToBack), so the line, its stations and their names stay crisp on top of it, and it widens
   and narrows with the zoom like the lines do. Nothing is clickable in it.
   =========================================================================== */
const lineGlowLayer = L.layerGroup();
let lineGlowRef = null;                    // the ref of the glowing line, or null
const LINE_GLOW = [[30, .10], [18, .20], [10, .30]];      // [width in px at city scale, opacity], widest first
const LINE_GLOW_DIM = 0.3;                 // what is left of every other line
function lineGlowWidths(){
  const s = Math.max(.6, lineScale(map.getZoom()));
  lineGlowLayer.eachLayer(pl => pl.setStyle({ weight: pl._glowBase * s }));
}
function setLineGlow(line){
  const had = lineGlowRef !== null;
  lineGlowLayer.clearLayers(); lineGlowRef = null;
  if(had){                                 // put every line back as it was: cores to their own strength, outlines by the style in force
    linePolys.forEach(o => { if(!o.glow) o.pl.setStyle({ opacity: o.baseOp }); });
    applyLineStyle();
  }
  if(!line || !Array.isArray(line.paths) || !line.paths.length){
    if(map.hasLayer(lineGlowLayer)) map.removeLayer(lineGlowLayer);
    if(typeof boatFocus === 'function') boatFocus(null);
    return;
  }
  lineGlowRef = line.ref;
  linePolys.forEach(o => { if(o.ref !== line.ref) o.pl.setStyle({ opacity: (o.pl.options.opacity == null ? 1 : o.pl.options.opacity) * LINE_GLOW_DIM }); });
  if(!map.hasLayer(lineGlowLayer)) lineGlowLayer.addTo(map);
  if(typeof boatFocus === 'function') boatFocus(line.ref);          // in the Boats tab the other boats step back too (14b-boats.js)
  const paths = (typeof boatPathFor === 'function' && boatPathFor(line)) || line.paths;     // there, a line is drawn on its own lane
  const glowColour = (typeof boatColourFor === 'function' && boatColourFor(line)) || line.color;
  paths.forEach(path => LINE_GLOW.forEach(g => {
    const pl = L.polyline(path, { renderer: lineRenderer, color: glowColour, weight: g[0], opacity: g[1], lineCap: 'round', lineJoin: 'round', interactive: false });
    pl._glowBase = g[0];
    pl.addTo(lineGlowLayer);
    if(pl.bringToBack) pl.bringToBack();
  }));
  lineGlowWidths();
}
map.on('zoomend', () => { if(lineGlowRef !== null) lineGlowWidths(); });
/* the glow belongs to the open panel: whoever closes it (its own X, another panel, a change of tab, the back button), the glow goes */
(function(){
  const panel = document.getElementById('linp');
  if(panel && typeof MutationObserver !== 'undefined')
    new MutationObserver(() => { if(!panel.classList.contains('show') && lineGlowRef !== null) setLineGlow(null); }).observe(panel, { attributes: true, attributeFilter: ['class'] });
})();
