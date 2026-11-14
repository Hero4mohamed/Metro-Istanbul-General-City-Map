/* TURKMAPS service worker — emitted by build.cjs with a fresh version per build,
   so every deploy activates immediately and the installed app self-updates.
   Strategy: NETWORK-FIRST for the page (updates always win; cached copy only when offline),
   stale-while-revalidate for static assets/CDNs, and NO caching for live data APIs. */
const VERSION = '20261114144443';
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
/* V4.4.1: the app must OPEN AND WORK with no connection after its first visit. Two things were missing.
   (1) The app's own files (the map engines, the typefaces, the map's letter shapes, the icons) were meant to be kept "as they are
       loaded", but the copy was taken after the response had been handed to the page, when its body was already used, so the copy
       failed silently every time and NOTHING was kept: offline, the page opened and could not start. APP_FILES is every such file,
       written by build.cjs, and all of them are now fetched at install; the keep-as-loaded path is fixed as well.
   (2) The base map came only from tiles fetched as you looked at them. A city's whole base map now comes as one file (a pack,
       offline/<city>.pack, see build-offline-packs.cjs) that the page stores in the PACKS cache; a tile that cannot be fetched is
       read out of it. */
const APP_FILES = ["assets/apple-touch-icon.png","assets/favicon-16.png","assets/favicon-32.png","assets/icon-192.png","assets/icon-512.png","assets/icon-maskable-512.png","assets/logo-96.png","assets/og-card.png","assets/splash-bg.jpg","assets/splash-icon.jpg","manifest.webmanifest","vendor/fonts/Inter-latin-ext.woff2","vendor/fonts/Inter-latin.woff2","vendor/fonts/JetBrainsMono-latin-ext.woff2","vendor/fonts/JetBrainsMono-latin.woff2","vendor/fonts/SpaceGrotesk-latin-ext.woff2","vendor/fonts/SpaceGrotesk-latin.woff2","vendor/glyphs/NotoSans-Bold/0-255.pbf","vendor/glyphs/NotoSans-Bold/1024-1279.pbf","vendor/glyphs/NotoSans-Bold/1536-1791.pbf","vendor/glyphs/NotoSans-Bold/256-511.pbf","vendor/glyphs/NotoSans-Bold/768-1023.pbf","vendor/glyphs/NotoSans-Bold/8192-8447.pbf","vendor/glyphs/NotoSans-Italic/0-255.pbf","vendor/glyphs/NotoSans-Italic/1024-1279.pbf","vendor/glyphs/NotoSans-Italic/1536-1791.pbf","vendor/glyphs/NotoSans-Italic/256-511.pbf","vendor/glyphs/NotoSans-Italic/768-1023.pbf","vendor/glyphs/NotoSans-Italic/8192-8447.pbf","vendor/glyphs/NotoSans-Regular/0-255.pbf","vendor/glyphs/NotoSans-Regular/1024-1279.pbf","vendor/glyphs/NotoSans-Regular/1536-1791.pbf","vendor/glyphs/NotoSans-Regular/256-511.pbf","vendor/glyphs/NotoSans-Regular/768-1023.pbf","vendor/glyphs/NotoSans-Regular/8192-8447.pbf","vendor/leaflet/images/layers-2x.png","vendor/leaflet/images/layers.png","vendor/leaflet/images/marker-icon-2x.png","vendor/leaflet/images/marker-icon.png","vendor/leaflet/images/marker-shadow.png","vendor/leaflet/leaflet.css","vendor/leaflet/leaflet.js","vendor/maplibre/leaflet-maplibre-gl.js","vendor/maplibre/maplibre-gl-csp-worker.js","vendor/maplibre/maplibre-gl-csp.js","vendor/maplibre/maplibre-gl.css"];
const PACKS = 'raynet-packs-v1';
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
const VEC_INDEX = 'https://tiles.openfreemap.org/planet';        // the tile list (TileJSON): names the current tile addresses
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
  const shell = await caches.open(SHELL), pages = await caches.open(PAGES), stat = await caches.open(STATIC), vec = await caches.open(VEC_TILES);
  await Promise.all([
    quiet(fetch(base).then(r => (r.ok ? shell.put('shell', r) : null))),
    ...OFFLINE_PAGES.map(p => { const u = new URL(p, base).href; return quiet(fetch(u).then(r => (r.ok && isHtml(r) ? pages.put(u, r) : null))); }),
    /* the app's own files: 'no-cache' asks the server whether the browser's copy is still good, so a new version is never skipped */
    ...APP_FILES.map(p => { const u = new URL(p, base).href; return quiet(fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? stat.put(u, r) : null))); }),
    /* the list that says where the map tiles are now: the map cannot start without it */
    quiet(fetch(VEC_INDEX).then(r => (r.ok ? vec.put(VEC_INDEX, r) : null))),
  ]);
}

