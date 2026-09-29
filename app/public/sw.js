// Service worker minimal du cockpit : il rend l'appli installable (Chrome) et
// ne sert JAMAIS une vieille version. Réseau d'abord, toujours ; le cache ne
// sert qu'à afficher la dernière page vue quand il n'y a plus de réseau.
// Les données (Supabase) et les fichiers de l'app ne passent pas par lui.
const CACHE = 'cockpit-page-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request)
      if (r.ok) { const c = await caches.open(CACHE); await c.put(e.request, r.clone()) }
      return r
    } catch (err) {
      const deja = await caches.match(e.request, { ignoreSearch: true })
      if (deja) return deja
      throw err
    }
  })())
})
