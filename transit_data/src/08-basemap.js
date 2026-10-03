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
    tintS: 0,                                 // no tint: by day the source's own hue is left alone
  },
  /* Night is GRAPHITE: neutral charcoal ground, near-black water, a whisper of green for parks, and
     main roads in a muted mustard. The first night palette was a slate blue with teal and brown
     roads; people found the whole screen too much, and the dark grey-and-black look that came
     before it was the one they wanted back. So the colour here is spent in exactly one place —
     the main roads — and kept low (about 3.4:1 on the ground, a fifth of the lightness the lines
     drawn over them have) so it organises the map without competing with the metro lines. */
  night: {
    ground: [30, 31, 34],
    bands: {
      water: { c: [18, 21, 26],   ref: .86, k: .30 },
      park:  { c: [30, 43, 35],   ref: .82, k: .18 },
      land:  { c: [30, 31, 34],   ref: .85, k: .10 },
      urban: { c: [35, 36, 39],   ref: .82, k: .10 },
      road:  { c: [110, 100, 58], ref: .76, k: .20 },
    },
    tintH: 220, tintS: 0,                     // no tint: greys stay grey
    // lightness in -> lightness out. Dark label text (low l) -> light; the halos and casings
    // (high l) -> dark; white road fill (1.0) -> one step above the land.
    curve: [[0, .90], [.25, .78], [.5, .58], [.62, .42], [.78, .17], [.9, .15], [.96, .21], [1, .31]],
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
  const NT = pal.curve ? _neutralTable(pal) : null;
  return function grade(d, z) {
    /* Scale. Above about z11 a green pixel is a park and wants its own colour. Below z9 it is a
       land-cover tint covering whole regions — Esri shades Anatolia green and Thrace beige at
       country scale — and giving that a distinct colour drew hard-edged blocks along tile
       boundaries (dark green Turkey beside slate Greece, at night). So the park colour fades
       into the land colour as the map zooms out. `z` is optional: omitted means full strength. */
    const pk = (z === undefined || z === null) ? 1 : _smooth(8, 11, z);
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
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2, dd = M - m;
      if (wm[i >> 2] && l >= .42 && l < .84 && around(i >> 2) >= 7) {
        d[i] = W.c[0]; d[i + 1] = W.c[1]; d[i + 2] = W.c[2];      // ferry route or its label, over open water
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
          } else { wu = _band(h, 33, 13); wr = _band(h, 18, 14); }
          const sum = ww + wp + wl + wu + wr;
          if (sum >= .002) {                             // a hue we have no class for (an icon) stays itself
            const dW = (l - W.ref) * W.k * 255,  dP = (l - Pk.ref) * Pk.k * 255, dL = (l - La.ref) * La.k * 255,
                  dU = (l - Ur.ref) * Ur.k * 255, dR = (l - Ro.ref) * Ro.k * 255;
            const R  = (ww * (W.c[0] + dW) + wp * (pc0 + dP) + wl * (La.c[0] + dL) + wu * (Ur.c[0] + dU) + wr * (Ro.c[0] + dR)) / sum;
            const G  = (ww * (W.c[1] + dW) + wp * (pc1 + dP) + wl * (La.c[1] + dL) + wu * (Ur.c[1] + dU) + wr * (Ro.c[1] + dR)) / sum;
            const Bl = (ww * (W.c[2] + dW) + wp * (pc2 + dP) + wl * (La.c[2] + dL) + wu * (Ur.c[2] + dU) + wr * (Ro.c[2] + dR)) / sum;
            const a = chroma * Math.min(1, sum * 1.6);
            oR = R0 + (R - R0) * a; oG = G0 + (G - G0) * a; oB = B0 + (Bl - B0) * a;
          }
        }
      }
      d[i] = _clamp255(oR); d[i + 1] = _clamp255(oG); d[i + 2] = _clamp255(oB);
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
/* ==BASEMAP-PURE-END== */

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
      try {
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 256, 256);
        const id = x.getImageData(0, 0, 256, 256);
        self.options.grade(id.data, coords.z);
        x.putImageData(id, 0, 0);
      } catch (e) { /* unreadable: the raw tile is already drawn, which beats a hole */ }
      done(null, c);
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
