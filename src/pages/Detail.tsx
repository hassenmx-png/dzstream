import { useEffect, useMemo, useRef, useState } from 'react'
import { getSimklWatched } from '@/lib/simkl'
import {
  ArrowLeft, Bookmark, BookmarkCheck, CalendarClock, Check, ChevronDown, Clock, Play, RefreshCw, Satellite, SlidersHorizontal, Star, Youtube, Users,, Dices } from 'lucide-react'
import type { Episode, MediaType, MetaFull, MetaPreview, Stream, SubtitleTrack } from '@/types'
import { fetchCatalog, GENRE_FR } from '@/lib/cinemeta'
import {
  fetchAllStreams, fetchAllSubtitles, fetchMetaAny, getDebrid, hasRiskyAudio, isDebridDown, isDebridStream, streamAudio, streamKind, streamQuality, streamSeeders, watchabilityScore, getAddons, cachedStreams, cacheStreams,
} from '@/lib/addons'
import { episodeStreamId, useLibrary, useProgress } from '@/lib/library'
import { setRating, useRatings } from '@/lib/ratings'
import { fetchMetaFr } from '@/lib/tmdbfr'
import { fetchExtras, fetchRecs, fetchRatings, type AggRatings, type TmdbExtras } from '@/lib/tmdbApi'
import { dominantColor, withAlpha } from '@/lib/color'
import { useNav } from '@/lib/nav'
import { readJSON, writeJSON } from '@/lib/store'
import { toast } from '@/lib/toast'
import SourceColumns from '@/components/SourceColumns'
import Row from '@/components/Row'

