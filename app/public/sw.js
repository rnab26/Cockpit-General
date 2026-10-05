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

// Notifications push (migration 0037) : « Claude a répondu ». Le corps est
// écrit par la fonction serveur cockpit-push ; aucune donnée sensible ici.
// Si l'appli est déjà à l'écran et active, la pastille suffit : pas de bannière.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let d = {}
    try { d = e.data ? e.data.json() : {} } catch (err) { d = { titre: 'Claude a répondu', corps: e.data ? e.data.text() : '' } }
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (fenetres.some((c) => c.visibilityState === 'visible' && c.focused)) return
    await self.registration.showNotification(d.titre || 'Claude a répondu', {
      body: [d.sujet, d.corps].filter(Boolean).join('\n'),
      icon: self.registration.scope + 'icon-192.png',
      badge: self.registration.scope + 'icon-192.png',
      tag: d.chantier_id || d.projet_id || 'cockpit',
      renotify: true,
      // Lien profond : le fragment est lu par l'app (app/src/lib/lienNotification.ts, même format).
      data: { url: self.registration.scope + (d.projet_id ? '#fil=' + d.projet_id + (d.chantier_id ? ':' + d.chantier_id : '') : '') },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const deja = fenetres.find((c) => c.url.startsWith(self.registration.scope))
    if (deja) {
      // L'appli est déjà ouverte : on lui dit où aller (elle écoute 'message'), puis on la met devant.
      try { deja.postMessage({ type: 'ouvrir-fil', url }) } catch (err) { /* ignoré */ }
      await deja.focus(); return
    }
    await self.clients.openWindow(url)
  })())
})
