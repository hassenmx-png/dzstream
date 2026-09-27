import { useEffect, useRef } from 'react'

/**
 * Halo doux qui suit le curseur ou le doigt, avec inertie.
 * (Les poussières flottantes ont été retirées — l'utilisateur les trouvait
 * gênantes.) Purement décoratif : aucun événement capté.
 */
export default function AmbientFX() {
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let x = window.innerWidth / 2
    let y = window.innerHeight * 0.3
    let tx = x
    let ty = y
    let raf = 0
    const onMouse = (e: MouseEvent) => { tx = e.clientX; ty = e.clientY }
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) { tx = t.clientX; ty = t.clientY }
    }
    const loop = () => {
      x += (tx - x) * 0.08
      y += (ty - y) * 0.08
      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${x - 250}px, ${y - 250}px, 0)`
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    window.addEventListener('mousemove', onMouse, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('touchmove', onTouch)
    }
  }, [])

  return <div ref={glowRef} className="pointer-glow" aria-hidden />
}
