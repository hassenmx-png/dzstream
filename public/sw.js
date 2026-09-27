/* Service worker DÉSACTIVÉ : il se purge et se désenregistre tout seul.
   Les déploiements fréquents cassaient le cache (écrans noirs). L'app charge
   désormais toujours fraîche du réseau — fini les mélanges de versions. */
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', () => {
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  self.registration.unregister()
})
