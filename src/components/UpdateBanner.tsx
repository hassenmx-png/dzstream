import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

/**
 * Détecte les nouvelles versions publiées : le serveur renvoie un identifiant
 * qui change à chaque déploiement. Si l'app ouverte n'est plus à jour, une
 * pastille propose de recharger — fini les versions fantômes en cache.
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState(false)
  const bootId = useRef<string | null>(null)

  useEffect(() => {
    let stopped = false

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as { v?: string }
        if (!j.v) return
        if (bootId.current === null) bootId.current = j.v
        else if (j.v !== bootId.current && !stopped) setUpdate(true)
      } catch {
        /* réseau coupé : on réessaiera au prochain cycle */
      }
    }

    void check()
    const timer = setInterval(check, 45_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!update) return null

  return (
    <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 rounded-full bg-[rgb(var(--acc))] pl-4 pr-2 py-2 shadow-[0_8px_30px_rgba(var(--acc),0.4)]">
      <p className="text-xs font-bold text-white whitespace-nowrap">✨ Nouvelle version dispo !</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-black hover:scale-105 active:scale-95 transition-transform"
      >
        <RefreshCw size={12} /> RECHARGER
      </button>
      <button
        onClick={() => setUpdate(false)}
        aria-label="Plus tard"
        className="rounded-full p-1 text-white/80 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  )
}
