/* İSTANBUL RAY-NET service worker — emitted by build.cjs with a fresh version per build,
   so every deploy activates immediately and the installed app self-updates.
   Strategy: NETWORK-FIRST for the page (updates always win; cached copy only when offline),
   stale-while-revalidate for static assets/CDNs, and NO caching for live data APIs. */
const VERSION = '20260806121340';
const SHELL  = 'raynet-shell-' + VERSION;
const STATIC = 'raynet-static-v1';
const STATIC_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILES  = 'raynet-tiles-v1';
const TILE_HOST = /(^|\.)(basemaps\.cartocdn\.com|cartocdn\.com|arcgisonline\.com|tile\.openstreetmap\.org)$/;
const TILE_CAP  = 3000;          // ~90 MB of 256px tiles; trimmed oldest-first

/* Basemap tiles are cached AS YOU VIEW THEM, so an area you have actually looked at still
   draws when you are offline. Deliberately NOT a bulk download: mass-fetching a provider's
   tile pyramid breaks CARTO's and OSM's usage policies. Everything else the app needs to
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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('raynet-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  const reply = d => e.source && e.source.postMessage(d);
  if (e.data === 'tileStats') {
    caches.open(TILES).then(c => c.keys()).then(k => reply({ type:"tileStats", count:k.length, cap:TILE_CAP }))
      .catch(() => reply({ type:"tileStats", count:0, cap:TILE_CAP }));
  }
  if (e.data === 'clearTiles') {
    caches.delete(TILES).then(() => reply({ type:"tileStats", count:0, cap:TILE_CAP }));
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // basemap tiles: serve from cache first (they never change), fill the cache as you browse,
  // and fall back to a neutral tile when offline in an area that was never viewed
  if (TILE_HOST.test(url.host)) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request, { cacheName: TILES });
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        // Leaflet requests tiles as plain <img>, so these come back OPAQUE (type 'opaque',
        // status 0, ok false). Testing r.ok alone silently cached nothing at all.
        if (r && (r.ok || r.type === 'opaque')) {
          const c = await caches.open(TILES);
          await c.put(e.request, r.clone());
          if (++tilePuts % 100 === 0) trimTiles();
        }
        return r;
      } catch (_) { return OFFLINE_TILE.clone(); }
    })());
    return;
  }
  // live data: always straight to the network (freshness is the product)
  if (/api\.ibb|overpass|open-meteo|routing\.openstreetmap/.test(url.host)) return;

  // the big lazy-loaded bus dataset: stale-while-revalidate → instant on repeat visits, works
  // offline after the first load, silently refreshed in the background when it changes
  if (/\/transit_data\/bus-data-[a-z]+\.json$/.test(url.pathname)) {
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

  // the app page: network-first, cache fallback for offline launches
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request);
        const c = await caches.open(SHELL);
        c.put('shell', r.clone());
        return r;
      } catch (_) {
        return (await caches.match('shell')) || Response.error();
      }
    })());
    return;
  }

  // same-origin static + font/leaflet CDNs: stale-while-revalidate
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
