import type { MediaType } from '@/types'
import { readJSON, useStored, writeJSON } from './store'

/**
 * Notes personnelles ★1-5, par contenu (id = baseId IMDB/autre).
 * Synchronisées avec le coffre (même merge last-write-wins que la liste).
 */

export const RATINGS_KEY = 'novastream:ratings'

export interface RatingItem {
  id: string
  rating: number // 1..5
  updatedAt: number
  name: string
  poster?: string
  type: MediaType
}

export function getRating(id: string): number | null {
  const cur = readJSON<RatingItem[]>(RATINGS_KEY, [])
  return cur.find((r) => r.id === id)?.rating ?? null
}

export function setRating(
  id: string,
  rating: number | null,
  info?: { name: string; poster?: string; type: MediaType },
): void {
  const cur = readJSON<RatingItem[]>(RATINGS_KEY, [])
  const rest = cur.filter((r) => r.id !== id)
  if (rating === null || rating < 1) {
    writeJSON(RATINGS_KEY, rest)
    return
  }
  const prev = cur.find((r) => r.id === id)
  const item: RatingItem = {
    id,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    updatedAt: Date.now(),
    name: info?.name ?? prev?.name ?? id,
    poster: info?.poster ?? prev?.poster,
    type: info?.type ?? prev?.type ?? 'movie',
  }
  writeJSON(RATINGS_KEY, [item, ...rest].slice(0, 500))
}

export function useRatings() {
  const [items] = useStored<RatingItem[]>(RATINGS_KEY, [])
  const byId = new Map(items.map((r) => [r.id, r.rating]))
  return { items, byId }
}
