import { useMemo } from 'react'
import { Play, Users } from 'lucide-react'
import type { Stream } from '@/types'
import {
  streamKind,
  streamSeeders,
  streamQuality,
  streamAudio,
  streamSize,
  isDebridStream,
} from '@/lib/addons'
import { makeStreamLabel } from '@/lib/library'
import { formatBytes } from '@/lib/addons'

/** Qualité normalisée pour le sous-titre de groupe. */
function normQ(s: Stream): string {
  const q = streamQuality(s).toUpperCase()
  if (q === '4K' || q === '2160P' || q === '8K') return '4K'
  if (q === '1080P') return '1080P'
  if (q === '720P') return '720P'
  return 'SD'
}

function QualityTag({ q }: { q: string }) {
  const color =
    q === '4K'
      ? 'bg-amber-400/15 text-amber-300 border-amber-400/30'
      : q === '1080P'
        ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
        : q === '720P'
          ? 'bg-sky-400/15 text-sky-300 border-sky-400/30'
          : 'bg-white/8 text-white/50 border-white/15'
  return (
    <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-bold tracking-wide ${color}`}>
      {q === 'SD' ? 'SD' : q}
    </span>
  )
}

/**
 * Sources affichées en COLONNES par addon (style Nuvio/Stremio) :
 * une colonne = un addon, scroll horizontal pour passer d'un addon à l'autre,
 * sous-sections qualité dans chaque colonne. Le bouton de source est identique
 * à la version liste verticale (mêmes classes, mêmes badges).
 */
export default function SourceColumns({
  streams,
  bestUrl,
  onLaunch,
}: {
  streams: Stream[]
  bestUrl: string | null
  onLaunch: (s: Stream) => void
}) {
  const groups = useMemo(() => {
    const m = new Map<string, Stream[]>()
    for (const s of streams) {
      const n = s.addonName || 'Autre'
      if (!m.has(n)) m.set(n, [])
      m.get(n)!.push(s)
    }
    return [...m.entries()]
  }, [streams])

  return (
    <div className="flex gap-3 pb-1">
      {groups.map(([addonName, items]) => {
        const debridCount = items.filter((s) => isDebridStream(s)).length
        return (
          <div key={addonName} className="w-[250px] md:w-[290px] shrink-0">
            {/* En-tête de colonne : nom + compteurs */}
            <div className="mb-1.5 flex items-center gap-2">
              <span className="truncate font-display text-xs font-bold tracking-wider text-[rgb(var(--acc))]">
                {addonName}
              </span>
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs font-semibold text-white/55 tracking-wide">
                {items.length}
                {debridCount > 0 && <span className="text-[rgb(var(--acc))]"> ⚡{debridCount}</span>}
              </span>
            </div>
            <div className="space-y-1">
              {items.map((s, i) => {
                const kind = streamKind(s)
                const seeders = streamSeeders(s)
                const recommended = bestUrl !== null && s.url === bestUrl
                const q = normQ(s)
                const prevQ = i > 0 ? normQ(items[i - 1]) : null
                return (
                  <div key={`${addonName}-${i}`}>
                    {q !== prevQ && (
                      <div className="mb-0.5 mt-1.5 first:mt-0 text-[11px] font-bold tracking-wide text-white/50">
                        {q === 'SD' ? 'SD / AUTRE' : q}
                      </div>
                    )}
                    <button
                      onClick={() => onLaunch(s)}
                      className={`group w-full flex items-center gap-3 rounded-md border px-3 py-2.5 md:px-4 md:py-3 text-left transition-all hover:border-[rgb(var(--acc))]/50 hover:bg-[rgb(var(--acc))]/5 ${
                        recommended ? 'border-[rgb(var(--acc))]/60 bg-[rgb(var(--acc))]/[0.07]' : 'border-white/8 bg-white/[0.03]'
                      }`}
                    >
                      <span className="shrink-0 rounded-full bg-white/8 p-2 text-white/60 group-hover:bg-[rgb(var(--acc))] group-hover:text-white transition-colors">
                        <Play size={13} fill="currentColor" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {recommended && (
                            <span className="mr-2 rounded-sm bg-[rgb(var(--acc))] px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">
                              ★ RECOMMANDÉ
                            </span>
                          )}
                          {makeStreamLabel(s)}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-white/55 font-medium">
                          <span className="text-[rgb(var(--acc))]/80">{s.addonName}</span>
                          <span>{kind === 'torrent' ? '⬡ P2P Torrent' : kind === 'http' ? '⇄ Direct / HLS' : kind === 'youtube' ? '▶ YouTube' : '↗ Externe'}</span>
                          {kind === 'http' && !isDebridStream(s) && (
                            <span className="rounded-sm bg-sky-400/15 border border-sky-400/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sky-300">
                              ⚡ DÉMARRAGE IMMÉDIAT
                            </span>
                          )}
                          {isDebridStream(s) && (
                            <span className="rounded-sm bg-[rgb(var(--acc))]/15 border border-[rgb(var(--acc))]/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[rgb(var(--acc))]">
                              ⚡ PREMIUM
                            </span>
                          )}
                          {(() => {
                            const audio = streamAudio(s)
                            if (!audio) return null
                            const styles = {
                              VF: 'bg-[rgb(var(--acc))] text-white',
                              MULTI: 'border border-[rgb(var(--acc))]/50 text-[rgb(var(--acc))]',
                              VOSTFR: 'border border-white/25 text-white/60',
                            } as const
                            const labels = { VF: '🇫🇷 VF', MULTI: '🇫🇷 MULTI', VOSTFR: 'VOSTFR' } as const
                            return (
                              <span className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold tracking-wide ${styles[audio]}`}>
                                {labels[audio]}
                              </span>
                            )
                          })()}
                          {(() => {
                            const t = `${s.title ?? ''} ${s.name ?? ''}`.toLowerCase()
                            return /\b(hevc|h[-.]?265|x265)\b/.test(t) ? (
                              <span
                                className="rounded-sm bg-fuchsia-500/15 border border-fuchsia-500/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-fuchsia-300"
                                title="Vidéo H.265/HEVC : image NOIRE sur ce téléphone (son OK) — choisis une source x264/H264"
                              >
                                🎥 H265
                              </span>
                            ) : null
                          })()}
                          {seeders > 0 && (
                            <span className={`flex items-center gap-1 ${seeders >= 20 ? 'text-[rgb(var(--acc))]' : 'text-amber-400/80'}`}>
                              <Users size={10} /> {seeders}
                            </span>
                          )}
                          {(s.behaviorHints?.videoSize || streamSize(s) > 0) && (
                            <span>{formatBytes(s.behaviorHints?.videoSize || streamSize(s))}</span>
                          )}
                        </p>
                      </div>
                      <QualityTag q={streamQuality(s)} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
