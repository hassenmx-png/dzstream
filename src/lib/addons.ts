import type { AddonManifest, InstalledAddon, MetaFull, MetaPreview, Stream, SubtitleTrack } from '@/types'
import { readJSON, writeJSON } from './store'
import { toast } from './toast'
import { getOpensubsKey, opensubsSearch } from './opensubs'

const KEY = 'novastream:addons'
const SEEDED_KEY = 'novastream:defaults-seeded-v16'

/** StreamFusion : instance perso de l'utilisateur — indexeurs FR (C411, YGG…)
 *  + cache AllDebrid intégré dans l'URL de config. Renvoie des liens
 *  /playback/ qui redirigent (302) vers le CDN AllDebrid : lecture DIRECTE,
 *  instantanée, sans P2P — et castable sur TV. */
export const STREAMFUSION_URL =
  'https://streamfusion.stremio-epsilon.ca/8e49f9e8-03d0-4c57-bb18-a464b4ccd536/0SOPHJrKGgmdEUA2E8KFS3T8P1NWWok-HSozEx3w2GQ8596PaWxYZB-nQjarS2DPy'

/** Addon HDHub avec les clés AllDebrid ET TorBox intégrées : liens premium
 *  ⚡[AD+] / ⚡[TB+] résolus en direct + liens directs (pixeldrain, CDN).
 *  Config base64 dans le chemin. */
/** UwU Watch : addon francophone tout-en-un (config base64 embarquant la
 *  clé AllDebrid de l'utilisateur) : sources DIRECTES françaises VF/VOSTFR
 *  (frenchstream, voirdrama, torrent911, C411, YGG…) en complément des
 *  torrents Torrentio et des liens premium HDHub. Remplace StreamFusion. */
/** Ancienne config UwU (nipva.com) : résolution morte (IP serveur bloquée
 *  par AllDebrid) → retirée des installations existantes. */
const OLD_UWU_NIPVA_URL =
  'https://uwu.nipva.com/'

/** LooStream : miroirs français (Netflix/Prime/Disney+/StreamFlix/Movix)
 *  en direct 1080p + sous-titres VTT FR intégrés. Résolution vérifiée :
 *  302 → MP4 CDN réel. Config embarquant la clé AllDebrid du propriétaire. */
export const LOOSTREAM_URL =
  'https://loostream.nipva.com/'

export const UWU_WATCH_URL =
  'https://uwu.creepso.com/profile_a2c7633a-f9e6-4f39-8c09-81c0f29b73f5'

export const HDHUB_URL =
  'https://hdhub.thevolecitor.qzz.io/'

/** Config HDHub AllDebrid seul (seeding v8) — remplacée au seeding v10. */
const OLD_HDHUB_AD_URL =
  'https://hdhub.thevolecitor.qzz.io/'

/** Ancienne config HDHub (clé TorBox seule, expirée) — remplacée au seeding v7. */
const OLD_HDHUB_URL =
  'https://hdhub.thevolecitor.qzz.io/'

/** URLs d'addons remplacées par une version configurée — retirées au seeding. */
const OLD_LOOSTREAM_URL =
  'https://loostream.nipva.com/'
const RETIRED_URLS = ['https://torrentio.strem.fun', OLD_HDHUB_URL, OLD_HDHUB_AD_URL, STREAMFUSION_URL, OLD_UWU_NIPVA_URL, OLD_LOOSTREAM_URL]

/**
 * Addons préinstallés : présents d'office sur TOUS les appareils, dès le
 * premier lancement, sans rien installer. L'utilisateur peut en ajouter
 * d'autres ou les désactiver depuis l'onglet Addons.
 */
const DEFAULT_ADDONS: InstalledAddon[] = [
  {
    url: 'https://v3-cinemeta.strem.io/manifest.json',
    manifest: {
      id: 'com.linkec.stremio.cinemeta',
      version: '3.0.0',
      name: 'Cinemeta',
      description: 'Catalogue public films et series',
      resources: ['catalog', 'meta'],
      types: ['movie', 'series'],
      catalogs: [
        { type: 'movie', id: 'top', name: 'Films populaires' },
        { type: 'series', id: 'top', name: 'Series populaires' },
      ],
    },
    enabled: true,
    installedAt: Date.now(),
  },
  {
    url: 'https://dzstream.duckdns.org/comet',
    manifest: {
      id: 'com.dzstream.comet',
      version: '1.7.0',
      name: 'Comet VPS',
      description: 'Ton Jackett (YGG, Torrent9, TPB, EZTV, Nyaa) débridé AllDebrid',
      resources: ['stream'],
      types: ['movie', 'series'],
      catalogs: [],
    },
    enabled: true,
    installedAt: Date.now(),
  },
]

/**
 * Vitrine « Addons recommandés » de la page Addons : installation en UN clic,
 * sans copier-coller d'URL. Les 4 premiers sont préinstallés d'office ; la
 * vitrine sert à les réinstaller après une suppression et à découvrir les
 * extras (anime…).
 */
export interface RecommendedAddon {
  url: string
  name: string
  desc: string
  tags: string[]
  logo?: string
}

