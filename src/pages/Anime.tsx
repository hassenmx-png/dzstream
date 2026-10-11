import { useEffect, useState } from 'react'
import Row from '@/components/Row'
import CalendarSection from '@/components/CalendarSection'
import { fetchCalendar, type CalEntry } from '@/lib/calendar'
import type { MetaPreview } from '@/types'

/**
 * Page Animés — catalogues Kitsu (Stremio) mappés sur les IDs IMDb.
 * Les fiches, les flux VF/VOSTFR, les sous-titres et la reprise de lecture
 * passent par le moteur existant (page Détail + sources Torbox) : ici on ne
 * fait que présenter les derniers animés japonais, joliment rangés.
 */

const KITSU = 'https://anime-kitsu.strem.fun/catalog/anime'

interface KitsuMeta {
  imdb_id?: string
  type?: string
  name?: string
  poster?: string
}

function useKitsu(catalog: string): MetaPreview[] {
  const [items, setItems] = useState<MetaPreview[]>([])
  useEffect(() => {
    let alive = true
    fetch(`${KITSU}/${catalog}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { metas?: KitsuMeta[] } | null) => {
        if (!alive || !j?.metas) return
        setItems(
          j.metas
            .filter((x) => x.imdb_id && /^tt\d+/.test(x.imdb_id))
            .map((x) => ({
              id: x.imdb_id as string,
              type: (x.type === 'movie' ? 'movie' : 'series') as 'movie' | 'series',
              name: x.name ?? 'Animé',
              poster: x.poster,
            })),
        )
      })
      .catch(() => { /* catalogue injoignable : la rangée reste cachée */ })
    return () => { alive = false }
  }, [catalog])
  return items
}

function KitsuRow({ catalog, title }: { catalog: string; title: string }) {
  const items = useKitsu(catalog)
  if (!items.length) return null
  return <Row title={title} items={items} />
}

/** Calendrier de la semaine : épisodes des animés en cours de diffusion. */
function AnimeWeekCalendar({ airing }: { airing: MetaPreview[] }) {
  const [entries, setEntries] = useState<CalEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    if (airing.length > 0)
      void fetchCalendar(airing.map((x) => ({ id: x.id, name: x.name, poster: x.poster })))
        .then((e) => { if (alive) setEntries(e) })
    return () => { alive = false }
  }, [airing])
  return <CalendarSection hasSeries={airing.length > 0} entries={entries} />
}

export default function Anime() {
  const airing = useKitsu('kitsu-anime-airing')
  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen">
      <h1 className="font-display text-4xl md:text-6xl font-black tracking-tight">ANIMÉS.</h1>
      <p className="mt-2 max-w-xl text-sm text-white/50">
        Les sorties du Japon, en VF et VOSTFR. Touche une affiche, choisis ta source — la lecture
        reprend où tu l'avais laissée, comme partout dans l'app.
      </p>
      <AnimeWeekCalendar airing={airing} />
      <div className="mt-8">
        {airing.length > 0 && <Row title="📡 En ce moment au Japon" items={airing} />}
        <KitsuRow catalog="kitsu-anime-trending" title="🔥 Tendances" />
        <KitsuRow catalog="kitsu-anime-popular" title="⭐ Populaires" />
        <KitsuRow catalog="kitsu-anime-rating" title="🏆 Les mieux notés" />
      </div>
    </div>
  )
}
