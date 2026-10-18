/* ===========================================================================
   BASEMAP — "Atlas": Esri's street map, regraded into our own palette.

   WHY THIS EXISTS
   The keyless raster basemaps are Esri's, and Esri's Streets is a busy picture: building
   footprints dithered across eight tones of beige, orange and red arterials, grey casings on
   every lane. Drawn under a metro network it is the loudest thing on the screen, and its warm
   roads sit in the same hue family as the red and orange lines it is supposed to carry. The
   other Esri canvas (Dark Gray) is calm but has no parks, no water colour and — measured — no
   place names at all unless a second layer is added.

   So the tiles are regraded as they arrive. Not a CSS filter: a filter moves every pixel the
   same way and cannot tell water from road. Each pixel is classified by HUE — measured on real
   tiles, the classes are cleanly separable even though they look alike:

        water ~210°   park ~76°   land ~55°   built-up ~33°   arterial ~18°

   and each class is pulled to a colour chosen for this app, with the building-footprint texture
   compressed rather than removed (it is what makes the map read as a city, not a screensaver).
   Anything that is NOT one of those classes passes through: white road fill, label text, label
   halos and POI icons are neutral or off-band, which is exactly what keeps place names crisp.

   Night is the same idea with one more step: neutral pixels go through a lightness curve, so
   dark label text becomes light and white roads become a step ABOVE the land rather than
   below it — the CSS invert() trick gets the road hierarchy backwards.

   THE PURE BLOCK below has no DOM dependency so the tests can lift it out of the shipped page
   and exercise the arithmetic directly, the same arrangement the timing engine uses.
   =========================================================================== */
/* ==BASEMAP-PURE-START== */
/* The palette, in one place. Colours are [r,g,b]. Each band names the colour it becomes, the
   source lightness it replaces (`ref`, measured: land 0.85, water 0.86, park 0.82, built-up
   0.82, arterial 0.76) and how much of the source's own texture survives (`k`, 0 = flat). */
const ATLAS_PAL = {
  day: {
    ground: [243, 240, 233],                  // the colour the map shows through a tile seam
    /* `k` is how much of the source's texture survives. It started at 0.26-0.38 and the dense
       districts came out as a hatch: Esri paints building footprints as eight tones of beige, and
       at a quarter strength that is still a screenful of stripes. Land and built-up are now
       nearly flat (0.10) — enough tone variation to read as a city, not enough to compete with
       the lines drawn over it. Water and parks keep more, because ship tracks and path networks
       are real information. */
    bands: {
      water: { c: [170, 211, 236], ref: .86, k: .30 },
      park:  { c: [205, 229, 192], ref: .82, k: .18 },
      land:  { c: [243, 240, 233], ref: .85, k: .10 },
      urban: { c: [238, 233, 224], ref: .82, k: .10 },
      road:  { c: [251, 228, 184], ref: .76, k: .38 },
    },
    /* The grey casing around every street is NEUTRAL — saturation near zero — so the hue classes
       never see it, and it survived the first version untouched as a hatch of grey hairlines. A
       gentle lift on the light greys (0.7-0.95) makes streets read as white on ivory with a
       whisper of edge. Text (below 0.6) is deliberately left exactly alone: its anti-aliased
       edges live at 0.5-0.8, and lightening them thins every label. */
    curve: [[0, 0], [.6, .6], [.72, .79], [.82, .91], [.92, .97], [1, 1]],
    quietInk: .55,
    tintS: 0,                                 // no tint: by day the source's own hue is left alone
    /* What the ground under a forest, a park, a campus and an airport becomes (see decodeLanduse). Painted
       as a SHIFT from the land colour, only on pixels as bright as the ground: by day streets are WHITE, a
       hair brighter than the ground (`bright` 14 = just under the gap to pure white), and text is far darker. */
    landuse: { forest: [176, 207, 158], park: [201, 227, 183], campus: [233, 227, 221], airport: [224, 228, 236], bright: 14, dark: 200 },
  },
  /* Night is GRAPHITE: neutral charcoal ground, near-black water, a whisper of green for parks, and
     main roads in a quiet slate grey. The first night palette was a slate blue with teal and brown
     roads; people found the whole screen too much, and the dark grey-and-black look that came
     before it was the one they wanted back. Mustard main roads, then light-grey ones, were tried
     and both made the roads the loudest thing on the map: they sit under the metro lines and must
     not compete with them. So this follows how Google's dark map treats a road — only a step above
     the ground, a step more for the main ones — and leaves the colour to water (a deep blue) and
     parks (a dark green), which is what makes a city read as a place and not a street diagram. */
  night: {
    ground: [27, 31, 42],
    bands: {
      water: { c: [11, 17, 33],   ref: .86, k: .30 },
      park:  { c: [31, 44, 40],   ref: .82, k: .18 },
      land:  { c: [27, 31, 42],   ref: .85, k: .10 },
      urban: { c: [32, 36, 48],   ref: .82, k: .10 },
      road:  { c: [92, 98, 112],  ref: .76, k: 0 },      // the same blue-grey as every other road: see roadGrey
    },
    /* ONE road colour. Every road is this light grey, whatever Esri drew it as — a white street, an
       orange arterial, a darker orange motorway. A road that sits under a label is the exception: a
       label's halo and a road are both pure white in the tile, so the pixels within a few of a
       letter go dark (roadHalo) and the label stays legible. */
    roadGrey: [92, 98, 112], roadHalo: [21, 25, 35],
    tintH: 225, tintS: .12,                   // greys lean the same cool blue as the ground, so a label's halo is not a grey box on it
    // lightness in -> lightness out. Dark label text (low l) -> light; the halos and casings
    // (high l) -> dark; white road fill (1.0) -> one quiet step above the land. Google's dark map is
    // the model for the hierarchy: streets are only a little lighter than the ground, main roads a
    // little lighter again, and it is the labels, water and parks that do the talking.
    curve: [[0, .82], [.2, .72], [.35, .55], [.5, .42], [.62, .30], [.78, .15], [.9, .14], [.96, .17], [1, .22]],
    quietInk: .5, inkGain: .72,
    /* By night streets and text are far BRIGHTER than the ground (`bright` 68 = the gap to the road colour)
       and only the halo round a label is darker (`dark` 33 = the gap to black). */
    landuse: { forest: [21, 54, 50], park: [30, 72, 62], campus: [40, 46, 66], airport: [52, 60, 84], bright: 68, dark: 33 },
  },
};

