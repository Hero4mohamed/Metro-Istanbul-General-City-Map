/* ===========================================================================
   WEATHER — the Weather tab: the city at a glance, then district by district.

   Every city the app covers has a list of districts (CITY.districts), and every one of them is asked about in
   ONE request to Open-Meteo (keyless, CORS-open, CC-BY): what it is like now, the next 24 hours, the next
   7 days. Air quality is a second request to its sister service. Nothing is invented and nothing is stored:
   a number on screen is a number that came back, and a "hint" is arithmetic on those numbers with its
   threshold written down below, not a warning anyone issued. (Official warnings are the State Meteorological
   Service's — mgm.gov.tr — and the card links to them.)

   One place is always "selected": the city centre until a district is picked. The hero, the hourly strip and the
   week all describe the selected place; the list and the map describe every district at once, in whichever of
   four modes — temperature, rain, wind, air — is chosen.
   =========================================================================== */
/* ==WEATHER-PURE-START== */
const WX_FIELDS = {
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
  hourly:  'temperature_2m,precipitation_probability,weather_code,wind_gusts_10m,is_day',
  daily:   'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,uv_index_max,sunrise,sunset',
};
/* points: [[lat, lng], ...]. One request for all of them; the answer is a list in the same order. */
function wxForecastURL(points) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + points.map(function (p) { return p[0]; }).join(',') +
    '&longitude=' + points.map(function (p) { return p[1]; }).join(',') +
    '&current=' + WX_FIELDS.current + '&hourly=' + WX_FIELDS.hourly + '&daily=' + WX_FIELDS.daily +
    '&forecast_hours=24&forecast_days=7&timezone=Europe%2FIstanbul';
}
function wxAirURL(points) {
  return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + points.map(function (p) { return p[0]; }).join(',') +
    '&longitude=' + points.map(function (p) { return p[1]; }).join(',') +
    '&current=european_aqi,pm10,pm2_5&timezone=Europe%2FIstanbul';
}
/* The answer for one place, or null when it is missing the fields everything else leans on. Open-Meteo answers a
   single location with an object and several with a list. */
