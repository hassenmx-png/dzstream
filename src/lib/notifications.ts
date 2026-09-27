/** Notifications locales de nouveaux épisodes.
 *
 *  Sans serveur push (impossible en déploiement 100 % statique), on utilise
 *  l'API Notification du navigateur : à l'OUVERTURE de l'app, on scanne les
 *  séries suivies, on compte les épisodes diffusés depuis la dernière visite,
 *  et on affiche une notification système si tu as autorisé.
 *  La date de dernière visite est stockée localement — rien ne part en ligne. */

const LAST_VISIT_KEY = 'novastream:last-episode-check'
const COOLDOWN_MS = 12 * 60 * 60 * 1000 // 12 h : pas de spam si tu ouvres souvent

function getLastVisit(): number {
  try {
    return Number(localStorage.getItem(LAST_VISIT_KEY) ?? 0)
  } catch {
    return 0
  }
}

function setLastVisit(): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()))
  } catch { /* non critique */ }
}

/** Demande la permission de notification (à appeler sur un clic utilisateur). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const p = await Notification.requestPermission()
  return p === 'granted'
}

/** Vérifie s'il y a des épisodes récents et envoie une notification locale. */
export async function checkNewEpisodes(
  calEntries: Array<{ seriesId: string; seriesName: string; season: number; episode: number; released: number }>,
  followedSeriesIds: Set<string>,
  seriesNames: Map<string, string>,
): Promise<number> {
  const now = Date.now()
  const lastVisit = getLastVisit()
  // Premier lancement ou déjà vérifié récemment → on ne notifie pas
  if (lastVisit === 0 || now - lastVisit < COOLDOWN_MS) {
    setLastVisit()
    return 0
  }
  const since = Math.max(lastVisit, now - 7 * 24 * 3600 * 1000)
  const fresh = calEntries.filter(
    (e) => followedSeriesIds.has(e.seriesId) && e.released >= since && e.released <= now,
  )
  setLastVisit()
  if (fresh.length === 0) return 0
  if (Notification.permission !== 'granted') return fresh.length // compte mais pas de notif
  const series = [...new Set(fresh.map((e) => seriesNames.get(e.seriesId) ?? e.seriesId))]
  const body =
    fresh.length === 1
      ? `${series[0]} — S${fresh[0].season} E${fresh[0].episode} est disponible`
      : `${fresh.length} nouveaux épisodes dont ${series.slice(0, 3).join(', ')}${series.length > 3 ? '…' : ''}`
  try {
    new Notification('🎬 DZ STREAM — Nouveaux épisodes', { body, icon: '/icons/icon-192.png', tag: 'novastream-ep' })
  } catch { /* certains navigateurs exigent un service worker : on ignore */ }
  return fresh.length
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** Abonne ce navigateur au push SERVEUR : il scrute les nouveaux épisodes
 *  des séries suivies et notifie même quand l'app est fermée. */
export async function subscribePushServeur(
  series: { id: string; name: string }[],
  vus: string[],
): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.ready
    const r = await fetch('/api/push/vapid-public-key')
    if (!r.ok) return false
    const { key } = await r.json()
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
    const payload = { ...(sub.toJSON() as Record<string, unknown>), series, vus }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return true
  } catch {
    return false
  }
}
