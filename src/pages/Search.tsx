import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Mic, MicOff, Search as SearchIcon, User } from 'lucide-react'
import type { MetaPreview } from '@/types'
import { searchMeta } from '@/lib/cinemeta'
import { departmentFr, searchPeople, type PersonResult } from '@/lib/tmdbApi'
import { useNav } from '@/lib/nav'
import PosterCard from '@/components/PosterCard'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'movie' | 'series'>('all')
  const [themeResults, setThemeResults] = useState<typeof movies>([])
  const [themeLabel, setThemeLabel] = useState('')
  const openTheme = async (label: string, mv: number, tv: number) => {
    setThemeLabel(label)
    setThemeResults([])
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/tmdb/discover/movie/${mv}`).then((r) => r.json()).catch(() => ({ items: [] as unknown[] })),
        fetch(`/api/tmdb/discover/tv/${tv}`).then((r) => r.json()).catch(() => ({ items: [] as unknown[] })),
      ])
      setThemeResults([...(a.items ?? []), ...(b.items ?? [])] as typeof movies)
    } catch {
      setThemeResults([])
    }
  }
  const [movies, setMovies] = useState<MetaPreview[]>([])
  const [series, setSeries] = useState<MetaPreview[]>([])
  const [people, setPeople] = useState<PersonResult[]>([])
  const [loading, setLoading] = useState(false)
  // Recherche vocale : dictée du nom d'un film/série au lieu de taper.
  // Utilise l'API Web Speech native (Chrome/Edge/Safari) — aucune dépendance.
  const [listening, setListening] = useState(false)
  const [voiceSupported] = useState(() => {
    const w = window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown }
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  })
  const recognitionRef = useRef<{ stop: () => void } | null>(null)

  const startVoice = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => { lang: string; onresult: (e: unknown) => void; onend: () => void; start: () => void; stop: () => void }
      webkitSpeechRecognition?: new () => { lang: string; onresult: (e: unknown) => void; onend: () => void; start: () => void; stop: () => void }
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'fr-FR'
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }
      const text = ev.results[ev.resultIndex]?.[0]?.transcript ?? ''
      if (text) setQuery(text)
    }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    setListening(true)
    rec.start()
  }

  const stopVoice = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { go } = useNav()

  // Historique des recherches (local, 8 max) — proposées au focus quand le
  // champ est vide.
  const HISTORY_KEY = 'novastream:search-history'
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[] } catch { return [] }
  })
  const saveHistory = (q: string) => {
    const v = q.trim()
    if (v.length < 2) return
    setHistory((h) => {
      const next = [v, ...h.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* mode privé */ }
      return next
    })
  }
  const clearHistory = () => {
    setHistory([])
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* mode privé */ }
  }


  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    clearTimeout(debounce.current)
    if (!query.trim()) {
      setMovies([])
      setSeries([])
      setPeople([])
      return
    }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      saveHistory(query)
      const [m, s, p] = await Promise.allSettled([searchMeta('movie', query), searchMeta('series', query), searchPeople(query)])
      setMovies(m.status === 'fulfilled' ? m.value : [])
      setSeries(s.status === 'fulfilled' ? s.value : [])
      setPeople(p.status === 'fulfilled' ? p.value : [])
      setLoading(false)
    }, 350)
    return () => clearTimeout(debounce.current)
  }, [query])

  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/10 px-4 py-3.5 transition-colors focus-within:border-white/40 focus-within:bg-white/15 md:px-5 md:py-4">
          <SearchIcon size={22} className="shrink-0 text-white/50" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Titres, personnes, genres…"
            aria-label="Rechercher"
            className="w-full min-w-0 bg-transparent text-lg font-medium text-white outline-none placeholder:text-white/30 md:text-2xl"
          />
        {/* Recherche vocale : bouton micro à droite de l'input */}
        {voiceSupported && (
          <button
            onClick={listening ? stopVoice : startVoice}
            aria-label={listening ? 'Arrêter la dictée' : 'Rechercher par la voix'}
            title={listening ? 'Arrêter la dictée' : 'Rechercher par la voix'}
            className={`absolute right-0 top-1/2 -translate-y-1/2 transition-colors ${
              listening ? 'text-red-400 animate-pulse' : 'text-white/40 hover:text-white/80'
            }`}
          >
            {listening ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
        )}
        </div>
      </div>

      <div className="mx-auto mt-4 flex max-w-3xl items-center gap-2">
        {([['all', 'Tout'], ['movie', 'Films'], ['series', 'Séries']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${tab === k ? 'bg-white text-black' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!query && (
        <div className="mx-auto mt-8 max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/35">Explorer par thème</p>
          <div className="flex flex-wrap gap-2">
            {([
        ['Documentaire', 99, 99], ['Animé', 16, 16], ['Comédie', 35, 35], ['Action', 28, 10759],
        ['Drame', 18, 18], ['Horreur', 27, 9648], ['Thriller', 53, 80], ['Science-fiction', 878, 10765],
        ['Romance', 10749, 10749], ['Aventure', 12, 10759], ['Animation', 16, 16], ['Crime', 80, 80],
        ['Fantastique', 14, 10765], ['Mystère', 9648, 9648], ['Famille', 10751, 10751],
        ['Musique', 10402, 10402], ['Guerre', 10752, 10768], ['Western', 37, 37],
      ] as const).map(([label, mv, tv]) => (
        <button
          key={label}
          onClick={() => openTheme(label, mv, tv)}
          className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/25 hover:text-white"
        >
          {label}
        </button>
      ))}
          </div>
        </div>
      )}

      {!query && history.length > 0 && (
        <div className="mt-8 max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="bracket-label">Recherches récentes</p>
            <button onClick={clearHistory} className="flex items-center gap-1 text-[11px] text-white/35 transition-colors hover:text-white/70">
              <X size={12} /> Effacer
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h}
                onClick={() => setQuery(h)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:border-[rgb(var(--acc))]/50 hover:text-white"
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-10 flex items-center gap-3 text-white/50 text-sm">
          <div className="h-5 w-5 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
          Recherche en cours…
        </div>
      )}

      {!loading && query && movies.length === 0 && series.length === 0 && people.length === 0 && (
        <p className="mt-10 text-white/40">Aucun résultat pour « {query} ».</p>
      )}

      {people.length > 0 && (
        <section className="mt-12">
          <h2 className="bracket-label mb-4">Personnes</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => go({ name: 'person', id: p.id })}
                className="group flex items-center gap-4 rounded-md border border-white/8 bg-white/[0.03] p-3 text-left hover:border-[rgb(var(--acc))]/40 transition-colors"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-white/5 border border-white/10 group-hover:border-[rgb(var(--acc))]/50 transition-colors">
                  {p.photo ? (
                    <img src={p.photo} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-white/20">
                      <User size={22} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold group-hover:text-[rgb(var(--acc))] transition-colors">{p.name}</p>
                  <p className="text-[10px] font-mono-label text-[rgb(var(--acc))]/70 uppercase">{departmentFr(p.department)}</p>
                  {p.knownFor.length > 0 && (
                    <p className="mt-0.5 truncate text-[11px] text-white/40">{p.knownFor.join(' · ')}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!query && themeResults.length > 0 && (
        <section className="mt-10">
          <h2 className="bracket-label mb-4">Thème : {themeLabel}</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
            {themeResults.map((m) => <PosterCard key={m.id} meta={m} />)}
          </div>
        </section>
      )}

      {tab !== 'series' && movies.length > 0 && (
        <section className="mt-12">
          <h2 className="bracket-label mb-4">Films</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {movies.map((m) => <PosterCard key={m.id} meta={m} />)}
          </div>
        </section>
      )}

      {tab !== 'movie' && series.length > 0 && (
        <section className="mt-12">
          <h2 className="bracket-label mb-4">Séries</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {series.map((m) => <PosterCard key={m.id} meta={m} />)}
          </div>
        </section>
      )}
    </div>
  )
}
