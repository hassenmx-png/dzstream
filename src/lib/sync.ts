import type { LibraryItem, WatchProgress } from '@/types'
import { LIB_KEY, PROGRESS_KEY } from './library'
import { RATINGS_KEY, type RatingItem } from './ratings'
import { onWrite, readJSON, writeJSON } from './store'
import { exportBackup } from './backup'
import {
  DATA_PREFIX as PROFILE_DATA_PREFIX,
  REGISTRY_KEY as PROFILE_REGISTRY_KEY,
  SHARED_KEYS as PROFILE_SHARED_KEYS,
  deleteProfileDataRaw,
  getActiveProfileId,
  getProfileDataRaw,
  getProfiles,
  saveProfileDataRaw,
  saveProfiles,
} from './profiles'

/**
 * Synchro multi-appareils sans compte.
 * Un code « NS-XXXX-XXXX » identifie le coffre côté serveur. La fusion est
 * faite ici, élément par élément, en gardant la version la plus récente
 * (updatedAt / addedAt). Les suppressions locales sont propagées grâce au
 * marqueur lastPullAt : un élément distant plus ancien que la dernière
 * synchro mais absent en local = supprimé ici → on ne le renvoie pas.
 */

const CODE_KEY = 'novastream:sync-code'
const META_KEY = 'novastream:sync-meta'

export interface SyncMeta {
  lastPullAt: number
  lastSyncAt: number
  lastError: string | null
}

export type SyncState = 'off' | 'idle' | 'busy' | 'error'

const stateListeners = new Set<() => void>()
let stateSnapshot = 0
function emitState() {
  stateSnapshot++
  stateListeners.forEach((l) => l())
}
export function subscribeSync(cb: () => void) {
  stateListeners.add(cb)
  return () => stateListeners.delete(cb)
}
export function syncSnapshot() {
  return stateSnapshot
}

// ------------------------------------------------------------------ code

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sans 0/O ni 1/I/L

export function generateSyncCode(): string {
  const pick = () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  const group = () => Array.from({ length: 4 }, pick).join('')
  return `NS-${group()}-${group()}`
}

export function normalizeSyncCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = clean.match(/^(?:NS)?([A-Z2-9]{4})([A-Z2-9]{4})$/)
  return m ? `NS-${m[1]}-${m[2]}` : null
}

export function getSyncCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY)
  } catch {
    return null
  }
}

export function getSyncMeta(): SyncMeta {
  return readJSON<SyncMeta>(META_KEY, { lastPullAt: 0, lastSyncAt: 0, lastError: null })
}

function setMeta(patch: Partial<SyncMeta>) {
  writeJSON(META_KEY, { ...getSyncMeta(), ...patch })
  emitState()
}

export function disconnectSync() {
  try {
    localStorage.removeItem(CODE_KEY)
    localStorage.removeItem(META_KEY)
  } catch {
    /* mode privé */
  }
  emitState()
}

// ------------------------------------------------------------------ merge

/**
 * Fusion symétrique, last-write-wins par élément, avec propagation des
 * suppressions grâce à lastPullAt (date de la dernière synchro RÉUSSIE) :
 * - distant absent en local : nouveau si updatedAt > lastPullAt, sinon
 *   c'est un élément supprimé ici → on ne le ressuscite pas ;
 * - local absent du distant : nouveau local (jamais poussé) si
 *   updatedAt > lastPullAt, sinon il a été supprimé sur l'autre appareil
 *   → on le laisse tomber (sinon les suppressions ne se propageraient
 *   jamais, chaque appareil « ressuscitant » les éléments de l'autre).
 */
function mergeById<T extends { id: string }>(
  local: T[],
  remote: T[],
  lastPullAt: number,
  stamp: (x: T) => number,
  cap: number,
): T[] {
  const byId = new Map<string, T>()
  const remoteIds = new Set(remote.map((r) => r.id))
  const localIds = new Set(local.map((l) => l.id))
  for (const r of remote) {
    if (!localIds.has(r.id) && stamp(r) <= lastPullAt) continue // supprimé ici
    byId.set(r.id, r)
  }
  for (const l of local) {
    if (!remoteIds.has(l.id) && stamp(l) <= lastPullAt) continue // supprimé à distance
    const cur = byId.get(l.id)
    if (!cur || stamp(l) >= stamp(cur)) byId.set(l.id, l)
  }
  return [...byId.values()].sort((a, b) => stamp(b) - stamp(a)).slice(0, cap)
}

function mergeProgress(local: WatchProgress[], remote: WatchProgress[], lastPullAt: number): WatchProgress[] {
  return mergeById(local, remote, lastPullAt, (p) => p.updatedAt, 60)
}

