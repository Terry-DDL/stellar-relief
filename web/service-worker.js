// BUILD_ID and FILES are injected by Vite from the emitted production bundle.
const cachePrefix = `stellar-relief:${self.registration.scope}:`
const cacheName = cachePrefix + BUILD_ID
const shell = new URL('index.html', self.registration.scope).href
const files = FILES.map((file) => new URL(file, self.registration.scope).href)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(files.map((file) => new Request(file, { cache: 'reload' })))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const obsolete = (await caches.keys()).filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
    await Promise.all(obsolete.map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const cached = request.mode === 'navigate' && url.href.startsWith(self.registration.scope)
    ? shell
    : files.includes(url.href) ? url.href : null
  if (!cached) return
  event.respondWith((async () => {
    const cache = await caches.open(cacheName)
    return await cache.match(cached) ?? fetch(request)
  })())
})
