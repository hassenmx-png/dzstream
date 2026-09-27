import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { MetaPreview } from '@/types'
import PosterCard from './PosterCard'

export default function Row({
  title,
  items,
  numbered = false,
  onSeeAll,
}: {
  title: string
  items: MetaPreview[]
  numbered?: boolean
  /** Si fourni : bouton « Tout voir » qui ouvre le catalogue complet en grille. */
  onSeeAll?: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(true)

  const updateArrows = () => {
    const el = scroller.current
    if (!el) return
    setCanLeft(el.scrollLeft > 10)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10)
  }

  const scroll = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  if (!items.length) return null
  const visible = items.slice(0, 25)

  return (
    <section className="relative cv-auto">
      <div className="group/title mb-3 flex items-baseline gap-3 px-5 md:px-12">
        <h2 className="row-title">{title}</h2>
        {onSeeAll ? (
          <button
            onClick={onSeeAll}
            className="flex items-center gap-0.5 text-xs font-semibold text-white/45 transition-colors hover:text-[rgb(var(--acc))]"
          >
            Tout voir
            <ChevronRight size={14} className="transition-transform duration-300 group-hover/title:translate-x-0.5" />
          </button>
        ) : (
          <ChevronRight
            size={18}
            className="text-[rgb(var(--acc))] opacity-0 -translate-x-1 transition-all duration-300 group-hover/title:opacity-100 group-hover/title:translate-x-0"
          />
        )}
      </div>
      <div className="group/row relative">
        {/* Masques de bord : suggèrent le contenu masqué à gauche/droite */}
        <div className={`pointer-events-none absolute left-0 top-0 bottom-4 z-10 w-8 bg-gradient-to-r from-[#050505] to-transparent transition-opacity duration-300 ${canLeft ? 'opacity-100' : 'opacity-0'}`} />
        <div className={`pointer-events-none absolute right-0 top-0 bottom-4 z-10 w-8 bg-gradient-to-l from-[#050505] to-transparent transition-opacity duration-300 ${canRight ? 'opacity-100' : 'opacity-0'}`} />
        <div
          ref={scroller}
          onScroll={updateArrows} tabIndex={0} role="group" aria-label={title} onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); scroll(-1) } else if (e.key === "ArrowRight") { e.preventDefault(); scroll(1) } }}
          className="snap-row flex gap-3 overflow-x-auto scroll-smooth px-5 md:px-12 pb-4 pt-1"
        >
          {visible.map((m, i) => (
            <div key={m.id} className="flex items-end shrink-0">
              {numbered && (
                <span className="font-display font-black text-[7rem] md:text-[9rem] leading-[0.75] text-stroke -mr-4 md:-mr-5 select-none">
                  {i + 1}
                </span>
              )}
              <PosterCard meta={m} />
            </div>
          ))}
        </div>
        {canLeft && (
          <button
            onClick={() => scroll(-1)}
            className="absolute left-0 top-0 bottom-4 w-12 bg-gradient-to-r from-[#050505] to-transparent flex items-center justify-start pl-2 opacity-0 group-hover/row:opacity-100 transition-opacity"
            aria-label="Défiler à gauche"
          >
            <ChevronLeft size={28} className="text-[rgb(var(--acc))]" />
          </button>
        )}
        {canRight && (
          <button
            onClick={() => scroll(1)}
            className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-[#050505] to-transparent flex items-center justify-end pr-2 opacity-0 group-hover/row:opacity-100 transition-opacity"
            aria-label="Défiler à droite"
          >
            <ChevronRight size={28} className="text-[rgb(var(--acc))]" />
          </button>
        )}
      </div>
    </section>
  )
}
