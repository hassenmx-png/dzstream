import { readJSON, writeJSON } from './store'

/** Préférences sous-titres : taille, couleur, fond, décalage. Persistées. */

export interface SubPrefs {
  size: number // 0=S 1=M 2=L 3=XL
  color: 'white' | 'yellow' | 'green'
  bg: 'none' | 'semi' | 'solid'
  delay: number // secondes, -10..+10 (positif = sous-titres en retard)
}

const KEY = 'novastream:sub-prefs'

export const DEFAULT_SUB_PREFS: SubPrefs = { size: 1, color: 'white', bg: 'semi', delay: 0 }

export function getSubPrefs(): SubPrefs {
  return { ...DEFAULT_SUB_PREFS, ...readJSON<Partial<SubPrefs>>(KEY, {}) }
}

const SIZES = ['0.85em', '1.1em', '1.45em', '1.9em']
const COLORS = { white: '#ffffff', yellow: '#ffe66d', green: 'rgb(var(--acc))' }
const BGS = { none: 'transparent', semi: 'rgba(0,0,0,0.55)', solid: 'rgba(0,0,0,0.92)' }

function applyCueStyle(p: SubPrefs) {
  let tag = document.getElementById('nova-cue-style') as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = 'nova-cue-style'
    document.head.appendChild(tag)
  }
  tag.textContent = `video::cue {
    font-size: ${SIZES[p.size]};
    color: ${COLORS[p.color]};
    background: ${BGS[p.bg]};
    font-weight: 600;
    line-height: 1.45;
    letter-spacing: 0.01em;
    padding: 0 8px;
    border-radius: 5px;
    text-shadow: 0 0 4px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.85);
  }`
}

export function setSubPrefs(patch: Partial<SubPrefs>): SubPrefs {
  const next = { ...getSubPrefs(), ...patch }
  next.size = Math.min(3, Math.max(0, Math.round(next.size)))
  next.delay = Math.min(10, Math.max(-10, Math.round(next.delay * 2) / 2))
  writeJSON(KEY, next)
  applyCueStyle(next)
  return next
}

export function initSubPrefs() {
  applyCueStyle(getSubPrefs())
}

/** Décale tous les timecodes d'un VTT de `offset` secondes (borné à ≥ 0). */
export function shiftVtt(vtt: string, offset: number): string {
  if (!offset) return vtt
  const shiftTs = (ts: string): string => {
    const m = ts.match(/(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/)
    if (!m) return ts
    let total = (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000) + offset
    if (total < 0) total = 0
    const h = Math.floor(total / 3600)
    const min = Math.floor((total % 3600) / 60)
    const sec = Math.floor(total % 60)
    const ms = Math.round((total % 1) * 1000)
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  }
  return vtt.replace(
    /(\d{0,2}:?\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{0,2}:?\d{2}:\d{2}\.\d{3})/g,
    (_, a: string, b: string) => `${shiftTs(a)} --> ${shiftTs(b)}`,
  )
}
