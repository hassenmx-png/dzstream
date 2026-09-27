import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, Play, Star } from 'lucide-react'
import type { MetaPreview } from '@/types'
import { useNav } from '@/lib/nav'
import { useLibrary, useProgress } from '@/lib/library'
import { toast } from '@/lib/toast'
import { rectOf, startFlight } from '@/lib/flight'
import HoverPreview from '@/components/HoverPreview'

/** Le survol enrichi n'a de sens qu'avec une souris/trackpad. */
const CAN_HOVER =
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

export default function PosterCard({ meta, large = false }: { meta: MetaPreview; large?: boolean }) {
  const { go } = useNav()
  const { toggle, has } = useLibrary()
  const { items: progressItems } = useProgress()
  const [loaded, setLoaded] = useState(false)
  const [preview, setPreview] = useState(false)
  const rootRef = useRef<HTMLButtonElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inList = has(meta.id)

  // Barre de progression style Netflix : % du contenu déjà vu.
  // Film → temps de lecture. Série → épisodes complétés / épisodes vus.
  const progress = useMemo(() => {
    if (meta.type === 'movie') {
      const film = progressItems.find((p) => p.id === meta.id && p.type === 'movie')
      if (film && film.duration > 0) {
        const pct = Math.round((film.time / film.duration) * 100)
        if (pct >= 5 && pct < 100) return pct
      }
      return null
    }
    // Série : parmi les épisodes connus, combien sont terminés (>90 %)
    const eps = progressItems.filter((p) => p.baseId === meta.id && p.type === 'series')
    if (eps.length === 0) return null
    const done = eps.filter((p) => p.duration > 0 && p.time / p.duration > 0.9).length
    return Math.min(Math.round((done / eps.length) * 100), 100)
  }, [progressItems, meta.id, meta.type])

  // Aperçu Netflix : ~700 ms de survol avant d'ouvrir (évite le papillonnage
  // quand on balaie une rangée rapidement)
  const enter = () => {
    if (!CAN_HOVER) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setPreview(true), 700)
  }
  // Anti-flicker : l'aperçu s'ouvre SOUS le curseur → la carte perd le survol.
  // On laisse 120 ms au pointeur pour entrer dans l'aperçu avant de fermer.
  const leave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPreview(false), 120)
  }
  const enterPreview = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const closePreview = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setPreview(false)
  }
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  return (
    <button
      ref={rootRef}
      onClick={() => {
        // Transition « affiche → fiche » : le clone vole depuis cette carte
        const imgEl = rootRef.current?.querySelector('img')
        if (meta.poster && imgEl) startFlight({ src: meta.poster, from: rectOf(imgEl) })
        go({ name: 'detail', id: meta.id, type: meta.type })
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={`group relative shrink-0 text-left ${
        large ? 'w-40 md:w-48' : 'w-32 md:w-40'
      }`}
    >
      <div
        className={`relative overflow-hidden rounded-lg bg-white/5 poster-shadow ring-1 ring-transparent transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] group-hover:z-10 group-hover:ring-[rgb(var(--acc))]/70 group-hover:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9),0_0_44px_rgba(196, 14, 29,0.5),0_0_18px_rgba(143, 13, 25,0.3)] aspect-[2/3]`}
      >
        {!loaded && <div className="absolute inset-0 skeleton" />}
        {meta.poster && (
          <img
            src={meta.poster}
            alt={meta.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {/* Barre de progression style Netflix (% vu) */}
        {progress !== null && progress > 0 && progress < 100 && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <span className="absolute -top-5 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {progress}%
            </span>
            <div className="h-[3px] bg-white/20">
              <div
                className="h-full bg-[rgb(var(--acc))] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Surcouche au survol */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <div className="absolute inset-x-0 bottom-0 p-2.5 translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
          <p className="text-[11px] font-semibold leading-tight line-clamp-2">{meta.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-white/60">
            {meta.imdbRating && (
              <span className="flex items-center gap-0.5 text-[rgb(var(--acc))]">
                <Star size={9} fill="currentColor" /> {meta.imdbRating}
              </span>
            )}
            {meta.releaseInfo && <span>{String(meta.releaseInfo).slice(0, 4)}</span>}
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <span className="rounded-full bg-[rgb(var(--acc))] p-3 text-white scale-75 group-hover:scale-100 transition-transform duration-300">
            <Play size={18} fill="currentColor" />
          </span>
        </div>
        {/* Ajout rapide à Ma Liste (coin supérieur droit, survol) */}
        <span
          role="button"
          aria-label={inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
          onClick={(e) => {
            e.stopPropagation()
            toggle({ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster })
            toast(inList ? 'Retiré de ta liste' : 'Ajouté à ta liste')
          }}
          className={`absolute right-2 top-2 rounded-full p-2 backdrop-blur transition-all duration-300 active:scale-90 ${
            inList
              ? 'bg-[rgb(var(--acc))] text-white opacity-100'
              : 'bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/85'
          }`}
        >
          {inList ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
        </span>
      </div>
      {preview && <HoverPreview meta={meta} anchor={rootRef} onClose={closePreview} onEnter={enterPreview} />}
    </button>
  )
}
