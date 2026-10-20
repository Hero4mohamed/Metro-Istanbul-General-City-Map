/* The Weather tab.
 *
 * It asks Open-Meteo about a city and every district in it, and turns the answer into a hero, an hourly strip, a week, a
 * list and map badges. What can go wrong without anyone noticing, and is pinned here:
 *
 *   - a hint that fires when it should not (a "ferries may be held back" at 20 km/h teaches people to ignore hints), or
 *     does not when it should — the thresholds are written down and tested at both sides of each;
 *   - a colour scale that runs backwards, an air-quality band that is off by one, a wind arrow that points where the wind
 *     comes FROM instead of where it goes;
 *   - a word that exists in English only: the card has ~60 strings of its own and four languages;
 *   - a city whose district list is empty or points into the sea, or a card that says "İstanbul" over Ankara;
 *   - the request itself: every field the screen reads has to be one the request asks for.
 * The arithmetic is lifted out of the SHIPPED page, between ==WEATHER-PURE== markers.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../testkit/helpers.cjs');

function W() {
  const html = H.html();
  const a = html.indexOf('/* ==WEATHER-PURE-START== */'), b = html.indexOf('/* ==WEATHER-PURE-END== */');
  assert.ok(a > 0 && b > a, 'weather pure block not found in the built page');
  const mod = { exports: {} };
  new Function('module', 'exports', html.slice(a, b) +
    '\nmodule.exports={WX_FIELDS,wxForecastURL,wxAirURL,wxParse,wxCode,wxScale,WX_TEMP_STOPS,wxTempColor,wxWindColor,wxRainColor,wxAqiBand,wxUvBand,wxCompass,wxMin,wxDayFrac,wxRange,wxHints,wxHourRows,WX_AQI_BANDS};'
  )(mod, mod.exports);
  return mod.exports;
}
const hourly = (n, f) => {
  const H2 = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], wind_gusts_10m: [], is_day: [] };
  for (let i = 0; i < n; i++) {
    H2.time.push('2026-10-18T' + String(i % 24).padStart(2, '0') + ':00');
    const r = f ? f(i) : {};
    H2.temperature_2m.push(r.t != null ? r.t : 15); H2.precipitation_probability.push(r.p != null ? r.p : 0);
    H2.weather_code.push(r.c != null ? r.c : 0); H2.wind_gusts_10m.push(r.g != null ? r.g : 10); H2.is_day.push(1);
  }
  return H2;
};
const item = (over) => Object.assign({ cur: { temperature_2m: 15, precipitation: 0, weather_code: 1, is_day: 1 }, hourly: hourly(24), daily: {
  temperature_2m_max: [20], temperature_2m_min: [10], uv_index_max: [4] } }, over || {});

/* ---------------- the request ---------------- */

test('the request asks for every field the screen reads, for every place at once, in İstanbul time', () => {
  const X = W();
  const url = X.wxForecastURL([[41.0, 29.0], [40.9, 29.1]]);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'), 'wrong host or path');
  assert.ok(/latitude=41,40\.9&longitude=29,29\.1/.test(url), 'places are not sent as one list: ' + url);
  assert.ok(/timezone=Europe%2FIstanbul/.test(url), 'times are not asked for in local time');
  assert.ok(/forecast_days=7/.test(url) && /forecast_hours=24/.test(url), 'the week or the day is not asked for');
  const s = H.appScript();
  // every field name the renderer indexes is in the request
  const reads = new Set([...(s.match(/\b(?:c|D|H|p\.cur|p\.daily|p\.hourly|item\.cur)\.([a-z_0-9]+)\b/g) || [])].map(x => x.split('.').pop())
    .filter(k => /_(2m|10m|msl|code|day|cover|max|min|sum|probability|speed|direction|gusts|humidity|precipitation|index|temperature)/.test(k) || /^(sunrise|sunset|time)$/.test(k)));
  const asked = new Set([].concat(X.WX_FIELDS.current.split(','), X.WX_FIELDS.hourly.split(','), X.WX_FIELDS.daily.split(','), ['time']));
  const missing = [...reads].filter(k => !asked.has(k));
  assert.deepStrictEqual(missing, [], 'the screen reads fields the request never asks for: ' + missing.join(', '));
  assert.ok(/air-quality-api\.open-meteo\.com\/v1\/air-quality\?latitude=41,40\.9/.test(X.wxAirURL([[41.0, 29.0], [40.9, 29.1]])), 'the air-quality request is wrong');
});

