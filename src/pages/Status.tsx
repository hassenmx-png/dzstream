import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, RefreshCw, XCircle, AlertTriangle } from 'lucide-react'
import { getDebrids } from '@/lib/addons'
import { getOpensubsKey } from '@/lib/opensubs'
import { getSimkl } from '@/lib/simkl'
import { useLibrary, useProgress } from '@/lib/library'
import { requestNotificationPermission, subscribePushServeur } from '@/lib/notifications'

type Health = 'ok' | 'ko' | 'pending'
type Service = { id: string; name: string; detail: string }

const STATUS_META: Record<Health, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'EN LIGNE', color: 'text-emerald-400', Icon: CheckCircle2 },
  ko: { label: 'HORS LIGNE', color: 'text-red-400', Icon: XCircle },
  pending: { label: 'TEST…', color: 'text-white/40', Icon: AlertTriangle },
}

/** Page « Statut des services » : ping chaque service vital et affiche
 *  vert/orange/rouge. Permet de diagnostiquer en 2 secondes si un service
 *  tombe en panne (clé expirée, API down, réseau bloqué…). */
/** Carte notifications push : abonne ce navigateur au scanner serveur
 *  (alerte « S1E5 dispo » même avec l'app fermée, toutes les 6 h). */
function PushNotifCard() {
  const { items: libraryItems } = useLibrary()
  const { items: progressItems } = useProgress()
  const [state, setState] = useState<'init' | 'off' | 'on' | 'busy' | 'unsupported' | 'error'>('init')

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('unsupported')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setState(sub ? 'on' : 'off')
      } catch {
        setState('off')
      }
    })()
  }, [])

  const activer = async () => {
    setState('busy')
    try {
      const perm = await requestNotificationPermission()
      if (!perm) { setState('error'); return }
      const series = libraryItems
        .filter((i) => i.type === 'series')
        .map((i) => ({ id: i.id, name: i.name }))
      const vus = progressItems.map((p) => p.id)
      const ok = await subscribePushServeur(series, vus)
      setState(ok ? 'on' : 'error')
    } catch {
      setState('error')
    }
  }

  const desactiver = async () => {
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
    } catch { /* ignore */ }
    setState('off')
  }

  if (state === 'unsupported') return null
  return (
    <div className="mt-8 rounded-md border border-white/10 bg-black/30 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold tracking-wide">🔔 Notifications d'épisodes</div>
          <div className="text-xs text-white/40">
            {state === 'on'
              ? 'Activées — le serveur te prévient quand un épisode de tes séries sort (toutes les 6 h), même app fermée.'
              : 'Sois prévenu quand un épisode de tes séries suivies est disponible.'}
          </div>
        </div>
        {state === 'on' ? (
          <button
            onClick={desactiver}
            className="rounded-sm border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/60 transition-colors hover:text-white"
          >
            Désactiver
          </button>
        ) : (
          <button
            onClick={activer}
            disabled={state === 'busy'}
            className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {state === 'busy' ? 'Activation…' : state === 'error' ? 'Réessayer' : 'Activer'}
          </button>
        )}
      </div>
      {state === 'error' && (
        <p className="mt-2 text-xs text-red-400">
          Échec de l'activation — autorise les notifications pour ce site dans les réglages du navigateur, puis réessaie.
        </p>
      )}
    </div>
  )
}

