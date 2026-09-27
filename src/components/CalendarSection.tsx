import { CalendarDays } from 'lucide-react'
import { dayDistance, type CalEntry } from '@/lib/calendar'
import { useNav } from '@/lib/nav'

const TONE_CLASSES: Record<string, string> = {
  today: 'bg-[rgb(var(--acc))] text-white',
  soon: 'border border-[rgb(var(--acc))]/50 text-[rgb(var(--acc))]',
  future: 'border border-white/20 text-white/60',
  past: 'border border-white/10 text-white/35',
}

/**
 * Calendrier des épisodes : diffusions de la semaine écoulée et des 30
 * prochains jours pour les séries suivies, regroupées par date.
 * Un clic ouvre la fiche de la série. Les données sont chargées par la page
 * (mutualisées avec les badges « nouvel épisode » de la bibliothèque).
 */
export default function CalendarSection({
  hasSeries,
  entries,
}: {
  hasSeries: boolean
  /** null = chargement en cours */
  entries: CalEntry[] | null
}) {
  const { go } = useNav()

  if (!hasSeries) return null

  // Regroupe par jour (ordre chronologique garanti par fetchCalendar)
  const days = new Map<string, CalEntry[]>()
  for (const e of entries ?? []) {
    const key = new Date(e.released).toDateString()
    if (!days.has(key)) days.set(key, [])
    days.get(key)!.push(e)
  }

  return (
    <section className="mt-14">
      <div className="mb-4 flex items-center gap-2">
        <CalendarDays size={15} className="text-[rgb(var(--acc))]" />
        <h2 className="bracket-label">Calendrier des épisodes</h2>
      </div>

      {entries === null ? (
        // Chargement : squelettes alignés sur le rendu final
        <div className="space-y-4">
          {[0, 1].map((d) => (
            <div key={d}>
              <div className="skeleton mb-2 h-3 w-40 rounded" />
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-24 w-64 shrink-0 rounded-md" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-white/35">
          Aucun épisode de tes séries dans les 30 prochains jours.
        </p>
      ) : (
        <div className="space-y-5">
          {[...days.entries()].map(([day, list]) => {
            const dist = dayDistance(list[0].released)
            const dateLabel = new Date(list[0].released).toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })
            return (
              <div key={day}>
                <div className="mb-2 flex items-baseline gap-2.5">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider ${TONE_CLASSES[dist.tone]}`}
                  >
                    {dist.label}
                  </span>
                  <span className="text-xs capitalize text-white/40">{dateLabel}</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1 snap-row">
                  {list.map((e) => (
                    <button
                      key={`${e.seriesId}:${e.season}:${e.episode}`}
                      onClick={() => go({ name: 'detail', id: e.seriesId, type: 'series' })}
                      className="group flex w-64 shrink-0 items-center gap-3 rounded-md border border-white/8 bg-white/[0.03] p-2.5 text-left transition-colors hover:border-[rgb(var(--acc))]/40"
                    >
                      {e.poster ? (
                        <img
                          src={e.poster}
                          alt=""
                          loading="lazy"
                          className="h-16 w-11 shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <span className="h-16 w-11 shrink-0 rounded-sm bg-white/8" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold group-hover:text-[rgb(var(--acc))] transition-colors">
                          {e.seriesName}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-mono text-[rgb(var(--acc))]/80">
                          S{String(e.season).padStart(2, '0')}E{String(e.episode).padStart(2, '0')}
                        </span>
                        <span className="block truncate text-[11px] text-white/40">{e.title}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
