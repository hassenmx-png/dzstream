/** Menu « piste audio / version » du lecteur.
 * Extrait de Player.tsx — composant purement présentationnel : toutes les
 * données et actions arrivent en props, aucun état interne.
 */

export type PlayerVersionKey = 'VF' | 'MULTI' | 'VOSTFR' | 'VO'

export interface PlayerVersionDef {
  key: PlayerVersionKey
  label: string
}

export default function PlayerAudioMenu({
  audioTracks,
  activeAudio,
  tcAudioCount,
  tcAudioIdx,
  availableVersions,
  currentVersion,
  pickAudio,
  switchTcAudio,
  switchVersion,
}: {
  audioTracks: { id: number; label: string }[]
  activeAudio: number
  tcAudioCount: number
  tcAudioIdx: number
  availableVersions: PlayerVersionDef[]
  currentVersion: PlayerVersionKey | null
  pickAudio: (id: number) => void
  switchTcAudio: (i: number) => void
  switchVersion: (target: PlayerVersionKey) => void
}) {
  return (
  <div className="absolute bottom-10 right-0 w-64 rounded-md border border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-1.5 max-h-72 overflow-y-auto">
    {audioTracks.length > 1 && (
      <>
        <p className="px-3 pb-1 pt-2 text-[10px] font-mono tracking-[0.2em] text-white/40">
          PISTE AUDIO
        </p>
        {audioTracks.map((t) => (
          <button
            key={t.id}
            onClick={() => pickAudio(t.id)}
            className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${activeAudio === t.id ? 'text-[rgb(var(--acc))]' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </>
    )}
    {tcAudioCount > 1 && (
      <>
        <p className="px-3 pb-1 pt-2 text-[10px] font-mono tracking-[0.2em] text-white/40">
          PISTE (CONVERSION AUDIO)
        </p>
        {Array.from({ length: tcAudioCount }, (_, i) => i).map((i) => (
          <button
            key={`tc-audio-${i}`}
            onClick={() => switchTcAudio(i)}
            className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${tcAudioIdx === i ? 'text-[rgb(var(--acc))]' : ''}`}
          >
            Piste {i + 1}
          </button>
        ))}
      </>
    )}
    {availableVersions.length > 0 && (
      <>
        <p className="px-3 pb-1 pt-2 text-[10px] font-mono tracking-[0.2em] text-white/40">
          VERSION {audioTracks.length > 1 ? '(AUTRE SOURCE)' : '— LANGUE DU FILM'}
        </p>
        {availableVersions.map((d) => (
          <button
            key={d.key}
            onClick={() => switchVersion(d.key)}
            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${currentVersion === d.key ? 'text-[rgb(var(--acc))]' : ''}`}
          >
            <span>{d.label}</span>
            {currentVersion === d.key && <span className="text-[10px] font-mono">EN COURS</span>}
          </button>
        ))}
        <p className="px-3 pb-1 pt-1.5 text-[10px] leading-snug text-white/35">
          Change de source et reprend là où tu en es.
        </p>
      </>
    )}
  </div>
  )
}
