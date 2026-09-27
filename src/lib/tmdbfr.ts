import type { MetaFull } from '@/types'

/**
 * Métadonnées FRANÇAISES via l'addon TMDB (ElfHosted, clé intégrée,
 * CORS ouvert). Sert de « couche FR » au-dessus de Cinemeta : synopsis,
 * genres et résumés d'épisodes en français, sans rien configurer.
 * Uniquement pour les IDs IMDB (tt…) — Cinemeta reste la référence.
 */
const BASE = 'https://tmdb.elfhosted.com/fr-FR'

const cache = new Map<string, MetaFull | null>()

export async function fetchMetaFr(type: string, id: string): Promise<MetaFull | null> {
  if (!/^tt\d+/.test(id)) return null
  const key = `${type}:${id}`
  if (cache.has(key)) return cache.get(key) ?? null
  try {
    const mt = type === 'series' ? 'series' : 'movie'
    const res = await fetch(`${BASE}/meta/${mt}/${encodeURIComponent(id)}.json`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error('tmdb fr indisponible')
    const data = (await res.json()) as { meta?: MetaFull }
    const meta = data.meta ?? null
    cache.set(key, meta)
    return meta
  } catch {
    cache.set(key, null)
    return null
  }
}
