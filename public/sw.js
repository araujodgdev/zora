// Zora's service worker (registered by `src/lib/pwa.ts` in production builds).
// It makes the app installable and shows an offline page when a navigation
// fails. It caches nothing private: pages, data, media and auth always come
// from the network; only the offline page and its icon are stored.

const CACHE = 'zora-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Store a copy: Cloudflare may answer `/offline.html` with a redirect to
      // `/offline`, and a redirected response cannot answer a navigation.
      const page = await fetch(OFFLINE_URL)
      if (!page.ok) throw new Error('offline page unavailable')
      await cache.put(
        OFFLINE_URL,
        new Response(await page.blob(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      )
      await cache.add('/icons/icon-192.png')
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only page loads; everything else goes to the network untouched.
  if (request.mode !== 'navigate' || request.method !== 'GET') return
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((page) => page ?? Response.error()),
    ),
  )
})
