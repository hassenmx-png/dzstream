export type MediaType = 'movie' | 'series'

export interface MetaPreview {
  id: string
  type: MediaType
  name: string
  poster?: string
  background?: string
  logo?: string
  description?: string
  releaseInfo?: string
  imdbRating?: string
  genres?: string[]
  runtime?: string
  year?: string
  // Correspondance IMDB fournie par certains addons (ex. Kitsu pour les animes)
  imdb_id?: string
  // Page personne : personnage joué / fonction + popularité TMDB
  role?: string
  popularity?: number
  // Bande-annonce (Hero)
  trailerStreams?: { title: string; ytId: string }[]
}

export interface Episode {
  id: string
  title: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  // Correspondance IMDB par épisode (addons anime : Kitsu, MAL…)
  imdb_id?: string
  imdbSeason?: number
  imdbEpisode?: number
}

export interface MetaFull extends MetaPreview {
  cast?: string[]
  director?: string[]
  writer?: string[]
  country?: string
  awards?: string
  videos?: Episode[]
}

export interface CatalogResponse {
  metas: MetaPreview[]
}

export interface SubtitleTrack {
  id: string
  url: string
  lang: string
  label: string
  addonName?: string
}

export interface Stream {
  name?: string
  title?: string
  description?: string
  url?: string
  ytId?: string
  infoHash?: string
  fileIdx?: number
  sources?: string[]
  externalUrl?: string
  /** Audio Fix : la source est routée vers le transcodage (audio AAC) — le player ne doit pas la sauter. */
  audioFix?: boolean
  subtitles?: { id: string; url: string; lang: string }[]
  behaviorHints?: {
    notWebReady?: boolean
    bingeGroup?: string
    videoSize?: number
    filename?: string
  }
  addonName?: string
  addonLogo?: string
}

export interface AddonCatalog {
  id: string
  type: string
  name?: string
}

export interface AddonManifest {
  id: string
  version: string
  name: string
  description?: string
  logo?: string
  resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[]
  types: string[]
  catalogs?: AddonCatalog[]
  idPrefixes?: string[]
  behaviorHints?: {
    configurable?: boolean
    configurationRequired?: boolean
    p2p?: boolean
  }
}

export interface InstalledAddon {
  url: string
  manifest: AddonManifest
  enabled: boolean
  installedAt: number
}

export interface LibraryItem {
  id: string
  type: MediaType
  name: string
  poster?: string
  addedAt: number
}

export interface WatchProgress {
  id: string // id ou id:saison:episode
  baseId: string
  type: MediaType
  name: string
  poster?: string
  background?: string
  episodeLabel?: string
  time: number
  duration: number
  streamLabel?: string
  stream?: Stream
  updatedAt: number
}

export type View =
  | { name: 'home' }
  | { name: 'movies' }
  | { name: 'series' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'addons' }
  | { name: 'settings' }
  | { name: 'tv' }
  | { name: 'mangas' }
  | { name: 'status' }
  | { name: 'admin' }
  | { name: 'detail'; id: string; type: MediaType }
  | { name: 'person'; id: number }
  | { name: 'shared'; code: string }
  /** Grille complète d'un catalogue : un genre Cinemeta OU un catalogue d'addon. */
  | {
      name: 'catalog'
      title: string
      /** 'movie' | 'series' pour Cinemeta ; chaîne libre pour les addons
          (ex. le type « Marvel » de l'addon éponyme). */
      type: string
      genre?: string // Cinemeta uniquement
      addonUrl?: string // catalogue d'addon (Nuvio, Streaming Catalogs…)
      catalogId?: string
    }
