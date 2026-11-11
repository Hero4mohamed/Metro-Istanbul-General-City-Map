/* ===========================================================================
   OFFLINE MAPS (V4.4.1)
   "The map must open and work whether there is Wi-Fi or not." After its first visit the app itself always opens (sw.js keeps every
   file of it). This file keeps the CITIES: for each one, its base map as one file (a pack, offline/<city>.pack, made by
   build-offline-packs.cjs) and the data files the app otherwise fetches when first needed (bus lines, places for search, land use).

   - İstanbul, İzmir and Ankara are kept WITHOUT BEING ASKED FOR: fetched in the background the first time the app runs.
   - The other cities are kept by choice: Settings > Map > Offline maps > Download.
   - Mobile data is the person's call: by default packs come down on Wi-Fi (or a cable); a switch allows mobile data too; and on a
     phone that is on mobile data (or cannot say what it is on) the app asks once, with two equal buttons, instead of deciding.
   - A pack that has been rebuilt (its date changed) is fetched again the same way.

   What still needs a connection, by its nature: service notices, weather, official timetables, the satellite layer, online place
   look-ups. The app says so where it matters; nothing here pretends otherwise.

   A website cannot arrive with a map already inside it: the packs come down on the first run. Only an app with the files packed
   INTO it would have them before first launch (see Play-Store-Readiness-Checklist.md in the records folder).
   =========================================================================== */
/* ==OFFLINE-PURE-START== */
const OFFLINE_DEFAULT = ['istanbul', 'izmir', 'ankara'];     // kept on the device without being asked for
const OFF_PACKS = 'raynet-packs-v1';                         // sw.js reads map tiles out of the packs stored in this cache
const OFF_STATIC = 'raynet-static-v1';                       // sw.js answers the app's own files from this cache
/* is this city to be kept? `pick` is what the person chose ({city: 1 | 0}); with no choice, the defaults are kept */
function offWanted(city, pick, info) {
  if (!info || !info[city] || !info[city].pack) return false;
  const p = pick ? pick[city] : undefined;
  return p === 1 || (p === undefined && OFFLINE_DEFAULT.indexOf(city) >= 0);
}
/* What the connection is, as far as the browser says: true = mobile data (or the person asked the browser to save data),
   false = Wi-Fi or a cable, null = the browser does not say (every iPhone, and most desktops). */
function offConn(nav) {
  const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
  if (!c) return null;
  if (c.saveData) return true;
  if (c.type === 'cellular') return true;
  if (c.type === 'wifi' || c.type === 'ethernet') return false;
  return null;
}
/* May a pack start downloading BY ITSELF? `pref`: 'any' = mobile data allowed, anything else = Wi-Fi only.
   Never by itself on mobile data unless allowed; on an unknown connection only on a computer (a phone that cannot tell is asked). */
function offMayAuto(pref, conn, phone) {
  if (pref === 'any') return true;
  if (conn === false) return true;
  if (conn === null) return !phone;
  return false;
}
const offMB = bytes => Math.max(1, Math.round(bytes / 1048576));
/* ==OFFLINE-PURE-END== */

const OFFLINE = __OFFLINE_JSON__;                            // per city: { pack, packBytes, bytes, v, data: [files] } (build.cjs)
const offState = {};                                         // city -> { state: 'none' | 'ready' | 'loading' | 'waiting' | 'error', pct }
const offRead = key => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } };
const offWrite = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} };
let offPick = offRead('irn_offline_pick'), offHave = offRead('irn_offline_have');
const offPref = () => (lsStr('irn_offline_net') === 'any' ? 'any' : 'wifi');
const offCities = () => CITY_IDS.filter(c => OFFLINE[c] && OFFLINE[c].pack);
const offUrl = city => new URL(OFFLINE[city].pack, location.href).href;
function offSet(city, state, pct) { offState[city] = { state: state, pct: pct || 0 }; offRender(); }
function offTellWorker() { try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('packsChanged'); } catch (e) {} }

