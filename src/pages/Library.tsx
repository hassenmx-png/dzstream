import { useEffect, useMemo, useState } from 'react'
import { useNav } from '@/lib/nav'
import { getSimkl, simklFetchWatchlist, simklFetchWatched, type SimklListItem } from '@/lib/simkl'
import { Bell, Clock3, Film, Play, Sparkles, Star, Trash2, Tv, Users } from 'lucide-react'
import { useLibrary, useProgress } from '@/lib/library'
import PosterCard from '@/components/PosterCard'
import CalendarSection from '@/components/CalendarSection'
import SyncCard from '@/components/SyncCard'
import { getSyncCode } from '@/lib/sync'
import { useRatings } from '@/lib/ratings'
import { joinRoomAndPlay } from '@/lib/room'
import { fetchCalendar, seriesForCalendar, type CalEntry } from '@/lib/calendar'
import { toast } from '@/lib/toast'
import { checkNewEpisodes, requestNotificationPermission, subscribePushServeur } from '@/lib/notifications'

function formatWatchTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

export default function LibraryPage() {
  const { go } = useNav()
  const { items } = useLibrary()
  const { continueWatching, items: history, remove } = useProgress()
  const { play } = useNav()
  const { byId: ratingsById } = useRatings()
  const [sort, setSort] = useState<'recent' | 'rating'>('recent')
  const [salonCode, setSalonCode] = useState('')
  const [salonBusy, setSalonBusy] = useState(false)

  // Calendrier : chargé une fois ici, mutualisé entre la section calendrier
  // et les badges « nouvel épisode » des affiches de séries.
  const calSeries = useMemo(() => seriesForCalendar(items, history), [items, history])
  const [calEntries, setCalEntries] = useState<CalEntry[] | null>(null)
  const [simklWatchlist, setSimklWatchlist] = useState<SimklListItem[]>([])

  // Simkl : historique (rafraîchi si vieux de +24 h) + watchlist.
  useEffect(() => {
    const s = getSimkl()
    if (!s?.accessToken) return
    const at = Number(localStorage.getItem('novastream:simkl-watched-at')) || 0
    if (Date.now() - at > 24 * 3600_000) void simklFetchWatched()
    void simklFetchWatchlist().then(setSimklWatchlist)
  }, [])
  useEffect(() => {
    setCalEntries(null)
    if (calSeries.length === 0) return
    let alive = true
    void fetchCalendar(calSeries).then((e) => {
      if (!alive) return
      setCalEntries(e)
      // Notifications locales : si de nouveaux épisodes sont sortis depuis
      // la dernière visite ET que l'utilisateur a autorisé, on notifie.
      const followed = new Set(calSeries.map((s) => s.id))
      const names = new Map(calSeries.map((s) => [s.id, s.name]))
      void checkNewEpisodes(e, followed, names)
    })
    return () => {
      alive = false
    }
  }, [calSeries])

  // État du bouton d'activation des notifications
  const [notifPerm, setNotifPerm] = useState<'default' | 'granted' | 'denied'>('default')
  useEffect(() => {
    if ('Notification' in window) setNotifPerm(Notification.permission)
  }, [])
  const enableNotif = async () => {
    const ok = await requestNotificationPermission()
    setNotifPerm(ok ? 'granted' : Notification.permission)
    if (ok) {
      // Abonnement au push SERVEUR (app fermée incluse)
      const series = calSeries.map((s) => ({ id: s.id, name: s.name }))
      const vus = (history ?? []).map((p) => p.id)
      const inscrit = await subscribePushServeur(series, vus)
      toast(inscrit
        ? 'Notifications serveur activées — alerte même app fermée 🔔'
        : 'Notifications locales activées (serveur indisponible)')
    } else {
      toast('Notifications refusées par le navigateur')
    }
  }

  // Séries avec un épisode diffusé dans les 3 derniers jours
  const [now] = useState(() => Date.now())
  const freshSeries = useMemo(() => {
    const set = new Set<string>()
    for (const e of calEntries ?? []) {
      if (e.released <= now && e.released >= now - 3 * 86400000) set.add(e.seriesId)
    }
    return set
  }, [calEntries])

  // Bandeau « Nouveautés » : épisodes des séries SUIVIES diffusés dans les
  // 7 derniers jours et non encore regardés. Calculé à l'ouverture de la page.
  const freshEpisodes = useMemo(() => {
    const followed = new Set(calSeries.map((s) => s.id))
    const weekAgo = now - 7 * 86400000
    return (calEntries ?? []).filter(
      (e) => followed.has(e.seriesId) && e.released >= weekAgo && e.released <= now
    ).length
  }, [calEntries, calSeries, now])

  const sortedItems = [...items].sort((a, b) => {
    if (sort === 'rating') {
      const d = (ratingsById.get(b.id) ?? 0) - (ratingsById.get(a.id) ?? 0)
      if (d !== 0) return d
    }
    return b.addedAt - a.addedAt
  })

  const joinSalon = async () => {
    if (!salonCode.trim()) return
    setSalonBusy(true)
    const res = await joinRoomAndPlay(salonCode, play)
    setSalonBusy(false)
    if (!res.ok) toast(res.error ?? 'Salon introuvable')
    else toast('Salon rejoint — la lecture suit l\'hôte')
  }

  const totalSeconds = history.reduce((acc, p) => acc + Math.min(p.time, p.duration || p.time), 0)
  const moviesCount = new Set(history.filter((p) => p.type === 'movie').map((p) => p.baseId)).size
  const episodesCount = history.filter((p) => p.type === 'series').length

  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen">
      <p className="bracket-label mb-2">Espace personnel</p>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase">Ma liste</h1>

      {/* Statistiques */}
      {history.length > 0 && (
        <div className="mt-8 grid grid-cols-3 max-w-xl gap-3">
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <Clock3 size={16} className="text-[rgb(var(--acc))] mb-2" />
            <p className="font-display text-xl font-bold">{formatWatchTime(totalSeconds)}</p>
            <p className="text-[10px] font-mono-label text-white/35 mt-1">Visionné</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <Film size={16} className="text-[rgb(var(--acc))] mb-2" />
            <p className="font-display text-xl font-bold">{moviesCount}</p>
            <p className="text-[10px] font-mono-label text-white/35 mt-1">Films</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <Tv size={16} className="text-[rgb(var(--acc))] mb-2" />
            <p className="font-display text-xl font-bold">{episodesCount}</p>
            <p className="text-[10px] font-mono-label text-white/35 mt-1">Épisodes</p>
          </div>
        </div>
      )}

      {/* Activité des 14 derniers jours + titres les plus regardés */}
      {history.length > 0 && (() => {
        const days: { label: string; count: number }[] = []
        for (let i = 13; i >= 0; i--) {
          const d = new Date()
          d.setHours(0, 0, 0, 0)
          d.setDate(d.getDate() - i)
          const next = d.getTime() + 86400000
          days.push({
            label: d.toLocaleDateString('fr-FR', { weekday: 'narrow' }),
            count: history.filter((p) => p.updatedAt >= d.getTime() && p.updatedAt < next).length,
          })
        }
        const maxCount = Math.max(1, ...days.map((d) => d.count))
        const top = [...history]
          .sort((a, b) => Math.min(b.time, b.duration || b.time) - Math.min(a.time, a.duration || a.time))
          .slice(0, 3)
        return (
          <div className="mt-4 grid gap-3 max-w-3xl md:grid-cols-2">
            <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-mono-label text-white/35 mb-3">Activité — 14 derniers jours</p>
              <div className="flex items-end gap-1 h-16">
                {days.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.count} titre(s)`}>
                    <div
                      className={`w-full rounded-sm ${d.count > 0 ? 'bg-[rgb(var(--acc))]' : 'bg-white/8'}`}
                      style={{ height: `${Math.max(6, (d.count / maxCount) * 100)}%` }}
                    />
                    {(i === 0 || i === 7 || i === 13) && (
                      <span className="text-[8px] font-mono text-white/25">{d.label}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-mono-label text-white/35 mb-3">Les plus regardés</p>
              <div className="space-y-2">
                {top.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 min-w-0">
                    <span className="font-display font-black text-[rgb(var(--acc))] w-4">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">
                        {p.name}{p.episodeLabel ? ` — ${p.episodeLabel}` : ''}
                      </p>
                      <div className="mt-1 h-1 rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[rgb(var(--acc))]"
                          style={{ width: `${Math.min(100, (p.time / (p.duration || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-white/35 shrink-0">
                      {formatWatchTime(Math.min(p.time, p.duration || p.time))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Continuer à regarder */}
      <section className="mt-12">
        <h2 className="bracket-label mb-4">Continuer à regarder</h2>
        {continueWatching.length === 0 ? (
          <p className="text-white/35 text-sm">
            Rien en cours. Lance une lecture — ta progression est enregistrée automatiquement.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {continueWatching.map((p) => (
              <div
                key={p.id}
                className="group relative flex gap-4 rounded-md border border-white/8 bg-white/[0.03] p-3 hover:border-[rgb(var(--acc))]/40 transition-colors"
              >
                <button
                  onClick={() => p.stream && play({ stream: p.stream, meta: { id: p.id, baseId: p.baseId, type: p.type, name: p.name, poster: p.poster, background: p.background }, episodeLabel: p.episodeLabel, startAt: p.time })}
                  className="relative w-32 shrink-0 aspect-video overflow-hidden rounded bg-white/5"
                >
                  {(p.background || p.poster) && (
                    <img src={p.background ?? p.poster} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play size={22} className="text-[rgb(var(--acc))]" fill="currentColor" />
                  </span>
                  <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
                    <span className="block h-full bg-[rgb(var(--acc))]" style={{ width: `${Math.min(100, (p.time / (p.duration || 1)) * 100)}%` }} />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  {p.episodeLabel && <p className="text-xs text-white/40">{p.episodeLabel}</p>}
                  <p className="mt-1 text-[11px] font-mono text-[rgb(var(--acc))]/80">
                    {Math.round((p.time / (p.duration || 1)) * 100)}% regardé
                  </p>
                </div>
                <button
                  onClick={() => remove(p.id)}
                  className="self-start p-1.5 text-white/30 hover:text-red-400 transition-colors"
                  aria-label="Retirer de l'historique"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bandeau Nouveautés + activation des notifications */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {freshEpisodes > 0 && (
          <div className="flex items-center gap-2 rounded-sm border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <Sparkles className="h-4 w-4 text-amber-400" aria-hidden />
            <span className="text-sm font-semibold text-amber-300">
              {freshEpisodes} nouvel{freshEpisodes > 1 ? 's' : ''} épisode{freshEpisodes > 1 ? 's' : ''} disponible{freshEpisodes > 1 ? 's' : ''} cette semaine
            </span>
          </div>
        )}
        {notifPerm === 'default' && (
          <button
            onClick={enableNotif}
            className="flex items-center gap-2 rounded-sm border border-[rgb(var(--acc))]/40 bg-[rgb(var(--acc))]/10 px-4 py-2.5 text-xs font-semibold text-[rgb(var(--acc))] transition hover:bg-[rgb(var(--acc))]/20"
          >
            <Bell className="h-4 w-4" aria-hidden />
            Activer les notifications de nouveaux épisodes
          </button>
        )}
        {notifPerm === 'granted' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <Bell className="h-3.5 w-3.5" aria-hidden /> Notifications actives
          </span>
        )}
      </div>

      {/* Calendrier des épisodes à venir (séries suivies) */}
      <CalendarSection hasSeries={calSeries.length > 0} entries={calEntries} />

      {/* Watchlist Simkl */}
      {simklWatchlist.length > 0 && (
        <section className="mt-14">
          <h2 className="bracket-label mb-4">Watchlist Simkl</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {simklWatchlist.map((w) => (
              <button
                key={w.id + w.type}
                onClick={() => go({ name: 'detail', type: w.type, id: w.id })}
                className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/5"
              >
                <p className="text-[10px] font-mono-label text-white/40">{w.type === 'movie' ? 'FILM' : 'SÉRIE'}</p>
                <p className="mt-1.5 line-clamp-3 text-sm font-semibold text-white/85">{w.name}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Favoris */}
      <section className="mt-14">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="bracket-label">Films & séries enregistrés</h2>
          {items.length > 0 && (
            <label className="flex items-center gap-2 text-[10px] font-mono-label text-white/35">
              Tri
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'recent' | 'rating')}
                className="rounded-sm border border-white/15 bg-[#0a0a0a] px-2 py-1.5 text-[11px] text-white/80 focus:border-[rgb(var(--acc))]/60 focus:outline-none"
              >
                <option value="recent">Ajout récent</option>
                <option value="rating">Ta note</option>
              </select>
            </label>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-white/35 text-sm">
            Ta liste est vide. Survole une affiche et ajoute-la avec « Ma liste ».
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {sortedItems.map((i) => {
              const r = ratingsById.get(i.id)
              return (
                <div key={i.id} className="relative">
                  <PosterCard meta={{ id: i.id, type: i.type, name: i.name, poster: i.poster }} />
                  {r && (
                    <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-sm bg-black/75 px-1.5 py-0.5 text-[10px] font-mono font-bold text-[rgb(var(--acc))] backdrop-blur">
                      <Star size={9} fill="currentColor" /> {r}
                    </span>
                  )}
                  {freshSeries.has(i.id) && (
                    <span className="absolute bottom-1.5 left-1.5 z-10 rounded-sm bg-[rgb(var(--acc))] px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider text-white">
                      NOUVEL ÉP.
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Historique complet */}
      <section className="mt-14">
        <h2 className="bracket-label mb-4">Historique complet</h2>
        {history.length === 0 ? (
          <p className="text-white/35 text-sm">Aucune lecture pour le moment.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {history.map((p) => (
              <div key={p.id} className="flex items-center gap-4 py-2.5 group">
                <button
                  onClick={() => p.stream && play({ stream: p.stream, meta: { id: p.id, baseId: p.baseId, type: p.type, name: p.name, poster: p.poster, background: p.background }, episodeLabel: p.episodeLabel, startAt: p.time })}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <span className="text-white/30 group-hover:text-[rgb(var(--acc))] transition-colors">
                    <Play size={14} fill="currentColor" />
                  </span>
                  <span className="truncate text-sm">
                    {p.name}
                    {p.episodeLabel && <span className="text-white/40"> — {p.episodeLabel}</span>}
                  </span>
                  <span className="text-[11px] font-mono text-white/30 shrink-0">
                    {Math.round((p.time / (p.duration || 1)) * 100)}%
                  </span>
                </button>
                <span className="text-[10px] font-mono text-white/20 shrink-0 hidden sm:block">
                  {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
                </span>
                <button
                  onClick={() => remove(p.id)}
                  className="p-1.5 text-white/20 hover:text-red-400 transition-colors shrink-0"
                  aria-label="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rejoindre un salon « regarder ensemble » */}
      <section className="mt-14 max-w-xl">
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-[rgb(var(--acc))]" />
            <h2 className="font-display font-bold">Salon — regarder ensemble</h2>
          </div>
          <p className="text-xs text-white/40 leading-relaxed mb-3">
            Un ami a lancé un salon ? Entre son code : le film se lance chez toi, calé sur sa lecture
            (pause, avance, épisode suivant — tout est synchronisé).
          </p>
          <div className="flex gap-2">
            <input
              value={salonCode}
              onChange={(e) => setSalonCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void joinSalon() }}
              placeholder="SN-XXXX-XXXX"
              className="min-w-0 flex-1 rounded-sm border border-white/15 bg-white/5 px-3 py-2 text-sm font-mono uppercase placeholder:text-white/25 focus:border-[rgb(var(--acc))]/60 focus:outline-none"
            />
            <button
              onClick={() => void joinSalon()}
              disabled={salonBusy}
              className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-sm font-bold text-white hover:bg-[#e8252f] disabled:opacity-50 transition-colors"
            >
              {salonBusy ? 'Connexion…' : 'Rejoindre'}
            </button>
          </div>
          <p className="mt-2.5 text-[10px] font-mono text-white/25">
            // Pour créer un salon : lance une lecture → icône 👥 dans le lecteur → « Créer un salon ».
          </p>
        </div>
      </section>

      <SyncCard />

      <p className="mt-14 text-[11px] font-mono text-white/25 max-w-xl leading-relaxed">
        {getSyncCode()
          ? '// Synchro active : ta liste et ta progression suivent ton code sur tous tes appareils.'
          : '// Sans code de synchro, tes données (liste, progression) restent stockées localement dans ce navigateur.'}
      </p>
    </div>
  )
}
