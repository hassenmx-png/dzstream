/**
 * Simkl — historique (scrobble à 80 %), 100 % gratuit.
 * Endpoints validés en direct contre api.simkl.com :
 *   1. POST  /oauth/pin                { client_id } → user_code, device_code…
 *   2. L'utilisateur entre le code sur simkl.com/pin
 *   3. GET   /oauth/pin/{USER_CODE}?client_id=… → { result, message?, access_token? }
 *      « Authorization pending » tant que non validé, puis result OK + token.
 * Création d'app : simkl.com → Settings → Developer (Client ID seul suffit).
 */

const BASE = 'https://api.simkl.com'

export interface SimklSettings {
  clientId: string
  accessToken: string
  username: string
  scrobble: boolean
}

const KEY = 'novastream:simkl'

/** Client ID pré-configuré (même principe que les presets debrid/opensubs) :
 *  pré-rempli pour chaque visiteur. L'access_token, lui, reste personnel :
 *  il exige une validation PIN unique sur simkl.com/pin (2 min, une fois). */
const PRESET_SIMKL_CLIENT_ID = '937d2ab2a3eec7fe147be79a5463890b589bcbc6e2ffd3318ce5e66724587441'
const PRESET_SIMKL_SEEDED = 'novastream:simkl-clientid-seeded-v1'

/** Pré-remplit le Client ID une fois (sans écraser une config existante
 *  ni réapparaître si l'utilisateur l'a effacé volontairement). */
export function ensurePresetSimkl(): void {
  try {
    if (!PRESET_SIMKL_CLIENT_ID) return
    if (localStorage.getItem(PRESET_SIMKL_SEEDED)) return
    const cur = localStorage.getItem(KEY)
    if (cur) {
      const p = JSON.parse(cur) as SimklSettings | null
      if (p && p.clientId) return // config existante : on respecte
    }
    localStorage.setItem(KEY, JSON.stringify({ clientId: PRESET_SIMKL_CLIENT_ID.trim(), accessToken: '', username: '', scrobble: true }))
    localStorage.setItem(PRESET_SIMKL_SEEDED, '1')
  } catch { /* non critique */ }
}

export function getSimkl(): SimklSettings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SimklSettings | null
    return s && s.clientId ? s : null
  } catch {
    return null
  }
}

export function saveSimkl(s: SimklSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota */ }
}

export function patchSimkl(patch: Partial<SimklSettings>): void {
  const s = getSimkl()
  if (s) saveSimkl({ ...s, ...patch })
}

export function clearSimkl(): void {
  try { localStorage.removeItem(KEY) } catch { /* */ }
}

function authHeaders(): Record<string, string> {
  const s = getSimkl()
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'simkl-api-key': s?.clientId ?? '',
  }
  if (s?.accessToken) h.Authorization = `Bearer ${s.accessToken}`
  return h
}

// ── Flux appareil ────────────────────────────────────────────────

export interface SimklDeviceFlow {
  userCode: string
  verificationUrl: string
  deviceCode: string
  interval: number
  expiresAt: number
}

export async function simklStartDeviceFlow(): Promise<SimklDeviceFlow | { error: string }> {
  const s = getSimkl()
  if (!s?.clientId) return { error: 'Client ID manquant — crée une app sur simkl.com (Settings → Developer)' }
  try {
    // Simkl n'accepte que le GET avec client_id en query string
    // (le POST renvoie 404 « url_failed » — testé en direct).
    const res = await fetch(`${BASE}/oauth/pin?client_id=${encodeURIComponent(s.clientId)}`)
    if (!res.ok) return { error: `Simkl a répondu ${res.status} — vérifie le Client ID` }
    const j = (await res.json()) as {
      user_code: string
      verification_url: string
      device_code: string
      interval: number
      expires_in: number
    }
    return {
      userCode: j.user_code,
      verificationUrl: j.verification_url,
      deviceCode: j.device_code,
      interval: j.interval,
      expiresAt: Date.now() + j.expires_in * 1000,
    }
  } catch {
    return { error: 'Réseau indisponible' }
  }
}

/** Polling : 'ok' | 'pending' | 'expired' | message d'erreur. */
export async function simklPollDeviceToken(userCode: string): Promise<string> {
  const s = getSimkl()
  if (!s) return 'Configuration manquante'
  try {
    const res = await fetch(
      `${BASE}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(s.clientId)}`,
    )
    const j = (await res.json()) as { result?: string; message?: string; access_token?: string }
    if (j.result === 'OK' && j.access_token) {
      saveSimkl({ ...getSimkl()!, accessToken: j.access_token })
      try {
        const me = await fetch(`${BASE}/users/me`, { headers: authHeaders() })
        if (me.ok) {
          const mj = (await me.json()) as { username?: string; user?: { username?: string } }
          patchSimkl({ username: mj.username ?? mj.user?.username ?? '' })
        }
      } catch { /* nom optionnel */ }
      return 'ok'
    }
    if (/pending/i.test(j.message ?? '')) return 'pending'
    if (/expired|invalid/i.test(j.message ?? '')) return 'expired'
    return j.message ?? 'Erreur inconnue'
  } catch {
    return 'pending'
  }
}

