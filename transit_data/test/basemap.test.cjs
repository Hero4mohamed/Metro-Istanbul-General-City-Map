/* The Atlas basemap's arithmetic, tested against the page that actually ships.
 *
 * Esri's Streets tiles are regraded per pixel (08-basemap.js) and every line drawn over them
 * gets an outline chosen from its own colour. Both are pure arithmetic, so they are lifted out
 * of the SHIPPED page between ==BASEMAP-PURE-== markers and exercised directly — not out of
 * src/, because build.cjs concatenates the sources and a splice that dropped the file would
 * leave a test of src/ green against a page that does not contain it.
 *
 * What these pin down is mostly what a regrade can quietly get wrong:
 *   - label text being reclassified as ground and fading (the first prototype did, at the edges);
 *   - the road hierarchy inverting at night, as the CSS invert() trick does;
 *   - a line colour that cannot be seen against the map it sits on — measured on the real
 *     network, not asserted for a few examples.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../testkit/helpers.cjs');

function basemap() {
  const html = H.html();
  const a = html.indexOf('/* ==BASEMAP-PURE-START== */');
  const b = html.indexOf('/* ==BASEMAP-PURE-END== */');
  assert.ok(a > 0 && b > a, 'basemap pure-maths markers not found in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) +
    '\nmodule.exports={ATLAS_PAL,makeBasemapGrade,lineCasing,contrastRgb,hexToRgb,rgbToHex};'
  )(mod, mod.exports);
  return mod.exports;
}

/* grade ONE pixel through the real function; Float64Array so a NaN is visible rather than being
   silently clamped to 0 the way a Uint8ClampedArray would */
function px(B, tone, rgb) {
  const d = Float64Array.from([rgb[0], rgb[1], rgb[2], 255]);
  B.makeBasemapGrade(B.ATLAS_PAL[tone])(d);
  return [d[0], d[1], d[2], d[3]];
}
const near = (a, b, tol) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const lum = (B, c) => B.contrastRgb(c, [0, 0, 0]);            // monotonic in luminance, which is all we need

/* Esri Streets colours, MEASURED from real tiles (see the sampling in 08-basemap.js's header). */
const ESRI = { water: [188, 220, 244], land: [236, 232, 197], park: [221, 228, 185],
               builtUp: [233, 215, 193], road: [252, 252, 252], text: [40, 40, 40], streetName: [120, 118, 110] };

test('each Esri land class becomes the colour chosen for it, by day', () => {
  const B = basemap(), P = B.ATLAS_PAL.day.bands;
  assert.ok(near(px(B, 'day', ESRI.water), P.water.c, 14), 'water drifted from its palette colour: ' + px(B, 'day', ESRI.water));
  assert.ok(near(px(B, 'day', ESRI.land), P.land.c, 12), 'land drifted from ivory: ' + px(B, 'day', ESRI.land));
  assert.ok(near(px(B, 'day', ESRI.park), P.park.c, 16), 'park drifted from sage: ' + px(B, 'day', ESRI.park));
});

test('each Esri land class becomes the colour chosen for it, by night', () => {
  const B = basemap(), P = B.ATLAS_PAL.night.bands;
  assert.ok(near(px(B, 'night', ESRI.water), P.water.c, 14), 'night water: ' + px(B, 'night', ESRI.water));
  assert.ok(near(px(B, 'night', ESRI.land), P.land.c, 12), 'night land: ' + px(B, 'night', ESRI.land));
  assert.ok(near(px(B, 'night', ESRI.park), P.park.c, 16), 'night park: ' + px(B, 'night', ESRI.park));
});

test('park and land stay distinct classes — green stays green', () => {
  /* Esri's park (hue ~76) and beige land (hue ~55) are only ~20 degrees apart, which is exactly
     the kind of gap a lazy regrade closes. If they merge, parks disappear from the map. */
  const B = basemap();
  for (const tone of ['day', 'night']) {
    const park = px(B, tone, ESRI.park), land = px(B, tone, ESRI.land);
    assert.ok(park[1] - park[0] > land[1] - land[0] + 8,
      tone + ': a park is no greener than land (park ' + park.slice(0, 3) + ', land ' + land.slice(0, 3) + ')');
  }
});

