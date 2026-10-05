import { SkipForward } from 'lucide-react'

/** Bouton « Épisode suivant » : compte à rebours auto + annulation.
 * Extrait de Player.tsx — purement présentationnel.
 */

export default function PlayerNextEpisode({
  nextIn,
  label,
  onNext,
  onCancel,
}: {
  nextIn: number | null
  label?: string
  onNext: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute bottom-28 right-6 flex items-center gap-2 rise-in">
      <button
        onClick={(e) => { e.stopPropagation(); onNext() }}
        className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-5 py-3 text-sm font-bold text-white hover:scale-105 transition-transform"
      >
        <SkipForward size={16} fill="currentColor" />
        Épisode suivant {label ?? ''}
        {nextIn !== null && <span className="font-mono">({nextIn})</span>}
      </button>
      {nextIn !== null && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel() }}
          className="rounded-sm border border-white/25 bg-black/60 px-3 py-3 text-xs text-white/70 hover:text-white backdrop-blur"
        >
          Annuler
        </button>
      )}
    </div>
  )
}