/* what is really on the device: the stored packs, not what a note says was stored */
async function offRefresh() {
  if (!('caches' in window)) return;
  let cache; try { cache = await caches.open(OFF_PACKS); } catch (e) { return; }
  for (const c of offCities()) {
    if (offState[c] && offState[c].state === 'loading') continue;
    const hit = await cache.match(offUrl(c)).catch(() => null);
    offState[c] = { state: hit && offHave[c] === OFFLINE[c].v ? 'ready' : (offState[c] && offState[c].state === 'waiting' ? 'waiting' : 'none'), pct: 0 };
  }
  offRender();
}
/* fetch one city: its pack (with progress), then its data files; stored by the page so it works before the worker is in control */
async function offDownload(city) {
  const info = OFFLINE[city];
  if (!info || !info.pack || !('caches' in window) || (offState[city] && offState[city].state === 'loading')) return false;
  offSet(city, 'loading', 0);
  try {
    const r = await fetch(info.pack, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let blob;
    if (r.body && r.body.getReader) {
      const total = +r.headers.get('content-length') || info.packBytes || 1, reader = r.body.getReader(), parts = [];
      let got = 0, shown = -1;
      for (;;) {
        const step = await reader.read(); if (step.done) break;
        parts.push(step.value); got += step.value.length;
        const pct = Math.min(99, Math.floor(100 * got / total));
        if (pct !== shown) { shown = pct; offSet(city, 'loading', pct); }
      }
      blob = new Blob(parts, { type: 'application/octet-stream' });
    } else blob = await r.blob();
    const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (String.fromCharCode(magic[0], magic[1], magic[2], magic[3]) !== 'RNP1') throw new Error('not a map pack');     // an error page, a truncated file
    const packs = await caches.open(OFF_PACKS);
    await packs.put(offUrl(city), new Response(blob, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(blob.size) } }));
    const stat = await caches.open(OFF_STATIC);
    await Promise.all(info.data.map(f => fetch(f, { cache: 'no-cache' }).then(x => (x.ok ? stat.put(new URL(f, location.href).href, x) : null)).catch(() => null)));
    offHave[city] = info.v; offWrite('irn_offline_have', offHave);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // ask the browser to keep the maps when space runs short
    offTellWorker();
    offSet(city, 'ready');
    showToast(t('offDone').replace('{city}', CITIES[city].label));
    return true;
  } catch (e) {
    offSet(city, 'error');
    return false;
  }
}
async function offRemove(city) {
  offPick[city] = 0; offWrite('irn_offline_pick', offPick);
  delete offHave[city]; offWrite('irn_offline_have', offHave);
  try { const cache = await caches.open(OFF_PACKS); await cache.delete(offUrl(city)); } catch (e) {}
  offTellWorker();
  offSet(city, 'none');
}
/* the person pressed Download: keep this city from now on, and fetch it now whatever the connection (they just said so) */
function offChoose(city) {
  offPick[city] = 1; offWrite('irn_offline_pick', offPick);
  return offDownload(city);
}
/* what should be on the device and is not (or is out of date) */
function offMissing() {
  return offCities().filter(c => offWanted(c, offPick, OFFLINE) && !(offState[c] && (offState[c].state === 'ready' || offState[c].state === 'loading')));
}
let offAutoBusy = false;
async function offAuto() {
  if (offAutoBusy || !('caches' in window) || navigator.onLine === false) return;
  offAutoBusy = true;
  try {
    await offRefresh();
    const todo = offMissing();
    if (!todo.length) return;
    if (offMayAuto(offPref(), offConn(navigator), IS_MOBILE)) { for (const c of todo) await offDownload(c); return; }
    todo.forEach(c => { offState[c] = { state: 'waiting', pct: 0 }; });
    offRender();
    if (lsStr('irn_offline_asked') !== '1') offAsk(todo);
  } finally { offAutoBusy = false; }
}

