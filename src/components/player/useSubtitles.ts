import { useEffect, useRef, useState, type RefObject } from 'react'
import type Hls from 'hls.js'
import type { PlayRequest } from '@/lib/nav'
import type { SubtitleTrack } from '@/types'
import { getSubPrefs, initSubPrefs, setSubPrefs, shiftVtt, type SubPrefs } from '@/lib/subprefs'
import { opensubsDownloadVtt } from '@/lib/opensubs'
import { readJSON, writeJSON } from '@/lib/store'

/** Codes de langue OpenSubtitles (ISO 639-2/3 et 2 lettres) → nom affiché. */
const SUB_LANG_NAMES: Record<string, string> = {
  fre: 'Français', fra: 'Français', fr: 'Français',
  eng: 'Anglais', en: 'Anglais',
  spa: 'Espagnol', es: 'Espagnol',
  por: 'Portugais', pt: 'Portugais',
  ger: 'Allemand', deu: 'Allemand', de: 'Allemand',
  ita: 'Italien', it: 'Italien',
  ara: 'Arabe', ar: 'Arabe',
  rus: 'Russe', ru: 'Russe',
  jpn: 'Japonais', ja: 'Japonais',
  kor: 'Coréen', ko: 'Coréen',
  chi: 'Chinois', zho: 'Chinois', zh: 'Chinois',
  tur: 'Turc', tr: 'Turc',
  pol: 'Polonais', pl: 'Polonais',
  dut: 'Néerlandais', nld: 'Néerlandais', nl: 'Néerlandais',
  swe: 'Suédois', sv: 'Suédois',
  nor: 'Norvégien', no: 'Norvégien',
  dan: 'Danois', da: 'Danois',
  fin: 'Finnois', fi: 'Finnois',
  hin: 'Hindi', hi: 'Hindi',
  ukr: 'Ukrainien', uk: 'Ukrainien',
  ron: 'Roumain', rum: 'Roumain', ro: 'Roumain',
  hun: 'Hongrois', hu: 'Hongrois',
  cze: 'Tchèque', ces: 'Tchèque', cs: 'Tchèque',
  gre: 'Grec', ell: 'Grec', el: 'Grec',
  heb: 'Hébreu', he: 'Hébreu',
  bul: 'Bulgare', bg: 'Bulgare',
  per: 'Persan', fas: 'Persan', fa: 'Persan',
  vie: 'Vietnamien', vi: 'Vietnamien',
  tha: 'Thaï', th: 'Thaï',
  ind: 'Indonésien', id: 'Indonésien',
  alb: 'Albanais', sqi: 'Albanais', sq: 'Albanais',
  srp: 'Serbe', sr: 'Serbe',
  hrv: 'Croate', hr: 'Croate',
  slv: 'Slovène', slo: 'Slovène', sl: 'Slovène',
  lit: 'Lituanien', lt: 'Lituanien',
  lav: 'Letton', lv: 'Letton',
  est: 'Estonien', et: 'Estonien',
  cat: 'Catalan', ca: 'Catalan',
  eus: 'Basque', eu: 'Basque',
  glg: 'Galicien', gl: 'Galicien',
  mlt: 'Maltais', mt: 'Maltais',
  isl: 'Islandais', ice: 'Islandais', is: 'Islandais',
  msa: 'Malais', may: 'Malais', ms: 'Malais',
  ben: 'Bengali', bn: 'Bengali',
  tam: 'Tamoul', ta: 'Tamoul',
  tel: 'Télougou', te: 'Télougou',
  urd: 'Ourdou', ur: 'Ourdou',
  geo: 'Géorgien', kat: 'Géorgien', ka: 'Géorgien',
  arm: 'Arménien', hye: 'Arménien', hy: 'Arménien',
  mac: 'Macédonien', mkd: 'Macédonien', mk: 'Macédonien',
}


/**
 * Anti-fausse-etiquette : certaines releases taguent « fre » une piste en
 * realite anglaise. Apres chargement on analyse le TEXTE de la piste :
 * comptage des mots-outils francais vs anglais (sur un echantillon).
 * Trop peu de matiere (piste forced, generiques) -> on ne juge pas (true).
 */
