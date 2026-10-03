import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, Info, Play, Star, Volume2, VolumeX } from 'lucide-react'
import type { MetaPreview } from '@/types'
import { useNav } from '@/lib/nav'
import { useLibrary } from '@/lib/library'
import { GENRE_FR } from '@/lib/cinemeta'
import { fetchExtras } from '@/lib/tmdbApi'

export default function Hero({ items }: { items: MetaPreview[] }) {
  const { go } = useNav()
  const { toggle, has } = useLibrary()
  const featured = useMemo(() => items.filter((m) => m.background).slice(0, 6), [items])
  const [idx, setIdx] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  // Bande-annonce en fondu après 3,5 s sur la slide (desktop uniquement).
  // Son coupé par défaut (politique d'autoplay) ; un bouton permet de l'activer.
  const [trailerYt, setTrailerYt] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  // Tick de replanification (pause : on reporte au lieu de sauter)
  const [tick, setTick] = useState(0)

  // Rotation : le chrono repart à zéro après chaque slide, automatique ou
  // manuelle (clic sur un indicateur). Pause tant que le pointeur est sur le
  // hero (test :hover au moment du déclenchement — fiable même si la souris
  // était déjà dedans au montage) ou que l'onglet est caché.
  useEffect(() => {
    if (featured.length < 2) return
    const t = setTimeout(() => {
      // Pendant qu'une bande-annonce joue, on ne change PAS de slide —
      // laisse le temps de la regarder. On passe au suivant quand elle
      // est finie (trailerYt repasse à null au changement de slide).
      if (trailerYt) {
        setTick((n) => n + 1) // recale une vérification plus tard
        return
      }
      if (document.hidden || rootRef.current?.matches(':hover')) setTick((n) => n + 1)
      else setIdx((i) => (i + 1) % featured.length)
    }, 9000)
    return () => clearTimeout(t)
  }, [idx, tick, featured.length, trailerYt])

  const m = featured[idx]

  useEffect(() => {
    setTrailerYt(null)
    if (!m || !/^tt\d+/.test(m.id)) return
    let cancelled = false
    const t = setTimeout(() => {
      // Repli : si l'API serveur échoue (déploiement statique), on retombe
      // sur trailerStreams fourni par Cinemeta — la BA se charge quand même.
      fetchExtras(m.id)
        .then((ex) => {
          if (cancelled) return
          setTrailerYt(ex?.trailerYtId ?? m.trailerStreams?.[0]?.ytId ?? null)
        })
        .catch(() => {
          if (!cancelled) setTrailerYt(m.trailerStreams?.[0]?.ytId ?? null)
        })
    }, 3500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [m?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Parallaxe cinématique : le fond glisse plus lentement que le scroll
  // (profondeur façon plateformes VOD). IO + rAF, pixels entiers, GPU.
  const parallaxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = parallaxRef.current
    if (!el) return
    let raf = 0
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { rootMargin: '25% 0px' })
    io.observe(el)
    const apply = () => {
      raf = 0
      el.style.transform = `translate3d(0, ${Math.round(window.scrollY * 0.28)}px, 0)`
    }
    const onScroll = () => {
      if (raf || !visible) return
      raf = requestAnimationFrame(apply)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (!m) return <div className="h-[70vh]" />

  return (
    <div ref={rootRef} className="relative h-[88vh] min-h-[540px] w-full overflow-hidden">
      {/* Fond : toutes les slides empilées + fondu croisé RÉEL.
          L'ancienne slide reste montée pendant que la nouvelle apparaît
          (plus de trou/noir derrière pendant le chargement). */}
      <div ref={parallaxRef} className="absolute inset-0">
      {featured.map((f, i) => (
        <div
          key={f.id}
          aria-hidden={i !== idx}
          className={`absolute inset-0 transition-opacity duration-[1200ms] ease-out ${
            i === idx ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <img
            src={f.background}
            alt=""
            className={`h-full w-full object-cover ${i === idx ? 'kenburns' : ''}`}
            fetchPriority={i === idx ? 'high' : 'low'}
            decoding="async"
          />
        </div>
      ))}

      {/* Bande-annonce muette en fondu (desktop) — pointer-events désactivés,
          la slide reste cliquable ; indicateur muet en haut à droite */}
      {trailerYt && (
        <div key={`yt-${m.id}`} className="absolute inset-0 hidden md:block">
          <iframe
            key={`${trailerYt}-${soundOn ? 's' : 'm'}`}
            src={`https://www.youtube.com/embed/${trailerYt}?autoplay=1&mute=${soundOn ? 0 : 1}&controls=0&loop=1&playlist=${trailerYt}&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1`}
            className="h-full w-full object-cover crossfade"
            style={{ transform: 'scale(1.35)' }}
            allow="autoplay"
            title=""
            tabIndex={-1}
          />
        </div>
      )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-64 fade-bottom" />

      {/* Contenu ancré en bas à gauche */}
      <div className="absolute bottom-[14%] left-5 md:left-12 max-w-2xl">
        <p className="bracket-label mb-4 rise-in">À la une — {m.type === 'movie' ? 'Film' : 'Série'}</p>
        {m.logo ? (
          <img src={m.logo} alt={m.name} className="max-h-28 md:max-h-44 max-w-[80%] object-contain object-left drop-shadow-2xl rise-in" />
        ) : (
          <h1 className="font-display font-black uppercase leading-[0.85] rise-in text-[clamp(2.4rem,6.5vw,5.5rem)]">
            {m.name}
          </h1>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/70 rise-in" style={{ animationDelay: '80ms' }}>
          {m.imdbRating && (
            <span className="flex items-center gap-1 font-semibold text-[rgb(var(--acc))]">
              <Star size={14} fill="currentColor" /> {m.imdbRating}
            </span>
          )}
          {m.releaseInfo && <span>{String(m.releaseInfo).slice(0, 4)}</span>}
          {m.runtime && <span>{m.runtime}</span>}
          {m.genres?.slice(0, 3).map((g) => (
            <span key={g} className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11px]">
              {GENRE_FR[g] ?? g}
            </span>
          ))}
        </div>
        {m.description && (
          <p className="mt-4 line-clamp-3 text-sm md:text-base text-white/70 max-w-xl rise-in" style={{ animationDelay: '140ms' }}>
            {m.description}
          </p>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-2.5 md:gap-3 rise-in" style={{ animationDelay: '200ms' }}>
          <button
            onClick={() => go({ name: 'detail', id: m.id, type: m.type })}
            className="btn-aurora flex items-center gap-2 rounded-sm px-5 py-3 md:px-7 md:py-3.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95"
          >
            <Play size={18} fill="currentColor" /> Regarder
          </button>
          <button
            onClick={() => go({ name: 'detail', id: m.id, type: m.type })}
            className="flex items-center gap-2 rounded-sm border border-white/25 bg-white/5 px-4 py-3 md:px-6 md:py-3.5 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/15"
          >
            <Info size={17} /> Plus d'infos
          </button>
          {/* Activer / couper le son de la bande-annonce en fond.
              Zone cliquable agrandie (48px min) + z-index élevé pour éviter
              que l'icône ou le dégradé ne bloque le clic sur mobile. */}
          {trailerYt && (
            <button
              onClick={() => setSoundOn((s) => !s)}
              aria-label={soundOn ? 'Couper le son' : 'Activer le son'}
              title={soundOn ? 'Couper le son' : 'Activer le son'}
              className="relative z-30 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 hover:scale-105 active:scale-95"
            >
              {soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          )}
          <button
            onClick={() => toggle({ id: m.id, type: m.type, name: m.name, poster: m.poster })}
            aria-label={has(m.id) ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
            title={has(m.id) ? 'Retirer de ma liste' : 'Ajouter à ma liste'}
            className={`flex items-center justify-center rounded-full border p-3 md:p-3.5 backdrop-blur transition-all active:scale-90 ${
              has(m.id)
                ? 'border-[rgb(var(--acc))] bg-[rgb(var(--acc))]/15 text-[rgb(var(--acc))]'
                : 'border-white/25 bg-white/5 text-white/80 hover:bg-white/15'
            }`}
          >
            {has(m.id) ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          </button>
        </div>
      </div>

      {/* Indicateurs */}
      <div className="absolute bottom-8 right-5 md:right-12 flex gap-1.5">
        {featured.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setIdx(i)}
            aria-label={`Voir ${f.name}`}
            className={`h-[3px] rounded-full transition-all duration-500 ${
              i === idx ? 'w-8 bg-[rgb(var(--acc))]' : 'w-3 bg-white/25 hover:bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