function wxParse(json, n) {
  const list = Array.isArray(json) ? json : [json], out = [];
  for (let i = 0; i < n; i++) {
    const x = list[i];
    out.push(x && x.current && typeof x.current.temperature_2m === 'number' ? { cur: x.current, hourly: x.hourly || null, daily: x.daily || null } : null);
  }
  return out;
}
/* WMO weather code -> a picture, the i18n key of its name, and a coarse kind that drives the scene */
function wxCode(code, isDay) {
  const day = isDay !== 0;
  if (code === 0) return { emo: day ? '☀️' : '🌙', key: 'wx0', kind: 'clear' };
  if (code === 1) return { emo: day ? '🌤️' : '🌙', key: 'wx1', kind: 'clear' };
  if (code === 2) return { emo: day ? '⛅' : '☁️', key: 'wx2', kind: 'cloud' };
  if (code === 3) return { emo: '☁️', key: 'wx3', kind: 'cloud' };
  if (code === 45 || code === 48) return { emo: '🌫️', key: 'wx45', kind: 'fog' };
  if (code >= 51 && code <= 57) return { emo: day ? '🌦️' : '🌧️', key: 'wx51', kind: 'rain' };
  if (code >= 61 && code <= 67) return { emo: '🌧️', key: 'wx61', kind: 'rain' };
  if (code >= 71 && code <= 77) return { emo: '🌨️', key: 'wx71', kind: 'snow' };
  if (code >= 80 && code <= 82) return { emo: '🌧️', key: 'wx80', kind: 'rain' };
  if (code === 85 || code === 86) return { emo: '🌨️', key: 'wx71', kind: 'snow' };
  if (code >= 95) return { emo: '⛈️', key: 'wx95', kind: 'storm' };
  return { emo: '🌡️', key: 'wx1', kind: 'cloud' };
}
function _lerp(a, b, f) { return a + (b - a) * f; }
function _hex(r, g, b) { return '#' + [r, g, b].map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join(''); }
/* a colour scale: stops are [value, [r,g,b]], ascending; the colour between two stops is a straight blend */
function wxScale(stops, v) {
  if (v <= stops[0][0]) return _hex.apply(null, stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], f = (v - a[0]) / (b[0] - a[0]);
      return _hex(_lerp(a[1][0], b[1][0], f), _lerp(a[1][1], b[1][1], f), _lerp(a[1][2], b[1][2], f));
    }
  }
  return _hex.apply(null, stops[stops.length - 1][1]);
}
const WX_TEMP_STOPS = [[-10, [122, 162, 255]], [0, [95, 196, 255]], [8, [79, 212, 184]], [16, [125, 220, 122]], [22, [242, 213, 90]], [28, [245, 161, 74]], [34, [239, 106, 74]], [40, [216, 58, 90]]];
const WX_WIND_STOPS = [[0, [111, 211, 160]], [15, [111, 211, 160]], [30, [242, 213, 90]], [50, [245, 161, 74]], [70, [239, 90, 90]]];
const WX_RAIN_STOPS = [[0, [120, 130, 150]], [30, [110, 170, 230]], [60, [70, 150, 245]], [100, [60, 110, 255]]];
function wxTempColor(t) { return wxScale(WX_TEMP_STOPS, t); }
function wxWindColor(k) { return wxScale(WX_WIND_STOPS, k); }
function wxRainColor(p) { return wxScale(WX_RAIN_STOPS, p); }
/* The European Air Quality Index, with the agency's own bands and colours (EEA): 0-20 good ... above 100 extremely poor. */
const WX_AQI_BANDS = [[20, 'good', '#50F0E6'], [40, 'fair', '#50CCAA'], [60, 'moderate', '#F0E641'], [80, 'poor', '#FF5050'], [100, 'very poor', '#960032'], [Infinity, 'extremely poor', '#7D2181']];
function wxAqiBand(v) { for (let i = 0; i < WX_AQI_BANDS.length; i++) if (v <= WX_AQI_BANDS[i][0]) return { i: i, key: 'wxAqi' + i, color: WX_AQI_BANDS[i][2] }; return { i: 5, key: 'wxAqi5', color: WX_AQI_BANDS[5][2] }; }
/* The WHO's UV bands: 0-2 low, 3-5 moderate, 6-7 high, 8-10 very high, 11+ extreme */
function wxUvBand(u) { return u < 3 ? 0 : u < 6 ? 1 : u < 8 ? 2 : u < 11 ? 3 : 4; }
// the compass point wind COMES FROM, 0 = north .. 7 = north-west
function wxCompass(deg) { return Math.round((((deg % 360) + 360) % 360) / 45) % 8; }
/* 'YYYY-MM-DDTHH:MM' (local) -> minutes into the day */
function wxMin(iso) { const m = /T(\d{2}):(\d{2})/.exec(iso || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
/* How far through the daylight it is, 0..1, or null before sunrise and after sunset (when the sun is not in the sky). */
function wxDayFrac(nowMin, riseIso, setIso) {
  const a = wxMin(riseIso), b = wxMin(setIso);
  if (a == null || b == null || b <= a || nowMin < a || nowMin > b) return null;
  return (nowMin - a) / (b - a);
}
/* where a day's low-high bar sits inside the week's range, as percentages */
function wxRange(lo, hi, weekLo, weekHi) {
  const span = Math.max(1, weekHi - weekLo);
  return { left: Math.max(0, Math.min(100, (lo - weekLo) / span * 100)), width: Math.max(4, Math.min(100, (hi - lo) / span * 100)) };
}
/* ---- hints: arithmetic on the forecast, with the thresholds in plain sight. Not warnings. ------------------
     rain   a chance of 60% or more in any of the next 12 hours (or it is raining now)
     gust   gusts of 50 km/h or more in the next 24 hours (a strong breeze begins near 50)
     ferry  gusts of 55 km/h or more: strong wind is what ferries are held back for
     hot    a high of 35 or more; cold: a low of 0 or less
     uv     today's UV index 8 or more (very high)
     air    European AQI 60 or more (poor or worse)
   Returns [{ k, at?, v? }] most useful first, at most four. */
function wxHints(item, aqi) {
  const out = [], c = item.cur, H = item.hourly, D = item.daily;
  const hh = function (iso) { return (iso || '').slice(11, 13) + ':00'; };
  if (c.precipitation > 0.1) out.push({ k: 'raining' });
  else if (H && H.precipitation_probability) {
    const n = Math.min(12, H.precipitation_probability.length);
    for (let i = 1; i < n; i++) if (H.precipitation_probability[i] >= 60) { out.push({ k: 'rain', at: hh(H.time[i]), v: H.precipitation_probability[i] }); break; }
  }
  if (H && H.wind_gusts_10m && H.wind_gusts_10m.length) {
    let mx = 0, at = 0;
    H.wind_gusts_10m.forEach(function (g, i) { if (g > mx) { mx = g; at = i; } });
    if (mx >= 55) out.push({ k: 'ferry', at: hh(H.time[at]), v: Math.round(mx) });
    else if (mx >= 50) out.push({ k: 'gust', at: hh(H.time[at]), v: Math.round(mx) });
  }
  if (D && D.temperature_2m_max && D.temperature_2m_max[0] >= 35) out.push({ k: 'hot', v: Math.round(D.temperature_2m_max[0]) });
  if (D && D.temperature_2m_min && D.temperature_2m_min[0] <= 0) out.push({ k: 'cold', v: Math.round(D.temperature_2m_min[0]) });
  if (D && D.uv_index_max && D.uv_index_max[0] >= 8) out.push({ k: 'uv', v: Math.round(D.uv_index_max[0]) });
  if (aqi && typeof aqi.european_aqi === 'number' && aqi.european_aqi >= 60) out.push({ k: 'air', v: Math.round(aqi.european_aqi) });
  return out.slice(0, 4);
}
/* the next `n` hours as rows, starting at the current hour, from the hourly block */
function wxHourRows(H, n) {
  if (!H || !H.time) return [];
  const rows = [];
  for (let i = 0; i < Math.min(n, H.time.length); i++)
    rows.push({ hh: H.time[i].slice(11, 13), t: H.temperature_2m[i], p: H.precipitation_probability ? H.precipitation_probability[i] : null,
                code: H.weather_code ? H.weather_code[i] : null, day: H.is_day ? H.is_day[i] : 1 });
  return rows;
}
/* ==WEATHER-PURE-END== */

/* ---- state -------------------------------------------------------------------------------------- */
// the places asked about: the city centre first, then every district
const WX_DISTRICTS = CITY.districts || [
  ['Adalar',40.8760,29.0891],['Arnavutköy',41.1840,28.7400],['Ataşehir',40.9923,29.1274],
  ['Avcılar',40.9800,28.7170],['Bağcılar',41.0340,28.8560],['Bahçelievler',41.0020,28.8600],
  ['Bakırköy',40.9820,28.8720],['Başakşehir',41.0930,28.8020],['Bayrampaşa',41.0460,28.9020],
  ['Beşiktaş',41.0430,29.0090],['Beykoz',41.1340,29.0920],['Beylikdüzü',41.0010,28.6420],
  ['Beyoğlu',41.0370,28.9770],['Büyükçekmece',41.0200,28.5850],['Çatalca',41.1430,28.4610],
  ['Çekmeköy',41.0360,29.1770],['Esenler',41.0430,28.8760],['Esenyurt',41.0340,28.6800],
  ['Eyüpsultan',41.0480,28.9340],['Fatih',41.0190,28.9400],['Gaziosmanpaşa',41.0580,28.9120],
  ['Güngören',41.0190,28.8820],['Kadıköy',40.9900,29.0300],['Kağıthane',41.0860,28.9710],
  ['Kartal',40.9060,29.1900],['Küçükçekmece',40.9990,28.7760],['Maltepe',40.9350,29.1300],
  ['Pendik',40.8780,29.2510],['Sancaktepe',41.0020,29.2310],['Sarıyer',41.1670,29.0570],
  ['Silivri',41.0730,28.2460],['Sultanbeyli',40.9600,29.2710],['Sultangazi',41.1060,28.8680],
  ['Şile',41.1760,29.6130],['Şişli',41.0600,28.9870],['Tuzla',40.8160,29.3000],
  ['Ümraniye',41.0250,29.0960],['Üsküdar',41.0230,29.0150],['Zeytinburnu',40.9940,28.9050]
];
const WX_PLACES = [[CITY.name, CITY.center[0], CITY.center[1]]].concat(WX_DISTRICTS);   // index 0 is the city itself
const weatherLayer = L.layerGroup();
let wxData = null;                 // [{cur, hourly, daily} | null] parallel to WX_PLACES
let wxAirQ = null;                  // [{european_aqi, pm10, pm2_5} | null] parallel to WX_PLACES, or null
let wxFetchedAt = 0, wxLoading = false;
let wxSel = 0;                     // the selected place (0 = the city)
let wxMode = 'temp';               // temp | rain | wind | air
function wxSetTitle() { const t0 = document.getElementById('wxTitle'); if (t0) t0.textContent = CITY.name + ' · ' + t('wxTitleSuffix'); }
function ensureWeather() {
  wxSetTitle();
  if (wxData && Date.now() - wxFetchedAt < 10 * 60 * 1000) { renderWeather(); return; }
  fetchWeather();
}
async function fetchWeather() {
  if (wxLoading) return; wxLoading = true;
  const hero = document.getElementById('wxHero');
  if (!wxData && hero) hero.innerHTML = '<div class="none">' + t('wxLoading') + '</div>';
  const pts = WX_PLACES.map(function (p) { return [p[1], p[2]]; });
  try {
    const r = await fetch(wxForecastURL(pts)); if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = wxParse(await r.json(), pts.length);
    if (!data[0]) throw new Error('no data for the city');
    wxData = data; wxFetchedAt = Date.now();
    renderWeather();
  } catch (e) { if (!wxData && hero) hero.innerHTML = '<div class="none">' + t('wxFail') + '</div>'; }
  wxLoading = false;
  // air quality is a nicety: asked for after the weather is on screen, and its failure costs nothing
  try {
    const r = await fetch(wxAirURL(pts));
    if (r.ok) { const j = await r.json(), list = Array.isArray(j) ? j : [j]; wxAirQ = pts.map(function (_, i) { return list[i] && list[i].current ? list[i].current : null; }); renderWeather(); }
  } catch (e) { /* no air quality: the rest stands */ }
}

/* ---- rendering ---------------------------------------------------------------------------------- */
const WX_COMPASS = ['wxN', 'wxNE', 'wxE', 'wxSE', 'wxS', 'wxSW', 'wxW', 'wxNW'];
function wxLoc() { return LOCALE[lang] || 'en-GB'; }
function wxFmtTime(iso) { return iso ? iso.slice(11, 16) : '—'; }
function wxR(v) { return Math.round(v); }
function wxPlace(i) { return wxData && wxData[i] ? Object.assign({ name: WX_PLACES[i][0], lat: WX_PLACES[i][1], lng: WX_PLACES[i][2], i: i }, wxData[i]) : null; }
// the arrow shows where the wind is GOING (it blows from `deg`), which is how people read wind
function wxArrow(deg) { return '<span class="wx-arrow" style="transform:rotate(' + ((deg + 180) % 360) + 'deg)">↑</span>'; }

function wxArcHTML(p) {
  const D = p.daily; if (!D || !D.sunrise) return '';
  const frac = wxDayFrac(nowIstanbulMin(), D.sunrise[0], D.sunset[0]);
  // the sun's path is a half-circle; the dot sits `frac` of the way along it, and is a moon-grey dot when the sun is down
  const W = 200, Hh = 54, r = 90, cx = 100, cy = 54;
  const ang = Math.PI * (1 - (frac == null ? 0 : frac)), x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang) * 0.58;
  return '<svg class="wx-arc" viewBox="0 0 ' + W + ' ' + (Hh + 6) + '" aria-hidden="true">' +
    '<path d="M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + (r * 0.58) + ' 0 0 1 ' + (cx + r) + ' ' + cy + '" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.6" stroke-dasharray="3 4"/>' +
    (frac == null ? '' : '<path d="M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + (r * 0.58) + ' 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + '" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round"/>') +
    '<circle cx="' + (frac == null ? cx + r - 4 : x.toFixed(1)) + '" cy="' + (frac == null ? cy : y.toFixed(1)) + '" r="5" fill="' + (frac == null ? '#8E9AB0' : '#FBBF24') + '"' + (frac == null ? '' : ' class="wx-sun"') + '/>' +
    '</svg>';
}
function wxStatHTML(ico, label, val, sub) {
  return '<div class="wx-st"><span class="wx-st-i">' + ico + '</span><span class="wx-st-v">' + val + '</span><span class="wx-st-l">' + svgEsc(label) + (sub ? ' <em>' + sub + '</em>' : '') + '</span></div>';
}
function wxHeroHTML(p) {
  const c = p.cur, w = wxCode(c.weather_code, c.is_day), D = p.daily || {}, air = wxAirQ && wxAirQ[p.i];
  const hi = D.temperature_2m_max ? wxR(D.temperature_2m_max[0]) : null, lo = D.temperature_2m_min ? wxR(D.temperature_2m_min[0]) : null;
  const uv = D.uv_index_max ? D.uv_index_max[0] : null;
  const aq = air && typeof air.european_aqi === 'number' ? wxAqiBand(air.european_aqi) : null;
  const dir = wxCompass(c.wind_direction_10m);
  const back = p.i !== 0 ? '<button class="wx-back" id="wxBack">← ' + svgEsc(CITY.name) + '</button>' : '';
  return '<div class="wx-hero ' + (c.is_day === 0 ? 'night' : 'day') + ' k-' + w.kind + '" role="group" aria-label="' + attrEsc(p.name) + '">' +
    '<div class="wx-fx" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
    '<div class="wx-h-top"><b>' + svgEsc(p.name) + '</b>' + back + '</div>' +
    '<div class="wx-h-main"><span class="wx-h-emo">' + w.emo + '</span><span class="wx-h-temp" style="color:' + wxTempColor(c.temperature_2m) + '">' + wxR(c.temperature_2m) + '°</span>' +
    '<span class="wx-h-side"><span class="wx-h-cond">' + svgEsc(t(w.key)) + '</span>' +
    '<span class="wx-h-sub">' + svgEsc(t('wxFeels')) + ' ' + wxR(c.apparent_temperature) + '°' + (hi != null ? ' · ' + svgEsc(t('wxHigh')) + ' ' + hi + '° · ' + svgEsc(t('wxLow')) + ' ' + lo + '°' : '') + '</span></span></div>' +
    wxArcHTML(p) +
    (D.sunrise ? '<div class="wx-sunrow"><span>🌅 ' + svgEsc(t('wxSunrise')) + ' ' + wxFmtTime(D.sunrise[0]) + '</span><span>🌇 ' + svgEsc(t('wxSunset')) + ' ' + wxFmtTime(D.sunset[0]) + '</span></div>' : '') +
    '<div class="wx-stats">' +
      wxStatHTML(wxArrow(c.wind_direction_10m), t('wxWind'), wxR(c.wind_speed_10m) + ' <small>km/h</small>', svgEsc(t(WX_COMPASS[dir])) + (c.wind_gusts_10m != null ? ' · ' + svgEsc(t('wxGust')) + ' ' + wxR(c.wind_gusts_10m) : '')) +
      wxStatHTML('💧', t('wxHumid'), c.relative_humidity_2m + '<small>%</small>', '') +
      wxStatHTML('🌡️', t('wxPress'), wxR(c.pressure_msl) + ' <small>hPa</small>', '') +
      wxStatHTML('☁️', t('wxCloud'), c.cloud_cover + '<small>%</small>', '') +
      wxStatHTML('🌧️', t('wxPrecip'), (c.precipitation || 0) + ' <small>mm</small>', D.precipitation_sum ? svgEsc(t('wxToday')) + ' ' + D.precipitation_sum[0] + ' mm' : '') +
      (uv != null ? wxStatHTML('🕶️', t('wxUV'), uv.toFixed(0), svgEsc(t('wxUv' + wxUvBand(uv)))) : '') +
      (aq ? wxStatHTML('🍃', t('wxAir'), '<span class="wx-aqi" style="background:' + aq.color + '"></span>' + wxR(air.european_aqi), svgEsc(t(aq.key))) : '') +
    '</div></div>';
}
function wxHintsHTML(p) {
  const hs = wxHints(p, wxAirQ && wxAirQ[p.i]); if (!hs.length) return '';
  const icon = { raining: '🌧️', rain: '☔', gust: '💨', ferry: '⛴️', hot: '🥵', cold: '🥶', uv: '🕶️', air: '😷' };
  return '<div class="wx-hints">' + hs.map(function (h) {
    return '<span class="wx-hint k-' + h.k + '">' + icon[h.k] + ' ' + svgEsc(t('wxHint_' + h.k).replace('{at}', h.at || '').replace('{v}', h.v != null ? h.v : '')) + '</span>';
  }).join('') + '</div><div class="wx-hintnote">' + svgEsc(t('wxHintNote')) + ' <a href="https://www.mgm.gov.tr" target="_blank" rel="noopener">mgm.gov.tr ↗</a></div>';
}
function wxHourlyHTML(p) {
  const rows = wxHourRows(p.hourly, 24); if (!rows.length) return '';
  return '<div class="wx-sechd">' + svgEsc(t('wxHourly')) + '</div><div class="wx-hourly" role="list">' + rows.map(function (r, i) {
    const w = wxCode(r.code, r.day);
    return '<div class="wx-hr" role="listitem"><span class="wx-hr-t">' + (i === 0 ? svgEsc(t('wxNow')) : r.hh) + '</span><span class="wx-hr-i">' + w.emo + '</span>' +
      '<b style="color:' + wxTempColor(r.t) + '">' + wxR(r.t) + '°</b>' +
      (r.p != null ? '<span class="wx-hr-p" title="' + attrEsc(t('wxRainChance')) + '"><i style="height:' + Math.max(2, r.p * 0.28) + 'px;background:' + wxRainColor(r.p) + '"></i><small>' + (r.p >= 10 ? r.p + '%' : '') + '</small></span>' : '') + '</div>';
  }).join('') + '</div>';
}
function wxDailyHTML(p) {
  const D = p.daily; if (!D || !D.time) return '';
  const lows = D.temperature_2m_min, highs = D.temperature_2m_max, wlo = Math.min.apply(null, lows), whi = Math.max.apply(null, highs);
  const fmt = new Intl.DateTimeFormat(wxLoc(), { weekday: 'short', timeZone: 'Europe/Istanbul' });
  return '<div class="wx-sechd">' + svgEsc(t('wxWeek')) + '</div><div class="wx-daily">' + D.time.map(function (day, i) {
    const w = wxCode(D.weather_code[i], 1), rg = wxRange(lows[i], highs[i], wlo, whi), pp = D.precipitation_probability_max ? D.precipitation_probability_max[i] : null;
    return '<div class="wx-dy"><span class="wx-dy-d">' + (i === 0 ? svgEsc(t('wxToday')) : fmt.format(new Date(day + 'T12:00:00+03:00'))) + '</span>' +
      '<span class="wx-dy-i" title="' + attrEsc(t(w.key)) + '">' + w.emo + '</span>' +
      '<span class="wx-dy-p">' + (pp != null && pp >= 10 ? '<em style="color:' + wxRainColor(pp) + '">' + pp + '%</em>' : '') + '</span>' +
      '<span class="wx-dy-lo">' + wxR(lows[i]) + '°</span>' +
      '<span class="wx-dy-bar"><i style="left:' + rg.left.toFixed(1) + '%;width:' + rg.width.toFixed(1) + '%;background:linear-gradient(90deg,' + wxTempColor(lows[i]) + ',' + wxTempColor(highs[i]) + ')"></i></span>' +
      '<span class="wx-dy-hi">' + wxR(highs[i]) + '°</span></div>';
  }).join('') + '</div>';
}
/* what a district shows in the current mode: its big number, its colour, and the line under its name */
function wxModeValue(p) {
  const c = p.cur;
  if (wxMode === 'rain') {
    const pp = p.hourly && p.hourly.precipitation_probability ? Math.max.apply(null, p.hourly.precipitation_probability.slice(0, 12)) : (p.daily && p.daily.precipitation_probability_max ? p.daily.precipitation_probability_max[0] : 0);
    return { text: pp + '%', n: pp, color: wxRainColor(pp), sort: pp };
  }
  if (wxMode === 'wind') return { text: wxR(c.wind_speed_10m) + '', n: c.wind_speed_10m, color: wxWindColor(c.wind_gusts_10m != null ? c.wind_gusts_10m : c.wind_speed_10m), sort: c.wind_speed_10m, arrow: c.wind_direction_10m };
  if (wxMode === 'air') {
    const a = wxAirQ && wxAirQ[p.i]; if (!a || typeof a.european_aqi !== 'number') return { text: '–', n: null, color: '#8E9AB0', sort: -1 };
    return { text: wxR(a.european_aqi) + '', n: a.european_aqi, color: wxAqiBand(a.european_aqi).color, sort: a.european_aqi };
  }
  return { text: wxR(c.temperature_2m) + '°', n: c.temperature_2m, color: wxTempColor(c.temperature_2m), sort: c.temperature_2m };
}
function wxRowsHTML(places, extremes) {
  return places.map(function (p) {
    const w = wxCode(p.cur.weather_code, p.cur.is_day), v = wxModeValue(p), tag = extremes[p.i] ? ' <span class="wx-tag">' + extremes[p.i] + '</span>' : '';
    return '<div class="wx-row' + (p.i === wxSel ? ' sel' : '') + '" data-i="' + p.i + '" tabindex="0" role="button">' +
      '<span class="wx-emo">' + w.emo + '</span>' +
      '<span class="wx-nm">' + svgEsc(p.name) + tag + '<small>' + svgEsc(t(w.key)) + '</small></span>' +
      '<span class="wx-t" style="color:' + v.color + '">' + (v.arrow != null ? wxArrow(v.arrow) + ' ' : '') + v.text + '</span>' +
      '<span class="wx-sub">' + (wxMode === 'temp' ? '🌡️ ' + wxR(p.cur.apparent_temperature) + '°<br>' : '') + '💨 ' + wxR(p.cur.wind_speed_10m) + ' km/h<br>💧 ' + p.cur.relative_humidity_2m + '%</span></div>';
  }).join('');
}
function renderWeather() {
  wxSetTitle();
  if (!wxData || !wxData[0]) return;
  if (!wxData[wxSel]) wxSel = 0;
  const sel = wxPlace(wxSel);
  const hero = document.getElementById('wxHero'); if (hero) hero.innerHTML = wxHeroHTML(sel);
  const hints = document.getElementById('wxHintsBox'); if (hints) hints.innerHTML = wxHintsHTML(sel);
  const hr = document.getElementById('wxHourlyBox'); if (hr) hr.innerHTML = wxHourlyHTML(sel);
  const dy = document.getElementById('wxDailyBox'); if (dy) dy.innerHTML = wxDailyHTML(sel);
  document.querySelectorAll('#wxModes button').forEach(function (b) { b.classList.toggle('active', b.dataset.m === wxMode); });
  // the districts, in the current mode; the extremes are tagged so a glance finds them
  const q = fold(document.getElementById('wxSearch').value || '');
  const all = WX_DISTRICTS.map(function (_, k) { return wxPlace(k + 1); }).filter(Boolean);
  const ex = {};
  if (wxMode === 'temp' && all.length > 3) {
    const byT = all.slice().sort(function (a, b) { return a.cur.temperature_2m - b.cur.temperature_2m; });
    ex[byT[0].i] = '❄ ' + t('wxCoolest'); ex[byT[byT.length - 1].i] = '🔥 ' + t('wxWarmest');
  } else if (wxMode === 'wind' && all.length > 3) {
    const byW = all.slice().sort(function (a, b) { return a.cur.wind_speed_10m - b.cur.wind_speed_10m; });
    ex[byW[byW.length - 1].i] = '💨 ' + t('wxWindiest');
  }
  const shown = all.filter(function (p) { return !q || fold(p.name).includes(q); });
  document.getElementById('wxList').innerHTML = shown.length ? wxRowsHTML(shown, ex) : '<div class="none">' + t('noLines') + '</div>';
  const upd = document.getElementById('wxUpd');
  if (upd) upd.textContent = t('wxUpdated') + ' ' + new Intl.DateTimeFormat(wxLoc(), timeOpts({ hour: '2-digit', minute: '2-digit' })).format(new Date(wxFetchedAt));
  wxWire();
  renderWeatherMap();
}
function wxWire() {
  const back = document.getElementById('wxBack'); if (back) back.addEventListener('click', function () { wxSel = 0; renderWeather(); map.flyTo(CITY.center, CITY.zoom, { duration: .6 }); });
  document.querySelectorAll('#wxList .wx-row').forEach(function (row) {
    const go = function () {
      wxSel = +row.dataset.i; renderWeather();
      map.flyTo([WX_PLACES[wxSel][1], WX_PLACES[wxSel][2]], Math.max(map.getZoom(), 12), { duration: .6 });
      const hero = document.getElementById('wxHero'); if (hero && hero.scrollIntoView) hero.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
/* ---- the map: one badge per district, coloured and filled by the chosen mode ------------------------- */
function renderWeatherMap() {
  weatherLayer.clearLayers();
  if (!wxData) return;
  const z = map.getZoom(), compact = z < 10, names = z >= 12;
  WX_DISTRICTS.forEach(function (d, k) {
    const p = wxPlace(k + 1); if (!p) return;
    const w = wxCode(p.cur.weather_code, p.cur.is_day), v = wxModeValue(p);
    const glyph = wxMode === 'wind' ? wxArrow(v.arrow) : (wxMode === 'rain' ? '💧' : (wxMode === 'air' ? '🍃' : w.emo));
    const body = (compact ? '' : glyph + ' ') + v.text + (wxMode === 'rain' && !compact ? '' : '') + (names ? '<small>' + svgEsc(d[0]) + '</small>' : '');
    const icon = L.divIcon({ className: 'wx-icon', iconSize: [names ? 96 : (compact ? 38 : 58), names ? 34 : 22], iconAnchor: [names ? 48 : (compact ? 19 : 29), names ? 17 : 11],
      html: '<div class="wx-badge' + (names ? ' named' : '') + (k + 1 === wxSel ? ' sel' : '') + '" style="--wc:' + v.color + '">' + body + '</div>' });
    const mk = L.marker([d[1], d[2]], { icon: icon, zIndexOffset: k + 1 === wxSel ? 1200 : 900 });
    mk.bindTooltip('<b>' + svgEsc(d[0]) + '</b><br>' + svgEsc(t(w.key)) + ' · ' + wxR(p.cur.temperature_2m) + '°C (' + svgEsc(t('wxFeels')) + ' ' + wxR(p.cur.apparent_temperature) + '°)<br>💨 ' + wxR(p.cur.wind_speed_10m) + ' km/h · 💧 ' + p.cur.relative_humidity_2m + '%',
      { className: 'lt', direction: 'top', offset: [0, -8] });
    mk.on('click', function () { wxSel = k + 1; renderWeather(); });
    mk.addTo(weatherLayer);
  });
}
map.on('zoomend', function () { if (typeof currentTab !== 'undefined' && currentTab === 'weather') renderWeatherMap(); });

// live city clock (the card's header): the time and date in İstanbul, which is the whole country's
setInterval(function () {
  const el = document.getElementById('wxClock'); if (!el || currentTab !== 'weather') return;
  const now = new Date();
  el.textContent = new Intl.DateTimeFormat(wxLoc(), timeOpts({ hour: '2-digit', minute: '2-digit', second: '2-digit' })).format(now);
  const de = document.getElementById('wxDate');
  if (de) de.textContent = new Intl.DateTimeFormat(wxLoc(), { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}, 1000);
document.getElementById('wxSearch').addEventListener('input', function () { renderWeather(); });
document.getElementById('wxRefresh').addEventListener('click', function () { wxFetchedAt = 0; fetchWeather(); });
document.getElementById('wxModes').addEventListener('click', function (e) {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  wxMode = b.dataset.m; renderWeather();
});

/* Named entry point for the browser smoke suite, in the spirit of setDisruptions(): the page's state lives in
   script-scoped bindings that are not properties of window, so what a test needs to drive has to be published on
   purpose. It swaps in a set of places the test supplies (same shape wxParse returns), so the whole tab — hero, hours,
   week, hints, list, map badges — can be exercised with no network. Client-side only and gone on reload. */
function setWeather(data, air) {
  wxData = data; wxAirQ = air || null; wxFetchedAt = Date.now(); wxSel = 0; wxMode = 'temp';
  renderWeather();
  return { places: WX_PLACES.length, badges: weatherLayer.getLayers().length };
}
// what the map is showing, as the badge markup the smoke suite reads back
function weatherProbe() {
  const badges = [];
  weatherLayer.eachLayer(function (l) { badges.push(l.options.icon.options.html); });
  return { places: WX_PLACES.length, mode: wxMode, selected: wxSel, badges: badges };
}
