import { AlertTriangle } from 'lucide-react'

/** Overlay d'erreur de lecture — extrait de Player.tsx. */

export default function PlayerErrorOverlay({
  error,
  showP2PFallback,
  onClose,
  onP2PFallback,
}: {
  error: string
  showP2PFallback: boolean
  onClose: () => void
  onP2PFallback: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
      <div className="max-w-md text-center space-y-4">
        <AlertTriangle size={36} className="mx-auto text-amber-400" />
        <p className="text-white/85">{error}</p>
        <p className="text-white/60 text-sm">
          Astuce : privilégie les sources avec le plus de seeders (👤), ou les liens Direct / HLS.
        </p>
        <button onClick={onClose} className="rounded-sm bg-[rgb(var(--acc))] px-6 py-2.5 text-sm font-bold text-white">
          Choisir une autre source
        </button>
        {showP2PFallback && (
          <button
            onClick={onP2PFallback}
            className="block mx-auto text-xs text-white/60 hover:text-[rgb(var(--acc))] underline underline-offset-4"
          >
            ou tenter en P2P navigateur (WebRTC)
          </button>
        )}
      </div>
    </div>
  )
}
