/** TV en direct française : lecteur HLS intégré + chaînes par catégorie. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MonitorPlay, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchFrenchChannels, fetchTvVooChannels, type TvChannel } from '@/lib/iptv'

interface EpgEntry { now: string; stop: number; next?: string }
type EpgMap = Record<string, EpgEntry>

export default function TVPage() {
  const [channels, setChannels] = useState<TvChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dzstream:tv-favs') ?? '[]')) } catch { return new Set() }
  })
  const toggleFav = (ch: TvChannel) => {
    setFavs((prev) => {
      const n = new Set(prev)
      const k = ch.name + '|' + ch.group
      if (n.has(k)) n.delete(k); else n.add(k)
      try { localStorage.setItem('dzstream:tv-favs', JSON.stringify([...n])) } catch { /* ignore */ }
      return n
    })
  }
  const [current, setCurrent] = useState<TvChannel | null>(null)
  const [epg, setEpg] = useState<EpgMap | null>(null)
  const [zapOsd, setZapOsd] = useState<{ name: string; logo?: string; group?: string; n: number; total: number } | null>(null)
  const zapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // OSD « zap » façon télé : s'affiche à chaque changement puis fond.
  const showOsd = (ch: TvChannel, list: TvChannel[]) => {
    if (zapTimer.current) clearTimeout(zapTimer.current)
    const n = Math.max(1, list.findIndex((c) => c.name === ch.name && c.group === ch.group) + 1)
    setZapOsd({ name: ch.name, logo: ch.logo, group: ch.group, n, total: list.length })
    zapTimer.current = setTimeout(() => setZapOsd(null), 2600)
  }

  // Zapping : chaîne précédente/suivante dans la liste filtrée (boucle).
  const zap = (dir: 1 | -1) => {
    const list = visible.length > 0 ? visible : channels
    if (list.length === 0) return
    const i = list.findIndex((c) => c.name === current?.name && c.group === current?.group)
    const next = list[(i + dir + list.length) % list.length]
    showOsd(next, list)
    void play(next)
  }

  // Flèches clavier (silencieux, desktop) pour zapper.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') zap(1)
      else if (e.key === 'ArrowLeft') zap(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<{ destroy: () => void } | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    // Deux sources fusionnées : iptv-org (grandes chaînes) + TvVoo (sport, 700+).
    Promise.allSettled([fetchFrenchChannels(), fetchTvVooChannels()])
      .then(([a, b]) => {
        const merged = [
          ...(a.status === 'fulfilled' ? a.value : []),
          ...(b.status === 'fulfilled' ? b.value : []),
        ]
        if (merged.length === 0) {
          setError('Impossible de charger les chaînes. Vérifie ta connexion.')
        }
        setChannels(merged)
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  useEffect(() => () => { hlsRef.current?.destroy() }, [])

  // Guide TV : servi par notre API (le CORS d'open-epg est fermé).
  useEffect(() => {
    let alive = true
    fetch('/api/tv/epg')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setEpg(j) })
      .catch(() => { /* mode statique : pas d'EPG */ })
    return () => { alive = false }
  }, [])

  const decodeEntities = (t: string): string =>
    t.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  const epgOf = (ch: TvChannel): EpgEntry | undefined =>
    ch.tvgId ? epg?.[ch.tvgId.split('@')[0]] : undefined

  const groups = useMemo(() => {
    const g = new Map<string, number>()
    for (const c of channels) {
      const k = c.group || 'Autres'
      g.set(k, (g.get(k) ?? 0) + 1)
    }
    return [...g.entries()].sort((a, b) => b[1] - a[1])
  }, [channels])

  const visible = useMemo(
    () => channels
      .filter((c) => (group === '★ Favoris' ? favs.has(c.name + '|' + c.group) : !group || (c.group || 'Autres') === group))
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [channels, group, q, favs],
  )

  const play = async (ch: TvChannel) => {
    setCurrent(ch)
    showOsd(ch, visible.length > 0 ? visible : channels)
    const v = videoRef.current
    if (!v) return
    // Source à endpoint JSON (TvVoo) : on résout le vrai flux au clic.
    let url = ch.url
    if (ch.resolver) {
      const resolved = await ch.resolver()
      if (!resolved) return
      url = resolved
    }
    hlsRef.current?.destroy()
    hlsRef.current = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url
    } else {
      try {
        const { default: Hls } = await import('hls.js')
        if (Hls.isSupported()) {
          const hls = new Hls({ maxBufferLength: 30 })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(v)
        } else {
          v.src = url
        }
      } catch {
        v.src = url
      }
    }
    v.play().catch(() => { /* autoplay refusé : l'utilisateur appuie sur play */ })
  }

  return (
    <div className="min-h-screen pb-28 pt-24 md:pb-16 md:pt-28">
      <div className="px-5 md:px-12">
        <div className="flex items-center gap-3">
          <MonitorPlay size={26} className="text-[rgb(var(--acc))]" />
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">TV en direct</h1>
        </div>
        <p className="mt-1 text-sm text-white/50">
          Chaînes françaises en direct (iptv-org + TvVoo) — {channels.length} chaînes
        </p>
      </div>

      <div className="mt-6 px-5 md:px-12">
        <div className="group relative overflow-hidden rounded-md border border-white/10 bg-black">
          <video ref={videoRef} controls playsInline webkit-playsinline="" className="aspect-video w-full" poster="" />
          {/* Zapping : flèches latérales */}
          <button
            onClick={() => zap(-1)}
            aria-label="Chaîne précédente"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white/85 opacity-0 backdrop-blur-sm transition-all hover:bg-black/75 hover:scale-110 group-hover:opacity-100"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => zap(1)}
            aria-label="Chaîne suivante"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white/85 opacity-0 backdrop-blur-sm transition-all hover:bg-black/75 hover:scale-110 group-hover:opacity-100"
          >
            <ChevronRight size={22} />
          </button>
          {/* OSD zap façon télé */}
          {zapOsd && (
            <div key={zapOsd.name + zapOsd.n} className="zap-osd absolute bottom-14 left-4 z-10 flex max-w-[70%] items-center gap-3 rounded-md border border-white/15 bg-black/75 px-4 py-2.5 shadow-xl backdrop-blur-md">
              {zapOsd.logo ? (
                <img src={zapOsd.logo} alt="" className="h-8 max-w-[72px] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--acc))]/25 text-sm font-bold text-[rgb(var(--acc))]">
                  {zapOsd.name.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{zapOsd.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/45">
                  {zapOsd.group ?? 'Chaîne'} · {zapOsd.n}/{zapOsd.total}
                </p>
              </div>
              <span className="ml-1 h-8 w-1 rounded-full bg-[rgb(var(--acc))]" />
            </div>
          )}
        </div>
        {current && (
          <div className="mt-2 text-xs text-white/60">
            <p className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              En direct : <span className="font-semibold text-white/90">{current.name}</span>
            </p>
            {epgOf(current) && (
              <p className="mt-1 pl-4 text-white/45">
                <span className="text-white/70">{decodeEntities(epgOf(current)!.now)}</span>
                {epgOf(current)!.next ? <> · suivi de « {decodeEntities(epgOf(current)!.next!)} »</> : null}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 px-5 md:px-12">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une chaîne…" aria-label="Rechercher une chaîne" className="w-full rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-[rgb(var(--acc))] outline-none" />
      </div>
      <div className="mt-3 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-5 pb-1 md:px-12">
        <button onClick={() => setGroup(group === '★ Favoris' ? null : '★ Favoris')} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${group === '★ Favoris' ? 'border-amber-400 text-amber-400' : 'border-amber-400/30 text-amber-400/70 hover:text-amber-300'}`}>
          ★ Favoris ({favs.size})
        </button>
        <button
          onClick={() => setGroup(null)}
          className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${!group ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]' : 'border-white/10 text-white/60 hover:text-white'}`}
        >
          Toutes ({channels.length})
        </button>
        {groups.map(([g, n]) => (
          <button
            key={g}
            onClick={() => setGroup(g === group ? null : g)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${group === g ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]' : 'border-white/10 text-white/60 hover:text-white'}`}
          >
            {g} ({n})
          </button>
        ))}
        <button onClick={load} aria-label="Recharger" className="ml-auto rounded-full border border-white/10 p-2 text-white/50 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading && <p className="mt-10 px-5 text-sm text-white/40 md:px-12">Chargement des chaînes…</p>}
      {error && <p className="mt-10 px-5 text-sm text-red-400 md:px-12">{error}</p>}

      {!loading && !error && (
        <div className="mt-6 grid grid-cols-2 gap-3 px-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 md:px-12">
          {visible.map((ch) => (
            <button
              key={ch.name + ch.group}
              onClick={() => play(ch)}
              aria-label={ch.name}
              className={`group relative aspect-video overflow-hidden rounded-xl border text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(var(--acc))] ${
                current?.name === ch.name && current?.group === ch.group
                  ? 'border-[rgb(var(--acc))] bg-gradient-to-b from-[rgb(var(--acc))]/15 to-white/[0.03] shadow-[0_0_28px_rgba(var(--acc),0.35)]'
                  : 'border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] hover:-translate-y-0.5 hover:border-white/30 hover:from-white/[0.12]'
              }`}
            >
              {/* Halo décoratif */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(var(--acc),0.10),transparent_65%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
              {/* Badge LIVE */}
              {current?.name === ch.name && current?.group === ch.group && (
                <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-[rgb(var(--acc))] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
                  En direct
                </span>
              )}
              {/* Étoile favori */}
              <span
                role="button"
                tabIndex={-1}
                aria-label="Favori"
                onClick={(e) => { e.stopPropagation(); toggleFav(ch) }}
                className={`absolute right-2 top-2 rounded-full bg-black/40 p-1 text-sm leading-none backdrop-blur transition-opacity ${
                  favs.has(ch.name + '|' + ch.group) ? 'text-amber-400 opacity-100' : 'text-white/60 opacity-0 group-hover:opacity-100'
                }`}
              >
                {favs.has(ch.name + '|' + ch.group) ? '★' : '☆'}
              </span>
              {/* Logo centré */}
              <div className="flex h-full w-full items-center justify-center px-3 pb-10 pt-5">
                {ch.logo ? (
                  <img src={ch.logo} alt="" loading="lazy" className="max-h-12 w-auto max-w-[80%] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--acc))]/25 text-xl font-bold text-[rgb(var(--acc))]">
                    {ch.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              {/* Nom + programme en bas */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-6">
                <span className="block truncate text-xs font-semibold text-white">{ch.name}</span>
                {epgOf(ch)?.now && (
                  <span className="mt-0.5 block truncate text-[10px] text-[rgb(var(--acc))]/90">{decodeEntities(epgOf(ch)!.now)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
