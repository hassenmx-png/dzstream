/** Configuration du home personnalisable (DZ STREAM). */
export interface HomeRowDef {
  id: string
  /** Type de rangée : continue | foryou | top-movies | top-series |
   *  popular-movies | popular-series | animes |
   *  genre:<movie|series>:<Genre> | platform:<movie|series>:<providerId> |
   *  addon:<url>|<type>|<catalogId> */
  type: string
  title: string
}

/** Disposition par défaut = l'ancien accueil (identique visuellement). */
export const DEFAULT_ROWS: HomeRowDef[] = [
  { id: 'foryou', type: 'foryou', title: 'Recommandé pour toi' },
  { id: 'top-movies', type: 'top-movies', title: 'Top 10 films' },
  { id: 'top-series', type: 'top-series', title: 'Top 10 séries' },
  { id: 'popular-movies', type: 'popular-movies', title: 'Films populaires' },
  { id: 'popular-series', type: 'popular-series', title: 'Séries populaires' },
  { id: 'action', type: 'genre:movie:Action', title: 'Action' },
  { id: 'scifi', type: 'genre:movie:Science Fiction', title: 'Science-fiction' },
  { id: 'comedy', type: 'genre:movie:Comedy', title: 'Comédies' },
  { id: 'drama', type: 'genre:series:Drama', title: 'Séries dramatiques' },
  { id: 'animes', type: 'animes', title: 'Animes du moment' },
]

/** Plateformes proposées dans l'éditeur (IDs TMDB watch-providers, région FR). */
export const PLATFORM_OPTIONS = [
  { id: '8', name: 'Netflix' },
  { id: '337', name: 'Disney+' },
  { id: '119', name: 'Prime Video' },
  { id: '350', name: 'Apple TV+' },
  { id: '381', name: 'Canal+' },
  { id: '531', name: 'Paramount+' },
  { id: '1899', name: 'Max' },
]