/** Sélecteur de saison façon Netflix : bouton panneau, pas de <select> natif. */
function SeasonPicker({
  seasons,
  current,
  counts,
  onChange,
}: {
  seasons: number[]
  current: number
  counts: Record<number, number>
  onChange: (s: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-md border border-white/15 bg-[#0d0d0d] px-4 py-2 text-sm font-bold transition-colors hover:border-[rgb(var(--acc))]/50"
      >
        Saison {current}
        <span className="text-xs font-normal text-white/35">{counts[current] ?? 0} ép.</span>
        <ChevronDown size={15} className={`text-white/50 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="preview-in absolute right-0 top-full z-30 mt-2 max-h-80 w-60 overflow-y-auto rounded-md border border-white/10 bg-[#0d0d0d]/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)] backdrop-blur">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => {
                onChange(s)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                s === current
                  ? 'bg-[rgb(var(--acc))]/10 font-bold text-[rgb(var(--acc))]'
                  : 'text-white/75 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                Saison {s}
                {s === current && <Check size={13} />}
              </span>
              <span className="font-mono text-[11px] text-white/30">{counts[s] ?? 0} ép.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Préférences de lecture automatique (style Nuvio), persistées. */
type AutoPrefs = {
  maxQ: 'any' | '4K' | '1080P' | '720P'
  audio: 'any' | 'VF' | 'MULTI' | 'VOSTFR'
  noHevc: boolean
  minSeeders: number
  autoOpen: boolean
}
const AUTO_DEFAULTS: AutoPrefs = { maxQ: 'any', audio: 'any', noHevc: false, minSeeders: 0, autoOpen: false }
const AUTO_QS = [['any', 'MAXIMALE'], ['4K', '4K'], ['1080P', '1080p'], ['720P', '720p']] as const
const AUTO_AUDIOS = [['any', 'INDIFF.'], ['VF', 'VF'], ['MULTI', 'MULTI'], ['VOSTFR', 'VOSTFR']] as const
const AUTO_SEEDERS = [[0, 'AUCUN'], [5, '5+'], [10, '10+'], [20, '20+']] as const
const AUTO_BOOL = [[false, 'NON'], [true, 'OUI']] as const

/** Bouton + panneau des règles de choix automatique de la meilleure source. */
function AutoPlayPrefsBtn({ prefs, onChange }: { prefs: AutoPrefs; onChange: (p: Partial<AutoPrefs>) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  function seg<T extends string | number | boolean>(opts: readonly (readonly [T, string])[], val: T, set: (v: T) => void) {
    return (
      <div className="flex overflow-hidden rounded border border-white/15 text-[10px] font-mono">
        {opts.map(([v, l]) => (
          <button key={String(v)} onClick={() => set(v)} className={`px-2 py-1 transition-colors ${val === v ? 'bg-[rgb(var(--acc))] font-bold text-white' : 'text-white/50 hover:text-white'}`}>{l}</button>
        ))}
      </div>
    )
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Préférences de lecture automatique"
        aria-expanded={open}
        className={`flex h-full min-h-[44px] items-center rounded-sm border px-3.5 transition-colors ${open ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]' : 'border-white/25 bg-white/5 hover:bg-white/15'}`}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative max-h-[75vh] w-80 space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-[#0d0d0d] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Lecture auto — règles de choix</p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/60">Qualité max</span>
            {seg(AUTO_QS, prefs.maxQ, (v) => onChange({ maxQ: v }))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/60">Audio préféré</span>
            {seg(AUTO_AUDIOS, prefs.audio, (v) => onChange({ audio: v }))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/60">Exclure HEVC/H265</span>
            {seg(AUTO_BOOL, prefs.noHevc, (v) => onChange({ noHevc: v }))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/60">Seeders min (P2P)</span>
            {seg(AUTO_SEEDERS, prefs.minSeeders, (v) => onChange({ minSeeders: v }))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <span className="text-[11px] text-white/60">Lecture auto à l'ouverture</span>
            {seg(AUTO_BOOL, prefs.autoOpen, (v) => onChange({ autoOpen: v }))}
          </div>
          <p className="text-[10px] leading-relaxed text-white/35">S'applique au bouton « Regarder », à l'enchaînement des épisodes et à la chaîne de repli.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Badges de notes agrégées (style Nuvio) à côté de l'étoile IMDb. */
function RatingsBadges({ id }: { id: string }) {
  const [r, setR] = useState<AggRatings | null>(null)
  useEffect(() => {
    if (!/^tt\d+/.test(id)) return
    let alive = true
    fetchRatings(id)
      .then((x) => { if (alive) setR(x) })
      .catch(() => { /* silencieux */ })
    return () => { alive = false }
  }, [id])
  if (!r) return null
  const badges: { label: string; value: string; cls: string }[] = []
  if (r.tmdb) badges.push({ label: 'TMDB', value: String(r.tmdb), cls: 'border-emerald-400/50 text-emerald-300' })
  if (r.imdb) badges.push({ label: 'IMDb', value: r.imdb, cls: 'border-amber-400/50 text-amber-300' })
  if (r.rt) badges.push({ label: 'RT', value: r.rt, cls: (r.rtVal ?? 0) >= 60 ? 'border-lime-400/50 text-lime-300' : 'border-red-400/50 text-red-300' })
  if (r.metacritic) badges.push({ label: 'Metacritic', value: r.metacritic, cls: 'border-yellow-400/50 text-yellow-300' })
  if (!badges.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5" title={r.tmdbVotes ? `${r.tmdbVotes.toLocaleString('fr-FR')} votes TMDB` : undefined}>
      {badges.map((b) => (
        <span key={b.label} className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold ${b.cls}`}>
          <span className="opacity-60">{b.label}</span> {b.value}
        </span>
      ))}
    </span>
  )
}

type SourceFilter = 'all' | 'torrent' | 'http'

export default function DetailPage({ id, type }: { id: string; type: MediaType }) {
  const { go, play, back } = useNav()
  // Parallaxe cinématique : le backdrop glisse plus lentement que le scroll
  // (effet de profondeur façon plateformes VOD). rAF-brodé, passif, sans état.
  const parallaxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = parallaxRef.current
    if (!el) return
    let raf = 0
    let visible = true
    // Zéro calcul quand le hero est hors écran (scroll profond dans la fiche)
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { rootMargin: '25% 0px' })
    io.observe(el)
    const apply = () => {
      raf = 0
      // translate3d : couche GPU dédiée ; pixels entiers : pas de re-raster sous-pixel
      el.style.transform = `translate3d(0, ${Math.round(window.scrollY * 0.28)}px, 0)`
    }
    const onScroll = () => {
      if (raf || !visible) return
      raf = requestAnimationFrame(apply)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  // Préchauffe le chunk du lecteur (lazy) pendant que l'utilisateur lit la
  // fiche : au clic sur une source, tout est déjà là → lecture instantanée
  // et plein écran auto mobile toujours dans la fenêtre du geste tactile.
  useEffect(() => { void import('@/components/Player') }, [])
  const [meta, setMeta] = useState<MetaFull | null>(null)
  // Couche métadonnées françaises (TMDB) : synopsis, genres, résumés d'épisodes
  const [metaFr, setMetaFr] = useState<MetaFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState(1)
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null)
  const sourcesRef = useRef<HTMLElement>(null)
  const [similar, setSimilar] = useState<MetaPreview[]>([])
  // Catalogue boosté : bande-annonce FR, casting photo, réalisateurs (TMDB)
  const [extras, setExtras] = useState<TmdbExtras | null>(null)
  const [recs, setRecs] = useState<MetaPreview[]>([])

  const [streams, setStreams] = useState<Stream[] | null>(null)
  const [streamsLoading, setStreamsLoading] = useState(false)
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [quality, setQuality] = useState<'all' | '1080P' | '720P' | '4K'>('all')
  const [audioFilter, setAudioFilter] = useState<'all' | 'fr' | 'vostfr'>('all')
  // 🎯 FR sûr : n'afficher que les sources dont le français est PROUVÉ
  // (VF explicite ou VOSTFR explicite dans le titre). Activé par défaut.
  const [frOnly, setFrOnly] = useState(true)
  // Préférences de lecture auto (style Nuvio) : qualité max, audio préféré,
  // exclusion HEVC, seeders minimum, lecture auto à l'ouverture.
  const [autoPrefs, setAutoPrefs] = useState<AutoPrefs>(() => ({
    ...AUTO_DEFAULTS,
    ...readJSON<Partial<AutoPrefs>>('novastream:autoplay-prefs', {}),
  }))
  const updateAutoPrefs = (patch: Partial<AutoPrefs>) => {
    const next = { ...autoPrefs, ...patch }
    setAutoPrefs(next)
    writeJSON('novastream:autoplay-prefs', next)
    // Re-tri immédiat des sources déjà chargées selon les nouvelles règles
    if (streams) setStreams((prev) => (prev ? [...prev].sort((a, b) => scoreWithPrefs(b) - scoreWithPrefs(a)) : prev))
  }
  const scoreWithPrefs = (s: Stream): number => {
    const premium = !!getDebrid() && !isDebridDown() && isDebridStream(s)
    let sc = watchabilityScore(s, { cloud: premium }) + (premium ? 2000 : 0)
    if (autoPrefs.audio !== 'any' && streamAudio(s) === autoPrefs.audio) sc += 500
    if (autoPrefs.noHevc && /(hevc|h[-.]?265|x265)/i.test(`${s.title ?? ''} ${s.name ?? ''}`)) sc -= 300
    if (!premium && autoPrefs.minSeeders > 0 && (s.infoHash || streamKind(s) === 'torrent') && streamSeeders(s) < autoPrefs.minSeeders) sc -= 400
    if (autoPrefs.maxQ !== 'any') {
      const rank: Record<string, number> = { '720P': 2, '1080P': 3, '4K': 4, '8K': 5 }
      const cap = autoPrefs.maxQ === '4K' ? 4 : autoPrefs.maxQ === '1080P' ? 3 : 2
      if ((rank[streamQuality(s)] ?? 0) > cap) sc -= 800
    }
    return sc
  }
  const { byId: ratingsById } = useRatings()
  const myRating = ratingsById.get(id) ?? null
  const [hoverStar, setHoverStar] = useState(0)
  // Halo ambiant : couleur dominante de l'affiche (null = CORS refusé → pas de halo)
  const [glow, setGlow] = useState<string | null>(null)
  useEffect(() => {
    setGlow(null)
    let alive = true
    if (meta?.poster) {
      void dominantColor(meta.poster).then((c) => {
        if (alive && c) setGlow(c)
      })
    }
    return () => {
      alive = false
    }
  }, [meta?.poster])

  const { toggle, has } = useLibrary()
  const { items: progressItems } = useProgress()

  useEffect(() => {
    setLoading(true)
    setMeta(null)
    setMetaFr(null)
    setStreams(null)
    setSelectedEpisode(null)
    setSeason(1)
    setExtras(null)
    setRecs([])
    // Couche FR (TMDB) en parallèle : synopsis + genres + résumés d'épisodes
    // en français quand ils existent. Silencieux si indisponible.
    fetchMetaFr(type, id).then(setMetaFr)
    // Catalogue boosté (IDs IMDB seulement) : BA française, casting photo,
    // recommandations TMDB — tout en parallèle, jamais bloquant.
    if (/^tt\d+/.test(id)) {
      fetchExtras(id).then(setExtras)
      fetchRecs(id).then(setRecs)
    }
    fetchMetaAny(type, id)
      .then((m) => {
        setMeta(m)
        // Contenus similaires : même genre principal (Cinemeta, IDs IMDB seulement)
        if (m?.genres?.length && /^tt\d+/.test(id)) {
          fetchCatalog(type, { genre: m.genres[0] })
            .then((list) => setSimilar(list.filter((x) => x.id !== id).slice(0, 20)))
            .catch(() => {})
        }
      })
      .catch(() => setMeta(null))
      .finally(() => setLoading(false))
    window.scrollTo(0, 0)
  }, [id, type])

  // Une œuvre est traitée comme une série si elle a des épisodes, même si son
  // type addon est exotique (anime…) : kitsu:, mal:, etc.
  const isSeries = type === 'series' || (meta?.videos?.length ?? 0) > 0

  // Épisodes déjà vus selon Simkl (historique rapatrié).
  const simklEpisodes = useMemo(() => new Set(getSimklWatched().episodes[id] ?? []), [id])

  const seasons = useMemo(() => {
    if (!meta?.videos?.length) return []
    return [...new Set(meta.videos.map((v) => v.season))].sort((a, b) => a - b)
  }, [meta])

  const episodes = useMemo(
    () => meta?.videos?.filter((v) => v.season === season).sort((a, b) => a.episode - b.episode) ?? [],
    [meta, season],
  )

  // Nombre d'épisodes par saison (affiché dans le sélecteur)
  const seasonCounts = useMemo(() => {
    const acc: Record<number, number> = {}
    for (const v of meta?.videos ?? []) acc[v.season] = (acc[v.season] ?? 0) + 1
    return acc
  }, [meta])

  const currentEpisode = selectedEpisode ?? episodes[0] ?? null

  const currentStreamId = isSeries
    ? currentEpisode
      ? episodeStreamId(id, currentEpisode.season, currentEpisode.episode)
      : episodeStreamId(id, 1, 1)
    : id

  const nextEpisode = useMemo(() => {
    if (!isSeries || !meta?.videos || !currentEpisode) return null
    const sorted = [...meta.videos].sort((a, b) => a.season - b.season || a.episode - b.episode)
    const idx = sorted.findIndex(
      (v) => v.season === currentEpisode.season && v.episode === currentEpisode.episode,
    )
    return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null
  }, [meta, currentEpisode, isSeries])

  const prevEpisode = useMemo(() => {
    if (!isSeries || !meta?.videos || !currentEpisode) return null
    const sorted = [...meta.videos].sort((a, b) => a.season - b.season || a.episode - b.episode)
    const idx = sorted.findIndex(
      (v) => v.season === currentEpisode.season && v.episode === currentEpisode.episode,
    )
    return idx > 0 ? sorted[idx - 1] : null
  }, [meta, currentEpisode, isSeries])

  // Progression existante pour reprendre
  const existing = progressItems.find((p) => p.id === currentStreamId || (type === 'movie' && p.baseId === id))

  // Anti-fausse-VF : le titre d une release peut mentir. On sonde le fichier
  // (ffprobe via /api/stream/tc-info, cache serveur 10 min) sur les premieres
  // sources « VF/MULTI » en lien direct ; sans piste FR reelle -> badge retire.
  const verifyFrenchAudio = (list: Stream[]) => {
    const FR = new Set(['fr', 'fre', 'fra', 'fr-ca', 'fr-ca'])
    let probing = 0
    const markLied = (s: Stream) => {
      ;(s as { audioLied?: boolean }).audioLied = true
      setStreams((prev) => (prev ? [...prev] : prev))
    }
    for (const s of list) {
      if (probing >= 4) break
      const a = streamAudio(s)
      if (a !== 'VF' && a !== 'MULTI') continue
      const u = s.url ?? ''
      if (!u.startsWith('http')) continue // torrents P2P : non sondables
      const key = 'novastream:vfprobe:' + u
      let cached: string[] | null = null
      try { cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') } catch { /* ignore */ }
      if (cached) {
        if (!cached.some((l) => FR.has((l ?? '').toLowerCase()))) markLied(s)
        continue
      }
      probing++
      void fetch(`/api/stream/tc-info?url=${encodeURIComponent(u)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { audioLangs?: string[] } | null) => {
          const langs = j?.audioLangs ?? null
          try { sessionStorage.setItem(key, JSON.stringify(langs)) } catch { /* quota */ }
          if (langs && !langs.some((l) => FR.has((l ?? '').toLowerCase()))) markLied(s)
        })
        .catch(() => { /* sonde indisponible : on garde le badge */ })
    }
  }

  const loadStreams = async (): Promise<Stream[]> => {
    setStreamsLoading(true)
    // Cache session : les sources de CET épisode/film chargées il y a moins
    // de 5 min s'affichent INSTANTANÉMENT — le réseau rafraîchit ensuite en
    // arrière-plan (stale-while-revalidate).
    const cached = cachedStreams(type, currentStreamId)
    if (cached?.length) setStreams(cached)
    else setStreams(null)
    const queries = [fetchAllStreams(type, currentStreamId, (_a, ns) => setStreams((prev: Stream[] | null) => {
      const seen = new Set((prev ?? []).map(x => x.url))
      return [...(prev ?? []), ...ns.filter((x) => !seen.has(x.url))]
    }))]
    // Mapping IMDB (addons anime : Kitsu, MAL…) : on interroge AUSSI les
    // addons avec l'ID IMDB de l'épisode → beaucoup plus de sources torrent,
    // car Torrentio et consorts indexent surtout les IDs IMDB.
    const imdbId = currentEpisode?.imdb_id ?? meta?.imdb_id
    if (imdbId && /^tt\d+/.test(imdbId)) {
      const s = currentEpisode?.imdbSeason ?? 1
      const e = currentEpisode?.imdbEpisode ?? currentEpisode?.episode ?? 1
      const imdbStreamId = isSeries ? `${imdbId}:${s}:${e}` : imdbId
      if (imdbStreamId !== currentStreamId) {
        queries.push(fetchAllStreams(isSeries ? 'series' : 'movie', imdbStreamId))
      }
    }
    const settled = await Promise.all(queries)
    const raw = settled.flatMap((results) => results.flatMap((r) => r.streams))
    // Déduplique (le même torrent peut revenir des deux requêtes)
    const seen = new Set<string>()
    const all = raw.filter((s) => {
      const k = s.infoHash ?? s.url ?? s.title ?? JSON.stringify(s).slice(0, 80)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    // Tri par « regardabilité » : la meilleure source À LANCER en premier
    // (seeders élevés, taille raisonnable, 1080p/720p) plutôt que la plus lourde.
    // Quand un debrid est connecté, ses liens premium (cache instantané,
    // zéro pair nécessaire) passent devant tout le reste.
    // Tri selon les règles de lecture auto (préférences utilisateur).
    all.sort((a, b) => scoreWithPrefs(b) - scoreWithPrefs(a))
    try {
      const httpOnly = all.filter((s) => (s.url ?? '').startsWith('http'))
      if (httpOnly.length) {
        const wr = await fetch('/api/stream/wrap?code=' + encodeURIComponent(localStorage.getItem('accessCode') || ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            urls: httpOnly.map((s) => s.url),
            // Audio Fix : pistes AC3/DTS sur conteneurs H.264 -> transcode via mediaflow.
            // HEVC (265) exclu : le réencodage vidéo serait trop lourd pour le VPS.
            flags: httpOnly.map((s) => {
              const probe = `${(s as { name?: string }).name ?? ''} ${(s as { title?: string }).title ?? ''} ${(s as { description?: string }).description ?? ''}`
              const hevc = /\b(265|hevc|x265|h265)\b/i.test(probe)
              const fix = hasRiskyAudio(s as Parameters<typeof hasRiskyAudio>[0]) && !hevc ? 1 : 0
              if (fix === 1) (s as { audioFix?: boolean }).audioFix = true
              return fix
            }),
          }) })
        if (wr.ok) {
          const { plays } = await wr.json()
          httpOnly.forEach((s, i) => { if (plays?.[i]) s.url = plays[i] })
        }
      }
    } catch {}
    setStreams(all)
    verifyFrenchAudio(all)
    setStreamsLoading(false)
    cacheStreams(type, currentStreamId, all)
    if (all.length === 0) toast('Aucune source trouvée pour ce contenu')
    // Préchauffe la source ★ RECOMMANDÉE : le serveur commence à chercher les
    // pairs et à télécharger le début du film AVANT le clic de l'utilisateur
    // → démarrage quasi instantané quand il appuie dessus. Les liens premium
    // (debrid) sont exclus : déjà instantanés, le P2P serait du gaspillage.
    const top = all.find((s) => s.infoHash && !isDebridStream(s))
    if (top?.infoHash) {
      const trs = (top.sources ?? [])
        .filter((x) => x.startsWith('tracker:'))
        .map((x) => x.slice('tracker:'.length))
        .filter((x) => /^(udp|https?|wss?):\/\//.test(x))
      const trQ = trs.map((t) => `&tr=${encodeURIComponent(t)}`).join('')
      fetch(`/api/stream/torrent?infoHash=${top.infoHash.toLowerCase()}&warm=1${trQ}`).catch(() => {})
    }
    return all
  }

  /**
   * Bouton « Regarder » : lance DIRECTEMENT la meilleure source (tri
   * regardabilité), sans que l'utilisateur ait à chercher dans la liste.
   * Si la liste n'est pas encore chargée, on la charge d'abord.
   */
  const watchBest = async () => {
    if (streamsLoading) return
    const list = streams ?? (await loadStreams())
    const best = list[0]
    if (!best) return // loadStreams a déjà affiché « aucune source »
    const audio = streamAudio(best)
    toast(`Lecture de la meilleure source : ${streamQuality(best)}${audio ? ` · ${audio}` : ''}`)
    void launch(best, undefined, currentEpisode, [], list)
  }

  // Lecture auto à l'ouverture (préférence style Nuvio) : la fiche démarre
  // toute seule sur la meilleure source dès qu'elle est prête.
  useEffect(() => {
    if (!autoPrefs.autoOpen || !meta || streams !== null || streamsLoading) return
    void watchBest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrefs.autoOpen, meta, currentStreamId])

  useEffect(() => {
    setStreams(null)
  }, [currentStreamId])

  // Sélection d'un épisode : on remonte en douceur vers la section sources
  // et on recharge AUTOMATIQUEMENT les sources de CET épisode — plus besoin
  // de re-cliquer « Trouver des sources » ni de traverser la page.
  useEffect(() => {
    if (!selectedEpisode) return
    sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    void loadStreams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEpisode])

  const launch = async (s: Stream, startAt?: number, ep: Episode | null = currentEpisode, tried: string[] = [], list?: Stream[]) => {
    if (!meta) return
    if (s.externalUrl) {
      window.open(s.externalUrl, '_blank')
      return
    }
    toast(`Lecture : ${meta.name}${ep && isSeries ? ` S${ep.season} E${ep.episode}` : ''}`)
    // Récupère les sous-titres, SANS JAMAIS bloquer le lancement : si les
    // addons de sous-titres sont lents/muets, on part sans (plafond 3,5 s)
    // plutôt que de laisser croire à un bug au clic. 6,5 s : les
    // sources d'anime (UwU) sont lentes mais donnent les meilleurs VOSTFR.
    const subs = await Promise.race([
      fetchAllSubtitles({
        type,
        id: ep && isSeries ? episodeStreamId(id, ep.season, ep.episode) : id,
        videoHash: s.infoHash,
        videoSize: s.behaviorHints?.videoSize,
        filename: s.behaviorHints?.filename,
        name: meta?.name,
      }).catch(() => [] as SubtitleTrack[]),
      new Promise<SubtitleTrack[]>((resolve) => setTimeout(() => resolve([]), 6500)),
    ])

    // Source P2P brute (infoHash sans URL) : on construit l'URL du moteur
    // torrent du serveur, qui sert le fichier en HTTP direct. Sans ça, le
    // player reçoit un flux sans URL et se referme instantanément — d'où le
    // « clic qui ne fait rien ».
    let playStream = s
    if (!s.url && s.infoHash) {
      const trs = (s.sources ?? [])
        .filter((x) => x.startsWith('tracker:'))
        .map((x) => x.slice('tracker:'.length))
        .filter((x) => /^(udp|https?|wss?):\/\//.test(x))
      const fileIdx = (s as unknown as { fileIdx?: number }).fileIdx
      playStream = {
        ...s,
        url: `/api/stream/torrent?infoHash=${encodeURIComponent(s.infoHash.toLowerCase())}${typeof fileIdx === 'number' ? `&fileIdx=${fileIdx}` : ''}${trs.map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`,
      }
    }
    play({
      stream: playStream,
      meta: {
        id: ep && isSeries ? episodeStreamId(id, ep.season, ep.episode) : id,
        baseId: id,
        type,
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
      },
      episodeLabel: ep && isSeries ? `S${ep.season} E${ep.episode}` : undefined,
      startAt,
      subtitles: subs,
      onNextEpisode: isSeries && ep ? () => playNextEpisode(ep) : undefined,
    onPrevEpisode: prevEpisode ? () => playNextEpisode(prevEpisode) : undefined,
    prevEpisodeLabel: prevEpisode ? `S${prevEpisode.season} E${prevEpisode.episode}` : undefined,
      nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season} E${nextEpisode.episode}` : undefined,
      // Repli automatique : si cette source ne répond pas (swarm mort, cloud
      // bloqué…), le lecteur enchaîne tout seul sur la suivante. La chaîne
      // MÉLANGE P2P et liens directs HTTP : si le P2P est bloqué sur le
      // réseau de l'utilisateur, les essais suivants passent par du direct
      // (aucun pair nécessaire). Sources déjà essayées exclues (anti
      // ping-pong) — clé = infoHash ou URL.
      fallbackStreams: (() => {
        // IMPORTANT : utiliser la liste EXPLICITE si fournie. L'état
        // `streams` (setState) n'est pas à jour dans cette closure quand on
        // vient de charger la liste (bouton Regarder) → la chaîne de repli
        // serait vide au premier lancement.
        const pool = (list ?? streams ?? [])
          .filter((x) => {
            const k = x.infoHash ?? x.url
            return k && k !== (s.infoHash ?? s.url) && !tried.includes(k)
          })
          .sort((a, b) => scoreWithPrefs(b) - scoreWithPrefs(a))
        // Mix obligatoire : les 4 meilleurs au global + 3 meilleurs HORS
        // premium. Si la clé debrid est refusée, les liens premium échouent
        // TOUS — sans ce mix, la chaîne de repli n'aurait que du premium et
        // la lecture s'arrêterait au lieu de retomber sur du gratuit.
        const free = pool.filter((x) => !isDebridStream(x))
        const mixed = [...pool.slice(0, 4), ...free.slice(0, 3)]
        const seen = new Set<string>()
        return mixed
          .filter((x) => {
            const k = x.infoHash ?? x.url ?? ''
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          .slice(0, 6)
      })(),
      // Pool complet : le sélecteur « Version » du lecteur (VF / VOSTFR / VO)
      // pioche dedans pour changer de langue audio à la volée.
      streamsPool: (list ?? streams ?? [])
        .slice()
        .sort((a, b) => scoreWithPrefs(b) - scoreWithPrefs(a)),
      // startAt : quand l'utilisateur change de VERSION (langue) depuis le
      // lecteur, on reprend exactement où il en était.
      onFallback: (next, resumeAt) => { void launch(next, resumeAt, ep, [...tried, s.infoHash ?? s.url ?? ''], list) },
      triedHashes: tried,
    })
  }

  /** Enchaîne automatiquement sur l'épisode suivant (première source dispo). */
  const playNextEpisode = async (fromEp: Episode) => {
    if (!meta?.videos) return
    const sorted = [...meta.videos].sort((a, b) => a.season - b.season || a.episode - b.episode)
    const idx = sorted.findIndex((v) => v.season === fromEp.season && v.episode === fromEp.episode)
    const next = idx >= 0 ? sorted[idx + 1] : null
    if (!next) return
    setSeason(next.season)
    setSelectedEpisode(next)
    toast(`Épisode suivant : S${next.season} E${next.episode}`)
    const results = await fetchAllStreams('series', episodeStreamId(id, next.season, next.episode))
    const all = results.flatMap((r) => r.streams)
    // Tri par « regardabilité » : la meilleure source À LANCER en premier
    // (seeders élevés, taille raisonnable, 1080p/720p) plutôt que la plus lourde.
    // Quand un debrid est connecté, ses liens premium (cache instantané,
    // zéro pair nécessaire) passent devant tout le reste.
    // Tri selon les règles de lecture auto (préférences utilisateur).
    all.sort((a, b) => scoreWithPrefs(b) - scoreWithPrefs(a))
    setStreams(all)
    if (all[0]) launch(all[0], undefined, next, [], all)
  }

  if (loading) {
    // Fantôme de la fiche : l'utilisateur voit la structure arriver au lieu
    // d'attendre devant un spinner — l'app paraît instantanée.
    return (
      <div className="min-h-screen pb-24">
        <div className="skeleton h-[78vh] min-h-[520px] w-full" />
        <div className="px-5 md:px-12 -mt-40 relative space-y-4">
          <div className="flex items-end gap-8">
            <div className="skeleton hidden md:block w-44 aspect-[2/3] rounded-md" />
            <div className="flex-1 space-y-3 pb-2">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-10 w-2/3 max-w-md rounded" />
              <div className="skeleton h-3 w-44 rounded" />
            </div>
          </div>
          <div className="flex gap-3 pt-3">
            <div className="skeleton h-11 w-36 rounded-sm" />
            <div className="skeleton h-11 w-32 rounded-sm" />
            <div className="skeleton h-11 w-40 rounded-sm" />
          </div>
        </div>
        <div className="px-5 md:px-12 mt-10 space-y-3 max-w-3xl">
          <div className="skeleton h-3 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-11/12 rounded" />
          <div className="skeleton h-3 w-4/5 rounded" />
        </div>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-white/60">Impossible de charger ce contenu.</p>
        <button onClick={back} className="rounded-sm bg-[rgb(var(--acc))] px-5 py-2 text-sm font-bold text-white">
          Retour
        </button>
      </div>
    )
  }

  const inList = has(id)
  const addonsInstalled = getAddons().length > 0
  // BA : TMDB donne la version FRANÇAISE en priorité, sinon celle de Cinemeta
  const trailerYtId = extras?.trailerYtId ?? meta.trailerStreams?.[0]?.ytId

  const filteredStreams = (streams ?? []).filter((s) => {
    if (filter !== 'all') {
      const k = streamKind(s)
      if (filter === 'torrent' ? k !== 'torrent' : k === 'torrent') return false
    }
    if (quality !== 'all') {
      const q = streamQuality(s)
      if (quality === '4K' ? !(q === '4K' || q === '8K') : q !== quality) return false
    }
    if (audioFilter === 'fr' && !(streamAudio(s) === 'VF' || streamAudio(s) === 'MULTI')) return false
    if (audioFilter === 'vostfr' && streamAudio(s) !== 'VOSTFR') return false
    if (frOnly && streamAudio(s) === null && (!isDebridStream(s) || (s as { audioLied?: boolean }).audioLied)) return false
    return true
  })

  // Retrait des doublons (même URL via plusieurs addons)
  const seenStreamUrls = new Set<string>()
  const usableStreams = filteredStreams.filter((s) => {
    const key = (s.url || '').toLowerCase()
    if (!key) return true
    if (seenStreamUrls.has(key)) return false
    seenStreamUrls.add(key)
    return true
  })

  // Tri par pertinence : addons débridés ⚡ d'abord, puis FR/MULTI, puis alpha
  const addonPriorities = new Map<string, { debrid: number; fr: number }>()
  for (const s of usableStreams) {
    const name = s.addonName || 'Autre'
    if (!addonPriorities.has(name)) addonPriorities.set(name, { debrid: 0, fr: 0 })
    const p = addonPriorities.get(name)!
    if (isDebridStream(s)) p.debrid++
    const a = streamAudio(s)
    if (a === 'VF' || a === 'MULTI') p.fr++
  }
  const addonSortedStreams = [...usableStreams].sort((a, b) => {
    const an = a.addonName || 'Autre'
    const bn = b.addonName || 'Autre'
    if (an !== bn) {
      const pa = addonPriorities.get(an) ?? { debrid: 0, fr: 0 }
      const pb = addonPriorities.get(bn) ?? { debrid: 0, fr: 0 }
      if ((pb.debrid > 0) !== (pa.debrid > 0)) return pb.debrid > 0 ? 1 : -1
      if (pb.debrid !== pa.debrid) return pb.debrid - pa.debrid
      if (pb.fr !== pa.fr) return pb.fr - pa.fr
      return an.localeCompare(bn)
    }
    return 0
  })
  const bestStreamUrl = usableStreams[0]?.url ?? null

  // Compteurs par qualité pour les puces du sélecteur
  const qualityCounts = (streams ?? []).reduce<Record<string, number>>((acc, s) => {
    const q = streamQuality(s)
    const key = q === '4K' || q === '8K' ? '4K' : q
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  // Compteur de sources avec audio français (VF ou MULTI)
  const frCount = (streams ?? []).filter((s) => streamAudio(s) === 'VF' || streamAudio(s) === 'MULTI').length

  return (
    <div className="min-h-screen pb-24">
      {/* Backdrop avec pan cinématique + halo ambiant de la couleur dominante */}
      <div className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
        {meta.background && (
          <div ref={parallaxRef} className="absolute inset-0">
            <img src={meta.background} alt="" fetchPriority="high" decoding="async" className="h-full w-full scale-[1.15] object-cover kenburns" />
          </div>
        )}
        {glow && (
          <div
            aria-hidden
            className="ambient-glow absolute inset-0 mix-blend-screen"
            style={{
              background: `radial-gradient(75% 90% at 50% 100%, ${withAlpha(glow, 0.5)}, transparent 72%), radial-gradient(55% 60% at 85% 0%, ${withAlpha(glow, 0.3)}, transparent 75%)`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050505]/95 via-[#050505]/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-56 fade-bottom" />
        <button
          onClick={back}
          className="absolute left-4 md:left-12 top-[4.5rem] z-30 flex min-h-[44px] items-center gap-2 rounded-full border border-white/25 bg-black/85 px-5 shadow-lg backdrop-blur-md text-sm font-mono-label font-semibold text-white/95 transition-colors hover:text-[rgb(var(--acc))] hover:border-[rgb(var(--acc))]/60"
        >
          <ArrowLeft size={16} /> RETOUR
        </button>

        <div className="absolute bottom-10 left-5 md:left-12 right-5 md:right-12 flex items-end gap-8 view-enter">
          {meta.poster && (
            <img
              decoding="async"
              src={meta.poster}
              alt={meta.name}
              data-flight-target
              className="hidden md:block w-44 rounded-md poster-shadow"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="bracket-label mb-3 rise-in" style={{ animationDelay: '80ms' }}>{type === 'movie' ? 'Film' : type === 'series' ? 'Série' : 'Anime'}</p>
            <div className="rise-in" style={{ animationDelay: '160ms' }}>
              {meta.logo ? (
                <img src={meta.logo} alt={meta.name} decoding="async" className="max-h-24 md:max-h-32 max-w-full object-contain object-left" />
              ) : (
                <h1 className="font-display text-4xl md:text-7xl font-black tracking-tight leading-[0.95] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">{meta.name}</h1>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/70 rise-in" style={{ animationDelay: '240ms' }}>
              {meta.imdbRating && (
                <span className="flex items-center gap-1 font-semibold text-[rgb(var(--acc))]">
                  <Star size={14} fill="currentColor" /> {meta.imdbRating}
                </span>
              )}
              <RatingsBadges id={id} />
              {meta.releaseInfo && <span>{meta.releaseInfo}</span>}
              {meta.runtime && (
                <span className="flex items-center gap-1"><Clock size={13} /> {meta.runtime}</span>
              )}
              {(metaFr?.genres?.length ? metaFr.genres : meta.genres)?.map((g) => (
                <span key={g} className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11px]">
                  {GENRE_FR[g] ?? g}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 rise-in" style={{ animationDelay: '320ms' }}>
              {existing && existing.stream ? (
                <button
                  onClick={() => launch(existing.stream!, existing.time)}
                  className="btn-aurora flex items-center gap-2 rounded-sm px-8 py-3.5 text-sm font-bold text-white shadow-[0_10px_44px_-10px_rgba(var(--acc),0.65)] hover:scale-105 transition-transform"
                >
                  <Play size={17} fill="currentColor" /> Reprendre ({Math.round((existing.time / (existing.duration || 1)) * 100)}%)
                </button>
              ) : (
                <button
                  onClick={() => void watchBest()}
                  disabled={streamsLoading}
                  className="btn-aurora flex items-center gap-2 rounded-sm px-8 py-3.5 text-sm font-bold text-white shadow-[0_10px_44px_-10px_rgba(var(--acc),0.65)] hover:scale-105 transition-transform disabled:opacity-60"
                >
                  {streamsLoading
                    ? <RefreshCw size={16} className="animate-spin" />
                    : <Play size={17} fill="currentColor" />}
                  {streamsLoading ? 'Recherche…' : 'Regarder'}
                </button>
              )}
              <AutoPlayPrefsBtn prefs={autoPrefs} onChange={updateAutoPrefs} />
              <button
                onClick={() => {
                  toggle({ id, type, name: meta.name, poster: meta.poster })
                  toast(inList ? 'Retiré de ta liste' : 'Ajouté à ta liste')
                }}
                className={`flex items-center gap-2 rounded-sm border px-5 py-3 text-sm font-semibold transition-colors ${
                  inList
                    ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]'
                    : 'border-white/25 bg-white/5 hover:bg-white/15'
                }`}
              >
                {inList ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                {inList ? 'Dans ma liste' : 'Ma liste'}
              </button>
              {trailerYtId && (
                <button
                  onClick={() =>
                    play({
                      stream: { ytId: trailerYtId, name: 'Bande-annonce' },
                      meta: { id: `${id}-trailer`, baseId: id, type, name: `${meta.name} — Bande-annonce`, poster: meta.poster, background: meta.background },
                    })
                  }
                  className="flex items-center gap-2 rounded-sm border border-white/25 bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/15 transition-colors"
                >
                  <Youtube size={16} className="text-red-500" /> Bande-annonce
                </button>
              )}
            </div>
            {/* Note personnelle ★1-5 (synchronisée avec le coffre) */}
            <div className="mt-4 flex items-center gap-3 rise-in" style={{ animationDelay: '400ms' }}>
              <span className="text-[10px] font-mono-label uppercase tracking-widest text-white/35">Ta note</span>
              <div className="flex gap-0.5" onMouseLeave={() => setHoverStar(0)}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const shown = hoverStar || myRating || 0
                  const filled = n <= shown
                  return (
                    <button
                      key={n}
                      onMouseEnter={() => setHoverStar(n)}
                      onClick={() => {
                        if (myRating === n) {
                          setRating(id, null)
                          toast('Note retirée')
                        } else {
                          setRating(id, n, { name: meta.name, poster: meta.poster, type })
                          toast(`Ta note : ${n}/5`)
                        }
                      }}
                      aria-label={`Noter ${n}/5`}
                      className="p-0.5 transition-transform hover:scale-125"
                    >
                      <Star
                        size={20}
                        className={filled ? 'text-[rgb(var(--acc))]' : 'text-white/25'}
                        fill={filled ? 'currentColor' : 'none'}
                      />
                    </button>
                  )
                })}
              </div>
              {myRating ? (
                <span className="text-xs font-mono text-[rgb(var(--acc))]/90">{myRating}/5</span>
              ) : (
                <span className="text-[11px] text-white/30">touche une étoile</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 md:px-12 mt-8 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div className="space-y-10 min-w-0">
          {/* Sources */}
          <section ref={sourcesRef} className="scroll-mt-20">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="section-title">Sources de lecture</h2>
              <div className="flex items-center gap-2">
                {streams && streams.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Sélecteur de qualité : 1080p en tête (choix par défaut) */}
                    <div className="flex rounded-sm border border-white/15 overflow-hidden text-[10px] font-mono-label">
                      {(['all', '1080P', '720P', '4K'] as const).map((q) => {
                        const count = q === 'all' ? streams.length : qualityCounts[q] ?? 0
                        if (q !== 'all' && count === 0) return null
                        return (
                          <button
                            key={q}
                            onClick={() => setQuality(q)}
                            className={`px-3 py-2 transition-colors ${
                              quality === q ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'
                            }`}
                          >
                            {q === 'all' ? 'TOUTES' : q}
                            <span className="ml-1 opacity-60">{count}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex rounded-sm border border-white/15 overflow-hidden text-[10px] font-mono-label">
                      {([['all', 'TOUTES'], ['torrent', 'P2P'], ['http', 'DIRECT']] as [SourceFilter, string][]).map(([f, label]) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-2 transition-colors ${
                            filter === f ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Filtre audio : le français d'abord */}
                    <div className="flex rounded-sm border border-white/15 overflow-hidden text-[10px] font-mono-label">
                      <button
                        onClick={() => setFrOnly(!frOnly)}
                        title="N'afficher que les sources dont le français est prouvé (VF ou VOSTFR explicite)"
                        className={`px-3 py-2 border-r border-white/15 transition-colors ${frOnly ? 'bg-amber-400/20 text-amber-300 font-bold' : 'text-white/40 hover:text-white'}`}
                      >
                        🎯 FR SÛR{frOnly ? ' ✓' : ''}
                      </button>
                      <button
                        onClick={() => setAudioFilter('all')}
                        className={`px-3 py-2 transition-colors ${
                          audioFilter === 'all' ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'
                        }`}
                      >
                        AUDIO
                      </button>
                      <button
                        onClick={() => setAudioFilter('fr')}
                        className={`px-3 py-2 transition-colors ${
                          audioFilter === 'fr' ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'
                        }`}
                      >
                        🇫🇷 FR<span className="ml-1 opacity-60">{frCount}</span>
                      </button>
                      <button
                        onClick={() => setAudioFilter('vostfr')}
                        className={`px-3 py-2 transition-colors ${
                          audioFilter === 'vostfr' ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'
                        }`}
                      >
                        VOSTFR
                      </button>
                    </div>
                  </div>
                )}
                <button
                  onClick={loadStreams}
                  disabled={streamsLoading}
                  className="flex items-center gap-2 rounded-sm border border-[rgb(var(--acc))]/50 px-4 py-2 text-xs font-mono-label text-[rgb(var(--acc))] hover:bg-[rgb(var(--acc))] hover:text-white transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={13} className={streamsLoading ? 'animate-spin' : ''} />
                  {streamsLoading ? 'RECHERCHE…' : 'TROUVER DES SOURCES'}
                </button>
              </div>
            </div>

            {!addonsInstalled && (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-5 text-sm text-amber-200/90">
                <p className="font-semibold mb-1 flex items-center gap-2">
                  <Satellite size={15} /> Aucun addon installé
                </p>
                <p className="text-white/50">
                  DZ STREAM fonctionne comme Stremio : installe des addons (protocole Stremio)
                  pour obtenir des sources de lecture. Va dans l'onglet <button onClick={() => go({ name: 'addons' })} className="text-[rgb(var(--acc))] underline underline-offset-2">Addons</button> et colle l'URL d'un addon.
                </p>
              </div>
            )}

            {streamsLoading && (
              <div className="flex items-center gap-3 py-8 text-white/50 text-sm">
                <div className="h-5 w-5 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
                Interrogation de tes addons en cours…
              </div>
            )}

            {streams && filteredStreams.length === 0 && !streamsLoading && (
              <p className="py-6 text-sm text-white/40">
                Aucune source {filter !== 'all' ? 'de ce type ' : ''}trouvée pour {isSeries ? 'cet épisode' : 'ce contenu'}.
                Essaie un autre épisode, un autre filtre, ou installe d'autres addons.
              </p>
            )}

            {usableStreams.length > 0 && (
              // Liste à hauteur bornée + défilement interne : les sources ne
              // mangent plus toute la page quand il y en a 150. Le voile en
              // bas signale qu'on peut faire défiler.
              <div className="relative">
                <div className="max-h-[430px] md:max-h-[540px] overflow-y-auto overscroll-contain space-y-1.5 pr-1">
                <SourceColumns
                  streams={addonSortedStreams}
                  bestUrl={bestStreamUrl}
                  onLaunch={(s) => launch(s)}
                />
                </div>
                {usableStreams.length > 4 && (
                  <div className="pointer-events-none absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-[#050505] to-transparent" />
                )}
              </div>
            )}
          </section>

          {/* Synopsis */}
          {(metaFr?.description || meta.description) && (
            <section>
              <h2 className="section-title mb-3">Synopsis</h2>
              <p className="text-white/75 leading-relaxed max-w-3xl">{metaFr?.description || meta.description}</p>
            </section>
          )}

          {/* Casting : photos + rôles, cliquable → page de l'acteur */}
          {extras && extras.cast.length > 0 && (
            <section>
              <h2 className="section-title mb-4">Casting</h2>
              <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
                {extras.cast.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => go({ name: 'person', id: p.id })}
                    className="group w-24 shrink-0 text-left"
                  >
                    <div className="aspect-[2/3] w-24 overflow-hidden rounded-md bg-white/5 border border-transparent group-hover:border-[rgb(var(--acc))]/50 transition-colors">
                      {p.photo ? (
                        <img src={p.photo} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-white/20">
                          <Users size={22} />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs font-semibold group-hover:text-[rgb(var(--acc))] transition-colors">{p.name}</p>
                    {p.character && <p className="truncate text-[10px] text-white/40">{p.character}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Épisodes */}
          {isSeries && seasons.length > 0 && (
            <section>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="section-title">Épisodes</h2>
                  <button
                    onClick={() => {
                      const pool = episodes.filter((e) => e.id !== currentEpisode?.id)
                      const pick = pool[Math.floor(Math.random() * pool.length)]
                      if (pick) playNextEpisode(pick)
                    }}
                    title="Lancer un épisode au hasard (parfait pour les sitcoms)"
                    className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/70 transition-colors hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))]"
                  >
                    <Dices size={13} /> Aléatoire
                  </button>
                </div>
                <SeasonPicker
                  seasons={seasons}
                  current={season}
                  counts={seasonCounts}
                  onChange={(s) => {
                    setSeason(s)
                    setSelectedEpisode(null)
                  }}
                />
              </div>
              <div className="space-y-2.5">
                {episodes.map((ep) => {
                  const active = currentEpisode?.id === ep.id
                  const p = progressItems.find((x) => x.id === episodeStreamId(id, ep.season, ep.episode))
                  const pct = p && p.duration > 0 ? Math.min(100, (p.time / p.duration) * 100) : 0
                  const watched = pct >= 95 || simklEpisodes.has(`S${ep.season}E${ep.episode}`)
                  const airTs = ep.released ? Date.parse(ep.released) : NaN
                  const upcoming = !Number.isNaN(airTs) && airTs > Date.now()
                  return (
                    <button
                      key={ep.id}
                      disabled={upcoming}
                      onClick={() => { setSelectedEpisode(ep); setStreams(null) }}
                      className={`group/ep flex w-full items-center gap-3.5 rounded-lg border p-2.5 md:gap-4 md:p-3 text-left transition-all ${
                        active
                          ? 'border-[rgb(var(--acc))]/50 bg-[rgb(var(--acc))]/[0.07]'
                          : upcoming
                            ? 'border-transparent opacity-55'
                            : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      {/* Numéro d'épisode, façon classement Netflix */}
                      <span
                        className={`w-7 shrink-0 text-center font-display text-2xl transition-colors ${
                          active ? 'text-[rgb(var(--acc))]' : 'text-white/20 group-hover/ep:text-white/50'
                        }`}
                      >
                        {ep.episode}
                      </span>

                      {/* Miniature */}
                      <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-white/5 md:w-44">
                        {ep.thumbnail ? (
                          <img
                            src={ep.thumbnail}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-500 group-hover/ep:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-white/15">
                            <Play size={20} />
                          </span>
                        )}
                        <span
                          className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity ${
                            active ? 'opacity-100' : 'opacity-0 group-hover/ep:opacity-100'
                          }`}
                        >
                          <Play size={22} className="text-[rgb(var(--acc))]" fill="currentColor" />
                        </span>
                        {upcoming && (
                          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white/60">
                            <CalendarClock size={16} />
                            <span className="font-mono text-[9px] tracking-wider">
                              {new Date(airTs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).toUpperCase()}
                            </span>
                          </span>
                        )}
                        {watched && !active && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-[rgb(var(--acc))] p-1 text-white">
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                        {pct > 0 && pct < 95 && (
                          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                            <div className="h-full bg-[rgb(var(--acc))]" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>

                      {/* Titre + résumé */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={`truncate text-sm font-bold md:text-[15px] ${
                              active ? 'text-[rgb(var(--acc))]' : watched ? 'text-white/55' : ''
                            }`}
                          >
                            {ep.title || `Épisode ${ep.episode}`}
                          </p>
                          {active && (
                            <span className="shrink-0 rounded-sm bg-[rgb(var(--acc))] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white">
                              EN COURS
                            </span>
                          )}
                        </div>
                        {(() => {
                          const ovFr = metaFr?.videos?.find((v) => v.season === ep.season && v.episode === ep.episode)?.overview
                          const ov = ovFr || ep.overview
                          return ov ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50 md:text-[13px]">{ov}</p>
                          ) : null
                        })()}
                        {p && !watched && pct > 0 && (
                          <p className="mt-1 font-mono text-[10px] text-[rgb(var(--acc))]/70">
                            Reprendre à {Math.floor(p.time / 60)} min — {Math.round(pct)}%
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

        </div>

        {/* Colonne infos */}
        <aside className="space-y-6">
          {!extras?.cast.length && meta.cast && meta.cast.length > 0 && (
            <section>
              <h3 className="bracket-label mb-3">Distribution</h3>
              <p className="text-sm text-white/60 leading-relaxed">{meta.cast.slice(0, 8).join(' · ')}</p>
            </section>
          )}
          {extras && extras.directors.length > 0 ? (
            <section>
              <h3 className="bracket-label mb-3">Réalisation</h3>
              <div className="flex flex-wrap gap-2">
                {extras.directors.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => go({ name: 'person', id: d.id })}
                    className="rounded-full border border-white/15 px-3 py-1 text-sm text-white/70 hover:border-[rgb(var(--acc))]/50 hover:text-[rgb(var(--acc))] transition-colors"
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </section>
          ) : meta.director && meta.director.length > 0 ? (
            <section>
              <h3 className="bracket-label mb-3">Réalisation</h3>
              <p className="text-sm text-white/60">{meta.director.join(' · ')}</p>
            </section>
          ) : null}
          {meta.country && (
            <section>
              <h3 className="bracket-label mb-3">Pays</h3>
              <p className="text-sm text-white/60">{meta.country}</p>
            </section>
          )}
        </aside>
      </div>

      {/* Recommandations TMDB (personnalisées sur CE titre) */}
      {recs.length > 0 && (
        <div className="mt-14">
          <Row title="Recommandé pour toi" items={recs} />
        </div>
      )}

      {/* Saga / collection : les autres volets dans l'ordre de sortie */}
      {extras?.collection && (
        <div className="mt-14">
          <Row title={`Saga ${extras.collection.name}`} items={extras.collection.parts} />
        </div>
      )}

      {/* Similaires par genre (repli / complément) */}
      {recs.length === 0 && similar.length > 0 && (
        <div className="mt-14">
          <Row title="Dans le même genre" items={similar} />
        </div>
      )}
    </div>
  )
}