test('place names survive the regrade', () => {
  const B = basemap();
  // by day, label text is left exactly alone — it is neutral and dark, which no land class claims
  for (const t of [ESRI.text, ESRI.streetName])
    assert.deepStrictEqual(px(B, 'day', t).slice(0, 3).map(Math.round), t, 'day label text was altered');
  // by night, dark text must come out LIGHT against the ground it sits on: that is the whole point
  const ground = B.ATLAS_PAL.night.ground;
  for (const t of [ESRI.text, ESRI.streetName]) {
    const out = px(B, 'night', t);
    assert.ok(B.contrastRgb(out, ground) >= 4.5,
      'night label text is ' + B.contrastRgb(out, ground).toFixed(2) + ':1 on the ground, under AA — got ' + out.slice(0, 3).map(Math.round));
  }
});

test('by night a road is brighter than the land, not darker', () => {
  /* The CSS invert() trick turns white roads black, so the road hierarchy comes out backwards:
     streets read as dark channels cut into a lighter city. */
  const B = basemap(), road = px(B, 'night', ESRI.road), land = px(B, 'night', ESRI.land);
  assert.ok(lum(B, road) > lum(B, land), 'a night road is not lighter than night land: ' + road.slice(0, 3));
});

test('by day a road is white and its grey casing is quieter than it was', () => {
  const B = basemap();
  assert.ok(near(px(B, 'day', ESRI.road), [252, 252, 252], 4), 'day road fill was altered');
  // a mid-light grey casing is lifted toward white so the street network stops reading as a hatch
  const casing = [200, 200, 200], out = px(B, 'day', casing);
  assert.ok(out[0] > casing[0], 'the street casing was not lightened — the dense districts would stay a hatch');
});

test('alpha is never touched, and every channel stays a real colour', () => {
  const B = basemap();
  const N = 30000, d = new Float64Array(N * 4);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) { d[i * 4] = rnd() * 255; d[i * 4 + 1] = rnd() * 255; d[i * 4 + 2] = rnd() * 255; d[i * 4 + 3] = 40 + (i % 200); }
  for (const tone of ['day', 'night']) {
    const copy = Float64Array.from(d);
    B.makeBasemapGrade(B.ATLAS_PAL[tone])(copy);
    for (let i = 0; i < N; i++) {
      assert.strictEqual(copy[i * 4 + 3], d[i * 4 + 3], tone + ': alpha was modified at pixel ' + i);
      for (let c = 0; c < 3; c++) {
        const v = copy[i * 4 + c];
        assert.ok(Number.isFinite(v) && v >= -1 && v <= 256, tone + ': channel out of range / NaN at pixel ' + i + ': ' + v);
      }
    }
  }
});

test('the ground is the land colour, so a tile seam is invisible', () => {
  /* Leaflet leaves a sub-pixel gap between tiles, and whatever is behind the map shows through
     it. If that is not the colour of the land, every tile edge draws a faint hairline across
     the whole map — which is exactly what the first night render did. */
  const B = basemap();
  for (const tone of ['day', 'night'])
    assert.deepStrictEqual(B.ATLAS_PAL[tone].ground, B.ATLAS_PAL[tone].bands.land.c, tone + ' ground != land');
});

