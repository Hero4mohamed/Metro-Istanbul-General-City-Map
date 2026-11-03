/* WCAG 2.x contrast, for the tests that keep text readable (V4.3). Colours are '#rgb', '#rrggbb', 'rgb(...)' or 'rgba(...)'. */
function parse(c) {
  c = String(c).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return [...m[1]].map(h => parseInt(h + h, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return [+m[1], +m[2], +m[3], a]; }
  throw new Error('cannot parse colour: ' + c);
}
/** the colour you see when `fg` (maybe translucent) is laid over the opaque `bg` */
function over(fg, bg) {
  const f = parse(fg), b = parse(bg);
  return [0, 1, 2].map(i => Math.round(f[i] * f[3] + b[i] * (1 - f[3]))).concat(1);
}
function lum(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** contrast ratio of text colour `fg` on background `bg` (a translucent fg is blended over bg first) */
function ratio(fg, bg) {
  const B = parse(bg), F = parse(fg).slice(3)[0] < 1 ? over(fg, bg) : parse(fg);
  const a = lum(F), b = lum(B), hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
module.exports = { parse, over, lum, ratio };
