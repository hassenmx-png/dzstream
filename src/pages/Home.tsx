import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Play, Trash2, ArrowLeft, Dices, Settings2, X, ChevronUp, ChevronDown, Plus } from 'lucide-react'
import type { LibraryItem, MediaType, MetaPreview, WatchProgress } from '@/types'
import { fetchCatalog, MOVIE_GENRES, GENRE_FR } from '@/lib/cinemeta'
import { fetchAddonCatalog, getAddonCatalogs } from '@/lib/addons'
import { useLibrary, useProgress } from '@/lib/library'
import { fetchRecs, fetchProviderCatalog } from '@/lib/tmdbApi'
import { useNav } from '@/lib/nav'
import { useStored } from '@/lib/store'
import { DEFAULT_ROWS, PLATFORM_OPTIONS, type HomeRowDef } from '@/lib/homeConfig'
import Hero from '@/components/Hero'
import Row from '@/components/Row'
import PosterCard from '@/components/PosterCard'
import type { InstalledAddon } from '@/types'

/** Révèle la section quand elle entre dans le viewport (fade + montée). */
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -60px 0px', threshold: 0.05 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}

/** Rangée fantôme affichée pendant le chargement des catalogues. */
function RowSkeleton() {
  return (
    <section className="cv-auto">
      <div className="mb-3 px-5 md:px-12">
        <div className="skeleton h-3 w-32 rounded" />
      </div>
      <div className="flex gap-3 overflow-hidden px-5 md:px-12 pb-4 pt-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[2/3] w-32 shrink-0 rounded-lg md:w-40" />
        ))}
      </div>
    </section>
  )
}