export const RECOMMENDED_ADDONS: RecommendedAddon[] = [
  {
    url: LOOSTREAM_URL,
    name: 'LooStream',
    desc: 'Miroirs VF/VOSTFR (Netflix, Prime, Disney+, StreamFlix, Movix) 1080p + sous-titres FR intégrés. Vérifié : MP4 réels.',
    tags: ['🇫🇷 FR', 'VF/VOSTFR', '1080p', '📝 Sous-titres'],
    logo: 'https://loostream.nipva.com/logo.png',
  },
  {
    url: UWU_WATCH_URL,
    name: 'UwU-FR Animes',
    desc: 'Animes VF/VOSTFR (Nyaa, NekoBT) résolus par ta clé AllDebrid. Films et séries : utilise Torrentio/HDHub.',
    tags: ['🇫🇷 FR', 'Animes', '⚡ AD'],
    logo: 'https://uwu.nipva.com/assets/UwU%20Logo.jpg',
  },

  {
    url: 'https://torrentio.strem.fun',
    name: 'Torrentio FR',
    desc: 'La référence : plus de 20 trackers dont Torrent9 — c\'est lui qui ramène la VF.',
    tags: ['P2P', '🇫🇷 VF'],
    logo: 'https://torrentio.strem.fun/logo.png',
  },
  {
    url: 'https://thepiratebay-plus.strem.fun',
    name: 'ThePirateBay+',
    desc: 'Second moteur P2P : films, séries et anime. Idéal en secours de Torrentio.',
    tags: ['P2P', 'Films', 'Séries'],
    logo: 'https://i.imgur.com/dPa2clS.png',
  },
  {
    url: 'https://87d6a6ef6b58-webstreamrmbg.baby-beamup.club/%7B%22multi%22%3A%20%22on%22%2C%20%22fr%22%3A%20%22on%22%7D',
    name: 'WebStreamr',
    desc: 'Sources directes HTTP (pas de P2P) : démarrage instantané, extracteurs FR activés.',
    tags: ['Direct', '🇫🇷 FR'],
  },
  {
    url: HDHUB_URL,
    name: 'HDHub 4K',
    desc: 'Sources premium AllDebrid ⚡ (4K/1080p instantané) + liens directs pixeldrain. Ta clé est déjà configurée.',
    tags: ['Premium', '4K', 'Direct'],
    logo: 'https://hdhub.thevolecitor.qzz.io/logo.png',
  },
  {
    url: 'https://opensubtitlesv3-pro.dexter21767.com/',
    name: 'OpenSubtitles PRO',
    desc: 'Sous-titres FR optimisés IA, sans pub, ajustement automatique.',
    tags: ['Sous-titres'],
  },
  {
    url: 'https://mylumio.tv/YOTizX6l3iiz',
    name: 'Lumio',
    desc: 'Votre cinéma privé : films, séries et animes en streaming direct.',
    tags: ['Streaming', 'Direct'],
  },
  {
    url: 'https://mediafusion.elfhosted.com/D-RcaqfmKC4jnXI4RledUpJnKNo4Q53VOnXPQlP0G6IWlbSOBGHSvhcQJBGXqPIlpipOv0Brye2gAEOdEuas-AA3zrgnkxNgi4FFDRCVLK-Nga_rPgx2nXjTrQN2AgyXgIZFfLxTo-8dpC2gyQQ9oH33rk4DVwBt2ZwZXF5SU7vWsg3kBI44-cNEF00YPwyZLG1o_TGS2_Uir6lNcQk7ZSskMxxb1pI9mJFtbLjNk2Kw8G68WxpAUZ0Dj0Ak1vXuQF',
    name: 'MediaFusion',
    desc: 'Sources multi-hébergeurs, audio FR prioritaire, contenu régional français.',
    tags: ['Streaming', 'FR'],
  },
  {
    url: 'https://addon-stremio-fs-public.stremio-fs-public.workers.dev/',
    name: 'Catalogues FR',
    desc: 'Rangées de catalogues français : derniers films, action, séries Netflix/AppleTV/Prime/Disney+.',
  },
  {
    url: 'https://v3-cinemeta.strem.io',
    name: 'Cinemeta Catalogs',
    desc: 'Top films, top séries, meilleures notes IMDb, par année.',
    tags: ['Catalogues', 'Top'],
  },
  {
    url: 'https://jackettio.elfhosted.com/',
    name: 'Comet VPS',
    desc: 'Indexeurs publics (EZTV, 1337x, TPB…) résolus en AllDebrid.',
  },
  {
    url: `${window.location.origin}/jackettio/`,
    name: 'Jackettio VPS',
    desc: 'Ton Jackett perso sur ton VPS (Torrent9, YGG à venir) débridé AllDebrid.',
    tags: ['Streaming', 'FR', 'Débrid'],
  },

  {
    url: 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LGRucCxhbXAsYXRwLGhibTo6RlI6MTc3OTk1MzAxNzUxMTowOjA6RlI%3D',
    name: 'Streaming Catalogs',
    desc: 'Catalogues Netflix, Disney+, Prime, Apple TV+ et HBO sur ta page d\'accueil.',
    tags: ['Catalogues'],
  },
  {
    url: 'https://catalog.nuvio.tv',
    name: 'Nuvio Catalogs',
    desc: 'Catalogues éditoriaux TMDB : séries diffusées aujourd\'hui, nouveautés à venir, films plébiscités par la critique.',
    tags: ['Catalogues', 'Éditorial'],
  },
  {
    url: 'https://addon-marvel.gonp.deno.net',
    name: 'Marvel',
    desc: 'Tout l\'univers Marvel : MCU en ordre chronologique, X-Men, films, séries et animations.',
    tags: ['Catalogues', 'Marvel'],
    logo: 'https://raw.githubusercontent.com/joaogonp/addon-marvel/main/public/assets/icon.png',
  },
  {
    url: 'https://anime-kitsu.strem.fun',
    name: 'Anime Kitsu',
    desc: 'Catalogue anime complet (Kitsu.io) : tendances, nouveautés, fiches détaillées.',
    tags: ['Anime', 'Catalogues'],
    logo: 'https://i.imgur.com/7N6XGoO.png',
  },
  {
    url: 'https://c5541ffce7d3-aniscraper.baby-beamup.club',
    name: 'AniScraper',
    desc: 'Streams animes depuis Nyaa & AnimeTosho (VOSTFR, épisodes auto-matchés).',
    tags: ['Streaming', 'Animés'],
  },
]

/** Injecte les addons par défaut : au premier lancement, MAIS ajoute aussi
 *  les NOUVEAUX préinstallés (Frenchio, MediaFusion…) aux appareils déjà
 *  initialisés — sans toucher aux addons de l'utilisateur ni à ses
 *  désactivations. La fusion est idempotente (par URL) et instantanée. */
export function ensureDefaultAddons(): void {
  const existing = readJSON<InstalledAddon[]>(KEY, [])
  // Retire les addons remplacés par une version configurée (ex. Torrentio
  // brut → Torrentio FR) pour éviter les sources en double.
  const kept = existing.filter((a) => !RETIRED_URLS.includes(a.url))
  const missing = DEFAULT_ADDONS.filter((d) => !kept.some((a) => a.url === d.url))
  if (missing.length > 0) writeJSON(KEY, [...kept, ...missing])
  if (!readJSON<boolean>(SEEDED_KEY, false)) writeJSON(SEEDED_KEY, true)
}

export function getAddons(): InstalledAddon[] {
  ensureDefaultAddons()
  ensurePresetDebrid()
  return readJSON<InstalledAddon[]>(KEY, [])
}

function saveAddons(addons: InstalledAddon[]) {
  writeJSON(KEY, addons)
}