function _smooth(a, b, x) { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); }
function _band(h, c, w) { let d = Math.abs(h - c); if (d > 180) d = 360 - d; return d >= w ? 0 : 1 - d / w; }

function _curveAt(pts, l) {
  for (let i = 1; i < pts.length; i++) {
    if (l <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      return a[1] + (b[1] - a[1]) * (l - a[0]) / (b[0] - a[0]);
    }
  }
  return pts[pts.length - 1][1];
}
/* A 256-entry table, indexed by source lightness: the lightness it should have afterwards, and
   (when the palette has a tint) the grey of that lightness in the palette's own hue. */
function _neutralTable(pal) {
  const lo = new Array(256), tint = pal.tintS > 0 ? new Array(256) : null, h = pal.tintH / 60;
  for (let v = 0; v < 256; v++) {
    const t = _curveAt(pal.curve, v / 255);
    lo[v] = t * 255;
    if (tint) {
      const C = (1 - Math.abs(2 * t - 1)) * pal.tintS, X = C * (1 - Math.abs(h % 2 - 1)), m = t - C / 2;
      const rgb = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][Math.floor(h) % 6];
      tint[v] = [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
    }
  }
  return { lo: lo, tint: tint };
}
function _clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
/* A separable 1-D morphology pass over a side x side mask: dilate (any set pixel in the window) or erode
   (all of them). Off the tile edge counts as SET when eroding, so a sign cut in half by a tile boundary is
   not eaten away at the cut. */
function _morph(a, side, r, erode) {
  const n = side * side, b = new Uint8Array(n), c = new Uint8Array(n);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let v = erode ? 1 : 0;
    for (let q = x - r; q <= x + r; q++) {
      const s = (q < 0 || q >= side) ? (erode ? 1 : 0) : a[y * side + q];
      if (erode ? !s : s) { v = erode ? 0 : 1; break; }
    }
    b[y * side + x] = v;
  }
  for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
    let v = erode ? 1 : 0;
    for (let q = y - r; q <= y + r; q++) {
      const s = (q < 0 || q >= side) ? (erode ? 1 : 0) : b[q * side + x];
      if (erode ? !s : s) { v = erode ? 0 : 1; break; }
    }
    c[y * side + x] = v;
  }
  return c;
}
/* Signs, badges and symbols: the road shields, the transit pictograms, the POI icons. Each is a SOLID block of
   saturated colour a few pixels across — which is what separates it from a letter, whose strokes are one or
   two pixels wide and from a road, which is a pale fill. So: mark every saturated, not-light pixel, keep only
   what survives an erosion by 2 (a block at least 5px thick), grow it back, then grow it a little further to
   take in the white letters inside the sign. null when the tile has none (most tiles). */
