import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let snapshot = 0

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit() {
  snapshot++
  listeners.forEach((l) => l())
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Écoutes déclenchées après chaque écriture (utilisé par la synchro multi-appareils). */
const writeListeners = new Set<(key: string) => void>()

export function onWrite(cb: (key: string) => void) {
  writeListeners.add(cb)
  return () => writeListeners.delete(cb)
}

export function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
  emit()
  writeListeners.forEach((cb) => {
    try {
      cb(key)
    } catch {
      /* un listener en panne ne doit jamais casser l'écriture */
    }
  })
}

/** Hook réactif adossé à localStorage : tous les composants se mettent à jour ensemble. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  useSyncExternalStore(subscribe, () => snapshot)
  const value = readJSON(key, fallback)
  const set = (v: T | ((p: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(readJSON(key, fallback)) : v
    writeJSON(key, next)
  }
  return [value, set]
}
