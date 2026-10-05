import { Play, Pause, RotateCcw, RotateCw, Volume2, SunMedium } from 'lucide-react'

/** HUD des gestes tactiles + bouton « Passer l'intro ».
 * Extrait de Player.tsx — purement présentationnel.
 */

export interface GestureHud {
  id: number
  kind: 'seek-left' | 'seek-right' | 'volume' | 'brightness' | 'play' | 'pause' | 'subdelay'
  value: number
}

export default function PlayerGestureOverlay({
  hud,
  showSkipIntro,
  onSkipIntro,
}: {
  hud: GestureHud | null
  showSkipIntro: boolean
  onSkipIntro: () => void
}) {
  return (
    <>
      {showSkipIntro && (
        <button
          onClick={onSkipIntro}
          className="absolute right-4 top-20 z-30 rounded bg-white px-4 py-2 text-sm font-bold text-black shadow-lg transition-colors hover:bg-white/80"
        >
          Passer l'intro
        </button>
      )}

      {hud && (
        <div key={hud.id} className="pointer-events-none absolute inset-0 z-[40]">
          {hud.kind === 'play' || hud.kind === 'pause' ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="hud-pop rounded-full bg-black/60 p-6 backdrop-blur">
                {hud.kind === 'play'
                  ? <Play size={56} className="fill-white text-white" />
                  : <Pause size={56} className="fill-white text-white" />}
              </div>
            </div>
          ) : hud.kind === 'subdelay' ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-md bg-black/60 px-4 py-2 text-sm font-mono text-[rgb(var(--acc))] backdrop-blur">
                Sous-titres {hud.value > 0 ? '+' : ''}{hud.value.toFixed(1)} s
              </span>
            </div>
          ) : hud.kind === 'seek-left' || hud.kind === 'seek-right' ? (
            <div className={`absolute inset-y-0 ${hud.kind === 'seek-left' ? 'left-0' : 'right-0'} flex w-1/3 items-center justify-center`}>
              <div className="hud-pop flex flex-col items-center gap-1 rounded-2xl bg-black/60 px-6 py-4 backdrop-blur">
                {hud.kind === 'seek-left' ? <RotateCcw size={26} className="text-[rgb(var(--acc))]" /> : <RotateCw size={26} className="text-[rgb(var(--acc))]" />}
                <span className="font-display text-lg">{hud.kind === 'seek-left' ? '−10 s' : '+10 s'}</span>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="hud-pop flex items-center gap-3 rounded-full bg-black/60 px-5 py-3 backdrop-blur">
                {hud.kind === 'volume' ? <Volume2 size={20} className="text-[rgb(var(--acc))]" /> : <SunMedium size={20} className="text-[rgb(var(--acc))]" />}
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-[rgb(var(--acc))] transition-[width] duration-100" style={{ width: `${Math.round(hud.value * 100)}%` }} />
                </div>
                <span className="w-9 text-right font-mono text-xs">{Math.round(hud.value * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