function _signBlobs(d, side) {
  const n = side * side, a = new Uint8Array(n);
  let any = 0;
  for (let p = 0, k = 0; p < n; p++, k += 4) {
    const R = d[k], G = d[k + 1], B = d[k + 2], M = Math.max(R, G, B), m = Math.min(R, G, B), dd = M - m, sum = M + m;
    if (sum < 331 && dd > 0) {                                        // lightness under .65
      const den = 1 - Math.abs(sum / 255 - 1);
      if (den > 0 && dd / 255 / den > .28) { a[p] = 1; any = 1; }     // and saturated
    }
  }
  if (!any) return null;
  const opened = _morph(_morph(a, side, 2, true), side, 2, false);
  let has = 0; for (let p = 0; p < n; p++) if (opened[p]) { has = 1; break; }
  return has ? _morph(opened, side, 3, false) : null;
}
/* 1 where a pixel is within `r` pixels of dark ink (text, an icon, a shield): any pixel darker than
   mid-grey in the ORIGINAL tile. Esri's roads and its label halos are the same pure white, so
   distance from ink is the only thing that tells them apart. A separable max filter. */
function _nearInk(d, side, r) {
  const n = side * side, a = new Uint8Array(n), b = new Uint8Array(n);
  for (let p = 0, k = 0; p < n; p++, k += 4)
    a[p] = (Math.max(d[k], d[k + 1], d[k + 2]) + Math.min(d[k], d[k + 1], d[k + 2])) < 255 ? 1 : 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let v = 0;
    for (let q = Math.max(0, x - r), e = Math.min(side - 1, x + r); q <= e; q++) if (a[y * side + q]) { v = 1; break; }
    b[y * side + x] = v;
  }
  for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
    let v = 0;
    for (let q = Math.max(0, y - r), e = Math.min(side - 1, y + r); q <= e; q++) if (b[q * side + x]) { v = 1; break; }
    a[y * side + x] = v;
  }
  return a;
}
/* Water hue: blue, with enough colour to be blue rather than grey (hue 195-225, measured on the
   sea at z12-z14: base water is ~210, the ferry ink 200-210). */
function _waterHued(R, G, B) {
  const M = Math.max(R, G, B), m = Math.min(R, G, B), dd = M - m;
  if (dd < 30 || M !== B) return false;
  const h = 60 * ((R - G) / dd + 4);
  return h >= 195 && h <= 225;
}
const FERRY_RING = [[6, 0], [-6, 0], [0, 6], [0, -6], [6, 6], [-6, 6], [6, -6], [-6, -6]];

/* Regrade an RGBA buffer IN PLACE. Alpha is never touched.

   Every pixel first goes through the palette's lightness curve as a SHIFT of its own colour, so
   hue survives: an icon keeps its colour, and by day label text is not altered at all (the day
   curve is the identity below 0.6). Only at night is a pixel that is genuinely grey also pulled
   onto the palette's slate, by how grey it is, so greys read as part of the ground. Pixels that
   land in a hue class are then blended to that class's colour. */
