/* İSTANBUL RAY-NET service worker — emitted by build.cjs with a fresh version per build,
   so every deploy activates immediately and the installed app self-updates.
   Strategy: NETWORK-FIRST for the page (updates always win; cached copy only when offline),
   stale-while-revalidate for static assets/CDNs, and NO caching for live data APIs. */
const VERSION = '20260708202451';
const SHELL  = 'raynet-shell-' + VERSION;
const STATIC = 'raynet-static-v1';
const STATIC_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('raynet-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // live data & map tiles: always straight to the network (freshness is the product)
  if (/api\.ibb|overpass|open-meteo|routing\.openstreetmap|cartocdn|arcgisonline|openstreetmap\.org/.test(url.host)) return;
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
