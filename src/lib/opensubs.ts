/**
 * OpenSubtitles.com (API v2) — source complémentaire de sous-titres,
 * bien meilleure couverture anime/VOSTFR que l'API legacy.
 * Clé API gratuite : opensubtitles.com → « API consumers » (2 minutes).
 * CORS ouvert, User-Agent navigateur requis (fourni nativement).
 */

const BASE = '/api/opensubs'  // proxy serveur : api.opensubtitles.com n'envoie pas de CORS (appels navigateur bloqués)

const KEY_STORAGE = 'novastream:opensubs-key'

/** Clé pré-configurée (même principe que le preset debrid) : chaque visiteur
 *  la reçoit automatiquement, sans rien saisir. Clé gratuite :
 *  opensubtitles.com → compte → « API consumers ». */
const PRESET_OPENSUBS_KEY = 'TgbhoeZhCumLnNGjllR3qQTUANFMieLJ'
const PRESET_OPENSUBS_SEEDED = 'novastream:opensubs-seeded-v1'

/** Applique la clé preset une seule fois (sans écraser une clé existante
 *  ni ré-apparaître si l'utilisateur l'a effacée volontairement). */
export function ensurePresetOpensubs(): void {
  try {
    if (!PRESET_OPENSUBS_KEY) return
    if (localStorage.getItem(KEY_STORAGE)) return
    if (localStorage.getItem(PRESET_OPENSUBS_SEEDED)) return
    localStorage.setItem(KEY_STORAGE, PRESET_OPENSUBS_KEY.trim())
    localStorage.setItem(PRESET_OPENSUBS_SEEDED, '1')
  } catch { /* non critique */ }
}

export function getOpensubsKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' }
}

export function setOpensubsKey(key: string): void {
  try { localStorage.setItem(KEY_STORAGE, key.trim()) } catch { /* quota */ }
}

interface V2SearchItem {
  attributes?: {
    files?: { file_id: number; file_name?: string }[]
    release?: string
  }
}

export interface OpensubsTrack {
  id: string
  fileId: number
  label: string
}

/** Recherche de sous-titres FR (films + épisodes) — nécessite une clé. */
export async function opensubsSearch(q: {
  imdbId?: string
  name?: string
  season?: number
  episode?: number
}): Promise<OpensubsTrack[]> {
  const key = getOpensubsKey()
  if (!key) return []
  const params = new URLSearchParams({ languages: 'fr' })
  if (q.imdbId) params.set('imdb_id', q.imdbId.replace(/^tt/i, ''))
  if (q.name) params.set('query', q.name)
  if (q.season != null) params.set('season_number', String(q.season))
  if (q.episode != null) params.set('episode_number', String(q.episode))
  try {
    const res = await fetch(`${BASE}/subtitles?${params}`, {
      headers: { 'x-os-key': key },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const j = (await res.json()) as { data?: V2SearchItem[] }
    const seen = new Set<number>()
    const out: OpensubsTrack[] = []
    for (const it of j.data ?? []) {
      for (const f of it.attributes?.files ?? []) {
        if (seen.has(f.file_id)) continue
        seen.add(f.file_id)
        out.push({
          id: `osv2-${f.file_id}`,
          fileId: f.file_id,
          label: (f.file_name ?? it.attributes?.release ?? 'Sous-titre FR').replace(/\.(srt|vtt|ass)$/i, ''),
        })
        if (out.length >= 15) return out
      }
    }
    return out
  } catch {
    return []
  }
}

/** Résout un file_id en contenu VTT (le préfixe « osv2: » est traité
 *  côté lecteur — voir fetchVttSub dans Player.tsx). */
export async function opensubsDownloadVtt(fileId: number): Promise<string> {
  const key = getOpensubsKey()
  if (!key) throw new Error('Clé OpenSubtitles manquante')
  const res = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: { 'x-os-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`OpenSubtitles a répondu ${res.status}`)
  const j = (await res.json()) as { link?: string }
  if (!j.link) throw new Error('Lien de téléchargement introuvable')
  const file = await fetch('/api/opensubs/file?u=' + encodeURIComponent(j.link), { signal: AbortSignal.timeout(25000) })  // lien signé sans CORS → proxy
  if (!file.ok) throw new Error('Téléchargement impossible')
  const buf = await file.arrayBuffer()
  let text: string
  try {
    text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  } catch {
    text = new TextDecoder('utf-8').decode(buf)
  }
  return text.trimStart().startsWith('WEBVTT') ? text : srtToVtt(text)
}

/** Conversion SRT → VTT minimale (partagée avec le lecteur). */
export function srtToVtt(txt: string): string {
  if (txt.trimStart().startsWith('WEBVTT')) return txt
  const body = txt
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => (/^\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(l) ? l.replace(/,/g, '.') : l))
    .join('\n')
  return `WEBVTT\n\n${body}`
}