function fmtRemaining(sec: number): string {
  const mins = Math.max(1, Math.ceil(sec / 60))
  if (mins < 90) return `${mins} MIN`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} H` : `${h} H ${String(m).padStart(2, '0')}`
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

/** Rangée "Continuer à regarder" affichée en haut de l'accueil. */
function ContinueRow() {
  const { continueWatching, remove } = useProgress()
  const { play } = useNav()
  if (continueWatching.length === 0) return null
  return (
    <section className="cv-auto">
      <div className="mb-3 px-5 md:px-12">
        <h2 className="row-title px-5 md:px-0">Continuer à regarder</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto px-5 md:px-12 pb-4">
        {continueWatching.slice(0, 25).map((p) => {
          const pct = Math.min(100, (p.time / (p.duration || 1)) * 100)
          const remaining = Math.max(0, (p.duration || 0) - p.time)
          return (
            <div
              key={p.id}
              className="group relative w-64 shrink-0 rounded-md border border-white/8 bg-white/[0.03] p-3 transition-all hover:border-[rgb(var(--acc))]/50 hover:shadow-[0_0_32px_rgba(var(--acc),0.18)]"
            >
              <button
                onClick={() =>
                  p.stream &&
                  play({
                    stream: p.stream,
                    meta: { id: p.id, baseId: p.baseId, type: p.type, name: p.name, poster: p.poster, background: p.background },
                    episodeLabel: p.episodeLabel,
                    startAt: p.time,
                  })
                }
                className="relative block w-full aspect-video overflow-hidden rounded bg-white/5"
              >
                {(p.background || p.poster) && (
                  <img src={p.background ?? p.poster} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                )}
                <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[rgb(var(--acc2))] backdrop-blur-sm border border-[rgb(var(--acc2))]/25">
                  RESTE {fmtRemaining(remaining)}
                </span>
                {p.episodeLabel && (
                  <span className="absolute left-2 bottom-2 font-display text-lg font-semibold tracking-wide text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                    {p.episodeLabel}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play size={26} className="text-[rgb(var(--acc))]" fill="currentColor" />
                </span>
                <span className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
                  <span
                    className="block h-full bg-gradient-to-r from-[rgb(var(--acc4))] via-[rgb(var(--acc2))] to-[rgb(var(--acc3))] shadow-[0_0_8px_rgba(255, 138, 138,0.7)]"
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </button>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-[11px] font-mono text-white/40">
                    Reprendre à <span className="text-[rgb(var(--acc))]/90">{fmtClock(p.time)}</span>
                    {' · '}
                    <span className="text-[rgb(var(--acc))]/80">{Math.round(pct)}%</span>
                  </p>
                </div>
                <button onClick={() => remove(p.id)} className="p-1 text-white/25 hover:text-red-400" aria-label="Retirer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Rangée alimentée par le catalogue d'un addon installé. */
function AddonRow({ addon, type, id, name }: { addon: InstalledAddon; type: string; id: string; name: string }) {
  const { go } = useNav()
  const [items, setItems] = useState<MetaPreview[]>([])
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    fetchAddonCatalog(addon.url, type, id)
      .then((v) => { if (alive) setItems(v) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [addon.url, type, id, retryKey])
  if (failed) {
    return (
      <section className="cv-auto px-5 md:px-12">
        <h2 className="row-title">{addon.manifest.name} — {name}</h2>
        <p className="mt-2 flex items-center gap-3 text-sm text-white/40">
          Échec du chargement.
          <button onClick={() => setRetryKey((k) => k + 1)} className="text-[rgb(var(--acc))] underline hover:text-white">Réessayer</button>
        </p>
      </section>
    )
  }
  if (!items.length) return null
  return (
    <Row
      title={`${addon.manifest.name} — ${name}`}
      items={items}
      onSeeAll={() =>
        go({ name: 'catalog', title: name, type, addonUrl: addon.url, catalogId: id })
      }
    />
  )
}

/** Rangée genre Cinemeta (films ou séries), auto-alimentée. */
function GenreRow({ type, genre }: { type: 'movie' | 'series'; genre: string }) {
  const { go } = useNav()
  const [items, setItems] = useState<MetaPreview[]>([])
  useEffect(() => {
    let alive = true
    fetchCatalog(type, { genre })
      .then((v) => { if (alive) setItems(v) })
      .catch(() => { /* rangée masquée */ })
    return () => { alive = false }
  }, [type, genre])
  if (!items.length) return null
  const label = GENRE_FR[genre] ?? genre
  return (
    <Row
      title={label}
      items={items}
      onSeeAll={() => go({ name: 'catalog', title: label, type, genre })}
    />
  )
}

/** Rangée plateforme de streaming (catalogue FR via TMDB discover). */
function PlatformRow({ type, providerId }: { type: 'movie' | 'series'; providerId: string }) {
  const [items, setItems] = useState<MetaPreview[]>([])
  useEffect(() => {
    let alive = true
    fetchProviderCatalog(type, providerId)
      .then((v) => { if (alive) setItems(v) })
      .catch(() => { /* rangée masquée */ })
    return () => { alive = false }
  }, [type, providerId])
  if (!items.length) return null
  const name = PLATFORM_OPTIONS.find((p) => p.id === providerId)?.name ?? 'Plateforme'
  return <Row title={`${name} — ${type === 'movie' ? 'films' : 'séries'}`} items={items} />
}

/** Rangée « Animes du moment » (catalogue Kitsu mappé sur les IDs IMDb). */
function AnimesRow() {
  const [items, setItems] = useState<MetaPreview[]>([])
  useEffect(() => {
    let alive = true
    fetch('https://anime-kitsu.strem.fun/catalog/anime/top.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { metas?: Array<{ imdb_id?: string; type?: string; name?: string; poster?: string }> }) => {
        if (!alive || !j?.metas) return
        setItems(
          j.metas
            .filter((x) => x.imdb_id && /^tt\d+/.test(x.imdb_id))
            .map((x) => ({ id: x.imdb_id as string, type: (x.type === 'movie' ? 'movie' : 'series') as 'movie' | 'series', name: x.name ?? 'Anime', poster: x.poster })),
        )
      })
      .catch(() => { /* silencieux : la rangée reste cachée */ })
    return () => { alive = false }
  }, [])
  if (!items.length) return null
  return <Row title="Animes du moment" items={items} />
}

/**
 * Recommandations personnalisées (TMDB) : la graine est le titre le plus
 * récent de la liste ou de l'historique de l'utilisateur.
 */
function ForYouRow() {
  const { items: library } = useLibrary()
  const { items: progress } = useProgress()
  const [recs, setRecs] = useState<MetaPreview[]>([])
  const [seedName, setSeedName] = useState('')

  const seeds = useMemo(() => {
    const out: { id: string; name: string }[] = []
    const seen = new Set<string>()
    const push = (id: string | undefined, name: string) => {
      if (id && /^tt\d+/.test(id) && !seen.has(id)) {
        seen.add(id)
        out.push({ id, name })
      }
    }
    for (const i of library.slice(0, 5)) push(i.id, i.name)
    for (const x of progress.slice(0, 8)) push(x.baseId, x.name)
    return out.slice(0, 3)
  }, [library, progress])

  const seedsKey = seeds.map((s) => s.id).join(',')
  useEffect(() => {
    if (seeds.length === 0) return
    let alive = true
    void Promise.allSettled(seeds.map((s) => fetchRecs(s.id))).then((results) => {
      if (!alive) return
      const merged: MetaPreview[] = []
      const seenIds = new Set<string>()
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        for (const x of r.value) {
          if (!seenIds.has(x.id)) {
            seenIds.add(x.id)
            merged.push(x)
          }
        }
      }
      setRecs((prev) => (prev.length === merged.length && prev.every((x, i) => x.id === merged[i].id) ? prev : merged.slice(0, 24)))
      setSeedName(seeds[0]?.name ?? '')
    })
    return () => { alive = false }
  }, [seedsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (seeds.length === 0 || recs.length === 0) return null
  return (
    <Row
      title={seeds.length > 1 ? 'Recommandé pour toi' : `Parce que tu as aimé « ${seedName} »`}
      items={recs}
    />
  )
}

/** Pioche un titre au hasard dans le pool et ouvre sa fiche. */
function pickSurprise(pool: { id: string; type: 'movie' | 'series' }[], library: LibraryItem[], progress: WatchProgress[], go: (v: { name: 'detail'; type: 'movie' | 'series'; id: string }) => void): void {
  if (pool.length === 0) return
  const libTypeCount = { movie: 0, series: 0 }
  for (const it of library) if (it.type === 'movie' || it.type === 'series') libTypeCount[it.type]++
  const dominantType = libTypeCount.movie >= libTypeCount.series ? 'movie' : 'series'
  const recentIds = new Set(progress.slice(-12).map((p) => p.baseId ?? p.id))

  const weighted = pool.map((m) => ({
    m,
    w: (m.type === dominantType ? 2 : 1) * (recentIds.has(m.id) ? 0 : 1),
  }))
  const playable = weighted.filter((x) => x.w > 0)
  if (playable.length === 0) {
    const pick = pool[Math.floor(Math.random() * pool.length)]
    go({ name: 'detail', type: pick.type, id: pick.id })
    return
  }
  const totalW = playable.reduce((s, x) => s + x.w, 0)
  let r = Math.random() * totalW
  for (const x of playable) {
    r -= x.w
    if (r <= 0) {
      go({ name: 'detail', type: x.m.type, id: x.m.id })
      return
    }
  }
  const fallback = playable[playable.length - 1].m
  go({ name: 'detail', type: fallback.type, id: fallback.id })
}

/** En mode édition : en-tête avec déplacer / supprimer. */
function RowShell({
  editing,
  title,
  onUp,
  onDown,
  onRemove,
  children,
}: {
  editing: boolean
  title: string
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  children: ReactNode
}) {
  if (!editing) return <>{children}</>
  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--acc))]/30">
      <div className="flex items-center gap-2 px-4 pt-2">
        <span className="truncate text-[11px] font-mono uppercase tracking-wider text-[rgb(var(--acc))]/80">{title}</span>
        <span className="h-px flex-1 bg-white/10" />
        <button onClick={onUp} className="rounded border border-white/15 p-1 text-white/60 transition-colors hover:text-white" aria-label="Monter"><ChevronUp size={13} /></button>
        <button onClick={onDown} className="rounded border border-white/15 p-1 text-white/60 transition-colors hover:text-white" aria-label="Descendre"><ChevronDown size={13} /></button>
        <button onClick={onRemove} className="rounded border border-white/15 p-1 text-white/60 transition-colors hover:text-red-400" aria-label="Supprimer"><X size={13} /></button>
      </div>
      <div className="pb-1">{children}</div>
    </div>
  )
}

/** Panneau « ajouter une rangée » (spéciales, genres, plateformes, addons). */
function AddRowPanel({ onAdd }: { onAdd: (row: Omit<HomeRowDef, 'id'>) => void }) {
  const addonCatalogs = getAddonCatalogs()
  const chip = (label: string, action: () => void, key: string) => (
    <button
      key={key}
      onClick={action}
      className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 transition-colors hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))]"
    >
      <Plus size={11} /> {label}
    </button>
  )
  const group = (label: string, children: ReactNode) => (
    <div>
      <p className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-white/35">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
  const STATICS: { type: string; label: string }[] = [
    { type: 'foryou', label: '★ Recommandé pour toi' },
    { type: 'top-movies', label: 'Top 10 films' },
    { type: 'top-series', label: 'Top 10 séries' },
    { type: 'popular-movies', label: 'Films populaires' },
    { type: 'popular-series', label: 'Séries populaires' },
    { type: 'animes', label: 'Animes du moment' },
  ]
  return (
    <div className="mx-5 md:mx-12 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-[rgb(var(--acc))]/30 bg-white/[0.03] p-4">
      <p className="text-xs text-white/50">Clique pour ajouter en bas de l'accueil, puis réorganise avec les flèches :</p>
      {group('Rangées spéciales', STATICS.map((s) => chip(s.label, () => onAdd({ type: s.type, title: s.label }), s.type)))}
      {group('Genres — Films', MOVIE_GENRES.map((g) => chip(GENRE_FR[g] ?? g, () => onAdd({ type: `genre:movie:${g}`, title: GENRE_FR[g] ?? g }), `gf-${g}`)))}
      {group('Genres — Séries', MOVIE_GENRES.map((g) => chip(GENRE_FR[g] ?? g, () => onAdd({ type: `genre:series:${g}`, title: `${GENRE_FR[g] ?? g} (séries)` }), `gs-${g}`)))}
      {group('Plateformes', PLATFORM_OPTIONS.flatMap((p) => [
        chip(`${p.name} · Films`, () => onAdd({ type: `platform:movie:${p.id}`, title: `${p.name} — films` }), `pf-${p.id}`),
        chip(`${p.name} · Séries`, () => onAdd({ type: `platform:series:${p.id}`, title: `${p.name} — séries` }), `ps-${p.id}`),
      ]))}
      {addonCatalogs.length > 0 && group('Catalogues addons', addonCatalogs.map((c) =>
        chip(`${c.addon.manifest.name} — ${c.name}`, () => onAdd({ type: `addon:${c.addon.url}|${c.type}|${c.id}`, title: `${c.addon.manifest.name} — ${c.name}` }), `ad-${c.addon.url}-${c.type}-${c.id}`),
      ))}
    </div>
  )
}

export default function Home() {
  const { go } = useNav()
  const { items: libraryItems } = useLibrary()
  const { items: progressItems } = useProgress()

  const [movies, setMovies] = useState<MetaPreview[]>([])
  const [series, setSeries] = useState<MetaPreview[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const addonCatalogs = getAddonCatalogs()

  // Disposition personnalisable de l'accueil (persistance navigateur).
  const [layout, setLayout] = useStored<HomeRowDef[]>('novastream:homeLayout', DEFAULT_ROWS)
  const [editing, setEditing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    const jobs = [
      { key: 'movies', label: 'Films', run: () => fetchCatalog('movie'), apply: setMovies },
      { key: 'series', label: 'Séries', run: () => fetchCatalog('series'), apply: setSeries },
    ]
    let alive = true
    setFailed([])
    void Promise.allSettled(jobs.map((j) => j.run())).then((results) => {
      if (!alive) return
      const fails: string[] = []
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') jobs[i].apply(r.value as MetaPreview[])
        else fails.push(jobs[i].key)
      })
      setFailed(fails)
    })
    return () => { alive = false }
  }, [reloadKey])

  const surprise = () => {
    const pool = [...movies, ...series].filter((m) => Number(m.imdbRating ?? 0) >= 6)
    pickSurprise(pool, libraryItems, progressItems, go)
  }

  // ---- édition de la disposition (lecture directe, compatibilité store) ----
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= layout.length) return
    const n = [...layout]
    const tmp = n[i]
    n[i] = n[j]
    n[j] = tmp
    setLayout(n)
  }
  const removeRow = (i: number) => setLayout(layout.filter((_, x) => x !== i))
  const addRow = (row: Omit<HomeRowDef, 'id'>) =>
    setLayout([...layout, { ...row, id: Math.random().toString(36).slice(2, 9) }])
  const resetLayout = () => setLayout(DEFAULT_ROWS.map((r) => ({ ...r })))

  // ---- rendu d'une rangée selon son type ----
  const renderRow = (row: HomeRowDef): ReactNode => {
    if (row.type === 'continue') return <ContinueRow />
    if (row.type === 'foryou') return <ForYouRow />
    if (row.type === 'animes') return <AnimesRow />
    if (row.type === 'top-movies')
      return (
        <Row title="Top 10 films" items={movies.slice(0, 10)} numbered
          onSeeAll={() => go({ name: 'catalog', title: 'Films populaires', type: 'movie' })} />
      )
    if (row.type === 'top-series')
      return (
        <Row title="Top 10 séries" items={series.slice(0, 10)} numbered
          onSeeAll={() => go({ name: 'catalog', title: 'Séries populaires', type: 'series' })} />
      )
    if (row.type === 'popular-movies')
      return (
        <Row title="Films populaires" items={movies.slice(10)}
          onSeeAll={() => go({ name: 'catalog', title: 'Films populaires', type: 'movie' })} />
      )
    if (row.type === 'popular-series')
      return (
        <Row title="Séries populaires" items={series.slice(10)}
          onSeeAll={() => go({ name: 'catalog', title: 'Séries populaires', type: 'series' })} />
      )
    if (row.type.startsWith('genre:')) {
      const parts = row.type.split(':')
      const t = parts[1]
      const genre = parts.slice(2).join(':')
      return <GenreRow type={t === 'series' ? 'series' : 'movie'} genre={genre} />
    }
    if (row.type.startsWith('platform:')) {
      const parts = row.type.split(':')
      return <PlatformRow type={parts[1] === 'series' ? 'series' : 'movie'} providerId={parts[2]} />
    }
    if (row.type.startsWith('addon:')) {
      const payload = row.type.slice(6)
      const parts = payload.split('|')
      const url = parts[0]
      const type = parts[1]
      const id = parts.slice(2).join('|')
      const found = addonCatalogs.find((c) => c.addon.url === url && c.type === type && c.id === id)
      if (!found) return null
      return <AddonRow addon={found.addon} type={type} id={id} name={found.name} />
    }
    return null
  }

  return (
    <div>
      <Hero items={[...movies.slice(0, 3), ...series.slice(0, 3)]} />
      <div className="relative z-10 -mt-16 space-y-10 pb-24">
        <h1 className="sr-only">Accueil — DZ STREAM</h1>
        {failed.map((f) => {
          const job = [{ key: 'movies', label: 'Films' }, { key: 'series', label: 'Séries' }].find((j) => j.key === f)
          return (
            <p key={f} className="px-5 md:px-12 text-white/40 text-sm flex items-center gap-3">
              Impossible de charger « {job?.label ?? f} ».
              <button onClick={() => setReloadKey((k) => k + 1)} className="text-[rgb(var(--acc))] underline hover:text-white">
                Réessayer
              </button>
            </p>
          )
        })}
        <div className="flex flex-wrap items-center gap-3 px-5 md:px-12">
          <button
            onClick={surprise}
            disabled={movies.length === 0 && series.length === 0}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))] disabled:opacity-40"
            title="Lancer un film ou une série au hasard"
          >
            <Dices size={16} />
            Mode soirée
          </button>
          <button
            onClick={() => { setEditing(!editing); setShowAdd(false) }}
            className={`flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors ${
              editing
                ? 'border-[rgb(var(--acc))] bg-[rgb(var(--acc))]/15 text-[rgb(var(--acc))]'
                : 'border-white/15 bg-white/5 text-white/80 hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))]'
            }`}
            title="Réorganiser les rangées de l'accueil"
          >
            <Settings2 size={16} />
            {editing ? 'Terminer' : "Personnaliser l'accueil"}
          </button>
          {editing && (
            <>
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))]"
              >
                <Plus size={16} />
                Ajouter une rangée
              </button>
              <button
                onClick={resetLayout}
                className="rounded-full border border-white/10 px-4 py-2.5 text-xs font-mono text-white/50 transition-colors hover:border-white/30 hover:text-white/80"
              >
                Réinitialiser
              </button>
            </>
          )}
        </div>
        {editing && showAdd && <AddRowPanel onAdd={(r) => { addRow(r); setShowAdd(false) }} />}
        {movies.length === 0 && series.length === 0 && failed.length === 0 && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
        <ContinueRow />
        {layout.map((row, i) => (
          <Reveal key={row.id} delay={(i % 4) * 70}>
            <RowShell
              editing={editing}
              title={row.title}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onRemove={() => removeRow(i)}
            >
              {renderRow(row)}
            </RowShell>
          </Reveal>
        ))}
      </div>
    </div>
  )
}

/**
 * Page catalogue complète : TOUTE la palette d'une catégorie en grille,
 * paginée. Deux sources possibles : Cinemeta (Films / Séries / genres) ou le
 * catalogue d'un addon installé, auquel cas le titre et le bouton Retour
 * sont affichés.
 */
export function CatalogPage({
  type,
  title,
  genre: initialGenre,
  addonUrl,
  catalogId,
}: {
  type: string
  title?: string
  genre?: string
  addonUrl?: string
  catalogId?: string
}) {
  const { back } = useNav()
  const [items, setItems] = useState<MetaPreview[]>([])
  const [genre, setGenre] = useState<string | null>(initialGenre ?? null)
  const [skip, setSkip] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [minYear, setMinYear] = useState(0)
  const [minRating, setMinRating] = useState(0)
  const isAddon = !!addonUrl && !!catalogId
  const seenRef = useRef<Set<string>>(new Set())

  const load = (g: string | null, s: number, append: boolean) => {
    setLoading(true)
    const promise = isAddon
      ? fetchAddonCatalog(addonUrl, type, catalogId, s)
      : fetchCatalog(type as MediaType, { genre: g ?? undefined, skip: s })
    promise
      .then((res) => {
        if (!append) seenRef.current = new Set()
        const fresh = res.filter((r) => !seenRef.current.has(r.id))
        fresh.forEach((r) => seenRef.current.add(r.id))
        setItems((prev) => (append ? [...prev, ...fresh] : fresh))
        setHasMore(fresh.length >= 20)
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setItems([])
    setSkip(0)
    load(genre, 0, false)
    window.scrollTo(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre, type, addonUrl, catalogId])

  const filtered = items.filter((m) => {
    if (minYear > 0) {
      const y = parseInt(String(m.releaseInfo ?? '').slice(0, 4), 10)
      if (!y || y < minYear) return false
    }
    if (minRating > 0) {
      const r = parseFloat(m.imdbRating ?? '0')
      if (!r || r < minRating) return false
    }
    return true
  })

  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen">
      {title && (
        <button
          onClick={back}
          className="mb-6 flex min-h-[44px] items-center gap-2 rounded-full border border-white/25 bg-black/85 px-5 text-sm font-mono-label font-semibold text-white/95 shadow-lg transition-colors hover:text-[rgb(var(--acc))] hover:border-[rgb(var(--acc))]/60"
        >
          <ArrowLeft size={16} /> RETOUR
        </button>
      )}
      
      <h1 className="font-display text-4xl md:text-6xl font-black tracking-tight">
        {title ?? (type === 'movie' ? 'Films' : 'Séries')}
      </h1>

      {!isAddon && (
      <div className="mt-8 flex flex-wrap gap-2">
        <button
          onClick={() => setGenre(null)}
          className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${
            genre === null
              ? 'border-[rgb(var(--acc))] bg-[rgb(var(--acc))] text-white font-bold'
              : 'border-white/15 text-white/60 hover:border-white/40'
          }`}
        >
          Tout
        </button>
        {MOVIE_GENRES.map((g) => (
          <button
            key={g}
            onClick={() => setGenre(g)}
            className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${
              genre === g
                ? 'border-[rgb(var(--acc))] bg-[rgb(var(--acc))] text-white font-bold'
                : 'border-white/15 text-white/60 hover:border-white/40'
            }`}
          >
            {GENRE_FR[g] ?? g}
          </button>
        ))}
      </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5">
          <span className="text-white/50">Année ≥</span>
          <select
            value={minYear}
            onChange={(e) => setMinYear(Number(e.target.value))}
            className="bg-transparent text-[rgb(var(--acc))] font-mono outline-none cursor-pointer [&>option]:bg-[#0d0d0d]"
          >
            {[0, 2020, 2015, 2010, 2000, 1990, 1980].map((y) => (
              <option key={y} value={y}>{y === 0 ? 'toutes' : y}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5">
          <span className="text-white/50">Note ≥</span>
          <select
            value={minRating}
            onChange={(e) => setMinRating(Number(e.target.value))}
            className="bg-transparent text-[rgb(var(--acc))] font-mono outline-none cursor-pointer [&>option]:bg-[#0d0d0d]"
          >
            {[0, 6, 7, 8].map((r) => (
              <option key={r} value={r}>{r === 0 ? 'toutes' : `${r}/10`}</option>
            ))}
          </select>
        </div>
        {(minYear > 0 || minRating > 0) && (
          <span className="text-white/35 font-mono">
            {filtered.length} résultat{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''} — charge plus de pages pour affiner
          </span>
        )}
      </div>

      <div className="mt-10 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
        {filtered.map((m) => (
          <PosterCard key={m.id} meta={m} />
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
        </div>
      )}

      {!loading && hasMore && items.length > 0 && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => { const ns = skip + items.length; setSkip(ns); load(genre, ns, true) }}
            className="rounded-sm border border-white/20 px-8 py-3 text-sm font-semibold hover:border-[rgb(var(--acc))] hover:text-[rgb(var(--acc))] transition-colors"
          >
            Charger plus
          </button>
        </div>
      )}
    </div>
  )
}