export default function StatusPage() {
  const [results, setResults] = useState<Record<string, Health>>({})
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const runId = useRef(0)

  const buildServices = useCallback((): Service[] => {
    const list: Service[] = []
    const ad = getDebrids().find((d) => d.service === 'alldebrid')
    list.push({
      id: 'alldebrid',
      name: 'AllDebrid',
      detail: ad ? `clé …${ad.key.slice(-4)}` : 'aucune clé configurée',
    })
    list.push({ id: 'torrentio', name: 'Torrentio', detail: 'sources torrent' })
    const osKey = getOpensubsKey()
    list.push({
      id: 'opensubs',
      name: 'OpenSubtitles',
      detail: osKey ? 'clé configurée' : 'aucune clé configurée',
    })
    const simkl = getSimkl()
    list.push({
      id: 'simkl',
      name: 'Simkl',
      detail: simkl?.clientId ? `Client ID …${simkl.clientId.slice(-4)}` : 'non configuré',
    })
    return list
  }, [])

  const checkOne = useCallback(async (id: string): Promise<Health> => {
    try {
      if (id === 'alldebrid') {
        const ad = getDebrids().find((d) => d.service === 'alldebrid')
        if (!ad) return 'ko'
        // Via NOTRE serveur : la clé ne transite plus par le navigateur.
        const r = await fetch('/api/stream/health?service=alldebrid', { signal: AbortSignal.timeout(8000) })
        if (!r.ok) return 'ko' // ex. non authentifié (cookie)
        const j = (await r.json()) as { ok?: boolean }
        return j?.ok ? 'ok' : 'ko'
      }
      if (id === 'torrentio') {
        const r = await fetch('https://torrentio.strem.fun/', { signal: AbortSignal.timeout(8000) })
        return r.ok ? 'ok' : 'ko'
      }
      if (id === 'opensubs') {
        const key = getOpensubsKey()
        if (!key) return 'ko'
        const r = await fetch('https://api.opensubtitles.com/api/v1/subtitles?imdb_id=1101161&languages=fr', {
          headers: { 'Api-Key': key, 'User-Agent': 'DZ STREAM' },
          signal: AbortSignal.timeout(8000),
        })
        return r.ok ? 'ok' : 'ko'
      }
      if (id === 'simkl') {
        const s = getSimkl()
        if (!s?.clientId) return 'ko'
        const r = await fetch(`https://api.simkl.com/oauth/pin?client_id=${encodeURIComponent(s.clientId)}`)
        return r.ok ? 'ok' : 'ko'
      }
      return 'ko'
    } catch {
      return 'ko'
    }
  }, [])

  const runChecks = useCallback(async () => {
    const myRun = ++runId.current
    const svcs = buildServices()
    setServices(svcs)
    setResults(Object.fromEntries(svcs.map((s) => [s.id, 'pending'])))
    await Promise.all(
      svcs.map(async (s) => {
        const h = await checkOne(s.id)
        if (runId.current === myRun) {
          setResults((prev) => ({ ...prev, [s.id]: h }))
        }
      }),
    )
    if (runId.current === myRun) setCheckedAt(new Date())
  }, [buildServices, checkOne])

  useEffect(() => {
    runChecks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allOk = services.length > 0 && services.every((s) => results[s.id] === 'ok')

  return (
    <div className="min-h-screen px-4 pb-24 pt-8 md:px-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Activity className="h-6 w-6 text-[rgb(var(--acc))]" aria-hidden />
          <h1 className="font-display text-2xl font-bold tracking-wide">STATUT DES SERVICES</h1>
        </div>

        <p className="mb-6 text-sm text-white/50">
          Vérification en direct des services critiques de DZ STREAM. Un service « hors ligne » explique
          presque toujours un problème de lecture ou de sources.
        </p>

        <ul className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/10 bg-black/30">
          {services.map((s) => {
            const h: Health = results[s.id] ?? 'pending'
            const meta = STATUS_META[h]
            return (
              <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div>
                  <div className="text-sm font-bold tracking-wide">{s.name}</div>
                  <div className="text-xs text-white/40">{s.detail}</div>
                </div>
                <div className={`flex items-center gap-2 text-xs font-bold ${meta.color}`}>
                  <meta.Icon className="h-4 w-4" aria-hidden />
                  {meta.label}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={runChecks}
            className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-85"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retester
          </button>
          {checkedAt && (
            <span className="text-xs text-white/40">
              Testé à {checkedAt.toLocaleTimeString('fr-FR')}
              {allOk ? ' — tout est opérationnel ✅' : ''}
            </span>
          )}
        </div>

        {allOk && checkedAt && (
          <p className="mt-4 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
            Tous les services répondent. Si une source ne joue pas malgré tout, le problème vient du lien
            torrent lui-même (mort) — change simplement de source.
          </p>
        )}
        <PushNotifCard />
      </div>
    </div>
  )
}