test('the page may talk to both Open-Meteo hosts and no others for weather', () => {
  const html = H.html();
  assert.ok(/connect-src[^"]*https:\/\/api\.open-meteo\.com/.test(html), 'the forecast host is not allowed by the CSP');
  assert.ok(/connect-src[^"]*https:\/\/air-quality-api\.open-meteo\.com/.test(html), 'the air-quality host is not allowed by the CSP: the fetch would be blocked silently');
});

test('an answer is read as a list or as a single place, and a place without a temperature is a gap, not a zero', () => {
  const X = W();
  const one = { current: { temperature_2m: 12 }, hourly: { time: [] }, daily: { time: [] } };
  assert.strictEqual(X.wxParse(one, 1)[0].cur.temperature_2m, 12);
  assert.strictEqual(X.wxParse([one, one], 2).length, 2);
  const out = X.wxParse([one, { current: {} }, null], 3);
  assert.ok(out[0] && out[1] === null && out[2] === null, 'a place with no temperature was kept: ' + JSON.stringify(out));
  assert.deepStrictEqual(X.wxParse([one], 3).map(x => !!x), [true, false, false], 'a short answer was padded with invented places');
});

/* ---------------- what the numbers become ---------------- */

test('every WMO code that can come back has a picture, a name in all four languages, and a kind', () => {
  const X = W(), I = H.i18nValues();
  const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  for (const c of codes) for (const day of [1, 0]) {
    const w = X.wxCode(c, day);
    assert.ok(w.emo && w.kind && /^(clear|cloud|fog|rain|snow|storm)$/.test(w.kind), 'code ' + c + ': ' + JSON.stringify(w));
    for (const L of ['en', 'tr', 'ar', 'fr']) assert.ok(I[L][w.key], L + ' has no name for ' + w.key + ' (code ' + c + ')');
  }
  assert.strictEqual(X.wxCode(0, 1).emo, '☀️');
  assert.strictEqual(X.wxCode(0, 0).emo, '🌙', 'a clear night shows a sun');
  assert.strictEqual(X.wxCode(95, 1).kind, 'storm');
  assert.strictEqual(X.wxCode(73, 1).kind, 'snow');
  assert.strictEqual(X.wxCode(999, 1).kind, 'storm', 'a code above the table is not weather we know — it must still show something');
});

test('the temperature scale runs cold to hot, and the wind scale calm to strong', () => {
  const X = W();
  const lum = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const c = t => lum(X.wxTempColor(t));
  assert.ok(c(-10)[2] > c(-10)[0], 'cold is not blue');
  assert.ok(c(40)[0] > c(40)[2], 'hot is not red');
  assert.deepStrictEqual(X.wxTempColor(-99), X.wxTempColor(-10), 'below the scale is not clamped');
  assert.deepStrictEqual(X.wxTempColor(99), X.wxTempColor(40), 'above the scale is not clamped');
  assert.ok(/^#[0-9a-f]{6}$/.test(X.wxTempColor(17.3)));
  // from 22 up the scale goes yellow -> orange -> red -> crimson: it only ever loses green
  let prev = 999; for (let t = 22; t <= 40; t += 2) { const g = c(t)[1]; assert.ok(g <= prev + 1, 'green rises again at ' + t + ' (the scale turns back toward yellow)'); prev = g; }
  assert.ok(lum(X.wxWindColor(80))[0] > lum(X.wxWindColor(5))[0] && lum(X.wxWindColor(5))[1] > lum(X.wxWindColor(80))[1], 'wind: strong is not redder than calm');
  assert.ok(lum(X.wxRainColor(100))[2] > lum(X.wxRainColor(0))[2], 'rain chance does not get bluer');
});

test('air quality bands are the European index: 20, 40, 60, 80, 100 and above', () => {
  const X = W();
  const band = v => X.wxAqiBand(v).i;
  assert.deepStrictEqual([0, 20, 21, 40, 41, 60, 61, 80, 81, 100, 101, 250].map(band), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepStrictEqual(X.WX_AQI_BANDS.map(b => b[2]), ['#50F0E6', '#50CCAA', '#F0E641', '#FF5050', '#960032', '#7D2181'], 'the colours are the agency\'s own');
  assert.strictEqual(X.wxAqiBand(35).key, 'wxAqi1');
  assert.deepStrictEqual([0, 2.9, 3, 5.9, 6, 7.9, 8, 10.9, 11, 14].map(X.wxUvBand), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], 'UV bands are the WHO\'s: 3, 6, 8, 11');
});

test('wind is read as where it blows FROM, and the arrow points where it goes', () => {
  const X = W(), s = H.appScript();
  assert.deepStrictEqual([0, 22, 23, 45, 90, 180, 225, 270, 315, 337, 338, 359, 360, -45].map(X.wxCompass), [0, 0, 1, 1, 2, 4, 5, 6, 7, 7, 0, 0, 0, 7]);
  // a north wind (from 0) blows south: the arrow, drawn pointing up, is turned 180
  assert.ok(/function wxArrow\(deg\) \{ return '<span class="wx-arrow" style="transform:rotate\(' \+ \(\(deg \+ 180\) % 360\)/.test(s), 'the arrow does not point downwind');
  assert.ok(/WX_COMPASS = \['wxN', 'wxNE', 'wxE', 'wxSE', 'wxS', 'wxSW', 'wxW', 'wxNW'\]/.test(s), 'compass names are out of order');
});

test('the sun\'s place in the day: nothing before sunrise or after sunset, half way at noon', () => {
  const X = W();
  const r = '2026-10-18T07:00', s = '2026-10-18T19:00';
  assert.strictEqual(X.wxDayFrac(6 * 60 + 59, r, s), null);
  assert.strictEqual(X.wxDayFrac(19 * 60 + 1, r, s), null);
  assert.strictEqual(X.wxDayFrac(7 * 60, r, s), 0);
  assert.strictEqual(X.wxDayFrac(13 * 60, r, s), 0.5);
  assert.strictEqual(X.wxDayFrac(19 * 60, r, s), 1);
  assert.strictEqual(X.wxDayFrac(12 * 60, undefined, s), null, 'a missing sunrise gave a sun position');
  assert.strictEqual(X.wxMin('2026-10-18T07:18'), 438);
  const bar = X.wxRange(10, 20, 0, 40);
  assert.deepStrictEqual([bar.left, bar.width], [25, 25]);
  assert.ok(X.wxRange(5, 5, 0, 40).width >= 4, 'a one-degree day has an invisible bar');
});

/* ---------------- hints: thresholds, both sides ---------------- */

test('hints fire at their thresholds and not below them', () => {
  const X = W();
  const kinds = it => X.wxHints(it, null).map(h => h.k);
  assert.deepStrictEqual(kinds(item()), [], 'a calm day produced a hint');
  // rain: 60% in the next 12 hours (not the current hour, not later than 12)
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ p: i === 4 ? 60 : 0 })) })), ['rain']);
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ p: i === 4 ? 59 : 0 })) })), [], '59% is not "likely"');
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ p: i === 13 ? 90 : 0 })) })), [], 'rain 13 hours away was announced as likely');
  const rain = X.wxHints(item({ hourly: hourly(24, i => ({ p: i === 4 ? 80 : 0 })) }), null)[0];
  assert.deepStrictEqual([rain.at, rain.v], ['04:00', 80], 'the hint does not say WHEN');
  assert.deepStrictEqual(kinds(item({ cur: { temperature_2m: 10, precipitation: 0.3, weather_code: 61, is_day: 1 } })), ['raining']);
  // wind: 50 is a gust hint, 55 is the ferry hint, never both
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ g: i === 9 ? 49 : 10 })) })), []);
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ g: i === 9 ? 50 : 10 })) })), ['gust']);
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ g: i === 9 ? 54.9 : 10 })) })), ['gust']);
  assert.deepStrictEqual(kinds(item({ hourly: hourly(24, i => ({ g: i === 9 ? 55 : 10 })) })), ['ferry']);
  const f = X.wxHints(item({ hourly: hourly(24, i => ({ g: i === 9 ? 61.4 : 10 })) }), null)[0];
  assert.deepStrictEqual([f.at, f.v], ['09:00', 61]);
  // heat, frost, UV, air
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [34.9], temperature_2m_min: [10], uv_index_max: [4] } })), []);
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [35], temperature_2m_min: [10], uv_index_max: [4] } })), ['hot']);
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [10], temperature_2m_min: [0.1], uv_index_max: [4] } })), []);
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [10], temperature_2m_min: [0], uv_index_max: [4] } })), ['cold']);
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [20], temperature_2m_min: [10], uv_index_max: [7.9] } })), []);
  assert.deepStrictEqual(kinds(item({ daily: { temperature_2m_max: [20], temperature_2m_min: [10], uv_index_max: [8] } })), ['uv']);
  assert.deepStrictEqual(X.wxHints(item(), { european_aqi: 59 }).map(h => h.k), []);
  assert.deepStrictEqual(X.wxHints(item(), { european_aqi: 60 }).map(h => h.k), ['air']);
  assert.deepStrictEqual(X.wxHints(item(), { european_aqi: null }).map(h => h.k), [], 'a missing air reading was treated as bad air');
});

