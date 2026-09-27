/**
 * Transition « affiche → fiche » : au clic sur une carte, on capture la
 * position de l'affiche, puis FlightOverlay anime un clone qui vole jusqu'à
 * l'emplacement de l'affiche sur la page de détail (FLIP simplifié).
 */
export interface FlightRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Flight {
  src: string
  from: FlightRect
}

let pending: Flight | null = null

export function startFlight(f: Flight) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  pending = f
}

export function consumeFlight(): Flight | null {
  const f = pending
  pending = null
  return f
}

export function rectOf(el: Element): FlightRect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
