/** TV en direct : chaînes françaises via la playlist publique iptv-org
 *  (GitHub Pages, CORS ouvert). Parsing M3U minimal : nom, logo,
 *  catégorie, URL de flux. */
export interface TvChannel {
  name: string
  logo?: string
  group?: string
  url: string
  tvgId?: string
  /** Si présent, l'URL du flux est résolue au clic (endpoints JSON). */
  resolver?: () => Promise<string | null>
}

/** TvVoo (ElfHosted) : 700+ chaînes FR dont le sport. L'URL finale est
 *  obtenue au moment du clic via leur endpoint /stream (liens éphémères). */
export async function fetchTvVooChannels(): Promise<TvChannel[]> {
  const res = await fetch('https://tvvoo.hayd.uk/cfg-fr/catalog/tv/vavoo_tv_fr.json', {
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error('TvVoo indisponible')
  const j = (await res.json()) as { metas?: { id: string; name?: string; poster?: string }[] }
  const out: TvChannel[] = []
  for (const m of j.metas ?? []) {
    const name = (m.name ?? m.id).trim()
    const api = `https://tvvoo.hayd.uk/cfg-fr/stream/tv/${m.id}.json`
    out.push({
      name,
      logo: m.poster || undefined,
      group: 'TvVoo',
      url: '',
      resolver: async () => {
        try {
          const r = await fetch(api, { signal: AbortSignal.timeout(15000) })
          if (!r.ok) return null
          const sd = (await r.json()) as { streams?: { url?: string }[] }
          return sd.streams?.[0]?.url ?? null
        } catch {
          return null
        }
      },
    })
  }
  return out
}

export async function fetchFrenchChannels(): Promise<TvChannel[]> {
  const res = await fetch('https://iptv-org.github.io/iptv/countries/fr.m3u', {
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error('Playlist TV indisponible')
  const text = await res.text()
  const channels: TvChannel[] = []
  const seen = new Set<string>()
  let pending: Partial<TvChannel> | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#EXTINF:')) {
      pending = {
        name: line.split(',').pop()?.trim() || 'Chaîne',
        logo: line.match(/tvg-logo="([^"]*)"/)?.[1] || undefined,
        group: line.match(/group-title="([^"]*)"/)?.[1] || undefined,
        tvgId: line.match(/tvg-id="([^"]*)"/)?.[1] || undefined,
      }
    } else if (line && !line.startsWith('#') && pending) {
      if (/^https?:\/\//.test(line)) {
        const key = `${pending.name}|${line}`
        if (!seen.has(key)) {
          seen.add(key)
          channels.push({ name: pending.name!, logo: pending.logo, group: pending.group, url: line, tvgId: pending.tvgId })
        }
      }
      pending = null
    }
  }
  return channels
}
