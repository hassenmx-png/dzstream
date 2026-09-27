import type { Stream, SubtitleTrack } from '@/types'
import { fetchAllStreams, fetchAllSubtitles } from '@/lib/addons'

/** Préchargement de l'épisode suivant.
 *
 *  Quand un épisode démarre, on récupère EN ARRIÈRE-PLAN les flux et les
 *  sous-titres de l'épisode d'après : au clic sur « Épisode suivant » (ou à la
 *  fin de l'épisode), tout est déjà là — la transition est instantanée
 *  au lieu d'attendre 2 réseaux (flux + sous-titres). */

export type PreloadedEpisode = {
  streams: Stream[]
  subtitles: SubtitleTrack[]
  at: number
}

const TTL_MS = 15 * 60 * 1000 // 15 min : au-delà, les liens debrid peuvent expirer
const MAX_ENTRIES = 4

const cache = new Map<string, PreloadedEpisode>()
const inflight = new Set<string>()

/** Récupère (et consomme) un épisode préchargé. */
export function consumePreloaded(streamId: string): PreloadedEpisode | null {
  const hit = cache.get(streamId)
  if (!hit) return null
  cache.delete(streamId)
  if (Date.now() - hit.at > TTL_MS) return null
  return hit
}

/** Regarde (sans consommer) si un épisode est déjà en cache — utile pour
 *  afficher « prêt » quelque part. */
export function peekPreloaded(streamId: string): boolean {
  const hit = cache.get(streamId)
  return !!hit && Date.now() - hit.at <= TTL_MS
}

/** Vide le cache (déconnexion debrid, changement de profil…). */
export function clearPreload(): void {
  cache.clear()
}

/** Précharge flux + sous-titres d'un épisode, en arrière-plan.
 *  Silencieux : jamais de toast, jamais d'erreur visible. */
export function preloadEpisode(params: {
  type: 'movie' | 'series'
  streamId: string
  name: string
}): void {
  if (inflight.has(params.streamId)) return
  const existing = cache.get(params.streamId)
  if (existing && Date.now() - existing.at <= TTL_MS) return

  inflight.add(params.streamId)
  ;(async () => {
    try {
      const [results, subtitles] = await Promise.all([
        fetchAllStreams(params.type, params.streamId),
        fetchAllSubtitles({
          type: params.type,
          id: params.streamId,
          name: params.name,
        }).catch(() => [] as SubtitleTrack[]),
      ])
      const streams = results.flatMap((r) => r.streams)
      cache.set(params.streamId, { streams, subtitles, at: Date.now() })
      // FIFO : on garde le cache petit
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
    } catch {
      /* silencieux : le préchargement est un bonus, jamais bloquant */
    } finally {
      inflight.delete(params.streamId)
    }
  })()
}
