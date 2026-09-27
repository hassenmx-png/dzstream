/* Service worker DZ STREAM : réception des notifications push.
   Stratégie RÉSEAU-ONLY (aucun cache) : l'app charge toujours fraîche,
   mais le SW reste enregistré pour recevoir les pushes. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  e.waitUntil(self.clients.claim())
})
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(data.title || 'DZ STREAM', {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'dzstream',
    renotify: true,
    data: { url: data.url || '/' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus() }
    return self.clients.openWindow(url)
  }))
})
