import { createContext, useContext } from 'react'
import type { View } from '@/types'

export interface NavCtx {
  view: View
  go: (v: View) => void
  back: () => void
  play: (payload: PlayRequest) => void
}

export interface PlayRequest {
  stream: import('@/types').Stream
  meta: { id: string; baseId: string; type: 'movie' | 'series'; name: string; poster?: string; background?: string }
  episodeLabel?: string
  startAt?: number
  /** Sous-titres disponibles (addons + pistes embarquées de la source). */
  subtitles?: import('@/types').SubtitleTrack[]
  /** Appelé quand l'utilisateur veut enchaîner sur l'épisode suivant. */
  onNextEpisode?: () => void
  /** Épisode précédent (bouton rapide dans le lecteur). */
  onPrevEpisode?: () => void
  prevEpisodeLabel?: string
  nextEpisodeLabel?: string
  /** Sources de repli (triées par regardabilité) si celle-ci échoue. */
  fallbackStreams?: import('@/types').Stream[]
  /** TOUTES les sources trouvées — sert au sélecteur de version (VF/VO…)
   *  du lecteur, au-delà des quelques replis automatiques. */
  streamsPool?: import('@/types').Stream[]
  /** Relance automatiquement la lecture avec une autre source.
   *  startAt permet de reprendre à la position courante (changement de
   *  version audio demandé par l'utilisateur). */
  onFallback?: (s: import('@/types').Stream, startAt?: number) => void
  /** infoHash déjà essayés dans cette chaîne (évite le ping-pong A→B→A). */
  triedHashes?: string[]
}

export const NavContext = createContext<NavCtx>({
  view: { name: 'home' },
  go: () => {},
  back: () => {},
  play: () => {},
})

export const useNav = () => useContext(NavContext)