function makeBasemapGrade(pal) {
  const B = pal.bands, W = B.water, Pk = B.park, La = B.land, Ur = B.urban, Ro = B.road;
  const OW = pal.roadGrey || null, OH = pal.roadHalo || null;
  const QI = pal.quietInk || 0, IG = pal.inkGain || 1;     // how much of a coloured label's strength survives; how far zoomed-out text is dimmed
  const NT = pal.curve ? _neutralTable(pal) : null;
  const LU = pal.landuse || null;                          // the colours land use is painted in; null = this palette ignores it
  const GM = (La.c[0] + La.c[1] + La.c[2]) / 3;            // how bright the ground is: land use is only ever painted on ground
  /* `lu` is the tile's land-use mask: null where nothing is known about the place (outside the city the
     file describes, or not loaded yet), otherwise { a } with `a` an RGBA buffer (colour = the class's
     ground colour, alpha = coverage) or null when the tile is inside the city but holds none. */
  return function grade(d, z, lu) {
    /* Scale. Above about z11 a green pixel is a park and wants its own colour. Below z9 it is a
       land-cover tint covering whole regions — Esri shades Anatolia green and Thrace beige at
       country scale — and giving that a distinct colour drew hard-edged blocks along tile
       boundaries (dark green Turkey beside slate Greece, at night). So the park colour fades
       into the land colour as the map zooms out. `z` is optional: omitted means full strength. */
    const covered = !!(LU && lu);
    const luA = covered ? lu.a : null;
    const pk = covered ? 0 : (z === undefined || z === null) ? 1 : _smooth(8, 11, z);   // covered: the polygons are the parks, Esri's tint would double them
    /* City-overview zoom (z12 and below) is drawn differently. Measured on real tiles: the
       built-up area is a SALMON fill (hue 10-30, saturation 0.8-1.0, lightness 0.75-0.90 — e.g.
       254,182,156) and motorways are a darker orange (236,152,120), where at z13+ the same hues
       are the roads themselves. Treating them all as "arterial" turned the whole city amber. So
       down here lightness decides: pale is built-up ground, dark is road. Above z12 nothing
       changes, so the street-level look is exactly what it was. */
    const low = (z !== undefined && z !== null && z <= 12);
    const pc0 = La.c[0] + (Pk.c[0] - La.c[0]) * pk, pc1 = La.c[1] + (Pk.c[1] - La.c[1]) * pk,
          pc2 = La.c[2] + (Pk.c[2] - La.c[2]) * pk;
    /* Esri draws its own ferry routes into the tiles: thin dashed lines across the water with an
       italic label along each. The app draws the ferry lines itself, properly, from the operator
       data, so the baked-in ones are a second, fainter, unlabelled-by-us copy that criss-crosses
       the sea. They are blue ink — water hue, a little darker than the water — and the one thing
       that tells them from a blue icon or a river is where they are: surrounded by more water.
       So a pass over the ORIGINAL pixels first marks everything water-hued, and a blue-ink pixel
       with water on (nearly) every side is painted as plain water. Land is never touched: a blue
       pixel there has land beside it. (Sea names such as "Marmara Denizi" are the same ink and go
       with them; the app has its own labels for what matters.) */
    const side = Math.round(Math.sqrt(d.length / 4)), wm = new Uint8Array(side * side);
    for (let p = 0, k = 0; p < wm.length; p++, k += 4) wm[p] = _waterHued(d[k], d[k + 1], d[k + 2]) ? 1 : 0;
    const around = function (p) {                       // how many of 8 points 6px away are water-hued; off the tile counts as water
      const x = p % side, y = (p - x) / side; let n = 0;
      for (let q = 0; q < 8; q++) {
        const xx = x + FERRY_RING[q][0], yy = y + FERRY_RING[q][1];
        n += (xx < 0 || yy < 0 || xx >= side || yy >= side) ? 1 : wm[yy * side + xx];
      }
      return n;
    };
    const near = OW ? _nearInk(d, side, 3) : null;
    const blobs = _signBlobs(d, side);
    const gain = (IG < 1 && z !== undefined && z !== null) ? IG + (1 - IG) * _smooth(11, 15, z) : 1;   // text is quietest when zoomed out
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2, dd = M - m;
      if (wm[i >> 2] && l >= .42 && l < .84 && around(i >> 2) >= 7) {
        d[i] = W.c[0]; d[i + 1] = W.c[1]; d[i + 2] = W.c[2];      // ferry route or its label, over open water
        continue;
      }
      if (blobs && blobs[i >> 2]) {                                 // a road shield, transit symbol or POI icon: gone
        d[i] = La.c[0]; d[i + 1] = La.c[1]; d[i + 2] = La.c[2];
        if (luA && luA[i + 3]) paintLanduse(d, i, luA);
        continue;
      }
      let R0 = d[i], G0 = d[i + 1], B0 = d[i + 2];
      if (NT) {
        const ix = (l * 255 + .5) | 0, sh = NT.lo[ix] - l * 255;
        R0 += sh; G0 += sh; B0 += sh;
        if (NT.tint) {
          const w = 1 - _smooth(.04, .14, dd), tn = NT.tint[ix];
          R0 += (tn[0] - R0) * w; G0 += (tn[1] - G0) * w; B0 += (tn[2] - B0) * w;
        }
      }
      let oR = R0, oG = G0, oB = B0;
      if (dd >= .04) {                                   // anything greyer than this is not a land class
        const s = dd / (1 - Math.abs(2 * l - 1) + 1e-6);
        // dark pixels are text and its anti-aliasing: never reclassify them as ground
        const chroma = _smooth(.10, .26, s) * _smooth(.55, .70, l);
        if (chroma >= .002) {
          let h = M === r ? ((g - b) / dd) % 6 : M === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
          h *= 60; if (h < 0) h += 360;
          const ww = _band(h, 210, 38), wp = _band(h, 76, 15), wl = _band(h, 55, 14);
          let wu, wr;
          if (low) {
            const warm = _band(h, 18, 24), pale = _smooth(.72, .78, l);
            wu = Math.max(_band(h, 33, 13), warm * pale);       // the salmon fill, and the old built-up tan
            wr = _band(h, 15, 16) * (1 - pale);                 // only the darker orange is a road
          } else {
            /* With one road colour an arterial must come out as ALL road. Measured arterials sit at hue 20-25,
               a little past the old band's centre, so they came out half road, half built-up: a grey that
               matched nothing. Both bands are narrowed and re-centred (the built-up fill measures 33-36). */
            if (OW) { wu = _band(h, 35, 6); wr = _band(h, 19, 13); }       // two narrow bands that no longer overlap: no grey in between
            else { wu = _band(h, 33, 13); wr = _band(h, 18, 14); }
          }
          const sum = ww + wp + wl + wu + wr;
          if (sum >= .002) {                             // a hue we have no class for (an icon) stays itself
            const rc = (OW && near[i >> 2]) ? OH : Ro.c;               // a road under a label is the label's halo
            const dW = (l - W.ref) * W.k * 255,  dP = (l - Pk.ref) * Pk.k * 255, dL = (l - La.ref) * La.k * 255,
                  dU = (l - Ur.ref) * Ur.k * 255, dR = (l - Ro.ref) * Ro.k * 255;
            const R  = (ww * (W.c[0] + dW) + wp * (pc0 + dP) + wl * (La.c[0] + dL) + wu * (Ur.c[0] + dU) + wr * (rc[0] + dR)) / sum;
            const G  = (ww * (W.c[1] + dW) + wp * (pc1 + dP) + wl * (La.c[1] + dL) + wu * (Ur.c[1] + dU) + wr * (rc[1] + dR)) / sum;
            const Bl = (ww * (W.c[2] + dW) + wp * (pc2 + dP) + wl * (La.c[2] + dL) + wu * (Ur.c[2] + dU) + wr * (rc[2] + dR)) / sum;
            const a = chroma * Math.min(1, sum * 1.6);
            oR = R0 + (R - R0) * a; oG = G0 + (G - G0) * a; oB = B0 + (Bl - B0) * a;
          }
        }
      }
      if (QI && l < .55 && dd >= .07) {                          // coloured label text (a park, a POI, a district): quieter
        const s = dd / (1 - Math.abs(2 * l - 1) + 1e-6);
        if (s > .25) {
          let h = M === r ? ((g - b) / dd) % 6 : M === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
          h *= 60; if (h < 0) h += 360;
          if (h < 6 || h > 34) { oR = La.c[0] + (oR - La.c[0]) * QI; oG = La.c[1] + (oG - La.c[1]) * QI; oB = La.c[2] + (oB - La.c[2]) * QI; }   // not the road/built-up hues
        }
      }
      if (gain < 1 && l < .45 && dd < .12) {                      // grey text, quieter the further out the map is
        oR = La.c[0] + (oR - La.c[0]) * gain; oG = La.c[1] + (oG - La.c[1]) * gain; oB = La.c[2] + (oB - La.c[2]) * gain;
      }
      if (OW && dd < .045 && l > .93 && !near[i >> 2]) {          // a white street, away from any label: the one road colour
        // by how white it is, between the land (L .93) and pure white, so a street's anti-aliased edge fades instead of breaking up
        const w = _smooth(.93, .995, l);
        oR += (OW[0] - oR) * w; oG += (OW[1] - oG) * w; oB += (OW[2] - oB) * w;
      }
      d[i] = _clamp255(oR); d[i + 1] = _clamp255(oG); d[i + 2] = _clamp255(oB);
      if (luA && luA[i + 3] && !wm[i >> 2]) paintLanduse(d, i, luA);       // never on water: a park polygon can reach over a lake
    }
    /* Recolour the GROUND under a polygon and nothing else. How much a pixel is ground is how close its
       brightness is to the ground's: 1 on the ground itself, 0 at the brightness of a road or a letter
       (the bright side) or of black (the dark side) — so streets, labels and the dark halo around a
       label's edge come through, the last one correctly picking up the colour it now sits on. The shift
       is by the DIFFERENCE between the class colour and the ground, so a faint texture in the ground
       survives it. */
    function paintLanduse(d, i, a) {
      const m = a[i + 3] / 255, dl = (d[i] + d[i + 1] + d[i + 2]) / 3 - GM;
      const c = dl >= 0 ? 1 - dl / LU.bright : 1 + dl / LU.dark;
      if (c <= 0) return;
      const w = m * (c > 1 ? 1 : c);
      d[i] = _clamp255(d[i] + (a[i] - La.c[0]) * w);
      d[i + 1] = _clamp255(d[i + 1] + (a[i + 1] - La.c[1]) * w);
      d[i + 2] = _clamp255(d[i + 2] + (a[i + 2] - La.c[2]) * w);
    }
  };
}

