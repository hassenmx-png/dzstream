import { toast } from '@/lib/toast'
import { setRoomFollow, type ActiveRoom } from '@/lib/room'

/** Menu « Salon — regarder ensemble » du lecteur.
 * Extrait de Player.tsx — composant purement présentationnel.
 */

export default function PlayerSalonMenu({
  room,
  salonBusy,
  salonInput,
  guestCount,
  salonCreate,
  salonJoin,
  salonLeave,
  setSalonInput,
}: {
  room: ActiveRoom | null
  salonBusy: boolean
  salonInput: string
  guestCount: number
  salonCreate: () => Promise<void>
  salonJoin: () => Promise<void>
  salonLeave: () => Promise<void>
  setSalonInput: (v: string) => void
}) {
  return (
  <div className="absolute bottom-10 right-0 w-72 rounded-md border border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-3 space-y-2.5">
    <p className="text-[10px] font-mono tracking-[0.2em] text-white/60">SALON — REGARDER ENSEMBLE</p>
    {!room ? (
      <>
        <button
          onClick={() => void salonCreate()}
          disabled={salonBusy}
          className="w-full rounded-sm bg-[rgb(var(--acc))] px-3 py-2 text-sm font-bold text-white hover:bg-[#e8252f] disabled:opacity-50 transition-colors"
        >
          {salonBusy ? 'Création…' : 'Créer un salon'}
        </button>
        <p className="text-[11px] text-white/60 leading-relaxed">
          Tes amis ouvrent le lecteur, touchent cette icône et entrent le code : lecture, pause et position synchronisées.
        </p>
        <div className="border-t border-white/10 pt-2.5">
          <p className="mb-1.5 text-[10px] font-mono tracking-[0.2em] text-white/60">REJOINDRE</p>
          <div className="flex gap-1.5">
            <input
              value={salonInput}
              onChange={(e) => setSalonInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void salonJoin() }}
              placeholder="SN-XXXX-XXXX"
              className="min-w-0 flex-1 rounded-sm border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-mono uppercase placeholder:text-white/25 focus:border-[rgb(var(--acc))]/60 focus:outline-none"
            />
            <button
              onClick={() => void salonJoin()}
              disabled={salonBusy}
              className="rounded-sm bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-[rgb(var(--acc))] hover:text-white disabled:opacity-50 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      </>
    ) : (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-bold text-[rgb(var(--acc))]">{room.code}</span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(room.code).catch(() => { /* ignore */ })
              toast('Code du salon copié ✓')
            }}
            className="rounded-sm bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/20 transition-colors"
          >
            Copier
          </button>
        </div>
        <p className="text-[11px] text-white/45">
          {room.role === 'host'
            ? `Tu es l'hôte — ${guestCount} invité${guestCount > 1 ? 's' : ''} connecté${guestCount > 1 ? 's' : ''}. Lecture, pause et changement d'épisode sont suivis par tous.`
            : 'Tu suis la lecture de l\'hôte.'}
        </p>
        {room.role === 'guest' && (
          <button
            onClick={() => setRoomFollow(!room.follow)}
            className={`w-full rounded-sm px-3 py-2 text-xs font-semibold transition-colors ${
              room.follow ? 'bg-[rgb(var(--acc))]/15 text-[rgb(var(--acc))]' : 'bg-white/10 text-white/70 hover:bg-white/15'
            }`}
          >
            {room.follow ? '● Synchro active — toucher pour faire une pause perso' : '○ Synchro en pause — toucher pour rejoindre l\'hôte'}
          </button>
        )}
        <button
          onClick={() => void salonLeave()}
          className="w-full rounded-sm border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
        >
          {room.role === 'host' ? 'Fermer le salon pour tout le monde' : 'Quitter le salon'}
        </button>
      </>
    )}
  </div>
  )
}
