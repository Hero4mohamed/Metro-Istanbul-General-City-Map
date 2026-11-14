/* Text contrast (V4.3, WCAG 2.x AA = 4.5:1 for normal text).
 *
 * The stylesheet is a set of design tokens restated by theme (light), style (atlas, calm, paper) and display option (high contrast).
 * This test does what the browser does: it cascades those token blocks in the same order and specificity, builds the surfaces text
 * sits on (the panel, a chip's tint, a "mixed" dark panel on a light page) and measures every text token against them, for every
 * combination. A palette edit that makes any of them unreadable fails here. A real-browser audit of every text node in every
 * combination backed this (22 combinations, 0 failures when it was written); this is the part CI can keep true.
 *
 * What it cannot see: text laid directly on the map, and gradients. Those were checked by hand in the browser audit.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const H = require('../testkit/helpers.cjs');
const { parse, over, ratio } = require('../testkit/contrast.cjs');

const css = H.appStyle().replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

/* every rule whose selector is just `:root` or `body.a.b...`, with its custom properties, in file order */
const RULES = [];
{
  const re = /([^{}]+)\{([^{}]*)\}/g; let m, i = 0;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    const s = /^body((?:\.[\w-]+)*)$/.exec(sel);
    if (sel !== ':root' && !s) continue;
    const props = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) props[d[1]] = d[2].trim();
    if (Object.keys(props).length) RULES.push({ classes: sel === ':root' ? null : (s[1] ? s[1].split('.').slice(1) : []), props, order: i++ });
  }
}
function tokens(active) {
  const hit = RULES.filter(r => r.classes === null || r.classes.every(c => active.includes(c)))
    .sort((a, b) => ((a.classes ? a.classes.length + 1 : 0) - (b.classes ? b.classes.length + 1 : 0)) || a.order - b.order);
  const t = {};
  for (const r of hit) Object.assign(t, r.props);
  for (const k of Object.keys(t)) { const v = /^var\((--[\w-]+)\)$/.exec(t[k]); if (v) t[k] = t[v[1]]; }
  return t;
}
const rgbTriplet = s => 'rgb(' + s + ')';

const COMBOS = [];
for (const style of [null, 'atlas', 'calm', 'paper']) for (const light of [false, true]) for (const hc of [false, true])
  COMBOS.push({ name: (style || 'neon') + (light ? ' light' : ' dark') + (hc ? ' high-contrast' : ''), active: [style, light && 'light', hc && 'high-contrast'].filter(Boolean) });

const TEXT = ['--text', '--muted', '--dim', '--accent-ink', '--ok-ink', '--warn-ink', '--danger-ink', '--gold-ink', '--sky-ink'];

test('the stylesheet has the token blocks this test reads (so it cannot pass by reading nothing)', () => {
  const t = tokens(['light', 'calm']);
  for (const k of ['--panel', '--obsidian', '--text', '--muted', '--dim', '--accent-ink', '--surface-2', '--track', '--ok-ink'])
    assert.ok(t[k], k + ' is not defined for calm + light');
  assert.ok(RULES.length >= 8, 'found only ' + RULES.length + ' token blocks');
  assert.ok(COMBOS.length === 16);
});

for (const combo of COMBOS) {
  test('text on panels, chips and tinted chips passes AA: ' + combo.name, () => {
    const t = tokens(combo.active);
    const page = parse(t['--obsidian']);
    const panel = over(t['--panel'], 'rgb(' + page.slice(0, 3) + ')');          // the panel over the page (the map under it is taken as the page colour)
    const panelCss = 'rgb(' + panel.slice(0, 3) + ')';
    const chip = over(t['--surface-2'], panelCss), chipCss = 'rgb(' + chip.slice(0, 3) + ')';
    const accent = parse(t['--accent']);
    const tint = over('rgba(' + accent.slice(0, 3) + ',.15)', panelCss), tintCss = 'rgb(' + tint.slice(0, 3) + ')';
    const low = [];
    for (const k of TEXT) {
      assert.ok(t[k], combo.name + ' has no ' + k);
      const onPanel = ratio(t[k], panelCss);
      if (onPanel < 4.5) low.push(k + ' on the panel = ' + onPanel.toFixed(2));
    }
    for (const k of ['--text', '--muted', '--dim', '--accent-ink']) {
      const r = ratio(t[k], chipCss); if (r < 4.5) low.push(k + ' on a chip = ' + r.toFixed(2));
    }
    for (const k of ['--accent-ink', '--ok-ink']) {
      const r = ratio(t[k], tintCss); if (r < 4.5) low.push(k + ' on an accent-tinted chip = ' + r.toFixed(2));
    }
    assert.deepStrictEqual(low, [], combo.name + ': ' + low.join('; '));
  });
}

test('the accent is never used as text colour directly: it is a fill (1.6:1 as text on a light panel); text uses --accent-ink', () => {
  const bad = [...css.matchAll(/(^|[^-\w])color\s*:\s*var\(--accent\)/g)].length;
  assert.strictEqual(bad, 0, bad + ' rule(s) paint text with var(--accent)');
  const raw = H.appScript();
  assert.ok(!/[^-\w]color\s*:\s*var\(--accent\)/.test(raw), 'a script writes text colour as var(--accent)');
});

test('a style that restates dark surface tokens restates the light ones for the light theme (Calm once left dark tab strips under dark text)', () => {
  for (const style of ['atlas', 'calm', 'paper']) {
    const dark = tokens([style]), light = tokens([style, 'light']);
    for (const k of ['--surface', '--surface-2', '--track']) {
      if (dark[k] !== tokens([]) [k]) assert.notStrictEqual(light[k], dark[k], style + ' + light still uses ' + style + '\'s dark ' + k + ': ' + light[k]);
    }
  }
});

/* chips painted in a line's or a severity's own colour */
test('inkOn() gives every line colour, severity colour and a sweep of all colours text that is at least 4.5:1', () => {
  const s = H.appScript().replace(/\r\n/g, '\n');
  const m = /function inkOn\(hex\)\{[\s\S]*?\n\}/.exec(s); assert.ok(m, 'inkOn is not in the page');
  const inkOn = new Function(m[0] + '\nreturn inkOn;')();
  const colours = [];
  for (const c of Object.values(H.cities())) for (const l of (c.lines || [])) if (l.color) colours.push(l.color);
  colours.push('#E5484D', '#F5A623', '#FFD400', '#2FBF71', '#4AB8E8', '#888', '#e81e77');
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) colours.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  assert.ok(colours.length > 250, 'too few colours to mean anything');
  const low = [];
  for (const c of colours) {
    const hex = c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c;
    const ink = inkOn(c), r = ratio(ink, hex);
    if (r < 4.5) low.push(c + ' with ' + ink + ' = ' + r.toFixed(2));
  }
  assert.deepStrictEqual(low.slice(0, 10), [], low.length + ' colour(s) get unreadable text');
});

test('every chip that paints a line or severity colour also chooses its text colour', () => {
  const s = H.appScript().replace(/\r\n/g, '\n');
  const bad = [];
  for (const m of s.matchAll(/class="(?:ann-line|ann-sev|svc-cd|cd|badge)"[^>]*style="background:\$\{([^}]+)\}([^"]*)"/g)) if (!/color:\$\{inkOn\(/.test(m[2])) bad.push(m[0].slice(0, 90));
  assert.deepStrictEqual(bad, [], 'a coloured chip with no ink chosen for it: ' + bad.join(' | '));
});