/* ---- colour arithmetic, kept here because the casing rule and its tests both need it ---- */
function _lin(c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
function _lum(a) { return .2126 * _lin(a[0]) + .7152 * _lin(a[1]) + .0722 * _lin(a[2]); }
function contrastRgb(a, b) { const A = _lum(a), B = _lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); }
function hexToRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
function rgbToHex(a) {
  return '#' + a.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); }).join('');
}
function _mixRgb(a, b, f) { return a.map(function (v, i) { return v + (b[i] - v) * f; }); }

/* The outline under a line.

   Operator colours are identity, so they are never altered — but several fail badly against
   the ground they now sit on. Measured on the real network: on the day map M9 yellow is 1.29:1
   and M12 lime 1.44:1; on the night map M5 purple is 1.66:1 and T1 navy 1.76:1. A single white
   or black outline cannot fix both ends, so the casing is chosen per line:

     - a line that already separates from the ground (>= 3:1, the WCAG non-text threshold) gets
       the neutral outline — white by day, deep ink by night — which just lifts it off busy roads;
     - one that does not gets a TINT OF ITS OWN COLOUR, darker by day and lighter by night,
       searched for the lightest step that clears 3:1 against the ground. A yellow line gets an
       amber edge, a purple one a lilac glow: it still reads as that line.

   Judged against LAND, which is most of the map. Also requiring 3:1 on every park and every
   water body was tried and rejected: it turns 34 of the 46 day colours into dark-edged lines and
   loses the clean white edge that makes the map look like a map. A line crossing a park still
   shows by its own colour. */