function looksFrench(vtt: string): boolean {
  const text = vtt
    .replace(/WEBVTT[^\n]*/g, " ")
    .replace(/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->[^\n]*/g, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
  const words = text.match(/[a-z\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00e7\u0027]+/g) ?? []
  if (words.length < 20) return true
  const FR = new Set(["le","la","les","des","une","je","tu","il","elle","nous","vous","ils","est","sont","pas","ne","que","qui","dans","sur","avec","pour","mais","est-ce","ca","etre","avoir","fait","faire","tout","tres","bien","oui","non","merci","quoi","cette","ces","mon","ton","son","mes","tes","ses","aux","du","au","quand","parce","ai","as","es","sommes","etes","ont","va","vas","rien","jamais","alors","ici","voila","peux","veux","vais","faut","dit","dis"])
  const EN = new Set(["the","you","he","she","we","they","is","are","was","were","not","what","who","where","when","why","how","this","that","these","those","my","your","his","her","our","their","and","but","if","because","with","from","into","about","have","has","do","does","did","will","would","can","could","should","don","didn","doesn","isn","aren","it","its","let","gonna","wanna","yeah","okay","hey","oh","uh"])
  let fr = 0, en = 0
  for (const w of words.slice(0, 400)) { if (FR.has(w)) fr++; else if (EN.has(w)) en++ }
  return fr >= en
}

/** Convertit un sous-titre SRT/VTT distant en texte VTT. */
async function fetchVtt(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!res.ok) throw new Error('subtitles fetch failed')
  const text = await res.text()
  return text.startsWith('WEBVTT')
    ? text
    : 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

/**
 * Sous-système sous-titres du lecteur — extrait de Player.tsx.
 * Regroupe : catalogue de pistes (source + addons), sélection, conversion
 * SRT→VTT, décalage, auto-français, réglages d'affichage persistants.
 * Le hook partage videoRef / hlsRef / tcOffsetRef / trackUrlRef avec le
 * lecteur : la piste VTT est injectée directement dans la balise <video>.
 */
export function useSubtitles({
  req, videoRef, hlsRef, tcOffsetRef, trackUrlRef,
}: {
  req: PlayRequest
  videoRef: RefObject<HTMLVideoElement | null>
  hlsRef: RefObject<Hls | null>
  tcOffsetRef: RefObject<number>
  trackUrlRef: RefObject<string | null>
}) {
  const [activeSub, setActiveSub] = useState<string | null>(null)
  const [subError, setSubError] = useState<string | null>(null)

  // Toutes les pistes de sous-titres disponibles
  const allSubs: SubtitleTrack[] = [
    ...(req.stream.subtitles ?? []).filter((t) => !/opensubtitles\.stremio\.homes|api\.opensubtitles\.com/i.test(t?.url ?? '')).map((s, i) => ({
      id: `emb-${i}`, url: s.url, lang: s.lang, label: s.lang.toUpperCase(), addonName: 'Source',
    })),
    ...(req.subtitles ?? []),
  ]

  // Regroupement par langue (français en tête), noms affichés en clair.
  const groupedSubs: [string, SubtitleTrack[]][] = (() => {
    const map = new Map<string, SubtitleTrack[]>()
    for (const s of allSubs) {
      const name = SUB_LANG_NAMES[s.lang.toLowerCase()] ?? s.lang.toUpperCase()
      map.set(name, [...(map.get(name) ?? []), s])
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'Français') return -1
      if (b === 'Français') return 1
      return a.localeCompare(b)
    })
  })()

  // Applique la piste courante avec le décalage choisi (rawVttRef = texte
  // original : changer le décalage régénère la piste sans re-télécharger).
  const rawVttRef = useRef<string | null>(null)
  const activeSubObjRef = useRef<SubtitleTrack | null>(null)
  const [subPrefs, setSubPrefsState] = useState<SubPrefs>(getSubPrefs)
  useEffect(() => initSubPrefs(), [])

  // Désactive TOUTES les pistes de sous-titres — y compris celles natives
  // des flux HLS, sinon doublon à l'écran (piste embarquée + piste ajoutée).
  const disableAllTextTracks = (v: HTMLVideoElement) => {
    for (const t of Array.from(v.textTracks)) t.mode = 'disabled'
  }

  // Certaines sources embarquent les mêmes cues 2-3 fois (doublons de blocs).
  // On supprime les blocs strictement identiques (timing + texte) avant rendu.
  const dedupeVttBlocks = (vtt: string): string => {
    const seen = new Set<string>()
    return vtt
      .split(/\n\n+/)
      .filter((b) => {
        const key = b.replace(/\r/g, '').replace(/\s+/g, ' ').trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .join('\n\n')
  }

  const applySubTrack = (label: string, lang: string) => {
    const v = videoRef.current
    const raw = rawVttRef.current
    if (!v || !raw) return
    v.querySelectorAll('track[data-nova]').forEach((t) => t.remove())
    disableAllTextTracks(v)
    const hls = hlsRef.current
    if (hls) {
      hls.subtitleDisplay = false
      hls.subtitleTrack = -1
    }
    if (trackUrlRef.current) URL.revokeObjectURL(trackUrlRef.current)
    const blobUrl = URL.createObjectURL(new Blob([dedupeVttBlocks(shiftVtt(raw, subPrefs.delay + tcOffsetRef.current))], { type: 'text/vtt' }))
    trackUrlRef.current = blobUrl
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.label = label
    track.srclang = lang
    track.src = blobUrl
    track.default = true
    track.dataset.nova = '1'
    v.appendChild(track)
    track.track.mode = 'showing'
  }

  const subPrefsRef = useRef<SubPrefs>(subPrefs)
  subPrefsRef.current = subPrefs
  const updateSubPrefs = (patch: Partial<SubPrefs>) => {
    const next = setSubPrefs(patch)
    setSubPrefsState(next)
    // Décalage modifié → régénère immédiatement la piste active
    if (patch.delay !== undefined && activeSubObjRef.current) {
      applySubTrack(activeSubObjRef.current.label, activeSubObjRef.current.lang)
    }
  }

  // Préfixe « os: » = lien OpenSubtitles gzippé (source intégrée) : on
  // décompresse côté client et on convertit SRT → VTT si besoin.
  const srtToVttText = (txt: string): string => {
    if (txt.trimStart().startsWith('WEBVTT')) return txt
    const body = txt
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => (/^\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(l) ? l.replace(/,/g, '.') : l))
      .join('\n')
    return `WEBVTT\n\n${body}`
  }

  const fetchVttSub = async (sub: SubtitleTrack): Promise<string> => {
    if (sub.url.startsWith('osv2:')) {
      const text = await opensubsDownloadVtt(Number(sub.url.slice(5)))
      return text.trimStart().startsWith('WEBVTT') ? text : srtToVttText(text)
    }
    if (!sub.url.startsWith('os:')) return fetchVtt(sub.url)
    const res = await fetch(sub.url.slice(3), { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error('OpenSubtitles indisponible')
    const buf = await res.arrayBuffer()
    let text: string
    try {
      text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    } catch {
      text = new TextDecoder('utf-8').decode(buf)
    }
    return srtToVttText(text)
  }

  const selectSubtitle = async (sub: SubtitleTrack | null) => {
    const v = videoRef.current
    if (!v) return
    setSubError(null)
    v.querySelectorAll('track[data-nova]').forEach((t) => t.remove())
    if (trackUrlRef.current) { URL.revokeObjectURL(trackUrlRef.current); trackUrlRef.current = null }
    rawVttRef.current = null
    activeSubObjRef.current = null
    if (!sub) {
      const vv = videoRef.current
      if (vv) disableAllTextTracks(vv)
      setActiveSub(null)
      return
    }
    try {
      let vtt = await fetchVttSub(sub)
      let chosen = sub
      // Piste annoncee FR mais contenu anglais : on tente un vrai repli FR
      // (OpenSubtitles, langue verifiee cote serveur) avant d afficher.
      if (sub.lang.toLowerCase().startsWith('fr') && !looksFrench(vtt)) {
        const fb = allSubs.find((s) =>
          s.id !== sub.id && s.lang.toLowerCase().startsWith('fr') &&
          (s.url.startsWith('osv2:') || s.url.startsWith('os:')),
        )
        let replaced = false
        if (fb) {
          try {
            const fbVtt = await fetchVttSub(fb)
            if (looksFrench(fbVtt)) { vtt = fbVtt; chosen = fb; replaced = true }
          } catch { /* repli indisponible : on garde la piste d origine */ }
        }
        setSubError(replaced
          ? 'La piste FR de la source etait en anglais : remplacee par OpenSubtitles.'
          : 'Attention : piste etiquettee Francais mais contenu anglais.')
      }
      rawVttRef.current = vtt
      activeSubObjRef.current = chosen
      applySubTrack(chosen.label, chosen.lang)
      setActiveSub(chosen.id)
    } catch {
      setSubError('Sous-titres inaccessibles (CORS).')
    }
  }

  // Sélection manuelle : désactive l'auto-FR pour CETTE lecture.
  const userTouchedSubsRef = useRef(false)
  const pickSubtitle = (sub: SubtitleTrack | null) => {
    userTouchedSubsRef.current = true
    void selectSubtitle(sub)
  }

  // Sous-titres FR AUTO : dès qu'une piste française existe, on l'active
  // sans rien demander (désactivable dans le menu, ou en choisissant une
  // autre piste soi-même pour cette lecture).
  const SUB_AUTO_KEY = 'novastream:sub-auto'
  const [subAuto, setSubAuto] = useState(() => readJSON<boolean>(SUB_AUTO_KEY, true))
  const autoSubDoneRef = useRef<string | null>(null)
  useEffect(() => {
    userTouchedSubsRef.current = false
    autoSubDoneRef.current = null
  }, [req.meta.id])
  useEffect(() => {
    if (!subAuto || autoSubDoneRef.current === req.meta.id) return
    if (activeSub || userTouchedSubsRef.current) return
    const fr = allSubs.find((s) => s.lang.toLowerCase().startsWith('fr'))
    if (!fr) return
    autoSubDoneRef.current = req.meta.id
    const t = setTimeout(() => {
      if (!userTouchedSubsRef.current) void selectSubtitle(fr)
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.meta.id, subAuto, activeSub, allSubs.length])
  const toggleSubAuto = () => {
    const next = !subAuto
    setSubAuto(next)
    writeJSON(SUB_AUTO_KEY, next)
    if (!next && activeSub && !userTouchedSubsRef.current) void selectSubtitle(null)
  }

  return {
    allSubs, groupedSubs, activeSub, subError, subPrefs, subAuto,
    pickSubtitle, toggleSubAuto, updateSubPrefs, applySubTrack, activeSubObjRef,
  }
}
