import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, BookmarkCheck, ChevronDown, Play, Star } from 'lucide-react'
import type { MetaPreview } from '@/types'
import { useNav } from '@/lib/nav'
import { useLibrary } from '@/lib/library'
import { fetchExtras } from '@/lib/tmdbApi'
import { toast } from '@/lib/toast'

/**
 * Aperçu façon Netflix : après ~700 ms de survol d'une affiche, une carte
 * agrandie s'ouvre PAR-DESSUS la page (portail en position fixed — échappe
 * au clipping overflow des rangées) avec la bande-annonce en miniature et
 * des actions rapides. Bureau uniquement (le survol n'existe pas au tactile).
 */
export default function HoverPreview({
  meta,
  anchor,
  onClose,
  onEnter,
}: {
  meta: MetaPreview
  anchor: React.RefObject<HTMLElement | null>
  onClose: () => void
  /** Le pointeur entre dans l'aperçu — annule la fermeture programmée. */
  onEnter: () => void
}) {
  const { go } = useNav()
  const { toggle, has } = useLibrary()
  const [trailerYt, setTrailerYt] = useState<string | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const inList = has(meta.id)

  // Position : centrée sur l'affiche d'origine, contrainte à l'écran
  useLayoutEffect(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = Math.min(Math.max(r.width * 2.05, 264), 340)
    const videoH = (w * 9) / 16
    const totalH = videoH + 108 // zone vidéo + zone infos
    let left = r.left + r.width / 2 - w / 2
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = r.top + r.height / 2 - totalH / 2
    top = Math.max(64, Math.min(top, window.innerHeight - totalH - 12))
    setStyle({ position: 'fixed', left, top, width: w, opacity: 1, zIndex: 70 })
  }, [anchor])

  // Bande-annonce (IDs IMDB uniquement — réponse servie par le cache du proxy)
  useEffect(() => {
    let alive = true
    if (/^tt\d+/.test(meta.id)) {
      void fetchExtras(meta.id)
        .then((x) => {
          if (alive && x?.trailerYtId) setTrailerYt(x.trailerYtId)
        })
        .catch(() => { /* pas de BA : on garde l'image */ })
    }
    return () => {
      alive = false
    }
  }, [meta.id])

  // Fermeture : scroll (la rangée bouge sous la carte) ou Échap
  useEffect(() => {
    const onScroll = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const openDetail = () => {
    onClose()
    go({ name: 'detail', id: meta.id, type: meta.type })
  }

  return createPortal(
    <div
      ref={rootRef}
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onClose}
      className="preview-in overflow-hidden rounded-xl bg-[#0d0d0d] shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)] ring-1 ring-white/10 select-none"
    >
      {/* Zone vidéo : BA muette en boucle, sinon visuel du titre */}
      <button onClick={openDetail} className="relative block w-full aspect-video overflow-hidden bg-white/5">
        <img
          src={meta.background ?? meta.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {trailerYt && (
          <>
            <iframe
              src={`https://www.youtube.com/embed/${trailerYt}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerYt}&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1`}
              className="pointer-events-none absolute inset-0 h-full w-full scale-[1.35] bg-black"
              allow="autoplay; encrypted-media"
              tabIndex={-1}
              title=""
            />
            <span className="absolute right-2 top-2 rounded-sm bg-black/70 px-2 py-0.5 text-[9px] font-mono tracking-widest text-white/80">
              BA
            </span>
          </>
        )}
        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0d0d0d] to-transparent" />
      </button>

      {/* Zone infos + actions rapides */}
      <div className="px-3.5 pb-3.5 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={openDetail}
            aria-label="Voir la fiche"
            className="rounded-full bg-[rgb(var(--acc))] p-2.5 text-white transition-transform hover:scale-110"
          >
            <Play size={15} fill="currentColor" />
          </button>
          <button
            onClick={() => {
              toggle({ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster })
              toast(inList ? 'Retiré de ta liste' : 'Ajouté à ta liste')
            }}
            aria-label={inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
            className={`rounded-full border p-2.5 transition-colors ${
              inList
                ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]'
                : 'border-white/30 text-white hover:border-white'
            }`}
          >
            {inList ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </button>
          <button
            onClick={openDetail}
            aria-label="Plus d'infos"
            className="ml-auto rounded-full border border-white/30 p-2.5 text-white transition-colors hover:border-white"
          >
            <ChevronDown size={14} />
          </button>
        </div>
        <p className="mt-2.5 truncate text-sm font-semibold">{meta.name}</p>
        <div className="mt-1 flex items-center gap-2.5 text-[11px] text-white/55">
          {meta.imdbRating && (
            <span className="flex items-center gap-1 font-semibold text-[rgb(var(--acc))]">
              <Star size={10} fill="currentColor" /> {meta.imdbRating}
            </span>
          )}
          {meta.releaseInfo && <span>{String(meta.releaseInfo).slice(0, 4)}</span>}
          <span className="rounded border border-white/20 px-1.5 py-px text-[9px] font-mono uppercase tracking-wider text-white/45">
            {meta.type === 'series' ? 'Série' : 'Film'}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