// ── Scrobble (marquer comme vu à 80 % de lecture) ────────────────

export function simklMarkWatched(
  meta: { id: string; type: 'movie' | 'series'; name: string; baseId?: string },
  episodeLabel?: string,
): void {
  const s = getSimkl()
  if (!s?.accessToken || !s.scrobble) return
  const imdb = meta.id.startsWith('tt') ? meta.id : meta.baseId?.startsWith('tt') ? meta.baseId : null
  if (!imdb) return
  const base = { title: meta.name, ids: { imdb } }
  const body =
    meta.type === 'movie'
      ? { movies: [base] }
      : (() => {
          const m = episodeLabel?.match(/S(\d+)\s*E(\d+)/i)
          return m
            ? { shows: [{ ...base, seasons: [{ number: Number(m[1]), episodes: [{ number: Number(m[2]) }] }] }] }
            : null
        })()
  if (!body) return
  void fetch(`${BASE}/sync/history`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  }).catch(() => {})
}

// ── Historique récupéré (badges « vu ») ──────────────────────────

const WATCHED_KEY = 'novastream:simkl-watched'
const WATCHED_AT_KEY = 'novastream:simkl-watched-at'

export interface SimklWatched {
  movies: string[]
  episodes: Record<string, string[]> // imdb de la série → ['S1E1', …]
}

export function getSimklWatched(): SimklWatched {
  try {
    const w = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? 'null') as SimklWatched | null
    return w ?? { movies: [], episodes: {} }
  } catch {
    return { movies: [], episodes: {} }
  }
}

/** Récupère l'historique Simkl (films + épisodes vus). True si réussi. */
export async function simklFetchWatched(): Promise<boolean> {
  const s = getSimkl()
  if (!s?.accessToken) return false
  try {
    const h = authHeaders()
    const [rm, rs] = await Promise.all([
      fetch(`${BASE}/sync/watched/movies`, { headers: h }),
      fetch(`${BASE}/sync/watched/shows`, { headers: h }),
    ])
    if (!rm.ok || !rs.ok) return false
    const mj = (await rm.json()) as { movie?: { ids?: { imdb?: string } } }[]
    const sj = (await rs.json()) as {
      show?: { ids?: { imdb?: string } }
      seasons?: { number: number; episodes?: { number: number }[] }[]
    }[]
    const movies: string[] = []
    for (const it of mj) {
      const imdb = it.movie?.ids?.imdb
      if (imdb) movies.push(imdb)
    }
    const episodes: Record<string, string[]> = {}
    for (const it of sj) {
      const imdb = it.show?.ids?.imdb
      if (!imdb) continue
      const list: string[] = []
      for (const se of it.seasons ?? []) {
        for (const ep of se.episodes ?? []) list.push(`S${se.number}E${ep.number}`)
      }
      episodes[imdb] = list
    }
    try {
      localStorage.setItem(WATCHED_KEY, JSON.stringify({ movies, episodes }))
      localStorage.setItem(WATCHED_AT_KEY, String(Date.now()))
    } catch { /* quota */ }
    return true
  } catch {
    return false
  }
}

// ── Watchlist ────────────────────────────────────────────────────

export interface SimklListItem {
  id: string
  type: 'movie' | 'series'
  name: string
}

export async function simklFetchWatchlist(): Promise<SimklListItem[]> {
  const s = getSimkl()
  if (!s?.accessToken) return []
  try {
    const res = await fetch(`${BASE}/sync/watchlist`, { headers: authHeaders() })
    if (!res.ok) return []
    const j = (await res.json()) as {
      type: string
      movie?: { title?: string; ids?: { imdb?: string } }
      show?: { title?: string; ids?: { imdb?: string } }
    }[]
    const out: SimklListItem[] = []
    for (const it of j) {
      const imdb = it.type === 'movie' ? it.movie?.ids?.imdb : it.show?.ids?.imdb
      const name = it.type === 'movie' ? it.movie?.title : it.show?.title
      if (imdb && name) out.push({ id: imdb, type: it.type === 'movie' ? 'movie' : 'series', name })
    }
    return out
  } catch {
    return []
  }
}