test('hints are capped, and a place with no forecast beyond "now" does not throw', () => {
  const X = W();
  const all = item({ cur: { temperature_2m: 40, precipitation: 1, weather_code: 95, is_day: 1 },
    hourly: hourly(24, () => ({ g: 80, p: 90 })), daily: { temperature_2m_max: [40], temperature_2m_min: [-3], uv_index_max: [10] } });
  assert.ok(X.wxHints(all, { european_aqi: 99 }).length <= 4, 'more than four hints');
  assert.deepStrictEqual(X.wxHints({ cur: { temperature_2m: 10, precipitation: 0 }, hourly: null, daily: null }, null), []);
  assert.deepStrictEqual(X.wxHourRows(null, 24), []);
  const rows = X.wxHourRows(hourly(30, i => ({ t: i })), 24);
  assert.strictEqual(rows.length, 24);
  assert.strictEqual(rows[5].t, 5);
  assert.strictEqual(X.wxHourRows(hourly(10), 24).length, 10, 'a short hourly block was padded');
});

/* ---------------- the words ---------------- */

test('every word the weather card uses exists in all four languages, and a hint has its own sentence for each kind', () => {
  const I = H.i18nValues(), src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', '16a-weather.js'), 'utf8');
  const used = new Set([...src.matchAll(/t\('(wx[A-Za-z0-9_]+)'\)/g)].map(m => m[1]));
  for (let i = 0; i <= 4; i++) used.add('wxUv' + i);
  for (let i = 0; i <= 5; i++) used.add('wxAqi' + i);
  ['wxN', 'wxNE', 'wxE', 'wxSE', 'wxS', 'wxSW', 'wxW', 'wxNW', 'wxModeTemp', 'wxModeRain', 'wxModeWind', 'wxModeAir', 'wxDistricts', 'wxTitleSuffix', 'wxSearchPh', 'wxLoading', 'wxFail',
   'wxHint_raining', 'wxHint_rain', 'wxHint_gust', 'wxHint_ferry', 'wxHint_hot', 'wxHint_cold', 'wxHint_uv', 'wxHint_air'].forEach(k => used.add(k));
  assert.ok(used.size >= 50, 'the scan found only ' + used.size + ' keys: the test is not looking at what it thinks');
  for (const L of ['en', 'tr', 'ar', 'fr']) {
    const missing = [...used].filter(k => !I[L][k] || !String(I[L][k]).trim());
    assert.deepStrictEqual(missing, [], L + ' is missing: ' + missing.join(', '));
  }
  // the hints keep their holes in every language, so the hour and the number are not lost in translation
  for (const L of ['en', 'tr', 'ar', 'fr']) {
    assert.ok(/\{at\}/.test(I[L].wxHint_rain) && /\{v\}/.test(I[L].wxHint_rain), L + ': the rain hint lost its time or chance');
    assert.ok(/\{at\}/.test(I[L].wxHint_gust) && /\{v\}/.test(I[L].wxHint_gust), L + ': the gust hint lost its time or speed');
    assert.ok(/\{at\}/.test(I[L].wxHint_ferry) && /\{v\}/.test(I[L].wxHint_ferry), L + ': the ferry hint lost its time or speed');
    ['wxHint_hot', 'wxHint_cold', 'wxHint_uv', 'wxHint_air'].forEach(k => assert.ok(/\{v\}/.test(I[L][k]), L + ': ' + k + ' lost its number'));
  }
  assert.ok(/ferries may be held back/.test(I.en.wxHint_ferry), 'the ferry hint must say "may", not "will"');
  assert.ok(/not issued warnings/.test(I.en.wxHintNote), 'the hints must say they are not official warnings');
});

