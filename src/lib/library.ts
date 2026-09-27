import { useCallback } from 'react'
import type { LibraryItem, MediaType, Stream, WatchProgress } from '@/types'
import { readJSON, useStored, writeJSON } from './store'

export const LIB_KEY = 'novastream:library'
export const PROGRESS_KEY = 'novastream:progress'

export function useLibrary() {
  const [items, setItems] = useStored<LibraryItem[]>(LIB_KEY, [])
  const toggle = (item: Omit<LibraryItem, 'addedAt'>) => {
    const cur = readJSON<LibraryItem[]>(LIB_KEY, [])
    if (cur.some((i) => i.id === item.id)) {
      setItems(cur.filter((i) => i.id !== item.id))
    } else {
      setItems([{ ...item, addedAt: Date.now() }, ...cur])
    }
  }
  const has = (id: string) => items.some((i) => i.id === id)
  return { items, toggle, has }
}

export function useProgress() {
  const [items, setItems] = useStored<WatchProgress[]>(PROGRESS_KEY, [])

  // useCallback : identité STABLE entre les rendus. Sans ça, chaque rendu
  // recréait save → saveProgress → relance de l'effet de sauvegarde du Player
  // → writeJSON → re-render → boucle infinie (React #185, écran noir).
  const save = useCallback((p: Omit<WatchProgress, 'updatedAt'>) => {
    const cur = readJSON<WatchProgress[]>(PROGRESS_KEY, [])
    const next = [{ ...p, updatedAt: Date.now() }, ...cur.filter((x) => x.id !== p.id)]
    // On ne garde que les 60 derniers
    writeJSON(PROGRESS_KEY, next.slice(0, 60))
  }, [])

  const remove = (id: string) => setItems(items.filter((x) => x.id !== id))

  const continueWatching = items.filter((x) => x.duration > 0 && x.time / x.duration < 0.92)

  return { items, save, remove, continueWatching }
}

export function makeStreamLabel(s: Stream): string {
  const parts = [s.name, s.title, s.description].filter(Boolean) as string[]
  return parts.join(' · ').slice(0, 120) || 'Source inconnue'
}

export function episodeStreamId(baseId: string, season: number, episode: number) {
  // Convention Stremio : IMDB → id:saison:épisode. IDs exotiques (kitsu:,
  // mal:…) → id:épisode (pas de notion de saison côté addons anime).
  if (/^tt\d+/.test(baseId)) return `${baseId}:${season}:${episode}`
  return `${baseId}:${episode}`
}

export function isValidIdForType(id: string, _type: MediaType) {
  void _type // paramètre réservé (validation par type à venir)
  return !!id
}
