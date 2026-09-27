/** Thème d'accent : quatre palettes, persistance locale, application
 *  immédiate via l'attribut data-accent sur <html> (variables CSS). */
export type Accent = 'rouge' | 'bleu' | 'corail' | 'blanc' | 'neon' | 'manga'

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'rouge', label: 'Rouge', swatch: 'rgb(255 59 71)' },
  { id: 'bleu', label: 'Bleu', swatch: 'rgb(59 130 246)' },
  { id: 'corail', label: 'Corail', swatch: 'rgb(255 107 97)' },
  { id: 'blanc', label: 'Blanc', swatch: 'rgb(245 245 247)' },
  { id: 'neon', label: 'Néon (gaming)', swatch: 'rgb(168 85 247)' },
  { id: 'manga', label: 'Manga', swatch: 'rgb(236 72 153)' },
]

const KEY = 'novastream:accent'

export function getAccent(): Accent {
  try {
    const v = localStorage.getItem(KEY)
    if (ACCENTS.some((a) => a.id === v)) return v as Accent
  } catch { /* mode privé */ }
  return 'bleu' // thème par défaut : bleu (choix utilisateur)
}

export function applyAccent(a: Accent): void {
  document.documentElement.dataset.accent = a
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', a === 'blanc' ? '#17171c' : '#0a0a0a')
}

export function setAccent(a: Accent): void {
  try { localStorage.setItem(KEY, a) } catch { /* mode privé */ }
  applyAccent(a)
}

export function applyStoredAccent(): void {
  applyAccent(getAccent())
}
