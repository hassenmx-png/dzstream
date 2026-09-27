import type { LibraryItem, MediaType } from '@/types'
import { fetchMetaAny } from '@/lib/addons'

export interface CalEntry {
  seriesId: string
  seriesName: string
  poster?: string
  season: number
  episode: number
  title: string
  /** Horodatage de diffusion (minuit local du jour concerné côté regroupement). */
  released: number
}

const CACHE_KEY = 'novastream:calendar'
const CACHE_TTL = 60 * 60 * 1000 // 1 h — Cinemeta ne bouge pas plus vite
const MAX_SERIES = 12 // borne le nombre de requêtes meta
const PAST_DAYS = 7
const FUTURE_DAYS = 30

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        try {
          out[idx] = await fn(items[idx])
        } catch {
          /* série injoignable : on l'ignore */
        }
      }
    }),
  )
  return out.filter((r): r is R => r !== null)
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Épisodes des séries suivies diffusés dans la fenêtre [J-7, J+30].
 * Source : les métadonnées Cinemeta déjà utilisées par les fiches (champ
 * `released` des vidéos) — aucune API supplémentaire. Réponse mise en cache
 * 1 h en sessionStorage (le calendrier ne change pas à la minute).
 */
export async function fetchCalendar(
  series: { id: string; name: string; poster?: string }[],
): Promise<CalEntry[]> {
  const picked = series.slice(0, MAX_SERIES)
  if (picked.length === 0) return []
  const cacheKey = picked
    .map((s) => s.id)
    .sort()
    .join(',')
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as { key: string; at: number; entries: CalEntry[] }
      if (cached.key === cacheKey && Date.now() - cached.at < CACHE_TTL) return cached.entries
    }
  } catch {
    /* cache illisible : on recalcule */
  }

  const from = startOfToday() - PAST_DAYS * 86400000
  const to = startOfToday() + (FUTURE_DAYS + 1) * 86400000

  const lists = await pool(picked, 4, async (s) => {
    const meta = await fetchMetaAny('series' satisfies MediaType, s.id)
    if (!meta?.videos?.length) return [] as CalEntry[]
    return meta.videos.flatMap((v): CalEntry[] => {
      if (!v.released || v.season <= 0) return [] // saison 0 = bonus/hors-série
      const t = Date.parse(v.released)
      if (Number.isNaN(t) || t < from || t >= to) return []
      return [
        {
          seriesId: s.id,
          seriesName: s.name,
          poster: s.poster ?? meta.poster,
          season: v.season,
          episode: v.episode,
          title: v.title,
          released: t,
        },
      ]
    })
  })

  const entries = lists.flat().sort((a, b) => a.released - b.released || a.season - b.season || a.episode - b.episode)
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey, at: Date.now(), entries }))
  } catch {
    /* quota : tant pis, pas de cache */
  }
  return entries
}

/** Libellé de proximité : « aujourd'hui », « demain », « dans 3 j »… */
export function dayDistance(ts: number): { label: string; tone: 'today' | 'soon' | 'future' | 'past' } {
  const days = Math.round((startOfDay(ts) - startOfToday()) / 86400000)
  if (days === 0) return { label: "AUJOURD'HUI", tone: 'today' }
  if (days === 1) return { label: 'DEMAIN', tone: 'soon' }
  if (days > 1) return { label: `DANS ${days} J`, tone: 'future' }
  if (days === -1) return { label: 'HIER', tone: 'past' }
  return { label: `IL Y A ${-days} J`, tone: 'past' }
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Séries concernées par le calendrier : bibliothèque + historique de visionnage. */
export function seriesForCalendar(
  library: LibraryItem[],
  history: { baseId: string; type: MediaType; name: string; poster?: string }[],
): { id: string; name: string; poster?: string }[] {
  const map = new Map<string, { id: string; name: string; poster?: string }>()
  for (const i of library) if (i.type === 'series') map.set(i.id, { id: i.id, name: i.name, poster: i.poster })
  for (const p of history) {
    if (p.type === 'series' && !map.has(p.baseId)) map.set(p.baseId, { id: p.baseId, name: p.name, poster: p.poster })
  }
  return [...map.values()]
}
