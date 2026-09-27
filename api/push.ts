/** Notifications Push serveur : scrute les nouveaux épisodes des séries
 *  suivies et envoie des alertes Web Push même quand l'app est fermée.
 *  Tout est encapsulé en try/catch : une panne push ne doit JAMAIS
 *  empêcher le boot du serveur. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import webpush from 'web-push'

const VAPID_PUBLIC = 'BCHhT2bUOrQgpFrnjNMQ3dFUavJ5FxadNabBgp7D6oNIEaj_BYioTlwN_Obl3ac8ZDkUDvZTc-svyC4IyPj1JSg'
const VAPID_PRIVATE = 'ZUi4jUyfYEKeT95VjE-awKZqqsvH7T1BYogGWxhdqiE'
const SUBS_FILE = process.env.PUSH_SUBS_FILE ?? '/root/push-subs.json'
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 h
const NOUVEAUTE_FENETRE_JOURS = 3

interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
  series: { id: string; name: string }[]
  vus: string[] // ["tt123:1:5", ...]
  notifies: string[]
  creeLe: number
}

let subs: PushSub[] = []
try {
  webpush.setVapidDetails('mailto:novastream@local', VAPID_PUBLIC, VAPID_PRIVATE)
  if (existsSync(SUBS_FILE)) subs = JSON.parse(readFileSync(SUBS_FILE, 'utf-8'))
} catch (e) {
  console.warn('[push] init:', (e as Error).message)
}

function save(): void {
  try { writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 1)) } catch { /* ignore */ }
}

export function registerPushRoutes(app: { get: Function; post: Function }): void {
  app.get('/api/push/vapid-public-key', () =>
    new Response(JSON.stringify({ key: VAPID_PUBLIC }), { headers: { 'Content-Type': 'application/json' } }),
  )

  app.post('/api/push/subscribe', async (c: { req: { json: () => Promise<any> } }) => {
    try {
      const body = await c.req.json()
      const sub: PushSub = {
        endpoint: body.endpoint,
        keys: body.keys,
        series: body.series ?? [],
        vus: body.vus ?? [],
        notifies: [],
        creeLe: Date.now(),
      }
      subs = subs.filter((s) => s.endpoint !== sub.endpoint)
      subs.push(sub)
      save()
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 400 })
    }
  })
}

/** Scan : pour chaque abonné, vérifie les épisodes récents de ses séries. */
async function scan(): Promise<void> {
  if (subs.length === 0) return
  const maintenant = Date.now()
  const limite = maintenant - NOUVEAUTE_FENETRE_JOURS * 86400000
  for (const sub of subs) {
    const nouvelles: string[] = []
    for (const serie of sub.series.slice(0, 60)) {
      try {
        const r = await fetch(`https://v3-cinemeta.strem.io/meta/series/${serie.id}.json`, {
          signal: AbortSignal.timeout(15000),
        })
        if (!r.ok) continue
        const j = (await r.json()) as { meta?: { videos?: { season: number; episode: number; released?: string; title?: string }[]; name?: string } }
        const videos = j.meta?.videos ?? []
        const nomSerie = j.meta?.name ?? serie.name
        for (const ep of videos) {
          if (!ep.released) continue
          const t = Date.parse(ep.released)
          if (Number.isNaN(t) || t < limite || t > maintenant) continue
          const cle = `${serie.id}:${ep.season}:${ep.episode}`
          if (sub.vus.includes(cle) || sub.notifies.includes(cle)) continue
          nouvelles.push(`${nomSerie} — S${ep.season}E${ep.episode}`)
          sub.notifies.push(cle)
        }
      } catch { /* série indisponible : on saute */ }
    }
    if (nouvelles.length > 0) {
      const body = nouvelles.length === 1
        ? `🎬 Nouvel épisode : ${nouvelles[0]}`
        : `🎬 ${nouvelles.length} nouveaux épisodes : ${nouvelles.slice(0, 3).join(' · ')}${nouvelles.length > 3 ? '…' : ''}`
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          JSON.stringify({ title: 'NovaStream', body, icon: '/icons/icon-192.png', tag: 'novastream-ep' }),
        )
        console.log(`[push] notifié : ${nouvelles.length} épisode(s)`)
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) subs = subs.filter((s) => s.endpoint !== sub.endpoint) // abonnement mort
        console.warn('[push] échec envoi:', code ?? (e as Error).message)
      }
    }
  }
  save()
}

export function startPushScanner(): void {
  try {
    setTimeout(scan, 60_000) // premier scan 1 min après le boot
    setInterval(scan, SCAN_INTERVAL_MS)
    console.log('[push] scanner démarré (toutes les 6 h)')
  } catch (e) {
    console.warn('[push] scanner:', (e as Error).message)
  }
}