function mergeLibrary(local: LibraryItem[], remote: LibraryItem[], lastPullAt: number): LibraryItem[] {
  return mergeById(local, remote, lastPullAt, (i) => i.addedAt, 300)
}

function mergeRatings(local: RatingItem[], remote: RatingItem[], lastPullAt: number): RatingItem[] {
  return mergeById(local, remote, lastPullAt, (r) => r.updatedAt, 500)
}

// ------------------------------------------------------------------ profils

/** Profil tel que stocke dans le coffre : registre + blob de donnees. */
export interface SyncProfile {
  id: string
  name: string
  color: string
  pin: string | null
  createdAt: number
  updatedAt: number
  /** Blob JSON des donnees du profil ('' = jamais sauvegarde / vide). */
  data: string
  dataUpdatedAt: number
}

function profileStamp(p: SyncProfile): number {
  return Math.max(p.updatedAt ?? p.createdAt, p.dataUpdatedAt ?? 0)
}

function mergeProfiles(local: SyncProfile[], remote: SyncProfile[], lastPullAt: number): SyncProfile[] {
  return mergeById(local, remote, lastPullAt, profileStamp, 8)
}

/**
 * Serialise les profils locaux pour le coffre. Le profil actif est capture
 * « en direct » depuis localStorage (son blob n'existe que lorsqu'on bascule
 * ailleurs) ; les autres depuis leur blob. L'appareil en cours d'usage
 * emporte le conflit sur le profil actif — on ne regarde que sur un ecran.
 */
function collectProfiles(): SyncProfile[] {
  const activeId = getActiveProfileId()
  let liveData: Record<string, unknown> | null = null
  return getProfiles().map((p) => {
    const updatedAt = p.updatedAt ?? p.createdAt
    let data: string
    let dataUpdatedAt: number
    if (p.id === activeId) {
      if (liveData === null) {
        liveData = {}
        for (const [k, v] of Object.entries(exportBackup().data)) {
          if (!PROFILE_SHARED_KEYS.has(k)) liveData[k] = v
        }
      }
      data = JSON.stringify(liveData)
      dataUpdatedAt = Date.now()
    } else {
      data = getProfileDataRaw(p.id) ?? ''
      dataUpdatedAt = updatedAt
    }
    return { id: p.id, name: p.name, color: p.color, pin: p.pin, createdAt: p.createdAt, updatedAt, data, dataUpdatedAt }
  })
}

/** Ecrit le resultat de la fusion en local (registre + blobs, nettoyage des supprimes). */
function applyProfiles(merged: SyncProfile[]): void {
  const before = new Set(getProfiles().map((p) => p.id))
  const after = new Set(merged.map((p) => p.id))
  saveProfiles(merged.map(({ data: _d, dataUpdatedAt: _t, ...p }) => p))
  for (const m of merged) if (m.data) saveProfileDataRaw(m.id, m.data)
  for (const id of before) if (!after.has(id)) deleteProfileDataRaw(id)
}

// ------------------------------------------------------------------ réseau

let suppressPush = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<boolean> | null = null

async function apiGet(code: string) {
  const res = await fetch(`/api/sync/${code}`, { cache: 'no-store' })
  if (res.status === 404) return { found: false as const }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as { data: { progress?: WatchProgress[]; library?: LibraryItem[]; ratings?: RatingItem[]; profiles?: SyncProfile[] } }
  return { found: true as const, progress: j.data.progress ?? [], library: j.data.library ?? [], ratings: j.data.ratings ?? [], profiles: j.data.profiles ?? [] }
}

