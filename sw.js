/* İSTANBUL RAY-NET service worker — emitted by build.cjs with a fresh version per build,
   so every deploy activates immediately and the installed app self-updates.
   Strategy: NETWORK-FIRST for the page (updates always win; cached copy only when offline),
   stale-while-revalidate for static assets/CDNs, and NO caching for live data APIs. */
const VERSION = '20261104145151';
const SHELL  = 'raynet-shell-' + VERSION;
const STATIC = 'raynet-static-v1';
const STATIC_HOSTS = [];     // the page loads no CDN files any more (V4.3): Leaflet and the fonts are shipped with it
/* V4.3: every page of the app's own address must always come back as a 200, online or not. The Android app (a Trusted Web Activity) has
   no browser around it, and Chrome counts a page that cannot be loaded offline, or that answers 404 / 5xx, as a CRASH of that app.
   So the app page and the legal pages are fetched at install (they open offline although never opened), a failed or error answer
   falls back to the stored copy, and a page with no stored copy gets a small 200 page instead of an error.
   OFFLINE_PAGES is written by build.cjs from the legal folder (paths under the scope). */
const PAGES = 'raynet-pages-' + VERSION;
const OFFLINE_PAGES = ["legal/index.html","legal/index.tr.html","legal/privacy.html","legal/privacy.tr.html","legal/terms.html","legal/terms.tr.html","legal/storage.html","legal/storage.tr.html","legal/credits.html","legal/credits.tr.html","legal/accessibility.html","legal/accessibility.tr.html"];
const APP_PATH = (self.registration && self.registration.scope) ? new URL(self.registration.scope).pathname : '/';   // the app's own address, e.g. /Metro-Istanbul-General-City-Map/
/* v2, and the activate handler below drops v1. Tiles are cached by URL, so the CARTO entries
   would never be read again after the switch to Esri — but a phone that browsed the map during
   the outage is holding up to 3,000 cached "API KEY REQUIRED" images, and they would sit there
   occupying the cap until enough new tiles pushed them out. Naming a new cache reclaims that
   space on the next visit instead. */
const TILES  = 'raynet-tiles-v2';
const TILE_HOST = /(^|\.)(arcgisonline\.com|tile\.openstreetmap\.org)$/;
const TILE_CAP  = 3000;          // ~90 MB of 256px tiles; trimmed oldest-first
/* The vector map's tiles (and the tile index that names their current version) are cached as you browse, like the raster
   ones. A vector tile is small and its address carries the data's version, so a cached one is always right; the index is
   fetched fresh when there is a network and read from the cache when there is not. */
const VEC_HOST  = 'tiles.openfreemap.org';
const VEC_TILES = 'raynet-vtiles-v1';
const VEC_CAP   = 3000;          // the tile service's own ceiling for what an app keeps offline
let vecPuts = 0;
async function trimVec(){
  const c = await caches.open(VEC_TILES);
  const keys = await c.keys();
  if (keys.length > VEC_CAP) await Promise.all(keys.slice(0, keys.length - VEC_CAP).map(k => c.delete(k)));
}

/* Basemap tiles are cached AS YOU VIEW THEM, so an area you have actually looked at still
   draws when you are offline. Deliberately NOT a bulk download: mass-fetching a provider's
   tile pyramid breaks Esri's and OSM's usage policies. Everything else the app needs to
   plan a trip — network geometry, stations, fares, timetables — is already local. */
let tilePuts = 0;
async function trimTiles(){
  const c = await caches.open(TILES);
  const keys = await c.keys();                    // Cache API preserves insertion order
  if (keys.length <= TILE_CAP) return;
  const drop = keys.slice(0, keys.length - TILE_CAP);
  await Promise.all(drop.map(k => c.delete(k)));
}
// a tile-shaped placeholder so a gap reads as "not saved" rather than as a broken map
const OFFLINE_TILE = new Response(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
  '<rect width="256" height="256" fill="#11151c"/>' +
  '<path d="M0 0h256v256H0z" fill="none" stroke="#1b212b" stroke-width="2"/>' +
  '</svg>',
  { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });

