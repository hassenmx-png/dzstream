import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Cake, Clapperboard, MapPin, Star, Film, Tv, CalendarRange,
  Instagram, Facebook, Twitter, Globe, Music2, X, Cross,
} from 'lucide-react'
import { ageAt, departmentFull, fetchPerson, type PersonFull } from '@/lib/tmdbApi'
import { useNav } from '@/lib/nav'
import PosterCard from '@/components/PosterCard'

type Tab = 'all' | 'movie' | 'series'
type Sort = 'pop' | 'recent' | 'rating'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Page personne enrichie : bio, âge, réseaux sociaux, galerie, stats de carrière,
 *  rôles signature et filmographie triable (films + séries). */
export default function PersonPage({ id }: { id: number }) {
  const { back } = useNav()
  const [person, setPerson] = useState<PersonFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [sort, setSort] = useState<Sort>('pop')
  const [bioOpen, setBioOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setPerson(null)
    setBioOpen(false)
    setTab('all')
    fetchPerson(id)
      .then(setPerson)
      .finally(() => setLoading(false))
    window.scrollTo(0, 0)
  }, [id])

  // Fermeture de la visionneuse photo avec Échap
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const all = useMemo(
    () => (person ? [...person.filmography, ...person.series] : []),
    [person],
  )

  if (loading) {
    return (
      <div className="min-h-screen px-5 md:px-12 pt-28 pb-24">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="skeleton w-40 md:w-52 aspect-[2/3] rounded-lg shrink-0" />
          <div className="flex-1 space-y-3 pt-2">
            <div className="skeleton h-3 w-28 rounded" />
            <div className="skeleton h-10 w-72 max-w-full rounded" />
            <div className="skeleton h-3 w-48 rounded" />
            <div className="skeleton h-3 w-full max-w-xl rounded" />
            <div className="skeleton h-3 w-11/12 max-w-xl rounded" />
            <div className="skeleton h-3 w-4/5 max-w-xl rounded" />
          </div>
        </div>
        <div className="mt-12 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[2/3] rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!person) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-white/60">Impossible de charger cette personne.</p>
        <button onClick={back} className="rounded-sm bg-[rgb(var(--acc))] px-5 py-2 text-sm font-bold text-white">
          Retour
        </button>
      </div>
    )
  }

  const items = tab === 'movie' ? person.filmography : tab === 'series' ? person.series : all
  const sorted = [...items].sort((a, b) =>
    sort === 'recent'
      ? Number(b.releaseInfo ?? 0) - Number(a.releaseInfo ?? 0)
      : sort === 'rating'
        ? Number(b.imdbRating ?? 0) - Number(a.imdbRating ?? 0)
        : (b.popularity ?? 0) - (a.popularity ?? 0),
  )

  // Rôles signature : les 8 crédits les plus populaires avec le personnage joué
  const topRoles = all
    .filter((x) => x.poster)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 8)

  // Stats de carrière
  const rated = all.map((x) => Number(x.imdbRating)).filter((n) => n > 0)
  const avgRating = rated.length ? (rated.reduce((s, n) => s + n, 0) / rated.length).toFixed(1) : null
  const years = all.map((x) => Number(x.releaseInfo)).filter((n) => n > 1900)
  const career = years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : null

  const age = person.birthday ? ageAt(person.birthday, person.deathday) : null
  const bornLabel = person.gender === 1 ? 'Née le' : person.gender === 2 ? 'Né le' : 'Né·e le'
  const deadLabel = person.gender === 1 ? 'Décédée le' : 'Décédé le'

  const socials = [
    person.socials.imdb && { href: `https://www.imdb.com/name/${person.socials.imdb}`, label: 'IMDb', icon: <Star size={15} /> },
    person.socials.instagram && { href: `https://instagram.com/${person.socials.instagram}`, label: 'Instagram', icon: <Instagram size={15} /> },
    person.socials.twitter && { href: `https://x.com/${person.socials.twitter}`, label: 'X / Twitter', icon: <Twitter size={15} /> },
    person.socials.facebook && { href: `https://facebook.com/${person.socials.facebook}`, label: 'Facebook', icon: <Facebook size={15} /> },
    person.socials.tiktok && { href: `https://tiktok.com/@${person.socials.tiktok}`, label: 'TikTok', icon: <Music2 size={15} /> },
    person.homepage && { href: person.homepage, label: 'Site officiel', icon: <Globe size={15} /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[]

  return (
    <div className="min-h-screen pb-24">
      {/* En-tête avec halo de la photo en fond */}
      <div className="relative px-5 md:px-12 pt-28 pb-10 overflow-hidden">
        {person.photo && (
          <div
            aria-hidden
            className="absolute inset-0 opacity-25 blur-3xl scale-125 pointer-events-none"
            style={{ backgroundImage: `url(${person.photo})`, backgroundSize: 'cover', backgroundPosition: 'center 20%' }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/60 via-[#050505]/80 to-[#050505] pointer-events-none" />

        <div className="relative">
          <button
            onClick={back}
            className="flex min-h-[44px] items-center gap-2 rounded-full border border-white/25 bg-black/85 px-5 shadow-lg backdrop-blur-md text-sm font-mono-label font-semibold text-white/95 transition-colors hover:text-[rgb(var(--acc))] hover:border-[rgb(var(--acc))]/60"
          >
            <ArrowLeft size={16} /> RETOUR
          </button>

          <div className="flex flex-col sm:flex-row items-start gap-8 mt-8">
            {person.photo ? (
              <img src={person.photo} alt={person.name} className="w-40 md:w-52 rounded-md poster-shadow shrink-0" />
            ) : (
              <div className="w-40 md:w-52 aspect-[2/3] rounded-md bg-white/5 flex items-center justify-center text-white/20 shrink-0">
                <Clapperboard size={40} />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="bracket-label mb-3">{departmentFull(person.department, person.gender)}</p>
              <h1 className="font-display text-4xl md:text-6xl font-black uppercase leading-[0.92]">{person.name}</h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/60">
                {person.birthday && (
                  <span className="flex items-center gap-1.5">
                    <Cake size={14} className="text-[rgb(var(--acc))]" />
                    {bornLabel} {fmtDate(person.birthday)}
                    {age !== null && <span className="text-white/60">({age} ans)</span>}
                  </span>
                )}
                {person.deathday && (
                  <span className="flex items-center gap-1.5">
                    <Cross size={14} className="text-white/50" />
                    {deadLabel} {fmtDate(person.deathday)}
                  </span>
                )}
                {person.placeOfBirth && (
                  <span className="flex items-center gap-1.5">
                    <MapPin size={14} className="text-[rgb(var(--acc))]" /> {person.placeOfBirth}
                  </span>
                )}
              </div>

              {person.alsoKnownAs.length > 0 && (
                <p className="mt-3 text-xs text-white/35">
                  Aussi connu·e sous : {person.alsoKnownAs.join(' · ')}
                </p>
              )}

              {person.bio && (
                <div className="mt-5 max-w-3xl">
                  <p className={`text-sm text-white/70 leading-relaxed ${bioOpen ? '' : 'line-clamp-5'}`}>{person.bio}</p>
                  <button
                    onClick={() => setBioOpen((v) => !v)}
                    className="mt-2 text-xs font-mono-label text-[rgb(var(--acc))] hover:underline"
                  >
                    {bioOpen ? 'RÉDUIRE ↑' : 'LIRE LA BIO COMPLÈTE ↓'}
                  </button>
                </div>
              )}

              {socials.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {socials.map((s) => (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:border-[rgb(var(--acc))]/60 hover:text-[rgb(var(--acc))] transition-colors"
                    >
                      {s.icon} {s.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bandeau stats de carrière */}
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-mono-label text-white/60"><Film size={12} className="text-[rgb(var(--acc))]" /> FILMS</p>
              <p className="mt-1 font-display text-2xl font-black">{person.counts.movies}</p>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-mono-label text-white/60"><Tv size={12} className="text-[rgb(var(--acc))]" /> SÉRIES</p>
              <p className="mt-1 font-display text-2xl font-black">{person.counts.series}</p>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-mono-label text-white/60"><Star size={12} className="text-[rgb(var(--acc))]" /> NOTE MOYENNE</p>
              <p className="mt-1 font-display text-2xl font-black">{avgRating ?? '—'}</p>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-mono-label text-white/60"><CalendarRange size={12} className="text-[rgb(var(--acc))]" /> CARRIÈRE</p>
              <p className="mt-1 font-display text-2xl font-black">{career ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Rôles signature */}
      {topRoles.length > 0 && (
        <section className="px-5 md:px-12 mb-10">
          <h2 className="bracket-label mb-4">Rôles signature</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 md:mx-0 md:px-0">
            {topRoles.map((m) => (
              <div key={`${m.type}:${m.id}`} className="w-28 md:w-32 shrink-0">
                <PosterCard meta={m} />
                {m.role && (
                  <p className="mt-1.5 text-[10px] leading-tight text-white/45 line-clamp-2">
                    {person.department === 'Acting' ? 'en' : ''} <span className="text-[rgb(var(--acc))]/80">{m.role}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Galerie photos */}
      {person.photos.length > 1 && (
        <section className="px-5 md:px-12 mb-10">
          <h2 className="bracket-label mb-4">Photos</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 md:mx-0 md:px-0">
            {person.photos.map((p) => (
              <button
                key={p}
                onClick={() => setLightbox(p)}
                className="shrink-0 overflow-hidden rounded-md border border-white/8 hover:border-[rgb(var(--acc))]/50 transition-colors"
              >
                <img src={p} alt={`${person.name}`} loading="lazy" className="h-40 w-auto object-cover" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Filmographie */}
      <div className="px-5 md:px-12">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h2 className="bracket-label">Filmographie</h2>
          <div className="flex rounded-sm border border-white/15 overflow-hidden text-[10px] font-mono-label">
            {([['all', 'TOUT'], ['movie', `FILMS ${person.counts.movies}`], ['series', `SÉRIES ${person.counts.series}`]] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 transition-colors ${tab === t ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-sm border border-white/15 overflow-hidden text-[10px] font-mono-label">
            {([['pop', 'POPULAIRES'], ['recent', 'RÉCENTS'], ['rating', 'MIEUX NOTÉS']] as [Sort, string][]).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-3 py-2 transition-colors ${sort === s ? 'bg-white/15 text-white font-bold' : 'text-white/50 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-white/60">Aucun titre disponible dans le catalogue.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {sorted.map((m) => (
              <div key={`${m.type}:${m.id}`}>
                <PosterCard meta={m} />
                {m.role && (
                  <p className="mt-1.5 text-[10px] leading-tight text-white/45 line-clamp-2">
                    {person.department === 'Acting' ? 'en' : ''} <span className="text-[rgb(var(--acc))]/80">{m.role}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Visionneuse photo */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            aria-label="Fermer"
            className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/60 p-2.5 text-white/80 hover:text-[rgb(var(--acc))] hover:border-[rgb(var(--acc))]/50 transition-colors"
          >
            <X size={18} />
          </button>
          <img
            src={lightbox.replace('/w185/', '/h632/')}
            alt={person.name}
            className="max-h-[85vh] max-w-full rounded-md poster-shadow"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