async function apiPut(code: string, progress: WatchProgress[], library: LibraryItem[], ratings: RatingItem[], profiles: SyncProfile[]) {
  const res = await fetch(`/api/sync/${code}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress, library, ratings, profiles }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/** Tire le coffre distant, fusionne avec le local, repousse le résultat. */
export async function syncNow(): Promise<boolean> {
  const code = getSyncCode()
  if (!code) return false
  if (inFlight) return inFlight
  emitState()
  inFlight = (async () => {
    try {
      const meta = getSyncMeta()
      const localProgress = readJSON<WatchProgress[]>(PROGRESS_KEY, [])
      const localLibrary = readJSON<LibraryItem[]>(LIB_KEY, [])
      const localRatings = readJSON<RatingItem[]>(RATINGS_KEY, [])
      const localProfiles = collectProfiles()

      const remote = await apiGet(code)
      const mergedProgress = remote.found ? mergeProgress(localProgress, remote.progress, meta.lastPullAt) : localProgress
      const mergedLibrary = remote.found ? mergeLibrary(localLibrary, remote.library, meta.lastPullAt) : localLibrary
      const mergedRatings = remote.found ? mergeRatings(localRatings, remote.ratings, meta.lastPullAt) : localRatings
      const mergedProfiles = remote.found ? mergeProfiles(localProfiles, remote.profiles, meta.lastPullAt) : localProfiles

      // Applique la fusion localement sans redéclencher un push en écho
      suppressPush = true
      try {
        writeJSON(PROGRESS_KEY, mergedProgress)
        writeJSON(LIB_KEY, mergedLibrary)
        writeJSON(RATINGS_KEY, mergedRatings)
        applyProfiles(mergedProfiles)
      } finally {
        suppressPush = false
      }

      await apiPut(code, mergedProgress, mergedLibrary, mergedRatings, mergedProfiles)
      const now = Date.now()
      setMeta({ lastPullAt: now, lastSyncAt: now, lastError: null })
      return true
    } catch (e) {
      setMeta({ lastError: e instanceof Error ? e.message : 'Erreur réseau' })
      return false
    } finally {
      inFlight = null
      emitState()
    }
  })()
  return inFlight
}

/** Crée un nouveau code et y envoie les données de CET appareil. */
export async function createSyncVault(): Promise<string> {
  const code = generateSyncCode()
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    /* mode privé */
  }
  const ok = await syncNow()
  if (!ok) {
    // Le code reste en place : la prochaine synchro réessaiera.
    return code
  }
  return code
}

/** Rattache cet appareil à un code existant (créé sur un autre appareil). */
export async function joinSyncVault(rawCode: string): Promise<{ ok: boolean; error?: string }> {
  const code = normalizeSyncCode(rawCode)
  if (!code) return { ok: false, error: 'Format invalide — le code ressemble à NS-XXXX-XXXX.' }
  try {
    const probe = await fetch(`/api/sync/${code}`, { cache: 'no-store' })
    if (probe.status === 404) return { ok: false, error: 'Code inconnu. Vérifie le code affiché sur ton autre appareil.' }
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
  } catch {
    return { ok: false, error: 'Serveur injoignable. Réessaie dans un instant.' }
  }
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    /* mode privé */
  }
  setMeta({ lastPullAt: 0 }) // premier tirage : on accepte tout le coffre
  const ok = await syncNow()
  return ok ? { ok: true } : { ok: false, error: getSyncMeta().lastError ?? 'Synchro impossible.' }
}

/** Crée/met à jour le partage public de MA liste et renvoie l'URL à copier. */
export async function shareMyLibrary(): Promise<string | null> {
  const code = getSyncCode()
  if (!code) return null
  const library = readJSON<LibraryItem[]>(LIB_KEY, [])
  try {
    const res = await fetch(`/api/sync/${code}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library }),
    })
    if (!res.ok) return null
    return `${location.origin}${location.pathname}#/share/${code}`
  } catch {
    return null
  }
}

/** Lit une liste partagée (publique, lecture seule). */
export async function fetchSharedList(code: string): Promise<LibraryItem[] | null> {
  try {
    const res = await fetch(`/api/sync/${code}/share`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as { library: LibraryItem[] }
    return j.library ?? []
  } catch {
    return null
  }
}

/** Importe une liste partagée dans MA liste (fusion par id). */
export function importSharedList(items: LibraryItem[]): number {
  const cur = readJSON<LibraryItem[]>(LIB_KEY, [])
  const fresh = items.filter((i) => !cur.some((x) => x.id === i.id))
  if (fresh.length > 0) writeJSON(LIB_KEY, [...fresh, ...cur])
  return fresh.length
}

// ------------------------------------------------- déclencheurs automatiques

let wired = false

/** À appeler une fois au démarrage de l'app. */
export function initSync() {
  if (wired) return
  wired = true

  // Push débouncé après chaque écriture locale sur la liste, la progression
  // ou les profils (création, suppression, PIN, bascule)
  onWrite((key) => {
    if (suppressPush || !getSyncCode()) return
    if (key !== LIB_KEY && key !== PROGRESS_KEY && key !== RATINGS_KEY
      && key !== PROFILE_REGISTRY_KEY && !key.startsWith(PROFILE_DATA_PREFIX)) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      void syncNow()
    }, 4000)
  })

  // Tirage au démarrage…
  if (getSyncCode()) void syncNow()
  // …et à chaque retour sur l'onglet (changement d'appareil typique)
  window.addEventListener('focus', () => {
    if (getSyncCode()) void syncNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getSyncCode()) void syncNow()
  })
}

export function syncState(): SyncState {
  if (!getSyncCode()) return 'off'
  if (inFlight || pushTimer) return 'busy'
  if (getSyncMeta().lastError) return 'error'
  return 'idle'
}