test('the chrome IS the ground: Atlas panels share the map\'s colour', () => {
  const B = basemap(), css = H.appStyle();
  const grab = sel => { const m = new RegExp(sel.replace(/\./g, '\\.') + '\\{([\\s\\S]*?)\\n  \\}').exec(css);
    assert.ok(m, sel + ' not found'); const o = /--obsidian:\s*(#[0-9a-fA-F]{6})/.exec(m[1]); assert.ok(o, sel + ' has no --obsidian'); return B.hexToRgb(o[1]); };
  assert.deepStrictEqual(grab('body.atlas'), B.ATLAS_PAL.night.ground, 'night chrome is not the night ground');
  assert.deepStrictEqual(grab('body.atlas.light'), B.ATLAS_PAL.day.ground, 'day chrome is not the day ground');
});

/* --- line outlines -------------------------------------------------------------------------
   Operator colours are identity and are never altered, but many cannot be seen against the map
   they sit on. Measured: on the day map M9 yellow is 1.29:1, M12 lime 1.44:1; on the night map
   M5 purple is 1.66:1 and T1 navy 1.76:1. This checks the REAL network, every colour, because
   a rule that works for the three colours someone thought of is how the fourth goes missing. */
function networkColours() {
  const dir = H.DATA, out = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!/(^|-)lines?\.json$/.test(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    const arr = Array.isArray(j) ? j : (j.lines || []);
    for (const l of arr) {
      if (!l || typeof l.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(l.color)) continue;
      if (l.kind === 'ferry') continue;               // drawn thin and dotted, with no outline
      out.set(l.color.toUpperCase(), (out.get(l.color.toUpperCase()) || []).concat(l.ref || f));
    }
  }
  return out;
}

test('the network colours are found (so the checks below are not vacuous)', () => {
  const c = networkColours();
  assert.ok(c.size >= 30, 'only ' + c.size + ' distinct line colours found — the line data has moved and the contrast checks below are testing nothing');
});

test('every line colour stays visible on the land, in both tones', () => {
  const B = basemap(), fails = [];
  for (const [hex, refs] of networkColours()) {
    for (const tone of ['day', 'night']) {
      const G = B.ATLAS_PAL[tone].ground, C = B.hexToRgb(hex), K = B.hexToRgb(B.lineCasing(hex, tone));
      const alone = B.contrastRgb(C, G);
      /* visible if the line separates from the ground by itself (3:1, the WCAG non-text
         threshold), or if its outline does AND the outline separates from the line */
      const ok = alone >= 3 || (B.contrastRgb(K, G) >= 3 && B.contrastRgb(C, K) >= 2);
      if (!ok) fails.push(hex + ' (' + refs.slice(0, 2) + ') ' + tone + ': line ' + alone.toFixed(2) +
        ', outline vs ground ' + B.contrastRgb(K, G).toFixed(2) + ', outline vs line ' + B.contrastRgb(C, K).toFixed(2));
    }
  }
  assert.deepStrictEqual(fails, [], 'lines that cannot be seen against the land:\n  ' + fails.join('\n  '));
});

test('a line that already shows gets the plain outline; one that does not gets a tint of its own colour', () => {
  const B = basemap();
  // B2's blue is 4.6:1 on ivory by itself, so it gets the neutral white edge. (An earlier draft
  // used #00A651 here; at 2.9:1 it correctly earns a tint, and the test caught the wrong example.)
  assert.strictEqual(B.lineCasing('#1F6FB2', 'day'), '#ffffff', 'a visible line did not get the neutral outline');
  // M9 yellow is 1.29:1 on ivory: it must get an outline DARKER than itself, and still yellow-ish
  const y = B.hexToRgb(B.lineCasing('#FCD10D', 'day'));
  assert.ok(B.contrastRgb(y, B.ATLAS_PAL.day.ground) >= 3, 'the yellow line\'s outline is not dark enough to show');
  assert.ok(y[0] > y[2], 'the yellow line\'s outline lost its hue: ' + y);       // warm, not a grey
  // M5 purple is 1.66:1 on night slate: it must get an outline LIGHTER than itself
  const p = B.hexToRgb(B.lineCasing('#683166', 'night'));
  assert.ok(B.contrastRgb(p, B.ATLAS_PAL.night.ground) >= 3, 'the purple line\'s outline is not light enough to show');
  assert.ok(lum(B, p) > lum(B, B.hexToRgb('#683166')), 'the purple line\'s outline is darker than the line, so it cannot lift it off the dark ground');
});

test('an outline is chosen from the line, never from the map: same colour, same answer', () => {
  const B = basemap();
  for (const hex of ['#FCD10D', '#683166', '#00A651', '#F490B3'])
    for (const tone of ['day', 'night'])
      assert.strictEqual(B.lineCasing(hex, tone), B.lineCasing(hex, tone), 'lineCasing is not deterministic');
});

test('at country scale a green pixel is land cover, not a park: the park colour fades out by z8', () => {
  /* Esri shades whole regions green or beige when zoomed out. Giving that a park colour drew
     hard-edged dark-green blocks along tile boundaries at night (Turkey beside Greece). */
  const B = basemap();
  const g = (tone, z) => { const d = Float64Array.from([...ESRI.park, 255]); B.makeBasemapGrade(B.ATLAS_PAL[tone])(d, z);
    return [d[0], d[1], d[2]]; };
  for (const tone of ['day', 'night']) {
    const land = px(B, tone, ESRI.land), far = g(tone, 6), near = g(tone, 14);
    assert.ok(near.every((v, i) => Math.abs(v - B.ATLAS_PAL[tone].bands.park.c[i]) <= 16), tone + ': a park at z14 lost its colour: ' + near);
    // at z6 a park pixel must be within a few levels of plain land, so no block edge can show
    assert.ok(far.every((v, i) => Math.abs(v - land[i]) <= 10), tone + ': at z6 a green pixel is still ' + far + ', not land ' + land);
  }
  // and omitting the zoom means full strength, so callers that do not know it still work
  const full = px(B, 'night', ESRI.park);
  assert.ok(full.slice(0, 3).every((v, i) => Math.abs(v - g('night', 14)[i]) <= 1), 'an omitted zoom is not full strength');
});