/* ---- the one-time question, on a phone that is on mobile data or cannot say: two equal buttons, never a decision made for them ---- */
function offAsk(todo) {
  if (document.getElementById('offAsk')) return;
  const unknown = offConn(navigator) === null;
  const mb = offMB(todo.reduce((a, c) => a + OFFLINE[c].bytes, 0)), names = todo.map(c => CITIES[c].label).join(', ');
  const box = document.createElement('div');
  box.className = 'priv-notice glass off-ask'; box.id = 'offAsk'; box.setAttribute('role', 'region'); box.setAttribute('aria-labelledby', 'offAskTitle');
  box.innerHTML = '<h2 id="offAskTitle">' + svgEsc(t('offAskTitle')) + '</h2><p>' + svgEsc(t(unknown ? 'offAskBodyUnknown' : 'offAskBody').replace('{cities}', names).replace('{mb}', mb)) + '</p>' +
    '<div class="priv-btns"><button class="priv-btn" id="offAskWifi">' + svgEsc(t('offAskWifi')) + '</button><button class="priv-btn" id="offAskNow">' + svgEsc(t('offAskNow')) + '</button></div>';
  document.body.appendChild(box);
  const done = () => { try { localStorage.setItem('irn_offline_asked', '1'); } catch (e) {} box.remove(); };
  box.querySelector('#offAskNow').addEventListener('click', async () => { done(); for (const c of todo) await offDownload(c); });
  box.querySelector('#offAskWifi').addEventListener('click', () => { done(); showToast(t('offAskLater')); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(); showToast(t('offAskLater')); } });
  /* one thing at a time: after the welcome dialog and the privacy question */
  const free = () => !document.querySelector('.wc-overlay.show') && !document.querySelector('#privNotice.show');
  const show = () => { if (!box.isConnected) return; if (free()) box.classList.add('show'); else setTimeout(show, 1500); };
  show();
}

/* ---- Settings > Map > Offline maps ---- */
function offRender() {
  const list = document.getElementById('offPackList'); if (!list) return;
  const row = c => {
    const s = offState[c] || { state: 'none', pct: 0 }, auto = OFFLINE_DEFAULT.indexOf(c) >= 0;
    const status = s.state === 'ready' ? t('offReady') : s.state === 'loading' ? t('offLoading').replace('{p}', s.pct) : s.state === 'waiting' ? t('offWaiting') : s.state === 'error' ? t('offFailed') : t('offNone');
    const btn = s.state === 'ready' ? ['remove', t('offRemove'), 'ghost'] : s.state === 'loading' ? null : s.state === 'waiting' ? ['get', t('offNow'), ''] : s.state === 'error' ? ['get', t('offRetry'), ''] : ['get', t('offGet'), ''];
    return '<div class="offp-row" data-state="' + s.state + '"><div class="offp-t"><b>' + svgEsc(CITIES[c].label) + '</b>' + (auto ? ' <span class="offp-tag">' + svgEsc(t('offAutoTag')) + '</span>' : '') +
      '<small>' + svgEsc(offMB(OFFLINE[c].bytes) + ' MB · ' + status) + '</small>' +
      (s.state === 'loading' ? '<span class="offp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + s.pct + '"><i style="width:' + s.pct + '%"></i></span>' : '') + '</div>' +
      (btn ? '<button class="off-btn ' + btn[2] + '" data-off="' + btn[0] + '" data-city="' + attrEsc(c) + '">' + svgEsc(btn[1]) + '</button>' : '') + '</div>';
  };
  list.innerHTML = offCities().map(row).join('');
}
(function () {
  const list = document.getElementById('offPackList'), sw = document.getElementById('swOffData');
  if (list) list.addEventListener('click', e => {
    const b = e.target.closest('button[data-off]'); if (!b) return;
    if (b.dataset.off === 'remove') offRemove(b.dataset.city); else offChoose(b.dataset.city);
  });
  const paint = () => { if (sw) { const on = offPref() === 'any'; sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); } };
  if (sw) sw.addEventListener('click', () => {
    try { localStorage.setItem('irn_offline_net', offPref() === 'any' ? 'wifi' : 'any'); } catch (e) {}
    paint(); offAuto();
  });
  paint(); offRender();
  /* first run, a new pack, back online, or onto Wi-Fi: look again. Late enough that the map has drawn first. */
  setTimeout(offAuto, 5000);
  window.addEventListener('online', () => setTimeout(offAuto, 1500));
  const c = navigator.connection; if (c && c.addEventListener) c.addEventListener('change', () => setTimeout(offAuto, 1500));
})();
