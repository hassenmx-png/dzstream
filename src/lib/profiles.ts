/**
 * Profils locaux : plusieurs espaces sur le même appareil (famille,
 * mode enfants). Chaque profil possède sa bibliothèque, sa progression,
 * ses réglages et son thème. Les clés debrid sont PARTAGÉES.
 *
 * Mécanisme de bascule : sauvegarde l'état courant sous le profil actif,
 * puis restaure les données du profil cible — le même moteur que la
 * sauvegarde/restauration JSON. Un profil peut être protégé par un
 * PIN à 4 chiffres (verrouillage à l'ouverture de l'app).
 */
import { exportBackup } from './backup'

export interface Profile {
  id: string
  name: string
  color: string
  pin: string | null
  createdAt: number
}

const REGISTRY_KEY = 'novastream:profiles'
const ACTIVE_KEY = 'novastream:active-profile'
const DATA_PREFIX = 'novastream:profile-data:'
const UNLOCK_KEY = 'novastream:profile-unlocked'

/** Clés partagées entre profils (registre, profil actif, clés debrid, sous-titres). */
const SHARED_KEYS = new Set([
  REGISTRY_KEY,
  ACTIVE_KEY,
  'novastream:debrids',
  'novastream:debrid',
  'novastream:opensubs-key', // clé API OpenSubtitles : identifiant global, partagé entre profils
])

export const PROFILE_COLORS = ['#ff3b47', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316']

export function getProfiles(): Profile[] {
  try {
    const v = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]') as Profile[]
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function saveProfiles(p: Profile[]): void {
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(p)) } catch { /* quota */ }
}

export function getActiveProfileId(): string | null {
  const p = getProfiles()
  const id = localStorage.getItem(ACTIVE_KEY)
  return p.some((x) => x.id === id) ? id : (p[0]?.id ?? null)
}

export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId()
  return getProfiles().find((p) => p.id === id) ?? null
}

export function createProfile(name: string, pin: string | null): Profile {
  const profiles = getProfiles()
  const p: Profile = {
    id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    name: name.trim() || `Profil ${profiles.length + 1}`,
    color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
    pin: pin && /^\d{4}$/.test(pin) ? pin : null,
    createdAt: Date.now(),
  }
  saveProfiles([...profiles, p])
  if (profiles.length === 0) {
    try { localStorage.setItem(ACTIVE_KEY, p.id) } catch { /* */ }
  }
  return p
}

export function deleteProfile(id: string): void {
  const profiles = getProfiles()
  if (profiles.length <= 1) return
  saveProfiles(profiles.filter((p) => p.id !== id))
  try { localStorage.removeItem(DATA_PREFIX + id) } catch { /* */ }
  if (getActiveProfileId() === id) {
    const next = profiles.find((p) => p.id !== id)
    if (next) switchProfile(next.id)
  }
}

export function setProfilePin(id: string, pin: string | null): void {
  saveProfiles(getProfiles().map((p) => (p.id === id ? { ...p, pin: pin && /^\d{4}$/.test(pin) ? pin : null } : p)))
}

function loadProfileData(id: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(DATA_PREFIX + id) ?? '{}') as Record<string, unknown>
  } catch { return {} }
}

function saveProfileData(id: string, data: Record<string, unknown>): void {
  try { localStorage.setItem(DATA_PREFIX + id, JSON.stringify(data)) } catch { /* quota */ }
}

function clearAppData(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('novastream:') && !SHARED_KEYS.has(k)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}

/** Bascule : sauvegarde l'état courant, restaure le profil cible. */
export function switchProfile(id: string): boolean {
  const profiles = getProfiles()
  if (!profiles.some((p) => p.id === id)) return false
  const active = getActiveProfileId()
  if (active && active !== id) {
    const all = exportBackup().data
    const stripped: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(all)) if (!SHARED_KEYS.has(k)) stripped[k] = v
    saveProfileData(active, stripped)
  }
  clearAppData()
  const data = loadProfileData(id)
  for (const [k, v] of Object.entries(data)) {
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { /* */ }
  }
  try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* */ }
  return true
}

/** Vrai si le profil actif est protégé et le PIN pas encore saisi (session). */
export function needsUnlock(): boolean {
  const p = getActiveProfile()
  if (!p?.pin) return false
  try { return sessionStorage.getItem(UNLOCK_KEY) !== p.id } catch { return true }
}

export function unlock(pin: string): boolean {
  const p = getActiveProfile()
  if (!p?.pin) return true
  if (pin !== p.pin) return false
  try { sessionStorage.setItem(UNLOCK_KEY, p.id) } catch { /* */ }
  return true
}
