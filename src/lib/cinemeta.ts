import type { CatalogResponse, MediaType, MetaFull, MetaPreview } from '@/types'

const CINEMETA = 'https://v3-cinemeta.strem.io'

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchCatalog(
  type: MediaType,
  opts: { genre?: string; skip?: number; search?: string } = {},
): Promise<MetaPreview[]> {
  const extras: string[] = []
  if (opts.genre) extras.push(`genre=${encodeURIComponent(opts.genre)}`)
  if (opts.skip) extras.push(`skip=${opts.skip}`)
  if (opts.search) extras.push(`search=${encodeURIComponent(opts.search)}`)
  const extraPath = extras.length ? `/${extras.join('&')}` : ''
  const data = await getJSON<CatalogResponse>(
    `${CINEMETA}/catalog/${type}/top${extraPath}.json`,
  )
  return data.metas ?? []
}

export async function fetchMeta(type: MediaType, id: string): Promise<MetaFull> {
  const data = await getJSON<{ meta: MetaFull }>(`${CINEMETA}/meta/${type}/${id}.json`)
  return data.meta
}

export async function searchMeta(type: MediaType, query: string): Promise<MetaPreview[]> {
  if (!query.trim()) return []
  return fetchCatalog(type, { search: query })
}

export const MOVIE_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance',
  'Science Fiction', 'Thriller', 'War', 'Western',
]

export const GENRE_FR: Record<string, string> = {
  Action: 'Action', Adventure: 'Aventure', Animation: 'Animation', Comedy: 'Comédie',
  Crime: 'Crime', Documentary: 'Documentaire', Drama: 'Drame', Family: 'Famille',
  Fantasy: 'Fantastique', History: 'Histoire', Horror: 'Horreur', Mystery: 'Mystère',
  Romance: 'Romance', 'Science Fiction': 'Science-fiction', 'Sci-Fi': 'Science-fiction',
  Thriller: 'Thriller', War: 'Guerre', Western: 'Western', 'TV Movie': 'Téléfilm',
  Biography: 'Biographie', Music: 'Musique', Musical: 'Comédie musicale',
  Reality: 'Téléréalité', News: 'Actualités', Talk: 'Talk-show', Soap: 'Feuilleton',
  Kids: 'Jeunesse', 'War & Politics': 'Guerre et politique',
  'Sci-Fi & Fantasy': 'SF et fantastique', 'Action & Adventure': 'Action et aventure',
}