function lineCasing(colorHex, tone, ground) {
  const C = hexToRgb(colorHex);
  const G = ground || (tone === 'night' ? ATLAS_PAL.night.ground : ATLAS_PAL.day.ground);
  const neutral = tone === 'night' ? [8, 9, 11] : [255, 255, 255];
  if (contrastRgb(C, G) >= 3 && contrastRgb(C, neutral) >= 2.2) return rgbToHex(neutral);
  const toward = tone === 'night' ? [255, 255, 255] : [0, 0, 0];
  for (let t = .2; t <= .951; t += .05) {
    const K = _mixRgb(C, toward, t);
    if (contrastRgb(K, G) >= 3 && contrastRgb(C, K) >= 2.0) return rgbToHex(K);
  }
  return tone === 'night' ? '#F2F5FA' : '#1B2433';
}

/* ---- Land use: forests, parks, campuses and airports -----------------------------------------
   The Esri raster draws a park as pale green and everything else — a forest, an airport — as the
   same beige as the rest of the land, so no regrade of it can tell them apart. These come from
   OpenStreetMap instead (fetch-landuse.cjs / process-landuse.cjs): one small file per city, painted
   into each tile as it is graded. Everything here is arithmetic on that file; the canvas work that
   uses it is below the pure block. */
const LANDUSE_CLASSES = ['forest', 'park', 'campus', 'airport'];       // draw order: later ones sit on top

/* [lat, lon] of the file's integer deltas -> the polygon list the painter walks. Coordinates are
   stored as WORLD fractions (0..1 across the whole Web-Mercator square), so putting a vertex on a
   tile at any zoom is one multiply and one subtract — no trigonometry per tile. */
