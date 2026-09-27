/**
 * Trakt.tv : historique (scrobble à 80 %) et watchlist.
 *
 * L'utilisateur crée UNE application gratuite sur
 * https://trakt.tv/oauth/applications (nom quelconque, URI vide)
 * puis colle son Client ID / Client Secret dans Réglages → Trakt.
 * Connexion par flux appareil : un code s'affiche à l'écran et est saisi
 * sur trakt.tv/activate. Les tokens sont rafraîchis automatiquement.
 */

const BASE = 'https://api.trakt.tv'

export interface TraktSettings {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
  username: string
  scrobble: boolean
}

const KEY = 'novastream:trakt'

export function getTrakt(): TraktSettings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as TraktSettings | null
    return s && s.clientId ? s : null
  } catch {
    return null
  }
}

export function saveTrakt(s: TraktSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota */ }
}

export function patchTrakt(patch: Partial<TraktSettings>): void {
  const s = getTrakt()
  if (s) saveTrakt({ ...s, ...patch })
}

function headers(auth: boolean): Record<string, string> {
  const s = getTrakt()
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': s?.clientId ?? '',
  }
  if (auth && s?.accessToken) h.Authorization = `Bearer ${s.accessToken}`
  return h
}

async function traktGet(path: string, auth: boolean): Promise<unknown | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers(auth) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function traktPost(path: string, body: unknown, auth: boolean): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: headers(auth), body: JSON.stringify(body) })
}

// ── Flux appareil (OAuth) ────────────────────────────────────────

export interface DeviceFlow {
  userCode: string
  verificationUrl: string
  deviceCode: string
  interval: number
  expiresAt: number
}

export async function startDeviceFlow(): Promise<DeviceFlow | { error: string }> {
  const s = getTrakt()
  if (!s?.clientId) return { error: 'Client ID manquant — crée une app sur trakt.tv/oauth/applications' }
  try {
    const res = await fetch(`${BASE}/oauth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: s.clientId }),
    })
    if (!res.ok) return { error: `Trakt a répondu ${res.status} — vérifie le Client ID` }
    const j = (await res.json()) as { user_code: string; verification_url: string; device_code: string; interval: number; expires_in: number }
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

/** 'ok' | 'pending' | message d'erreur. */
export async function pollDeviceToken(deviceCode: string): Promise<string> {
  const s = getTrakt()
  if (!s) return 'Configuration manquante'
  try {
    const res = await fetch(`${BASE}/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, code: deviceCode }),
    })
    if (res.ok) {
      const j = (await res.json()) as { access_token: string; refresh_token: string }
      saveTrakt({ ...getTrakt()!, accessToken: j.access_token, refreshToken: j.refresh_token })
      const me = (await traktGet('/users/me', true)) as { user?: { username?: string } } | null
      if (me?.user?.username) patchTrakt({ username: me.user.username })
      return 'ok'
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string }
    if (j.error === 'authorization_pending' || j.error === 'slow_down') return 'pending'
    if (j.error === 'expired_token') return 'expired'
    return j.error_description ?? j.error ?? 'Erreur inconnue'
  } catch {
    return 'pending'
  }
}

// ── Scrobble (marquer comme vu) ──────────────────────────────────

export function traktMarkWatched(
  meta: { id: string; type: 'movie' | 'series'; name: string; baseId?: string },
  episodeLabel?: string,
): void {
  const s = getTrakt()
  if (!s?.accessToken || !s.scrobble) return
  const imdb = meta.id.startsWith('tt') ? meta.id : meta.baseId?.startsWith('tt') ? meta.baseId : null
  if (!imdb) return
  if (meta.type === 'movie') {
    void traktPost('/sync/history', { movies: [{ ids: { imdb }, title: meta.name }] }, true).catch(() => {})
    return
  }
  const m = episodeLabel?.match(/S(\d+)\s*E(\d+)/i)
  if (!m) return
  void traktPost(
    '/sync/history',
    { shows: [{ ids: { imdb }, seasons: [{ number: Number(m[1]), episodes: [{ number: Number(m[2]) }] }] }] },
    true,
  ).catch(() => {})
}

// ── Watchlist (pour affichage futur) ─────────────────────────────

export interface TraktListItem {
  id: string
  type: 'movie' | 'series'
  name: string
}

export async function traktFetchWatchlist(): Promise<TraktListItem[]> {
  interface Raw {
    type: string
    movie?: { title?: string; ids?: { imdb?: string } }
    show?: { title?: string; ids?: { imdb?: string } }
  }
  const j = (await traktGet('/sync/watchlist', true)) as Raw[] | null
  if (!Array.isArray(j)) return []
  const out: TraktListItem[] = []
  for (const it of j) {
    const id = it.type === 'movie' ? it.movie?.ids?.imdb : it.show?.ids?.imdb
    const name = it.type === 'movie' ? it.movie?.title : it.show?.title
    if (id && name) out.push({ id, type: it.type === 'movie' ? 'movie' : 'series', name })
  }
  return out
}

export function clearTrakt(): void {
  try { localStorage.removeItem(KEY) } catch { /* */ }
}
