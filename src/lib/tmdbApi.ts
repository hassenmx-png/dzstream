import type { MetaPreview } from '@/types'

/** Client du catalogue boosté (proxy TMDB côté serveur, tout en français). */

export interface CastMember {
  id: number
  name: string
  character?: string
  photo: string | null
}

export interface TmdbExtras {
  found: boolean
  tmdbId?: number
  type?: 'movie' | 'series'
  trailerYtId: string | null
  cast: CastMember[]
  directors: { id: number; name: string }[]
  collection?: { name: string; parts: MetaPreview[] } | null
}

export interface PersonResult {
  id: number
  name: string
  photo: string | null
  department: string
  knownFor: string[]
}

export interface PersonFull {
  id: number
  name: string
  department: string
  gender: number // 1 = femme, 2 = homme, 0/3 = autre/inconnu
  bio: string | null
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  photo: string | null
  popularity: number
  homepage: string | null
  alsoKnownAs: string[]
  socials: {
    imdb: string | null
    instagram: string | null
    twitter: string | null
    facebook: string | null
    tiktok: string | null
  }
  photos: string[]
  counts: { movies: number; series: number }
  filmography: MetaPreview[]
  series: MetaPreview[]
}

/** Métier traduit, accordé au genre quand c'est un métier d'interprétation. */
export function departmentFull(dept: string, gender: number): string {
  if (dept === 'Acting') {
    if (gender === 1) return 'Actrice'
    if (gender === 2) return 'Acteur'
    return 'Acteur / Actrice'
  }
  return departmentFr(dept)
}

/** Âge à une date donnée (aujourd'hui, ou au décès). */
export function ageAt(birth: string, end?: string | null): number | null {
  const b = new Date(birth)
  const e = end ? new Date(end) : new Date()
  if (Number.isNaN(b.getTime())) return null
  let age = e.getFullYear() - b.getFullYear()
  const m = e.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && e.getDate() < b.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

async function get<T>(path: string, timeoutMs = 10000): Promise<T | null> {
  try {
    const res = await fetch(path, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Catalogue d'une plateforme de streaming (FR), IDs IMDB. */
export async function fetchProviderCatalog(type: 'movie' | 'series', providerId: string): Promise<MetaPreview[]> {
  const j = await get<{ items: MetaPreview[] }>(`/api/tmdb/discover-provider/${type}/${providerId}`)
  return j?.items ?? []
}

/** Notes agrégées (style Nuvio). */
export type AggRatings = {
  imdb?: string | null
  imdbVotes?: string | null
  tmdb?: number | null
  tmdbVotes?: number | null
  rt?: string | null
  rtVal?: number | null
  metacritic?: string | null
  mcVal?: number | null
}
export async function fetchRatings(imdbId: string): Promise<AggRatings | null> {
  if (!/^tt\d+/.test(imdbId)) return null
  return get<AggRatings>(`/api/tmdb/ratings/${imdbId}`)
}

export function fetchExtras(imdbId: string): Promise<TmdbExtras | null> {
  return get<TmdbExtras>(`/api/tmdb/extras/${imdbId}`)
}

export async function fetchRecs(imdbId: string): Promise<MetaPreview[]> {
  const j = await get<{ items: MetaPreview[] }>(`/api/tmdb/recs/${imdbId}`)
  return j?.items ?? []
}

export async function searchPeople(q: string): Promise<PersonResult[]> {
  if (q.trim().length < 2) return []
  const j = await get<{ items: PersonResult[] }>(`/api/tmdb/people?q=${encodeURIComponent(q)}`)
  return j?.items ?? []
}

export function fetchPerson(id: number): Promise<PersonFull | null> {
  // La première visite d'une personne prolifique exige la résolution IMDB de
  // toute sa filmographie côté serveur : on laisse large (25 s) plutôt que
  // d'abandonner à 10 s et d'afficher une page vide.
  return get<PersonFull>(`/api/tmdb/person/${id}`, 25000)
}

const DEPT_FR: Record<string, string> = {
  Acting: 'Acteur / Actrice',
  Directing: 'Réalisation',
  Writing: 'Scénario',
  Production: 'Production',
  Creator: 'Création',
  Sound: 'Musique',
  Camera: 'Image',
  Editing: 'Montage',
}

export function departmentFr(d: string): string {
  return DEPT_FR[d] ?? d
}