function decodeLanduse(j) {
  const out = [];
  if (!j || j.v !== 1 || !Array.isArray(j.p)) return out;
  const sc = j.scale || 1e5, cls = j.classes || LANDUSE_CLASSES;
  for (let k = 0; k < j.p.length; k++) {
    const p = j.p[k], rings = [];
    let x0 = 2, y0 = 2, x1 = -1, y1 = -1;
    for (let r = 0; r < p[2].length; r++) {
      const a = p[2][r], n = a.length >> 1, f = new Float64Array((n + 1) * 2);
      let la = 0, lo = 0;
      for (let i = 0; i < n; i++) {
        la = i === 0 ? a[0] : la + a[2 * i]; lo = i === 0 ? a[1] : lo + a[2 * i + 1];
        const lat = la / sc, lng = lo / sc, s = Math.sin(lat * Math.PI / 180);
        const x = (lng + 180) / 360, y = .5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
        f[2 * i] = x; f[2 * i + 1] = y;
        if (r === 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      f[2 * n] = f[0]; f[2 * n + 1] = f[1];                  // closed
      rings.push(f);
    }
    out.push({ c: LANDUSE_CLASSES.indexOf(cls[p[0]]), ha: p[1], bb: [x0, y0, x1, y1], rings: rings });
  }
  return out;
}
/* Smallest polygon worth drawing at a zoom, in hectares: about a 12-pixel patch. Below that it is
   a speck, and at z8 there are thousands of them. (118,000 m per pixel at z0 is right to within
   10% anywhere in Turkey, which is all a visibility cut needs.) */
function landuseMinHa(z) {
  const mpp = 118000 / Math.pow(2, z);
  return 12 * mpp * mpp / 10000;
}
/* The polygons of `list` that touch tile x,y at zoom z and are big enough to see there. */
function landusePick(list, z, x, y) {
  const n = Math.pow(2, z), x0 = x / n, y0 = y / n, x1 = (x + 1) / n, y1 = (y + 1) / n, min = landuseMinHa(z), out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.c < 0 || p.ha < min) continue;
    if (p.bb[2] < x0 || p.bb[0] > x1 || p.bb[3] < y0 || p.bb[1] > y1) continue;
    out.push(p);
  }
  return out;
}
/* ==BASEMAP-PURE-END== */

/* ---- Land use, loaded and painted ------------------------------------------------------------
   One file per city, fetched at once (not after first paint like the bus data: a tile cannot be
   graded without it, and it is ~1 MB gzipped). A tile that finishes loading BEFORE the file is
   waited for, up to a second; one that gives up waiting is graded without it, and the layer is
   redrawn when the file arrives — so a slow network costs a flicker, never a map with no forests. */
const LANDUSE = { list: null, bx: null, settled: false, missed: false, promise: null };
function loadLanduse() {
  if (LANDUSE.promise) return LANDUSE.promise;
  LANDUSE.promise = fetch('transit_data/landuse-' + CITY_ID + '.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return;
      LANDUSE.list = decodeLanduse(j);
      const b = j.box;                                       // the box the polygons were fetched for, as world fractions
      const wy = function (lat) { const s = Math.sin(lat * Math.PI / 180); return .5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
      LANDUSE.bx = [(b.w + 180) / 360, wy(b.n), (b.e + 180) / 360, wy(b.s)];
    })
    .catch(function () { /* offline or a city with none: the raster's own parks stay */ })
    .then(function () {
      LANDUSE.settled = true;
      if (LANDUSE.missed && LANDUSE.list && typeof curBase !== 'undefined' && curBase.redraw) curBase.redraw();
    });
  return LANDUSE.promise;
}
/* Run `fn` once the polygon file is in hand, or after a second, whichever is first. */
function whenLanduse(fn) {
  if (LANDUSE.settled) { fn(); return; }
  let ran = false;
  const go = function () { if (!ran) { ran = true; if (!LANDUSE.settled) LANDUSE.missed = true; fn(); } };
  LANDUSE.promise.then(go);
  setTimeout(go, 1000);
}
/* The mask for one tile: null where land use says nothing about the place (outside the city, or no
   file), { a: null } inside the city but with nothing in this tile, otherwise { a: RGBA } — each class
   in its palette colour, anti-aliased edges as partial alpha. One scratch canvas, reused. Each polygon
   is its own fill so two that overlap (a park mapped twice, a clearing inside a forest) add instead
   of cancelling the way one even-odd path would make them. */
