import { useEffect, useRef, useState } from 'react'
import { BookOpen, Bookmark, Film, Home, Layers, MonitorPlay, Palette, Search, Settings, Tv } from 'lucide-react'
import { ACCENTS, getAccent, setAccent, type Accent } from '@/lib/theme'
import ProfileMenu from '@/components/ProfileMenu'
import CharSplit from './CharSplit'
import { useNav } from '@/lib/nav'
import type { View } from '@/types'

// SCANS servi par le même serveur que l'app : URL relative à l'origine
// (fonctionne sur n'importe quel tunnel/domaine sans modification).
const LINKS: { label: string; view: View; key: string }[] = [
  { label: 'ACCUEIL', view: { name: 'home' }, key: 'home' },
  { label: 'FILMS', view: { name: 'movies' }, key: 'movies' },
  { label: 'SÉRIES', view: { name: 'series' }, key: 'series' },
  { label: 'MA LISTE', view: { name: 'library' }, key: 'library' },
  { label: 'STATUT', view: { name: 'status' }, key: 'status' },
  { label: 'SCANS', view: { name: 'mangas' }, key: 'mangas' },
]

const TABS: { label: string; icon: typeof Home; view: View; key: string }[] = [
  { label: 'Accueil', icon: Home, view: { name: 'home' }, key: 'home' },
  { label: 'Films', icon: Film, view: { name: 'movies' }, key: 'movies' },
  { label: 'Séries', icon: Tv, view: { name: 'series' }, key: 'series' },
  { label: 'TV', icon: MonitorPlay, view: { name: 'tv' }, key: 'tv' },
  { label: 'Ma Liste', icon: Bookmark, view: { name: 'library' }, key: 'library' },
  { label: 'Scans', icon: BookOpen, view: { name: 'mangas' }, key: 'mangas' },
]

/** Sélecteur de thème : 4 palettes interchangeables à la volée. */
export function AccentMenu() {
  const [open, setOpen] = useState(false)
  const [accent, setAccentState] = useState<Accent>(getAccent)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Changer de thème"
        title="Thème de l'interface"
        className={`p-3 rounded-full transition-colors hover:bg-white/10 ${open ? 'text-[rgb(var(--acc))]' : 'text-white/80'}`}
      >
        <Palette size={19} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-44 rounded-md border border-white/10 bg-[#0a0a0a]/95 p-2 shadow-xl backdrop-blur">
          <p className="px-2 pb-1.5 text-[10px] font-mono tracking-[0.2em] text-white/60">THÈME</p>
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => { setAccent(a.id); setAccentState(a.id); setOpen(false) }}
              className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-xs transition-colors ${
                accent === a.id ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="h-4 w-4 rounded-full border border-white/25" style={{ backgroundColor: a.swatch }} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Nav() {
  const { view, go } = useNav()
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [progress, setProgress] = useState(0)
  const lastY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 40)
      // Cache la barre en descendant, la réaffiche dès qu'on remonte
      // (pattern des apps VOD : l'interface s'efface devant le contenu)
      if (y > lastY.current + 6 && y > 140) setHidden(true)
      else if (y < lastY.current - 4 || y < 140) setHidden(false)
      lastY.current = y
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, y / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const active = view.name

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-transform duration-500 ease-[cubic-bezier(0,0.5,0,1)] ${
          hidden ? '-translate-y-full' : 'translate-y-0'
        } ${
          scrolled
            ? 'bg-[#050505]/85 backdrop-blur-xl border-b border-white/5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
            : 'bg-gradient-to-b from-black/80 to-transparent'
        }`}
      >
        {/* Jauge de progression de la page */}
        <div className="absolute top-0 left-0 h-[2px] bg-gradient-to-r from-[rgb(var(--acc4))] via-[rgb(var(--acc2))] to-[rgb(var(--acc3))] transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />

        <div className="flex items-center gap-2 md:gap-5 px-3 md:px-8 h-16 overflow-x-auto">
          <button onClick={() => go({ name: 'home' })} className="flex items-baseline gap-1 shrink-0">
            <span className="font-display font-black text-xl tracking-tight text-white">
              DZ
            </span>
            <span className="font-display font-black text-xl tracking-tight text-aurora">
              STREAM
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-4 lg:gap-6 min-w-0 overflow-x-auto whitespace-nowrap">
            {LINKS.map((l) => (
              <button
                key={l.label}
                onClick={() => go(l.view)}
                className={`relative shrink-0 text-[11px] font-mono-label transition-colors pb-1 ${
                  active === l.key ? 'text-[rgb(var(--acc))]' : 'text-white/70 hover:text-white'
                }`}
              >
                <CharSplit text={l.label} />
                {/* Pastille active animée */}
                <span
                  className={`absolute -bottom-1 left-1/2 -translate-x-1/2 h-[3px] rounded-full bg-[rgb(var(--acc))] transition-all duration-400 ${
                    active === l.key ? 'w-5 opacity-100' : 'w-0 opacity-0'
                  }`}
                />
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => go({ name: 'tv' })}
              aria-label="TV en direct"
              title="TV en direct"
              className="p-3 rounded-full transition-colors hover:bg-white/10 text-white/80"
            >
              <MonitorPlay size={19} />
            </button>
            <button
              onClick={() => go({ name: 'settings' })}
              aria-label="Réglages"
              title="Réglages"
              className="p-3 rounded-full transition-colors hover:bg-white/10 text-white/80"
            >
              <Settings size={19} />
            </button>
            <ProfileMenu />
            <span className="hidden md:inline-flex"><AccentMenu /></span>
            <button
              onClick={() => go({ name: 'search' })}
              aria-label="Rechercher"
              className={`inline-flex p-3 rounded-full transition-colors hover:bg-white/10 ${
                active === 'search' ? 'text-[rgb(var(--acc))]' : 'text-white/80'
              }`}
            >
              <Search size={19} />
            </button>
            <button
              onClick={() => go({ name: 'addons' })}
              aria-label="Addons"
              title="Addons — sources de streaming"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full border transition-all text-[10px] font-mono-label ${
                active === 'addons'
                  ? 'border-[rgb(var(--acc))] text-[rgb(var(--acc))]'
                  : 'border-white/15 text-white/70 hover:border-[rgb(var(--acc))]/60 hover:text-white'
              }`}
            >
              <Layers size={13} />
              <span className="hidden sm:inline">ADDONS</span>
            </button>
          </div>
        </div>
      </header>

      {/* Barre d'onglets mobile (pattern Netflix/Disney+) : fixe en bas,
          avec liseré actif et safe-area iPhone */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0a0a0a]/92 backdrop-blur-xl border-t border-white/8 safe-bottom">
        <div className="flex justify-around">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => go(t.view)}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[9px] font-mono-label transition-colors ${
                active === t.key ? 'text-[rgb(var(--acc))]' : 'text-white/45 active:text-white/80'
              }`}
            >
              <span
                className={`absolute top-0 h-[2.5px] rounded-b-full bg-[rgb(var(--acc))] transition-all duration-300 ${
                  active === t.key ? 'w-8 opacity-100' : 'w-0 opacity-0'
                }`}
              />
              <t.icon size={19} strokeWidth={active === t.key ? 2.4 : 1.8} />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}