const quiet = p => p.catch(() => {});                  // one page that cannot be fetched must not fail the install
const isHtml = r => { try { return /text\/html/i.test(r.headers.get('content-type') || ''); } catch (_) { return false; } };
async function precache() {
  const base = self.registration.scope;
  const shell = await caches.open(SHELL), pages = await caches.open(PAGES);
  await Promise.all([
    quiet(fetch(base).then(r => (r.ok ? shell.put('shell', r) : null))),
    ...OFFLINE_PAGES.map(p => { const u = new URL(p, base).href; return quiet(fetch(u).then(r => (r.ok && isHtml(r) ? pages.put(u, r) : null))); }),
  ]);
}
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(precache().catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('raynet-shell-') && k !== SHELL) ||
                                       (k.startsWith('raynet-pages-') && k !== PAGES) ||
                                       (k.startsWith('raynet-tiles-')  && k !== TILES))
                          .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* what a page of the app's own address gets when it cannot be loaded and nothing is stored: plain, no script, no outside address,
   in English and Turkish, with a way back to the app. A 200, because anything else is a crash in the Android app. */
function offlinePage() {
  const css = 'body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f7f8fa;color:#14181f}' +
    'main{max-width:34rem;margin:0 auto;padding:32px 16px}h1{font-size:1.4rem;line-height:1.25;margin:1.2em 0 .3em}a{color:#0b5cad}' +
    '@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}a{color:#6cb6ff}}';
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><meta name="color-scheme" content="light dark">' +
    '<title>İstanbul Ray-Net</title><style>' + css + '</style></head><body><main>' +
    '<h1>This page is not available right now</h1><p>You may be offline, or this page may no longer exist.</p><p><a href="' + APP_PATH + '">Open İstanbul Ray-Net</a></p>' +
    '<h1 lang="tr">Bu sayfa şu anda açılamıyor</h1><p lang="tr">Çevrimdışı olabilirsiniz ya da bu sayfa artık mevcut olmayabilir.</p><p lang="tr"><a href="' + APP_PATH + '">İstanbul Ray-Net\'i aç</a></p>' +
    '</main></body></html>';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* a page of the app's own address: the network first (an update always wins), the stored copy when the network fails or answers an error.
   The app page is stored as THE shell (the page an offline launch opens); the other pages are stored under their own address. Only the
   app's own addresses are the shell: the legal index (legal/index.html) is a page like any other and must not become the app. */
async function openPage(req, url) {
  const isApp = url.pathname === APP_PATH || url.pathname === APP_PATH + 'index.html';
  try {
    const r = await fetch(req);
    if (r.type === 'opaqueredirect') return r;               // a redirect (legal -> legal/): the browser follows it
    if (r.ok) {
      const copy = r.clone();                                // before the page starts reading it
      if (isApp) caches.open(SHELL).then(c => c.put('shell', copy)).catch(() => {});
      else if (isHtml(r)) caches.open(PAGES).then(c => c.put(url.origin + url.pathname, copy)).catch(() => {});
      return r;
    }
  } catch (_) { /* offline */ }
  const kept = isApp ? await caches.match('shell') : await caches.match(url.origin + url.pathname, { cacheName: PAGES, ignoreVary: true });
  return kept || offlinePage();
}

self.addEventListener('message', e => {
  const reply = d => e.source && e.source.postMessage(d);
  if (e.data === 'tileStats') {
    Promise.all([caches.open(TILES).then(c => c.keys()), caches.open(VEC_TILES).then(c => c.keys())])
      .then(([a, b]) => reply({ type:"tileStats", count:a.length + b.length, cap:TILE_CAP + VEC_CAP }))
      .catch(() => reply({ type:"tileStats", count:0, cap:TILE_CAP }));
  }
  if (e.data === 'clearTiles') {
    Promise.all([caches.delete(TILES), caches.delete(VEC_TILES)])
      .then(() => reply({ type:"tileStats", count:0, cap:TILE_CAP }));
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // every page of the app's own address (the app, the legal pages): always a 200 (see the note on OFFLINE_PAGES)
  if (e.request.mode === 'navigate' && url.origin === location.origin && url.pathname.startsWith(APP_PATH)) {
    e.respondWith(openPage(e.request, url));
    return;
  }

  // basemap tiles: serve from cache first (they never change), fill the cache as you browse,
  // and fall back to a neutral tile when offline in an area that was never viewed
  if (TILE_HOST.test(url.host)) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request, { cacheName: TILES });
      // Only trust a cached tile we can actually verify. Entries written before the layers
      // set crossOrigin are OPAQUE (status 0), which makes a cached ERROR indistinguishable
      // from a cached tile — and cache-first would then serve that blank square forever.
      // Anything unverifiable is refetched once and replaced with a real CORS response.
      if (hit && hit.status === 200) return hit;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(e.request);
          if (r && r.ok) {
            const c = await caches.open(TILES);
            await c.put(e.request, r.clone());
            if (++tilePuts % 100 === 0) trimTiles();
            return r;
          }
          // opaque: can't tell success from failure, so hand it back but never cache it
          if (r && r.type === 'opaque') return r;
          // a genuine 404/403 will not fix itself; only retry on 429/5xx
          if (r && r.status >= 400 && r.status < 500 && r.status !== 429) return r;
        } catch (_) { /* transient (dropped connection, TLS hiccup) — fall through to retry */ }
        if (attempt === 0) await new Promise(res => setTimeout(res, 350));
      }
      // Say "not saved" ONLY when the network is genuinely unreachable. Online, return a real
      // error so Leaflet marks the tile failed and can re-request it: the old code returned a
      // 200 placeholder, which fired the <img> load event, so Leaflet believed the blank
      // square WAS the map and never asked for that tile again.
      return self.navigator.onLine ? Response.error() : OFFLINE_TILE.clone();
    })());
    return;
  }
  // vector map: a tile's address carries its data version, so a cached tile always wins; the tile index is network-first
  if (url.host === VEC_HOST) {
    e.respondWith((async () => {
      const cache = await caches.open(VEC_TILES);
      const hit = await cache.match(e.request, { ignoreVary: true });
      if (hit && /\.pbf$/.test(url.pathname)) return hit;
      try {
        const r = await fetch(e.request);
        if (r && r.ok) { cache.put(e.request, r.clone()); if (++vecPuts % 100 === 0) trimVec(); }
        return r;
      } catch (_) { return hit || Response.error(); }
    })());
    return;
  }
  // live data: always straight to the network (freshness is the product)
  if (/api\.ibb|overpass|open-meteo|routing\.openstreetmap/.test(url.host)) return;

  // the big lazy-loaded bus dataset: stale-while-revalidate → instant on repeat visits, works
  // offline after the first load, silently refreshed in the background when it changes
  // bus-geom-* is matched too: road geometry used to travel inside bus-data-*, and splitting it
  // out for the payload win would otherwise have silently dropped it from the offline cache,
  // leaving saved-area users with straight lines where a route shape used to be.
  // landuse-* (forests, parks, airports) is the same kind of file: large, static, per city
  // places-* (every street, area and place the search runs on) is another: it IS the search, so it has to work offline
  if (/\/transit_data\/(?:bus-(?:data|geom)|landuse|places)-[a-z]+\.json$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const fresh = fetch(e.request).then(r => {
        if (r && r.ok) caches.open(STATIC).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
    return;
  }
  if (url.pathname.includes('/transit_data/')) return;   // live disruptions JSON stays no-store

  // (the app page and the other pages are handled above, in openPage)

  // same-origin static files (Leaflet, MapLibre, the typefaces, icons): stale-while-revalidate
  if (url.origin === location.origin || STATIC_HOSTS.includes(url.host)) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const fresh = fetch(e.request).then(r => {
        if (r && r.ok) caches.open(STATIC).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
  }
});