function makeLanduseMask(pal) {
  const colours = LANDUSE_CLASSES.map(function (c) { return 'rgb(' + pal.landuse[c].join(',') + ')'; });
  let cv = null, g = null;
  return function (coords) {
    const L = LANDUSE.list, bx = LANDUSE.bx;
    if (!L || !bx) return null;
    const z = coords.z, n = Math.pow(2, z), x = coords.x, y = coords.y;
    if (x / n > bx[2] || (x + 1) / n < bx[0] || y / n > bx[3] || (y + 1) / n < bx[1]) return null;
    const pick = landusePick(L, z, x, y);
    if (!pick.length) return { a: null };
    if (!cv) { cv = document.createElement('canvas'); cv.width = cv.height = 256; g = cv.getContext('2d', { willReadFrequently: true }); }
    g.clearRect(0, 0, 256, 256);
    let drew = false;
    for (let k = 0; k < LANDUSE_CLASSES.length; k++) {
      g.fillStyle = colours[k];
      for (let q = 0; q < pick.length; q++) {
        const p = pick[q];
        if (p.c !== k) continue;
        g.beginPath();
        for (let r = 0; r < p.rings.length; r++) {
          const f = p.rings[r];
          for (let i = 0; i < f.length; i += 2) {
            const px = (f[i] * n - x) * 256, py = (f[i + 1] * n - y) * 256;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath();
        }
        g.fill('evenodd'); drew = true;
      }
    }
    return { a: drew ? g.getImageData(0, 0, 256, 256).data : null };
  };
}
/* Named entry point for the browser smoke suite (the page's state is script-scoped, not on window): how much land use is loaded, and
   — given a point — what colour the mask paints there, read back out of a real canvas. That is the part node cannot test. */
function landuseProbe(pt) {
  const L = LANDUSE.list, info = { loaded: !!L, polygons: L ? L.length : 0, settled: LANDUSE.settled };
  if (!pt || !L) return info;
  const tone = pt.tone || 'night', z = pt.z || 13, n = Math.pow(2, z), s = Math.sin(pt.lat * Math.PI / 180);
  const x = (pt.lng + 180) / 360 * n, y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n, tx = Math.floor(x), ty = Math.floor(y);
  const m = makeLanduseMask(ATLAS_PAL[tone])({ z: z, x: tx, y: ty });
  info.covered = !!m; info.expected = ATLAS_PAL[tone].landuse;
  if (m && m.a) {
    const px = Math.min(255, Math.floor((x - tx) * 256)), py = Math.min(255, Math.floor((y - ty) * 256)), i = (py * 256 + px) * 4;
    info.rgba = [m.a[i], m.a[i + 1], m.a[i + 2], m.a[i + 3]];
  }
  return info;
}
loadLanduse();

/* The tile layer. A canvas per tile rather than an <img>: the regrade needs the pixels.

   Everything the old layers got from Leaflet's <img> path is kept — CORS (so the service worker
   caches real responses, not opaque ones), keepBuffer, and the retry that stops one dropped
   request leaving a permanent hole: a tile that errors stays blank until something re-creates
   it. The retry lives HERE rather than in the generic tileerror handler because a canvas has no
   `src` for that handler to find. `done` is held back until the last attempt, so a retry that
   succeeds never flashes an error tile in between. */
/* Written `createTile: function` rather than method shorthand on purpose. The scope analyser
   (testkit/analyse-scope.cjs) only recognises a deferred body by the `function` keyword, so the
   shorthand read as load-time code and every local in it — `src`, `id`, `x` — was counted as a
   reference to some other file's top-level name, inventing a four-file cycle. */
const AtlasTiles = L.TileLayer.extend({
  createTile: function (coords, done) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;                       // Esri tiles are 256px; the CSS size is Leaflet's
    c.setAttribute('role', 'presentation');              // what Leaflet gives its <img> tiles: the map is not a figure to read
    const src = this.getTileUrl(coords), self = this;
    let tries = 0;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      whenLanduse(function () {
        try {
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, 0, 0, 256, 256);
          const id = x.getImageData(0, 0, 256, 256);
          self.options.grade(id.data, coords.z, self.options.landuse ? self.options.landuse(coords) : null);
          x.putImageData(id, 0, 0);
        } catch (e) { /* unreadable: the raw tile is already drawn, which beats a hole */ }
        done(null, c);
      });
    };
    img.onerror = function () {
      if (++tries > 3) { done(new Error('tile'), c); return; }   // give up rather than hammer the provider
      // a tile scrolled out of the view meanwhile has been removed from the DOM: let it go
      setTimeout(function () { if (c.parentNode) img.src = src; }, 400 * tries);
    };
    img.src = src;
    return c;
  },
});
