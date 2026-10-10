import { Minus, Plus } from 'lucide-react'
import type { SubtitleTrack } from '@/types'
import type { SubPrefs } from '@/lib/subprefs'

/** Menu « sous-titres » du lecteur : choix de piste + réglages d'affichage.
 * Extrait de Player.tsx — composant purement présentationnel.
 */

export default function PlayerSubMenu({
  allSubs,
  groupedSubs,
  activeSub,
  subError,
  subAuto,
  subPrefs,
  pickSubtitle,
  toggleSubAuto,
  updateSubPrefs,
}: {
  allSubs: SubtitleTrack[]
  groupedSubs: [string, SubtitleTrack[]][]
  activeSub: string | null
  subError: string | null
  subAuto: boolean
  subPrefs: SubPrefs
  pickSubtitle: (sub: SubtitleTrack | null) => void
  toggleSubAuto: () => void
  updateSubPrefs: (patch: Partial<SubPrefs>) => void
}) {
  return (
  <div className="absolute bottom-10 right-0 w-64 rounded-md border border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-1.5 max-h-72 overflow-y-auto">
    <p className="px-3 pb-1 pt-2 text-[10px] font-mono tracking-[0.2em] text-white/60">
      SOUS-TITRES
    </p>
    <button
      onClick={() => pickSubtitle(null)}
      className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${!activeSub ? 'text-[rgb(var(--acc))]' : ''}`}
    >
      Désactivés
    </button>
    {allSubs.length === 0 && (
      <p className="px-3 py-2 text-xs text-white/35">
        Aucune piste disponible pour ce titre. Installe un addon de sous-titres (ex. OpenSubtitles) dans l'onglet Addons.
      </p>
    )}
    {groupedSubs.map(([lang, tracks]) => (
      <div key={lang}>
        <p className="px-3 pb-0.5 pt-2.5 text-[10px] font-mono tracking-[0.2em] text-[rgb(var(--acc))]/70">
          {lang.toUpperCase()}
        </p>
        {tracks.map((s, i) => (
          <button
            key={s.id}
            onClick={() => pickSubtitle(s)}
            className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${activeSub === s.id ? 'text-[rgb(var(--acc))]' : ''}`}
          >
            {tracks.length > 1 ? `${lang} · piste ${i + 1}` : lang}
            <span className="block text-[10px] text-white/35">{s.addonName}</span>
          </button>
        ))}
      </div>
    ))}
    {subError && <p className="px-3 py-1.5 text-[11px] text-amber-400">{subError}</p>}

    {/* Réglages d'affichage : taille, couleur, fond, décalage */}
    <div className="mt-1.5 border-t border-white/10 px-3 pt-2 pb-2 space-y-2">
      <p className="text-[10px] font-mono tracking-[0.2em] text-white/60">RÉGLAGES</p>
      <button
        onClick={toggleSubAuto}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] text-white/60">Français automatique</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold ${subAuto ? 'bg-[rgb(var(--acc))] text-white' : 'bg-white/10 text-white/50'}`}>
          {subAuto ? 'OUI' : 'NON'}
        </span>
      </button>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Taille</span>
        <div className="flex rounded border border-white/15 overflow-hidden text-[10px] font-mono">
          {['S', 'M', 'L', 'XL'].map((s, i) => (
            <button
              key={s}
              onClick={() => updateSubPrefs({ size: i })}
              className={`px-2 py-1 ${subPrefs.size === i ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Couleur</span>
        <div className="flex gap-1.5">
          {([['white', '#fff'], ['yellow', '#ffe66d'], ['green', 'rgb(var(--acc))']] as const).map(([c, hex]) => (
            <button
              key={c}
              onClick={() => updateSubPrefs({ color: c })}
              aria-label={`Couleur ${c}`}
              className={`h-4 w-4 rounded-full border-2 ${subPrefs.color === c ? 'border-white' : 'border-white/20'}`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Fond</span>
        <div className="flex rounded border border-white/15 overflow-hidden text-[10px] font-mono">
          {([['none', 'AUCUN'], ['semi', 'LÉGER'], ['solid', 'OPAQUE']] as const).map(([b, label]) => (
            <button
              key={b}
              onClick={() => updateSubPrefs({ bg: b })}
              className={`px-2 py-1 ${subPrefs.bg === b ? 'bg-[rgb(var(--acc))] text-white font-bold' : 'text-white/50 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/60">Décalage</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => updateSubPrefs({ delay: subPrefs.delay - 0.5 })}
            className="rounded border border-white/15 p-1 text-white/60 hover:text-[rgb(var(--acc))]"
            aria-label="Sous-titres plus tôt"
          >
            <Minus size={12} />
          </button>
          <span className="w-14 text-center text-[11px] font-mono text-[rgb(var(--acc))]">
            {subPrefs.delay > 0 ? '+' : ''}{subPrefs.delay.toFixed(1)} s
          </span>
          <button
            onClick={() => updateSubPrefs({ delay: subPrefs.delay + 0.5 })}
            className="rounded border border-white/15 p-1 text-white/60 hover:text-[rgb(var(--acc))]"
            aria-label="Sous-titres plus tard"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  </div>
  )
}
