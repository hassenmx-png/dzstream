import type { PlayRequest } from './nav'
import { fetchAllStreams, fetchMetaAny, getDebrid, isDebridDown, isDebridStream, watchabilityScore } from './addons'
import { readJSON, writeJSON } from './store'
import type { Stream } from '@/types'

/**
 * Salon « regarder ensemble » — lecture synchronisée entre appareils.
 *
 * L'HÔTE crée un salon depuis le lecteur (code SN-XXXX-XXXX) et pousse son
 * état (lecture/pause/position) à chaque action + battement toutes les 10 s.
 * Les INVITÉS interrogent l'état toutes les ~2,5 s et calent leur lecteur
 * dessus (seek si dérive > 4 s, play/pause alignés). Si l'hôte change
 * d'épisode ou de film, les invités suivent automatiquement.
 *
 * Pas de WebSocket : du simple polling HTTP — ça marche partout, y compris
 * derrière les proxies qui coupent les connexions longues.
 */

const CID_KEY = 'novastream:cid'
const ROOM_KEY = 'novastream:room'

export interface RoomMedia {
  id: string // id de flux (tt… ou tt…:S:E)
  baseId: string
  type: 'movie' | 'series'
  name: string
  poster?: string
  background?: string
  episodeLabel?: string
  infoHash?: string
}

export interface RoomState {
  v: 1
  host: string
  media: RoomMedia
  playing: boolean
  position: number
  at: number // horloge SERVEUR (ms)
  guests?: Record<string, number>
}

export interface ActiveRoom {
  code: string
  role: 'host' | 'guest'
  /** Invité : suivre la lecture de l'hôte (false = pause perso locale) */
  follow: boolean
}

// ------------------------------------------------------------------ état local

const listeners = new Set<() => void>()
let snapshot = 0
function emit() {
  snapshot++
  listeners.forEach((l) => l())
}
export function subscribeRoom(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function roomSnapshot() {
  return snapshot
}

export function getClientId(): string {
  let cid = ''
  try {
    cid = localStorage.getItem(CID_KEY) ?? ''
  } catch { /* mode privé */ }
  if (!cid) {
    cid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    try {
      localStorage.setItem(CID_KEY, cid)
    } catch { /* ignore */ }
  }
  return cid
}

export function getActiveRoom(): ActiveRoom | null {
  return readJSON<ActiveRoom | null>(ROOM_KEY, null)
}

function setActiveRoom(room: ActiveRoom | null) {
  writeJSON(ROOM_KEY, room)
  emit()
}

export function setRoomFollow(follow: boolean) {
  const r = getActiveRoom()
  if (r) setActiveRoom({ ...r, follow })
}

// ------------------------------------------------------------------ réseau

export function normalizeRoomCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = clean.match(/^(?:SN)?([A-Z2-9]{4})([A-Z2-9]{4})$/)
  return m ? `SN-${m[1]}-${m[2]}` : null
}

/** Position estimée de l'hôte MAINTENANT (horloge serveur = référence commune). */
export function roomPosition(state: RoomState, serverNow: number): number {
  const drift = Math.max(0, serverNow - state.at) / 1000
  return state.position + (state.playing ? drift : 0)
}

/** Crée un salon (hôte). Renvoie le code à partager, ou null si échec. */
export async function createRoom(media: RoomMedia, playing: boolean, position: number): Promise<string | null> {
  const state: RoomState = {
    v: 1,
    host: getClientId(),
    media,
    playing,
    position,
    at: Date.now(), // réécrit côté serveur
  }
  try {
    const res = await fetch('/api/sync/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { code: string }
    setActiveRoom({ code: j.code, role: 'host', follow: true })
    return j.code
  } catch {
    return null
  }
}

/** Pousse l'état de lecture (hôte). Silencieux en cas d'échec. */
export async function pushRoomState(code: string, media: RoomMedia, playing: boolean, position: number): Promise<void> {
  const state: RoomState = { v: 1, host: getClientId(), media, playing, position, at: Date.now() }
  try {
    await fetch(`/api/sync/room/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
  } catch { /* réseau capricieux : le prochain battement réessaiera */ }
}

/** Battement de cœur invité (présence visible par l'hôte). */
export async function guestHeartbeat(code: string): Promise<void> {
  try {
    await fetch(`/api/sync/room/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest: getClientId() }),
    })
  } catch { /* ignore */ }
}

