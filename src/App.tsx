import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { getActiveProfile, needsUnlock, unlock } from '@/lib/profiles'
import type { View } from '@/types'
import { NavContext, type PlayRequest } from './lib/nav'
import { initSync } from '@/lib/sync'
import { ensurePresetOpensubs } from '@/lib/opensubs'
import { ensurePresetSimkl } from '@/lib/simkl'
import Nav from '@/components/Nav'
// Le lecteur (avec hls.js, ~350 Ko) n'est chargé qu'au premier lancement
// d'une vidéo : il ne pèse plus sur le démarrage de l'app.
const Player = lazy(() => import('@/components/Player'))
// Préchargement en tâche de fond : dès que l'accueil est rendu et le
// navigateur inactif, le chunk du lecteur est téléchargé → le premier
// « Regarder » ouvre le lecteur SANS attendre le réseau.
const prefetchPlayer = () => {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  if (idle) idle(() => { void import('@/components/Player') }, { timeout: 4000 })
  else setTimeout(() => { void import('@/components/Player') }, 3000)
}
import ErrorBoundary from '@/components/ErrorBoundary'
import Toaster from '@/components/Toaster'
import UpdateBanner from '@/components/UpdateBanner'
import AmbientFX from '@/components/AmbientFX'
import { InstallPrompt } from '@/components/InstallPrompt'
import FlightOverlay from '@/components/FlightOverlay'
import Splash from '@/components/Splash'
import Home from '@/pages/Home'

