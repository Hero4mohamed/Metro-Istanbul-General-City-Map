/* Two things people asked for by eye, pinned so they cannot quietly drift back:
 *   - ONE station dot everywhere: a white disc with a thick black outline, on every line and every tab. It used to be
 *     drawn four ways (line-coloured disc, coloured ring, hollow ring for planned lines, dark disc for intercity).
 *   - A fourth theme, "Mixed": everything light EXCEPT the tabs, which stay dark.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

test('every station dot is the same white disc with a thick black outline', () => {
  const s = H.appScript();
  assert.ok(/const STATION_RING = [\d.]+;/.test(s), 'the shared station ring width is gone');
  assert.ok(/const stationDot = /.test(s), 'the shared stationDot style is gone');
  // the live-line markers and the planned-line markers
  const live = /renderer:stationRenderer, radius: base, color:'#05070A', weight:STATION_RING, fillColor:'#FFFFFF'/.test(s);
  const planned = /renderer:stationRenderer, radius:3\.0, color:'#05070A', weight:STATION_RING, fillColor:'#FFFFFF'/.test(s);
  assert.ok(live, 'live station markers are not a white disc with the black ring');
  assert.ok(planned, 'planned-line station markers are not the same dot');
  assert.ok(!/fillColor: col\b/.test(s), 'a station marker is still filled with its line colour');
  // intercity stations (three marker sites) use the shared style
  assert.strictEqual((s.match(/stationDot\(\{ renderer:lineRenderer/g) || []).length, 3, 'intercity stations do not all use the shared dot');
  // the tone changes must not restyle a dot into something else
  const fn = /function applyStationStyle\(\)\{[\s\S]*?\r?\n\}/.exec(s);
  assert.ok(fn && /fillColor:'#FFFFFF'/.test(fn[0]) && !/o\.color/.test(fn[0]), 'applyStationStyle gives a station its line colour again');
});

test('the line-panel strip map uses the same station dot', () => {
  const s = H.appScript();
  const dots = s.match(/<circle cx="\$\{x\}" cy="\$\{TY\}" r="(8|6\.5|5)" fill="#fff" stroke="#05070A" stroke-width="[\d.]+"\/>/g) || [];
  assert.strictEqual(dots.length, 3, 'the terminus, interchange and ordinary-stop circles are not all the shared white/black dot');
});

test('the fourth theme, Mixed, is offered, remembered and keeps the tabs, layers, planner and announcements dark', () => {
  const html = H.html(), s = H.appScript(), css = H.appStyle();
  assert.ok(/<button data-theme="split"[^>]*data-i18n="themeSplit"/.test(html), 'the Mixed option is not in the theme control');
  assert.ok(/id="cardTabs"/.test(html), 'the tab card cannot be targeted');
  assert.ok(/s==='split'\)\s*return s/.test(s), 'a saved Mixed theme is not restored at boot');
  assert.ok(/\(pref==='light'\|\|pref==='auto'\|\|pref==='split'\)/.test(s), 'applyTheme does not accept Mixed');
  assert.ok(/return \(pref==='light'\|\|pref==='split'\)\?'light':'dark'/.test(s), 'Mixed does not resolve to the light page');
  assert.ok(/classList\.toggle\('mixed', themePref==='split'\)/.test(s), 'the body never gets its mixed marker');
  const rule = /body\.mixed #cardTabs,body\.mixed #cardLayers,body\.mixed #cardPlanner,body\.mixed #announce,body\.mixed \.mnav\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the dark-panels rule is missing, or does not cover the tabs, Layers, Trip Planner and announcements');
  assert.ok(/--panel:rgba\(13,17,27/.test(rule[1]) && /--text:#EEF2F8/.test(rule[1]), 'the tabs do not restate the dark palette');
});

test('station dots are small with a thin ring, and a plain stop is only drawn once the map is zoomed in', () => {
  const s = H.appScript();
  const ring = +/const STATION_RING = ([\d.]+);/.exec(s)[1];
  assert.ok(ring >= 1 && ring <= 1.5, 'the black outline is ' + ring + ' px: it is meant to be thin');
  const base = /const base = ix\?([\d.]+):([\d.]+);/.exec(s);
  assert.ok(base, 'the dot sizes are not where they were');
  assert.ok(+base[1] <= 4.4 && +base[2] <= 3.2, 'dots are bigger than the decluttered size: interchange ' + base[1] + ', stop ' + base[2]);
  assert.ok(+base[1] > +base[2], 'an interchange must stay bigger than an ordinary stop');
  const minZ = +/const STOP_MIN_ZOOM = (\d+);/.exec(s)[1];
  assert.ok(minZ >= 11 && minZ <= 13, 'plain stops must hide on a city-wide view and show once zoomed in: ' + minZ);
  // hidden by leaving the layer: a transparent canvas marker would still take clicks
  assert.ok(/o\.group\.removeLayer\(o\.m\)/.test(s), 'a hidden stop is no longer taken off its layer');
  assert.ok(/if\(o\.group && !o\.ix\)/.test(s), 'interchanges must stay drawn at every zoom');
});