/** Normalise l'URL saisie : accepte manifest.json, base avec/sans slash, stremio:// */
export function normalizeAddonUrl(input: string): string {
  let url = input.trim()
  url = url.replace(/^stremio:\/\//, 'https://')
  if (url.endsWith('/manifest.json')) url = url.slice(0, -'/manifest.json'.length)
  return url.replace(/\/+$/, '')
}

export async function installAddon(input: string): Promise<InstalledAddon> {
  const base = normalizeAddonUrl(input)
  if (!/^https?:\/\//.test(base)) throw new Error('URL invalide — elle doit commencer par http(s)://')
  const res = await fetch(`${base}/manifest.json`)
  if (!res.ok) throw new Error(`Manifest introuvable (HTTP ${res.status})`)
  const manifest = (await res.json()) as AddonManifest
  if (!manifest.id || !manifest.name || !manifest.resources) {
    throw new Error("Ce manifest n'est pas un addon compatible (protocole Stremio).")
  }
  const addons = getAddons()
  if (addons.some((a) => a.url === base)) throw new Error('Cet addon est déjà installé.')
  const addon: InstalledAddon = { url: base, manifest, enabled: true, installedAt: Date.now() }
  saveAddons([...addons, addon])
  return addon
}

export function removeAddon(url: string) {
  saveAddons(getAddons().filter((a) => a.url !== url))
}

export function toggleAddon(url: string) {
  saveAddons(getAddons().map((a) => (a.url === url ? { ...a, enabled: !a.enabled } : a)))
}

function hasResource(manifest: AddonManifest, name: string): boolean {
  return manifest.resources.some((r) => (typeof r === 'string' ? r === name : r.name === name))
}

function supportsType(manifest: AddonManifest, type: string): boolean {
  if (!manifest.types || manifest.types.length === 0) return true
  return manifest.types.includes(type) || manifest.types.includes('movie') || manifest.types.includes('series')
}

// ---- Debrid premium (AllDebrid, Real-Debrid, TorBox…) ----
// Une clé debrid transforme chaque torrent Torrentio en lien HTTPS direct
// mis en cache chez le debrideur : lecture instantanée, zéro pair, zéro
// attente. Stockée localement sur l'appareil, jamais envoyée ailleurs qu'à
// Torrentio (qui s'en sert pour résoudre les liens).
export interface DebridConfig {
  service: 'alldebrid' | 'realdebrid' | 'torbox' | 'premiumize' | 'debridlink' | 'easydebrid' | 'offcloud'
  key: string
}
/** Stockage multi-clés : chaque service actif (AllDebrid, TorBox, une clé
 *  perso…) est conservé — leurs sources premium apparaissent EN PARALLÈLE. */
const DEBRIDS_KEY = 'novastream:debrids'
/** Ancien stockage mono-clé (primaire), conservé en miroir pour compatibilité. */
const DEBRID_KEY = 'novastream:debrid'

/** Toutes les clés debrid actives, dédupliquées par service (la première gagne). */
export function getDebrids(): DebridConfig[] {
  ensurePresetDebrid()
  const list = readJSON<DebridConfig[]>(DEBRIDS_KEY, [])
  const seen = new Set<string>()
  const out: DebridConfig[] = []
  for (const d of list) {
    if (!d || !d.key || seen.has(d.service)) continue
    seen.add(d.service)
    out.push(d)
  }
  return out
}

/** Première clé active (primaire) — conservé pour les appels existants. */
export function getDebrid(): DebridConfig | null {
  return getDebrids()[0] ?? null
}

function saveDebrids(list: DebridConfig[]): void {
  writeJSON(DEBRIDS_KEY, list)
  // Miroir de compatibilité : les anciens consommateurs lisent DEBRID_KEY.
  if (list.length > 0) writeJSON(DEBRID_KEY, list[0])
  else localStorage.removeItem(DEBRID_KEY)
}

/** Ajoute ou remplace la clé d'un service (la clé perso passe en tête). */
export function upsertDebrid(config: DebridConfig): void {
  const rest = getDebrids().filter((d) => d.service !== config.service)
  saveDebrids([config, ...rest])
  clearDebridDown() // nouvelle clé → on retente le premium
}

/** Retire un service précis (ex. déconnecter TorBox sans toucher AllDebrid). */
export function removeDebrid(service: DebridConfig['service']): void {
  saveDebrids(getDebrids().filter((d) => d.service !== service))
  clearDebridDown()
}

/** Déconnecte tous les services d'un coup. */
export function setDebrid(config: DebridConfig | null): void {
  if (config) upsertDebrid(config)
  else {
    saveDebrids([])
    clearDebridDown()
  }
}

/**
 * Pré-enregistre les clés debrid préinstallées (demande explicite) :
 * AllDebrid ET TorBox actives EN PARALLÈLE — leurs sources premium
 * apparaissent côte à côte dans chaque fiche.
 * Une seule fois par appareil : si l'utilisateur retire un service ensuite,
 * son choix est respecté (drapeau seeded v3).
 * Migration v3 : les anciens stockages mono-clé (clé perso, preset AllDebrid
 * seul, anciennes clés préinstallées bannies/expirées) sont convertis en
 * liste. Une clé entrée à la main par l'utilisateur n'est JAMAIS écrasée.
 */
const DEBRID_SEEDED_KEY = 'novastream:debrid-seeded-v4'
// Ancien drapeau v2 : sert à distinguer « utilisateur déconnecté » (ne pas
// réinjecter les presets) de « seeding jamais passé ».
const DEBRID_SEEDED_KEY_V2 = 'novastream:debrid-seeded-v2'
// Toutes les anciennes clés préinstallées : AllDebrid banni (compte rétabli
// depuis, nouvelle clé ci-dessous) et TorBox (clé renouvelée — réintégrée
// comme preset actif).
const OLD_PRESET_KEYS = [
  '3yMHSCeGN1eeWG2MR5Av',
  'iZV3GS7JIO2lfl8NFchbhHbc',
  'AIJH9kKxprHF1qMonoxw', // preset AllDebrid remplacé (nouvelle clé)
  'bz4XvtwqEAlf5JUxkGFATSs1', // cookie expiré (AUTH_BAD_APIKEY) — remplacé v4
]
// Clé « application tierce » vérifiée sur l'API AllDebrid (compte premium
// BOUDJhass, dernière utilisation FR). Les clés « cookie » tournent et
// expirent : celle-ci est stable et dédiée aux apps.
const PRESET_ALLDEBRID: DebridConfig = { service: 'alldebrid', key: '' }
const PRESET_TORBOX: DebridConfig = { service: 'torbox', key: '' }

function savePresetDebrids(list: DebridConfig[]): void {
  writeJSON(DEBRIDS_KEY, list)
  writeJSON(DEBRID_KEY, list[0])
}

export function ensurePresetDebrid(): void {
  try {
    if (localStorage.getItem(DEBRID_SEEDED_KEY)) return
    const legacy = readJSON<DebridConfig | null>(DEBRID_KEY, null)
    const wasSeededV2 = !!localStorage.getItem(DEBRID_SEEDED_KEY_V2)
    const list: DebridConfig[] = []
    if (legacy && legacy.key && !OLD_PRESET_KEYS.includes(legacy.key)) {
      // Clé personnalisée de l'utilisateur : conservée, même si c'est
      // l'ancienne clé TorBox réactivée depuis (elle rejoint les presets).
      list.push(legacy)
    }
    if (legacy && legacy.key === PRESET_TORBOX.key && !list.some((d) => d.service === 'torbox')) {
      list.push(PRESET_TORBOX)
    }
    if (!wasSeededV2 || legacy) {
      // Jamais seedé, ou clé existante : on garantit les deux presets.
      if (!list.some((d) => d.service === PRESET_ALLDEBRID.service)) list.push(PRESET_ALLDEBRID)
      if (!list.some((d) => d.service === PRESET_TORBOX.service)) list.push(PRESET_TORBOX)
    }
    // wasSeededV2 && !legacy → l'utilisateur s'était déconnecté : on respecte.
    savePresetDebrids(list)
    localStorage.setItem(DEBRID_SEEDED_KEY, '1')
  } catch { /* mode privé : ignoré */ }
}

/**
 * Drapeau de session « debrid HS » : si le service refuse la clé à la lecture
 * (abonnement expiré…), on cesse de pousser les liens premium en tête et on
 * retombe sur les sources gratuites pour le reste de la session. Réinitialisé
 * à la (re)connexion ou au prochain lancement de l'app.
 */
/** Drapeaux de session « service HS » : par service (torbox peut tomber sans
 *  affecter alldebrid) plus l'ancien drapeau global lu pour compatibilité. */
const DEBRID_DOWN_KEY = 'novastream:debrid-down'
const downFlagKey = (service: string) => `novastream:debrid-down:${service}`

export function isServiceDown(service: string): boolean {
  try {
    return sessionStorage.getItem(downFlagKey(service)) === '1'
  } catch { return false }
}

/** (Dé)marque un service HS pour la session — appelé par le contrôle de santé. */
export function setServiceDownFlag(service: string, down: boolean): void {
  try {
    if (down) sessionStorage.setItem(downFlagKey(service), '1')
    else sessionStorage.removeItem(downFlagKey(service))
    sessionStorage.removeItem(DEBRID_DOWN_KEY) // l'ancien drapeau global devient caduc
  } catch { /* mode privé : ignoré */ }
}

/** Vrai si AUCUN service debrid actif ne répond (tous marqués HS). */
export function isDebridDown(): boolean {
  const all = getDebrids()
  if (all.length === 0) return false
  return all.every((d) => isServiceDown(d.service))
}

function clearDebridDown(): void {
  try {
    sessionStorage.removeItem(DEBRID_DOWN_KEY)
    for (const d of getDebrids()) sessionStorage.removeItem(downFlagKey(d.service))
  } catch { /* mode privé : ignoré */ }
}

/** Marque TOUS les services HS (repli sécurité déclenché à la lecture)… */
export function setDebridDown(down: boolean): void {
  try {
    if (!down) return clearDebridDown()
    sessionStorage.setItem(DEBRID_DOWN_KEY, '1')
    for (const d of getDebrids()) sessionStorage.setItem(downFlagKey(d.service), '1')
  } catch { /* mode privé : ignoré */ }
}

/**
 * Contrôle de santé des clés debrid au démarrage : chaque service actif est
 * interrogé via son API (compte banni, clé invalide, abonnement expiré).
 * Chaque service est géré INDÉPENDAMMENT : TorBox HS masque ses sources
 * sans affecter AllDebrid (et inversement). Si le compte redevient actif,
 * ses sources reviennent automatiquement. Silencieux en cas de coupure
 * réseau (on ne punit pas une panne temporaire).
 */
export async function checkDebridHealth(): Promise<void> {
  ensurePresetDebrid()
  // Le contrôle de santé passe par NOTRE serveur : les clés ne quittent
  // jamais le VPS (fin des appels directs api.alldebrid.com / api.torbox.app
  // depuis le navigateur). Clés serveur : .env.local
  // (ALLDEBRID_API_KEY / TORBOX_API_KEY). Fail-open : sans clé serveur ou
  // réseau coupé, on ne masque JAMAIS les sources.
  await Promise.allSettled(getDebrids().map(async (d) => {
    if (d.service !== 'alldebrid' && d.service !== 'torbox') return
    try {
      const res = await fetch(`/api/stream/health?service=${d.service}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return // ex. pas encore authentifié (cookie) : on ne change rien
      const j = (await res.json()) as { ok: boolean; reason?: string }
      if (j.ok) {
        setServiceDownFlag(d.service, false) // compte rétabli → le premium revient tout seul
        return
      }
      if (j.reason === 'no-server-key' || j.reason === 'network' || j.reason === 'unknown-service') return
      setServiceDownFlag(d.service, true)
      const label = d.service === 'torbox' ? 'TorBox' : 'AllDebrid'
      toast(
        j.reason === 'banned'
          ? `Compte ${label} suspendu — ses sources sont masquées, les autres services restent actifs.`
          : j.reason === 'expired'
            ? `Abonnement ${label} expiré — ses sources sont masquées, les autres services restent actifs.`
            : `Clé ${label} refusée — ses sources sont masquées, les autres services restent actifs.`,
      )
    } catch {
      /* réseau coupé : on ne change rien pour ce service */
    }
  }))
}

/**
 * URL effective d'un addon : injecte TOUTES les clés debrid actives dans
 * Torrentio. Torrentio accepte plusieurs services dans le chemin, séparés
 * par « | » :
 *   torrentio.strem.fun/alldebrid=<clé>|torbox=<clé>|language=french
 * Les sources premium de CHAQUE service remontent alors en parallèle
 * ([AD+], [TB+]…). Un service marqué HS (banni, expiré) est exclu
 * individuellement : ses liens morts ne polluent pas la liste, les autres
 * services restent pleinement actifs.
 */
export function effectiveAddonUrl(addon: InstalledAddon): string {
  if (addon.url.includes('torrentio.strem.fun')) {
    const parts = getDebrids()
      .filter((d) => !isServiceDown(d.service))
      .map((d) => `${d.service}=${encodeURIComponent(d.key)}`)
    if (parts.length === 0) return addon.url
    return `https://torrentio.strem.fun/${parts.join('|')}|language=french`
  }
  return addon.url
}

/** Vrai si le stream est un lien résolu par debrid (cache premium instantané).
 *  Inclut les /playback/ de StreamFusion (302 → CDN AllDebrid). */
export function isDebridStream(s: Stream): boolean {
  if (!!s.url && /\/resolve\/|\/tb\/play|\/playback\/|debrid|alldebrid|real-debrid|torbox/i.test(s.url)) return true
  // Lumio : ses liens /play/ sont resolus cote serveur via Torbox (cache
  // premium) — le mot « debrid » n apparait nulle part dans l URL, d ou ce
  // marquage explicite pour le badge eclair et le tri des colonnes.
  if (!!s.url && /mylumio\.tv\/play\//i.test(s.url)) return true
  // Badge debrid dans le NOM du stream (format standard Stremio : [AD], [AD+],
  // [RD], [TB], [PM]…) — indispensable pour les addons dont l'URL passe par
  // un proxy/tunnel sans le mot « debrid » dedans (ex : Jackettio).
  if (s.name && /\[(AD|AD\+|RD|RD\+|TB|TB\+|DL|DL\+|PM|PM\+|ED|ED\+)\]/i.test(s.name)) return true
  return false
}

export function streamCapableAddons(): InstalledAddon[] {
  return getAddons().filter((a) => a.enabled && hasResource(a.manifest, 'stream') && !/statusio/i.test(`${a.manifest?.id ?? ''} ${a.manifest?.name ?? ''} ${a.url ?? ''}`))
}

export interface AddonStreams {
  addon: InstalledAddon
  streams: Stream[]
  error?: string
}

/** Interroge tous les addons activés en parallèle et agrège les sources.
 *  Timeout 12 s PAR addon : un addon qui rame ne bloque plus jamais
 *  l'affichage des sources des autres. */
export async function fetchAllStreams(type: string, id: string, onPartial?: (addon: InstalledAddon, streams: Stream[]) => void): Promise<AddonStreams[]> {
  const addons = streamCapableAddons().filter((a) => supportsType(a.manifest, type))
  const results = await Promise.all(
    addons.map(async (addon): Promise<AddonStreams> => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20000)
      try {
        const res = await fetch(`${effectiveAddonUrl(addon)}/stream/${type}/${encodeURIComponent(id)}.json`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { streams?: Stream[] }
        const streams = (data.streams ?? [])
          // Faux-flux d'erreur debrid (clé invalide/expirée) : Torrentio les
          // renvoie comme des « sources » pointant vers une vidéo d'erreur.
          // On les masque complètement.
          .filter((s) => !/failed_access/i.test(s.url ?? '') && !/invalid .*(key|token|apkey)|\berror\b/i.test(`${s.name ?? ''} ${s.title ?? ''}`))
          .map((s) => {
            const u = typeof s.url === 'string' ? s.url : ''
            const risky = /(ac3|e-?ac3|dts|truehd|atmos)/i.test(`${s.name ?? ''} ${s.title ?? s.description ?? ''}`)
            return {
              ...s,
              url: u,
              addonName: addon.manifest.name,
              addonLogo: addon.manifest.logo,
            }
          })
        const _r={addon,streams}
        onPartial?.(addon,streams)
        return _r
      } catch (e) {
        return { addon, streams: [], error: e instanceof Error ? e.message : 'Erreur réseau' }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return results
}

/** Cache session des listes de sources (5 min) : rouvrir une fiche ou
 *  changer d'épisode réaffiche les sources INSTANTANÉMENT pendant que le
 *  réseau rafraîchit en arrière-plan. Les URLs mises en cache sont les
 *  liens RÉSOLVEURS (/resolve/, /playback/) — stables, pas les liens CDN
 *  temporaires. */
const STREAMS_CACHE_MS = 5 * 60_000
export function cachedStreams(type: string, id: string): Stream[] | null {
  try {
    const raw = sessionStorage.getItem(`novastream:streams:${type}:${id}`)
    if (!raw) return null
    const { t, streams } = JSON.parse(raw) as { t: number; streams: Stream[] }
    if (Date.now() - t > STREAMS_CACHE_MS) return null
    return streams
  } catch {
    return null
  }
}

export function cacheStreams(type: string, id: string, streams: Stream[]): void {
  try {
    // sessionStorage est limité (~5 Mo) : on tronque à 120 sources, largement
    // suffisant pour le tri + le sélecteur de version.
    sessionStorage.setItem(
      `novastream:streams:${type}:${id}`,
      JSON.stringify({ t: Date.now(), streams: streams.slice(0, 120) }),
    )
  } catch {
    /* quota plein : pas grave, pas de cache */
  }
}

/** Extrait la qualité (2160p/1080p/720p…) depuis le nom/titre d'une source. */
export function streamQuality(s: Stream): string {
  const text = `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`
  const m = text.match(/(2160|1080|720|480|360)\s?p/i) || text.match(/\b(4k|8k|uhd|hdrip|webrip|bluray|bdrip|cam)\b/i)
  if (!m) return 'SD'
  const v = m[1].toLowerCase()
  if (v === '4k' || v === '2160') return '4K'
  if (v === '8k' || v === 'uhd') return '8K'
  return v.endsWith('p') ? v.toUpperCase() : `${v}p`.replace('PP', 'P').toUpperCase()
}

export function streamKind(s: Stream): 'torrent' | 'http' | 'youtube' | 'external' {
  // Lien premium (debrid / StreamFusion /playback/) : lecture DIRECTE même si
  // un infoHash est présent — le P2P serait un détour inutile et plus lent.
  if (s.url && isDebridStream(s)) return 'http'
  if (s.infoHash) return 'torrent'
  if (s.ytId) return 'youtube'
  if (s.externalUrl) return 'external'
  return 'http'
}

export function qualityRank(q: string): number {
  const order = ['8K', '4K', '2160P', '1080P', '720P', '480P', '360P', 'SD']
  const i = order.indexOf(q.toUpperCase())
  return i === -1 ? order.length : i
}

export function formatBytes(n?: number): string {
  if (!n) return ''
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

/**
 * Audio NON décodé par Chrome/Firefox/Edge (AC3, E-AC3, DTS, TrueHD…) :
 * la vidéo passe mais SANS SON. Couvre toutes les écritures rencontrées
 * dans les noms de releases : AC3, AC-3, EAC3, E-AC-3, DD5.1, DD 5.1,
 * DDP5.1, DDP 5.1, DD+5.1, DD+ 5.1, Dolby Digital, DTS, DTS-HD, DTS:X,
 * TrueHD, Atmos…
 */
export const RISKY_AUDIO_RE =
  /\b(e-?ac-?3|ac-?3|dd[p+]?[\s.-]?5[\s.-]?1|dd[p+]?[\s.-]?7[\s.-]?1|dolby[\s-]?digital|dts(-?hd)?(-?ma)?|dts:?x|truehd|atmos)\b/i

/** Audio décodé partout (AAC, MP3, Opus, Vorbis, FLAC→non mais rare). */
export const SAFE_AUDIO_RE = /\b(aac|mp3|opus|vorbis|pcm|lcpm|flac)\b/i

/** Texte complet d'une source pour la détection (nom + titre + description). */
export function streamText(s: Stream): string {
  // Le nom de fichier (behaviorHints) porte souvent le codec audio
  // (ex. Torrentio : « Movie.2026.1080p.AMZN.WEB-DL.EAC3... ») — indispensable
  // pour détecter l'AC3/EAC3 que ni le nom ni la description ne mentionnent.
  return `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''} ${s.behaviorHints?.filename ?? ''}`
}

/** Vrai si la source déclare une piste audio incompatible navigateur. */
export function hasRiskyAudio(s: Stream): boolean {
  return RISKY_AUDIO_RE.test(streamText(s))
}

/** Vrai si la source déclare une piste audio sûre (AAC/MP3/Opus…). */
export function hasSafeAudio(s: Stream): boolean {
  return SAFE_AUDIO_RE.test(streamText(s))
}

/** Nombre de seeders détecté dans le titre d'une source torrent (👤 152, etc.). */
export function streamSeeders(s: Stream): number {
  const text = `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`
  const m = text.match(/👤\s*(\d+)/) || text.match(/(?:seeders?|seeds?)\s*[-:]?\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}

/** Taille du fichier détectée (💾 1.5 GB dans le titre, ou behaviorHints.videoSize). */
export function streamSize(s: Stream): number {
  const hint = s.behaviorHints?.videoSize
  if (hint && hint > 0) return hint
  const text = `${s.title ?? ''} ${s.name ?? ''} ${s.description ?? ''}`
  const m = text.match(/💾\s*([\d.,]+)\s*(GB|MB|GiB|MiB|Go|Mo)/i)
  if (!m) return 0
  const v = parseFloat(m[1].replace(',', '.'))
  return /g/i.test(m[2]) ? v * 1e9 : v * 1e6
}

/**
 * Audio français détecté dans le titre d'une source :
 * - 'VF' : doublage français (FRENCH, TRUEFRENCH, VFF, VFQ, VF…)
 * - 'MULTI' : release multi-langues — inclut presque toujours une piste FR
 * - 'VOSTFR' : audio original + sous-titres FR
 * - null : pas d'info (le plus souvent VO)
 */
export function streamAudio(s: Stream): 'VF' | 'MULTI' | 'VOSTFR' | null {
  const text = `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`
  // Preuve EXPLICITE d'une piste audio française dans la release
  if (text.includes('🇫🇷')) return 'VF'
  if (/truefrench|\bfrench\b|\bvff\b|\bvfq\b|\bvf2\b|fran[cç]ais|\bfr[- ]?audio\b|\baudio[- ]?fr\b/i.test(text)) return 'VF'
  // « FR » isolé dans un nom de release = audio français (ex. « (2001) FR [1080p] »)
  if (/\bfr\b/i.test(text)) return 'VF'
  if (/\bvf\b/i.test(text)) return 'VF'
  // « MULTI » : sur les trackers, ça désigne le plus souvent des sous-titres
  // multi (VO + ST) — SANS piste FR. On ne le classe MULTI que si une preuve
  // FR existe quelque part ; sinon c'est du VOSTFR déguisé.
  if (/\bmulti\b/i.test(text)) {
    return /french|vff|vfq|vfi|fran[cç]ais/i.test(text) ? 'MULTI' : 'VOSTFR'
  }
  if (/\bvostfr?\b/i.test(text)) return 'VOSTFR'
  return null
}

/**
 * Score de « regardabilité » : privilégie ce qui démarre vite et se lit
 * sans accroc — beaucoup de seeders, taille raisonnable, qualité adaptée.
 * Un 4K de 16 Go est pénalisé, un 1080p/720p bien seedé est favorisé.
 */
export function watchabilityScore(s: Stream, opts?: { cloud?: boolean }): number {
  const q = streamQuality(s).toUpperCase()
  const text = `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`
  // cloud : lien servi par les serveurs debrid — seeders et taille ne
  // changent rien au démarrage ; seuls la qualité et l'audio décident.
  // Seeders plafonnés à 120 : au-delà, la vitesse ne progresse plus, et ça
  // évite qu'un fichier VO très seedé écrase une VF correctement seedée.
  let score = opts?.cloud ? 0 : Math.min(streamSeeders(s), 120)
  const sizeGB = streamSize(s) / 1e9
  // Fichiers lourds = débit élevé. Pénalité douce au-delà de 3 Go (le 1080p
  // pèse naturellement plus que le 720p — on ne veut pas le pénaliser pour
  // ça), plus sévère au-delà de 8 Go (irregardable en direct).
  if (!opts?.cloud) {
    if (sizeGB > 3) score -= (sizeGB - 3) * 40
    if (sizeGB > 8) score -= (sizeGB - 8) * 60
  }
  // Sweet spot demandé par l'utilisateur : 1080p d'abord, 720p en repli,
  // 4K/8K relégués (trop lourds pour du streaming temps réel).
  if (q === '1080P') score += 100
  else if (q === '720P') score += 40
  else if (q === '4K' || q === '2160P' || q === '8K') score -= 150
  // Codec : x264/H.264 = lisible nativement par tous les navigateurs.
  // x265/HEVC et XviD/DivX = illisibles sans transcodage cloud → relégués
  // tout en bas (le cloud est un secours, pas un choix par défaut).
  if (/x265|hevc|h[.\s-]?265/i.test(text)) score -= 500
  else if (/x264|avc|h[.\s-]?264/i.test(text)) score += 50
  if (/xvid|divx/i.test(text)) score -= 500
  // Audio non décodé par Chrome/Firefox (AC3, E-AC3, DTS, TrueHD) : image
  // SANS SON. Pénalité massive — une source AAC même en 720p est toujours
  // préférable à un 1080p muet. Regex partagée : toutes les variantes
  // (DD 5.1, DDP 5.1, DD+…) sont couvertes.
  if (RISKY_AUDIO_RE.test(text)) score -= 800
  else if (SAFE_AUDIO_RE.test(text)) score += 120
  // Audio français : PRIORITÉ ABSOLUE demandée par l'utilisateur — le bonus
  // est un tier à part entière (au-dessus du premium/caché/qualité) : TOUTE
  // source VF regardable passe devant la meilleure VO. À l'intérieur du
  // tier VF, le reste du score (premium, cache, qualité, seeders) trie.
  const audio = streamAudio(s)
  if (audio === 'VF') score += 10000
  else if (audio === 'MULTI') score += 6000
  else if (audio === 'VOSTFR') score += 2500
  // Marqueur de cache debrid dans le nom ([AD+], [RD+], [TB+]…) : le fichier
  // est DÉJÀ sur les serveurs du debrideur → lecture instantanée garantie.
  // Les liens premium non marqués peuvent déclencher un téléchargement cloud
  // (attente longue) — ils passent derrière.
  // Marqueur de cache debrid dans le nom ([AD+], [RD+], [TB+]…, « ⚡instant »
  // de StreamFusion) : le fichier est DÉJÀ sur les serveurs du debrideur →
  // lecture instantanée garantie.
  if (/\[(ad|rd|tb|pm|dl|ed|oc)\+\]|\[torbox\]|⚡\s*instant/i.test(text)) score += 600
  // Cyrillique = doublage RU garanti : relégué tout en bas, quels que soient
  // les seeders (un fichier inutilisable ne doit jamais être recommandé).
  if (/[Ѐ-ӿ]/.test(text)) score -= 1000
  // Enregistrements cinéma (CAM, TELESYNC, TELECINE, HDTS, HDCAM…) et
  // screeners (HDSCR, DVDSCR, R5…) : jamais recommandés face à un WEB-DL.
  if (/\bcam\b|\btelesync\b|\btelecine\b|\bhdts\b|\bhdcam\b|\bhd-?ts\b|\bts\b/i.test(text)) score -= 400
  if (/\bhdscr\b|\bdvdscr\b|\bwebscr\b|\bscr\b|\br5\b/i.test(text)) score -= 400
  // Sources DIRECTES HTTP (WebStreamr…) : démarrage GARANTI — aucun pair
  // nécessaire, contrairement au P2P dont le swarm peut être injoignable.
  // Bonus massif quand le profil codec est sûr (h264 + AAC…) ; réduit si la
  // source déclare un codec à risque (HEVC/AC3 — le détecteur de silence et
  // la chaîne de repli prendront le relais). Les liens premium debrid ont
  // déjà leur propre bonus (+2000) aux points d'appel : exclus ici.
  const directHttp = !s.infoHash && !!s.url && !isDebridStream(s)
  if (directHttp && !opts?.cloud) {
    const riskyVideo = /x265|hevc|h[.\s-]?265|xvid|divx/i.test(text)
    const riskyAudio = /\b(e-?ac-?3|ac-?3|ddp?5[.\s]?1|dts-?hd|dts|truehd|atmos)\b/i.test(text)
    score += riskyVideo || riskyAudio ? 300 : 800
  }
  return score
}

/** Addons capables de fournir des sous-titres (ressource "subtitles"). */
export function subtitleCapableAddons(): InstalledAddon[] {
  return getAddons().filter((a) => a.enabled && hasResource(a.manifest, 'subtitles'))
}

export interface SubtitleQuery {
  type: string
  id: string
  videoHash?: string
  videoSize?: number
  filename?: string
  /** Titre de la série/film : secours de recherche OpenSubtitles par nom
   *  (indispensable pour les animes, mal indexés par ID IMDb). */
  name?: string
}

/** Interroge les addons de sous-titres (protocole Stremio /subtitles/...). */
export async function fetchAllSubtitles(q: SubtitleQuery): Promise<SubtitleTrack[]> {
  const addons = subtitleCapableAddons()
  const extra = [
    q.videoHash ? `videoHash=${q.videoHash}` : '',
    q.videoSize ? `videoSize=${q.videoSize}` : '',
    q.filename ? `filename=${encodeURIComponent(q.filename)}` : '',
  ].filter(Boolean).join('&')
  const extraPath = extra ? `/${extra}` : ''
  const results = await Promise.allSettled(
    addons.filter((addon) => !/opensubtitles|stremio\.homes/i.test(addon.url ?? '')).map(async (addon) => {
      const mapSubs = (data: { subtitles?: { id: string; url: string; lang: string }[] }) =>
        (data.subtitles ?? []).map((s, i) => ({
          id: `${addon.manifest.id}-${s.id ?? i}`,
          url: s.url,
          lang: s.lang,
          label: s.lang.toUpperCase(),
          addonName: addon.manifest.name,
        }))
      const base = `${addon.url}/subtitles/${q.type}/${encodeURIComponent(q.id)}`
      const res = await fetch(`${base}${extraPath}.json`, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const subs = mapSubs(await res.json())
        if (subs.length > 0) return subs
      }
      // Repli SANS empreinte : quand le hash/nom de fichier du torrent est
      // inconnu d'OpenSubtitles, la requête ciblée renvoie 0 piste. On
      // retombe alors sur la recherche par ID IMDB (toutes langues).
      if (extraPath) {
        const bare = await fetch(`${base}.json`, { signal: AbortSignal.timeout(5000) })
        if (bare.ok) return mapSubs(await bare.json())
      }
      return []
    }),
  )
  const fromAddons = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  // Vraie source intégrée : OpenSubtitles interrogé directement (API legacy,
  // CORS ouvert) — français prioritaire, plein catalogue indépendamment
  // des addons installés.
  const direct = await fetchOpenSubtitlesDirect(q).catch(() => [] as SubtitleTrack[])
  // Source complémentaire : OpenSubtitles.com v2 (meilleure couverture
  // anime/VOSTFR) — active si une clé API est enregistrée (Réglages).
  let v2: SubtitleTrack[] = []
  const epParts = q.id.split(':')
  const imdb = q.id.match(/^tt\d+/)?.[0]
  if (getOpensubsKey()) {
    v2 = (await opensubsSearch({
      imdbId: imdb ?? undefined,
      name: q.name,
      season: epParts.length >= 3 ? Number(epParts[1]) : undefined,
      episode: epParts.length >= 3 ? Number(epParts[2]) : undefined,
    }).catch(() => [])).map((t) => ({
      id: t.id,
      url: `osv2:${t.fileId}`,
      lang: 'fre',
      label: `OS.com · ${t.label}`,
    }))
  }
  return [...fromAddons, ...direct, ...v2]
}

interface OsLegacyItem {
  IDSubtitleFile: string
  SubFileName: string
  SubDownloadLink: string
  MovieReleaseGroup?: string
}

/** OpenSubtitles direct : recherche par ID IMDB, sous-langue français.
 *  Les URL renvoyées portent le préfixe « os: » (liens gzippés traités
 *  côté lecteur). */
async function fetchOpenSubtitlesDirect(q: SubtitleQuery): Promise<SubtitleTrack[]> {
  const m = q.id.match(/tt(\d+)/)
  if (!m) return []
  const parts = q.id.split(':')
  let url = `https://rest.opensubtitles.org/search/imdbid-${m[1]}/sublanguageid-fre`
  if (parts.length >= 3) {
    url = `https://rest.opensubtitles.org/search/episode-${parts[2]}/season-${parts[1]}/imdbid-${m[1]}/sublanguageid-fre`
  }
  const runSearch = async (u: string): Promise<OsLegacyItem[]> => {
    const res = await fetch(u, {
      headers: { 'User-Agent': 'DZ STREAM v37' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    // L'API legacy renvoie tantôt une liste brute, tantôt { data: [...] }
    const parsed = (await res.json().catch(() => null)) as OsLegacyItem[] | { data?: OsLegacyItem[] } | null
    if (Array.isArray(parsed)) return parsed
    return parsed?.data ?? []
  }

  let items = await runSearch(url)
  // SECOURS ANIME : si la recherche par ID IMDb est vide (animes mal
  // indexés), on retente par NOM de la série + saison/épisode.
  if (items.length === 0 && q.name) {
    const qe = encodeURIComponent(q.name.replace(/[^\wÀ-ÿ' -]/g, ' ').trim())
    if (qe) {
      const alt = parts.length >= 3
        ? `https://rest.opensubtitles.org/search/query-${qe}/episode-${parts[2]}/season-${parts[1]}/sublanguageid-fre`
        : `https://rest.opensubtitles.org/search/query-${qe}/sublanguageid-fre`
      items = await runSearch(alt)
    }
  }
  if (items.length === 0) return []
  const seen = new Set<string>()
  const tracks: SubtitleTrack[] = []
  for (const it of items.slice(0, 20)) {
    const name = (it.SubFileName ?? it.MovieReleaseGroup ?? 'Sous-titre VF').replace(/\.srt$/i, '')
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tracks.push({
      id: `os-${it.IDSubtitleFile}`,
      url: `os:${it.SubDownloadLink}`,
      lang: 'fre',
      label: name,
      addonName: 'OpenSubtitles',
    })
  }
  return tracks
}

/** Catalogues exposés par les addons installés (pour les rangées de l'accueil). */
export function getAddonCatalogs(): { addon: InstalledAddon; id: string; type: string; name: string }[] {
  type Entry = { addon: InstalledAddon; id: string; type: string; name: string }
  // Un addon peut déclarer beaucoup de catalogues (ex. Streaming Catalogs :
  // 10 entrées Netflix/Disney+/Prime/Apple/HBO). On pioche en tourniquet
  // entre les addons pour qu'aucun ne monopolise l'accueil.
  const perAddon: Entry[][] = []
  for (const addon of getAddons()) {
    if (!addon.enabled || !hasResource(addon.manifest, 'catalog') || !addon.manifest.catalogs) continue
    perAddon.push(
      addon.manifest.catalogs.map((c) => ({ addon, id: c.id, type: c.type, name: c.name ?? c.id })),
    )
  }
  const out: Entry[] = []
  for (let i = 0; out.length < 12; i++) {
    let took = false
    for (const list of perAddon) {
      if (out.length >= 12) break
      if (list[i]) { out.push(list[i]); took = true }
    }
    if (!took) break
  }
  return out
}

export async function fetchAddonCatalog(addonUrl: string, type: string, catalogId: string, skip = 0): Promise<MetaPreview[]> {
  // Pagination Stremio : /skip=N n'est honoré que par les catalogues qui le
  // déclarent ; les autres renvoient la première page (dédoublonnée en amont)
  // ou une erreur → la grille « Tout voir » s'arrête proprement.
  const url =
    skip > 0
      ? `${addonUrl}/catalog/${type}/${catalogId}/skip=${skip}.json`
      : `${addonUrl}/catalog/${type}/${catalogId}.json`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { metas?: MetaPreview[] }
  // IMPORTANT : ne PAS filtrer sur /^tt\d+/ — les addons anime utilisent des
  // IDs kitsu:, mal:, etc. On garde tout élément avec un poster.
  return (data.metas ?? []).filter((m) => m.poster)
}

/** True si le manifeste déclare gérer ce préfixe d'ID (ou n'impose rien). */
function idPrefixMatches(manifest: AddonManifest, id: string): boolean {
  const prefixes = manifest.idPrefixes
    ?? manifest.resources.flatMap((r) => (typeof r === 'string' ? [] : r.idPrefixes ?? []))
  if (!prefixes || prefixes.length === 0) return true
  return prefixes.some((p) => id.startsWith(p))
}

/**
 * Métadonnées : IMDB (tt…) → Cinemeta. IDs exotiques (kitsu:, mal:…) →
 * l'addon installé qui déclare ce préfixe (ex. addon anime). Repli Cinemeta.
 */
export async function fetchMetaAny(type: string, id: string): Promise<MetaFull | null> {
  const { fetchMeta } = await import('./cinemeta')
  const mt = (type === 'series' ? 'series' : 'movie') as 'movie' | 'series'
  if (/^tt\d+/.test(id)) return fetchMeta(mt, id)
  const addons = getAddons().filter(
    (a) => a.enabled && hasResource(a.manifest, 'meta') && idPrefixMatches(a.manifest, id),
  )
  for (const addon of addons) {
    try {
      const res = await fetch(`${addon.url}/meta/${type}/${encodeURIComponent(id)}.json`)
      if (!res.ok) continue
      const data = (await res.json()) as { meta?: MetaFull }
      if (data.meta?.id) return data.meta
    } catch { /* essaie l'addon suivant */ }
  }
  // Repli : Cinemeta sait parfois résoudre des IDs externes
  try {
    return await fetchMeta(mt, id)
  } catch {
    return null
  }
}

export function ensureServerDebridAddon(): void {
  fetch('/api/manga/debrid-addon').then(r => r.ok ? r.json() : null).then((d: any) => {
    if (!d) return
    const list = readJSON<InstalledAddon[]>(KEY, [])
    let changed = false
    const add = (url: string, manifest: unknown) => {
      if (!url || !manifest) return
      const mid = (manifest as { id?: string }).id
      // Meme addon deja present (meme id de manifest) mais avec une ANCIENNE
      // URL (ex. Lumio configure a la main avec AllDebrid) : on le REMPLACE
      // par la version serveur (Torbox) au lieu de laisser les deux.
      const idx = list.findIndex(a => a.url === url || (mid && a.manifest?.id === mid))
      if (idx >= 0) {
        if (list[idx].url !== url) {
          list[idx] = { ...list[idx], url, manifest, enabled: true }
          changed = true
        }
        return
      }
      list.push({ url, manifest, enabled: true, installedAt: Date.now() } as InstalledAddon)
      changed = true
    }
    // Les URLs sont stockées SANS le suffixe /manifest.json (convention de
    // normalizeAddonUrl) — sinon les requêtes /stream/… aboutissent à un 404.
    const base = (u: string) => u.replace(/\/manifest\.json$/i, '')
    if (d.url) add(base(d.url), d.manifest)
    if (d.animesub?.url) add(base(d.animesub.url), d.animesub.manifest)
    if (Array.isArray(d.extra)) for (const e of d.extra) { if (e?.url) add(base(e.url), e.manifest) }
    if (changed) writeJSON(KEY, list)
  }).catch(() => {})
}