/* ---------------- every city ---------------- */

test('every city has places to ask about, inside its own box, and the card names the city rather than İstanbul', () => {
  const cities = H.cities(), s = H.appScript(), html = H.html();
  for (const id of Object.keys(cities)) {
    const c = cities[id];
    assert.ok(c.center && c.center.length === 2, id + ': no centre for the hero');
    if (id === 'istanbul') continue;                       // İstanbul's districts are in the script, the rest are in cities.json
    assert.ok(Array.isArray(c.districts) && c.districts.length >= 8, id + ': too few districts for a weather list');
    for (const [name, la, lo] of c.districts) {
      assert.ok(name && typeof la === 'number' && typeof lo === 'number', id + ': a district is malformed');
      // districts are the whole PROVINCE (Beypazarı is 150 km from Ankara's centre), so this is a check for a typo — a sign, a swapped pair — not for the city limits
      assert.ok(la >= c.box.s - 1.5 && la <= c.box.n + 1.5 && lo >= c.box.w - 1.5 && lo <= c.box.e + 1.5, id + ': ' + name + ' is nowhere near the city: ' + la + ',' + lo);
    }
  }
  const ist = /const WX_DISTRICTS = CITY\.districts \|\| \[([\s\S]*?)\];/.exec(s);
  assert.ok(ist && (ist[1].match(/\['/g) || []).length === 39, 'İstanbul no longer has its 39 districts');
  assert.ok(/const WX_PLACES = \[\[CITY\.name, CITY\.center\[0\], CITY\.center\[1\]\]\]\.concat\(WX_DISTRICTS\);/.test(s), 'the first place is not the city itself');
  assert.ok(/function wxSetTitle\(\) \{ const t0 = document\.getElementById\('wxTitle'\); if \(t0\) t0\.textContent = CITY\.name \+ ' · ' \+ t\('wxTitleSuffix'\); \}/.test(s), 'the title does not use the city\'s name');
  assert.ok(/<div class="sec" id="wxTitle">/.test(html) && !/data-i18n="wxTitle"/.test(html), 'the title is still the fixed "İstanbul" string from the language table');
});

test('the weather code left 16-intercity.js, and the card keeps the ids the rest of the page reaches for', () => {
  const s = H.appScript(), html = H.html();
  assert.strictEqual((s.match(/const weatherLayer = /g) || []).length, 1, 'weatherLayer is defined more than once');
  assert.strictEqual((s.match(/function ensureWeather\(\)/g) || []).length, 1);
  for (const id of ['wxHero', 'wxHintsBox', 'wxHourlyBox', 'wxDailyBox', 'wxModes', 'wxSearch', 'wxRefresh', 'wxUpd', 'wxList', 'wxClock', 'wxDate', 'wxTitle'])
    assert.ok(new RegExp('id="' + id + '"').test(html), 'the card lost #' + id);
  assert.strictEqual((html.match(/data-m="(temp|rain|wind|air)"/g) || []).length, 4, 'the four modes are not all offered');
  // the layers card steps aside on desktop only
  assert.ok(/if\(!IS_MOBILE\) document\.getElementById\('cardLayers'\)\.style\.display = \(t==='weather'\) \? 'none' : '';/.test(s), 'the layers card rule changed');
  // air quality can fail without taking the weather with it
  assert.ok(/\/\* no air quality: the rest stands \*\//.test(s), 'an air-quality failure is no longer survivable');
});

test('motion is for show only: the scenes are CSS, and switch off with reduced motion', () => {
  const css = H.appStyle();
  assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important;/.test(css), 'the global reduced-motion switch is gone');
  assert.ok(/body\.reduce-motion \*\{animation-duration:\.001ms!important;/.test(css), 'the in-app reduce-motion switch is gone');
  for (const k of ['wxSun', 'wxDrift', 'wxRain', 'wxSnow', 'wxFlash']) assert.ok(new RegExp('@keyframes ' + k + '\\{').test(css), k + ' animation missing');
  assert.ok(/\.k-storm \.wx-fx i:nth-child\(3\)\{[^}]*animation:wxFlash 7s infinite/.test(css), 'the storm does not flash');
  // the rain is confined to the sky part of the hero, so the numbers below stay clean
  assert.ok(/\.k-rain \.wx-fx i:nth-child\(4\),\.k-storm \.wx-fx i:nth-child\(4\)\{opacity:\.\d+;inset:-20px 0 \d+% 0;/.test(css), 'rain is drawn over the whole card again');
});