/** Lit l'état du salon. null = introuvable/terminé. */
export async function fetchRoom(code: string): Promise<{ state: RoomState; serverNow: number } | null> {
  try {
    const res = await fetch(`/api/sync/room/${code}`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as { state: RoomState; serverNow: number }
    return j
  } catch {
    return null
  }
}

/** Quitte le salon. L'hôte le FERME pour tout le monde. */
export async function leaveRoom(): Promise<void> {
  const room = getActiveRoom()
  if (room?.role === 'host') {
    try {
      await fetch(`/api/sync/room/${room.code}`, { method: 'DELETE' })
    } catch { /* déjà fermé */ }
  }
  setActiveRoom(null)
}

/** Marque le salon actif comme invité (après un joinRoomAndPlay réussi). */
export function enterRoomAsGuest(code: string): void {
  setActiveRoom({ code, role: 'guest', follow: true })
}

/**
 * Rejoindre un salon = trouver le même contenu chez soi et le lancer à la
 * position de l'hôte. Chacun utilise SES sources (P2P local) — on matche
 * l'infoHash de l'hôte si possible (même fichier = synchro parfaite), sinon
 * la meilleure source disponible chez l'invité.
 */
export async function joinRoomAndPlay(
  rawCode: string,
  play: (req: PlayRequest) => void,
): Promise<{ ok: boolean; error?: string }> {
  const code = normalizeRoomCode(rawCode)
  if (!code) return { ok: false, error: 'Format invalide — le code ressemble à SN-XXXX-XXXX.' }
  const room = await fetchRoom(code)
  if (!room) return { ok: false, error: 'Salon introuvable ou déjà terminé.' }
  const { state, serverNow } = room

  const meta = await fetchMetaAny(state.media.type, state.media.baseId).catch(() => null)
  const name = meta?.name ?? state.media.name
  const poster = meta?.poster ?? state.media.poster
  const background = meta?.background ?? state.media.background

  const results = await fetchAllStreams(state.media.type, state.media.id).catch(() => [])
  const all = results.flatMap((r) => r.streams)
  const debridOn = !!getDebrid() && !isDebridDown()
  const scoreOf = (s: Stream) => {
    const premium = debridOn && isDebridStream(s)
    return watchabilityScore(s, { cloud: premium }) + (premium ? 2000 : 0)
  }
  all.sort((a, b) => scoreOf(b) - scoreOf(a))
  const stream =
    (state.media.infoHash ? all.find((s) => s.infoHash?.toLowerCase() === state.media.infoHash) : null) ?? all[0]
  if (!stream) {
    return { ok: false, error: `Aucune source trouvée chez toi pour « ${name} ». Le salon existe — ajoute des addons ou vérifie ton debrid.` }
  }

  enterRoomAsGuest(code)

  // Chaîne de repli (même logique que la fiche détail) : si la source choisie
  // échoue — ex. lien premium alors que la clé debrid vient d'être refusée —
  // le lecteur enchaîne SEUL sur la suivante, en mélangeant P2P et direct.
  const metaPayload = {
    id: state.media.id,
    baseId: state.media.baseId,
    type: state.media.type,
    name,
    poster,
    background,
  }
  const launchWithFallbacks = (s: Stream, tried: string[]): void => {
    const pool = all
      .filter((x) => {
        const k = x.infoHash ?? x.url
        return k && k !== (s.infoHash ?? s.url) && !tried.includes(k)
      })
      .sort((a, b) => scoreOf(b) - scoreOf(a))
    const free = pool.filter((x) => !isDebridStream(x))
    const seen = new Set<string>()
    const fallbacks = [...pool.slice(0, 4), ...free.slice(0, 3)]
      .filter((x) => {
        const k = x.infoHash ?? x.url ?? ''
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .slice(0, 6)
    play({
      stream: s,
      meta: metaPayload,
      episodeLabel: state.media.episodeLabel,
      startAt: roomPosition(state, serverNow),
      subtitles: [],
      fallbackStreams: fallbacks,
      // Pool complet : sélecteur de version (VF/VO) disponible aussi en salon.
      streamsPool: all,
      onFallback: (next) => launchWithFallbacks(next, [...tried, s.infoHash ?? s.url ?? '']),
      triedHashes: tried,
    })
  }
  launchWithFallbacks(stream, [])
  return { ok: true }
}