// Chargement à la demande : chaque page devient un chunk séparé — le
// bundle initial ne contient que l'accueil → premier affichage plus rapide.
const CatalogPage = lazy(() => import('@/pages/Home').then((m) => ({ default: m.CatalogPage })))
const SearchPage = lazy(() => import('@/pages/Search'))
const LibraryPage = lazy(() => import('@/pages/Library'))
const AddonsPage = lazy(() => import('@/pages/Addons'))
const DetailPage = lazy(() => import('@/pages/Detail'))
const PersonPage = lazy(() => import('@/pages/Person'))
const SharedListPage = lazy(() => import('@/pages/SharedList'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const TVPage = lazy(() => import('@/pages/TV'))
const MangasPage = lazy(() => import('@/pages/Mangas'))
const StatusPage = lazy(() => import('@/pages/Status'))

/** Liens directs : décode le hash (#/films, #/ma-liste, #/detail/…) en vue. */
export function hashToView(hash: string): View | null {
  const share = hash.match(/^#\/share\/(NS-[A-Z2-9]{4}-[A-Z2-9]{4})$/i)
  if (share) return { name: 'shared', code: share[1].toUpperCase() }
  const key = hash.replace(/^#/, '')
  const simple: Record<string, View> = {
    '': { name: 'home' },
    '/': { name: 'home' },
    '/accueil': { name: 'home' },
    '/films': { name: 'movies' },
    '/series': { name: 'series' },
    '/recherche': { name: 'search' },
    '/ma-liste': { name: 'library' },
    '/addons': { name: 'addons' },
    '/reglages': { name: 'settings' },
    '/tv': { name: 'tv' },
    '/mangas': { name: 'mangas' },
    '/statut': { name: 'status' },
    '/parametres': { name: 'settings' },
  }
  if (simple[key]) return simple[key]
  const d = key.match(/^\/detail\/(movie|series)\/([^/]+)$/)
  if (d) return { name: 'detail', type: d[1] as 'movie' | 'series', id: decodeURIComponent(d[2]) }
  const p = key.match(/^\/personne\/(\d+)$/)
  if (p) return { name: 'person', id: Number(p[1]) }
  const c = key.match(/^\/catalogue\/(movie|series)\/([^/]+)$/)
  if (c) {
    const g = decodeURIComponent(c[2])
    return { name: 'catalog', title: g, type: c[1] as 'movie' | 'series', genre: g }
  }
  return null
}

/** Vue → hash : chaque page a désormais un lien direct partageable. */
function viewToHash(v: View): string | null {
  switch (v.name) {
    case 'home': return '/'
    case 'movies': return '/films'
    case 'series': return '/series'
    case 'search': return '/recherche'
    case 'library': return '/ma-liste'
    case 'addons': return '/addons'
    case 'settings': return '/reglages'
    case 'tv': return '/tv'
    case 'mangas': return '/mangas'
    case 'status': return '/statut'
    case 'detail': return `/detail/${v.type}/${encodeURIComponent(v.id)}`
    case 'person': return `/personne/${String(v.id)}`
    case 'shared': return `/share/${v.code}`
    case 'catalog':
      return v.genre && !v.addonUrl ? `/catalogue/${v.type}/${encodeURIComponent(v.genre)}` : null
  }
}

function initialView(): View {
  return hashToView(window.location.hash) ?? { name: 'home' }
}

export default function App() {
  const [view, setView] = useState<View>(initialView)
  // Verrouillage du profil actif (PIN) : masque toute l'interface tant que
  // le code n'a pas été saisi (mémorisé pour la session uniquement).
  const [locked, setLocked] = useState<boolean>(() => needsUnlock())
  const [lockName] = useState<string>(() => getActiveProfile()?.name ?? '')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [playReq, setPlayReq] = useState<PlayRequest | null>(null)
  // Mini-lecteur : la lecture continue en fenêtre réduite pendant la navigation
  const [miniPlayer, setMiniPlayer] = useState(false)
  const historyRef = useRef<View[]>([])
  // Anti-echo : quand C'EST l'app qui pose le hash, le hashchange qui suit
  // ne doit pas être traité comme une navigation externe.
  const suppressHashRef = useRef(false)

  // Pose le hash correspondant à la vue (lien direct partageable).
  const syncHash = useCallback((v: View) => {
    const h = viewToHash(v)
    if (!h || window.location.hash === `#${h}`) return
    suppressHashRef.current = true
    window.location.hash = h
  }, [])

  const go = useCallback((v: View) => {
    setView((prev) => {
      historyRef.current = [...historyRef.current.slice(-19), prev]
      return v
    })
    window.scrollTo(0, 0)
    syncHash(v)
  }, [syncHash])

  const back = useCallback(() => {
    const prev = historyRef.current.pop() ?? { name: 'home' as const }
    setView(prev)
    window.scrollTo(0, 0)
    syncHash(prev)
  }, [syncHash])

  // Navigation navigateur (bouton retour/avant, lien collé dans la barre
  // d'adresse) : on suit le hash. L'historique interne est remis à zéro
  // (le navigateur pilote désormais l'historique).
  useEffect(() => {
    const onHash = () => {
      if (suppressHashRef.current) {
        suppressHashRef.current = false
        return
      }
      const v = hashToView(window.location.hash)
      if (v) {
        historyRef.current = []
        setView(v)
        window.scrollTo(0, 0)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const play = useCallback((p: PlayRequest) => {
    setMiniPlayer(false) // une nouvelle lecture reprend toujours en plein écran
    setPlayReq(p)
  }, [])

  // Synchro multi-appareils : tirage initial + écoute des écritures locales
  useEffect(() => initSync(), [])
  // Clé OpenSubtitles préinstallée : appliquée une fois au démarrage
  // (sans écraser une clé existante ni réapparaître si effacée).
  useEffect(() => ensurePresetOpensubs(), [])
  useEffect(() => ensurePresetSimkl(), [])
  useEffect(() => prefetchPlayer(), [])

  // Écran de démarrage : une seule fois par session
  const [splash, setSplash] = useState(
    () => !sessionStorage.getItem('novastream:splashed'),
  )
  useEffect(() => {
    if (splash) sessionStorage.setItem('novastream:splashed', '1')
  }, [splash])

  const ctx = useMemo(() => ({ view, go, play, back }), [view, go, play, back])

  if (locked) {
    const tryUnlock = () => {
      if (unlock(pin)) {
        setLocked(false)
      } else {
        setPinError(true)
        setPin('')
      }
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] font-sans text-white antialiased">
        <div className="w-72 text-center">
          <Lock size={32} className="mx-auto mb-4 text-[rgb(var(--acc))]" />
          <p className="text-lg font-bold">{lockName || 'Profil protégé'}</p>
          <p className="mb-5 text-sm text-white/50">Entre ton code PIN pour continuer</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(false) }}
            onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
            className="w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-[rgb(var(--acc))]"
            placeholder="····"
            autoFocus
          />
          {pinError && <p className="mt-2 text-xs text-red-400">Code PIN incorrect</p>}
          <button
            onClick={tryUnlock}
            className="mt-4 w-full rounded bg-[rgb(var(--acc))] py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
          >
            Déverrouiller
          </button>
        </div>
      </div>
    )
  }

  return (
    <NavContext.Provider value={ctx}>
      <div className="min-h-screen bg-[#050505] text-white">
        <Nav />
        {/* key = transition douce à chaque changement de vue ; pb pour ne pas
            passer sous la barre d'onglets mobile */}
        <main key={view.name + (view.name === 'detail' ? view.id : view.name === 'person' ? String(view.id) : view.name === 'catalog' ? view.title : '')} className="view-enter pb-20 md:pb-0">
          <Suspense fallback={
            <div className="flex h-[50vh] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[rgb(var(--acc))]" />
            </div>
          }>
          {view.name === 'home' && <Home />}
          {view.name === 'movies' && <CatalogPage type="movie" />}
          {view.name === 'series' && <CatalogPage type="series" />}
          {view.name === 'catalog' && (
            <CatalogPage
              type={view.type}
              title={view.title}
              genre={view.genre}
              addonUrl={view.addonUrl}
              catalogId={view.catalogId}
            />
          )}
          {view.name === 'search' && <SearchPage />}
          {view.name === 'library' && <LibraryPage />}
          {view.name === 'addons' && <AddonsPage />}
          {view.name === 'settings' && <SettingsPage />}
          {view.name === 'status' && <StatusPage />}
          {view.name === 'tv' && <TVPage />}
          {view.name === 'mangas' && <MangasPage />}
          {view.name === 'detail' && <DetailPage id={view.id} type={view.type} />}
          {view.name === 'person' && <PersonPage id={view.id} />}
          {view.name === 'shared' && <SharedListPage code={view.code} />}
          </Suspense>
        </main>
        <footer className="border-t border-white/5 px-5 md:px-12 py-10 pb-24 md:pb-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <p className="font-display font-black text-lg">
            DZ <span className="text-aurora">STREAM</span>
          </p>
          <p className="text-[10px] font-mono text-white/25 tracking-widest uppercase">
            Lecteur multimédia ouvert — compatible protocole Stremio
          </p>
        </footer>
        {playReq && (
          <ErrorBoundary onReset={() => { setPlayReq(null); setMiniPlayer(false) }}>
            <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black" />}>
              <Player
                key={`${playReq.meta.id}-${playReq.stream.url ?? playReq.stream.infoHash ?? playReq.stream.ytId ?? ''}`}
                req={playReq}
                onClose={() => { setPlayReq(null); setMiniPlayer(false) }}
                minimized={miniPlayer}
                onToggleMinimize={() => setMiniPlayer((m) => !m)}
              />
            </Suspense>
          </ErrorBoundary>
        )}
        <Toaster />
        <UpdateBanner />
        <AmbientFX />
        <InstallPrompt />
        <FlightOverlay />
        {splash && <Splash onDone={() => setSplash(false)} />}
      </div>
    </NavContext.Provider>
  )
}