/* ---- offline map packs ----
   A pack is 'RNP1', a 4-byte length, an index as JSON ({ tiles: { "z/x/y": [offset, length] } }) and then the tiles, each gzipped.
   The page downloads a city's pack and stores the file itself in the PACKS cache; a tile is read straight out of that stored file
   (a slice of it, unzipped as it is handed over), so nothing is unpacked or stored twice. The index of every stored pack is read
   once and kept while this worker lives; the page says 'packsChanged' when it adds or removes one. */
let packTiles = null;                                  // Map "z/x/y" -> [Blob, offset, length], or null = not read yet
async function readPacks() {
  const map = new Map();
  try {
    const cache = await caches.open(PACKS);
    for (const req of await cache.keys()) {
      try {
        const blob = await (await cache.match(req)).blob();
        const head = new DataView(await blob.slice(0, 8).arrayBuffer());
        if (head.getUint32(0) !== 0x524E5031) continue;                                  // 'RNP1'
        const n = head.getUint32(4, true), meta = JSON.parse(await blob.slice(8, 8 + n).text());
        for (const k in meta.tiles) if (!map.has(k)) map.set(k, [blob, 8 + n + meta.tiles[k][0], meta.tiles[k][1]]);
      } catch (_) { /* a damaged pack is skipped, never fatal */ }
    }
  } catch (_) { /* no cache storage */ }
  return map;
}
async function packTile(z, x, y) {
  if (!packTiles) packTiles = readPacks();
  const e = (await packTiles).get(z + '/' + x + '/' + y);
  if (!e || typeof DecompressionStream === 'undefined') return null;
  return new Response(e[0].slice(e[1], e[1] + e[2]).stream().pipeThrough(new DecompressionStream('gzip')),
                      { status: 200, headers: { 'Content-Type': 'application/x-protobuf', 'X-TurkMaps-Pack': '1' } });
}
/* the tile list, when it was never fetched and cannot be now: enough for the map to start and ask for tiles (which the packs answer) */
function packIndex() {
  return new Response(JSON.stringify({ tilejson: '3.0.0', tiles: [VEC_INDEX + '/offline/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14,
                                       attribution: '', vector_layers: [] }),
                      { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    '<title>TurkMaps</title><style>' + css + '</style></head><body><main>' +
    '<h1>This page is not available right now</h1><p>You may be offline, or this page may no longer exist.</p><p><a href="' + APP_PATH + '">Open TurkMaps</a></p>' +
    '<h1 lang="tr">Bu sayfa şu anda açılamıyor</h1><p lang="tr">Çevrimdışı olabilirsiniz ya da bu sayfa artık mevcut olmayabilir.</p><p lang="tr"><a href="' + APP_PATH + '">TurkMaps\'i aç</a></p>' +
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
  if (e.data === 'packsChanged') packTiles = null;          // the page stored or removed an offline pack: read the indexes again
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
      const tile = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
      if (hit && tile) return hit;
      /* what to answer when the network cannot: the kept copy, else the tile out of an offline pack, else (for the tile list)
         a stand-in that lets the map start. An error only when there is truly nothing. */
      const offline = async () => hit || (tile ? await packTile(tile[1], tile[2], tile[3]) : (/\/planet\/?$/.test(url.pathname) ? packIndex() : null));
      try {
        const r = await fetch(e.request);
        if (r && r.ok) { cache.put(e.request, r.clone()); if (++vecPuts % 100 === 0) trimVec(); return r; }
        /* the service answered, but not with a tile (it is down, the tile addresses moved on, or the map started from the stand-in
           list): the pack is better than a hole. Where the pack has nothing either (open sea), the answer is passed on as it is. */
        return (await offline()) || r;
      } catch (_) { return (await offline()) || Response.error(); }
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
        if (r && r.ok) { const copy = r.clone(); caches.open(STATIC).then(c => c.put(e.request, copy)).catch(() => {}); }   // the copy is taken NOW: once the page reads the answer it cannot be copied
        return r;
      }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
    return;
  }
  if (url.pathname.includes('/transit_data/')) return;   // live disruptions JSON stays no-store
  /* an offline map pack is tens of megabytes and the PAGE stores it (in the PACKS cache, with a progress bar): never keep a second copy */
  if (url.origin === location.origin && url.pathname.includes('/offline/')) return;

  // (the app page and the other pages are handled above, in openPage)

  // same-origin static files (Leaflet, MapLibre, the typefaces, icons): stale-while-revalidate
  if (url.origin === location.origin || STATIC_HOSTS.includes(url.host)) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const fresh = fetch(e.request).then(r => {
        if (r && r.ok) { const copy = r.clone(); caches.open(STATIC).then(c => c.put(e.request, copy)).catch(() => {}); }   // the copy is taken NOW: once the page reads the answer it cannot be copied
        return r;
      }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
  }
});
