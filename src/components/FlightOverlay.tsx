import { useEffect, useRef, useState } from 'react'
import { useNav } from '@/lib/nav'
import { consumeFlight, type Flight, type FlightRect } from '@/lib/flight'

const EASE = 'cubic-bezier(0.22,1,0.36,1)'

/**
 * Emplacement prévisible de l'affiche sur la fiche (hero 62vh, affiche w-44
 * ancrée en bas à gauche) — utilisé comme cible tant que la vraie affiche
 * n'est pas encore montée (chargement des métadonnées).
 */
function fallbackRect(): FlightRect {
  const desktop = window.innerWidth >= 768
  const w = desktop ? 176 : Math.min(120, window.innerWidth * 0.3)
  const h = w * 1.5
  const heroH = Math.max(window.innerHeight * 0.62, 420)
  return { x: desktop ? 48 : 20, y: heroH - 32 - h, w, h }
}

/**
 * Clone de l'affiche cliquée qui « vole » vers sa place sur la fiche, puis
 * fond dans la vraie image (même source → raccord invisible).
 */
export default function FlightOverlay() {
  const { view } = useNav()
  const [flight, setFlight] = useState<Flight | null>(null)
  const [to, setTo] = useState<FlightRect | null>(null)
  const [fading, setFading] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (view.name !== 'detail') return
    const f = consumeFlight()
    if (!f) return
    setFlight(f)
    setTo(null)
    setFading(false)
    // Décollage à la frame suivante (le navigateur doit d'abord peindre le
    // clone à sa position de départ pour que la transition joue)
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setTo(fallbackRect())),
    )
    // Dès que la vraie affiche de la fiche apparaît, on se cale exactement
    // dessus puis on fond. Sans affiche visible : dissolution dans le hero
    // (~3 s sur desktop où l'affiche finit toujours par arriver, ~1,7 s sur
    // mobile où elle est masquée par design).
    const maxTries = window.innerWidth >= 768 ? 25 : 14
    let tries = 0
    const poll = setInterval(() => {
      const el = document.querySelector('[data-flight-target]')
      const r = el?.getBoundingClientRect()
      tries++
      if (r && r.width > 0) {
        setTo({ x: r.left, y: r.top, w: r.width, h: r.height })
        clearInterval(poll)
        timers.current.push(setTimeout(() => setFading(true), 480))
        timers.current.push(setTimeout(() => setFlight(null), 820))
      } else if (tries > maxTries) {
        clearInterval(poll)
        setFading(true)
        timers.current.push(setTimeout(() => setFlight(null), 500))
      }
    }, 120)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(poll)
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [view])

  if (!flight) return null
  const r = to ?? flight.from
  return (
    <img
      src={flight.src}
      alt=""
      aria-hidden
      className="poster-shadow pointer-events-none fixed z-[90] rounded-md"
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        objectFit: 'cover',
        opacity: fading ? 0 : 1,
        transform: fading ? 'scale(1.03)' : 'none',
        transition: `left 0.55s ${EASE}, top 0.55s ${EASE}, width 0.55s ${EASE}, height 0.55s ${EASE}, opacity 0.3s ease, transform 0.3s ease`,
      }}
    />
  )
}
