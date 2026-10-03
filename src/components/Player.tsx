import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  X, Play, Pause, Volume2, VolumeX, Maximize, Users, ArrowDownToLine, AlertTriangle,
  PictureInPicture2, Captions, Gauge, Moon, SkipBack, SkipForward, Rewind, FastForward, Cloud, Cast, Airplay,
  Minimize2, Maximize2, Plus, Minus, RotateCcw, RotateCw, SunMedium, Expand, Shrink, Languages,
} from 'lucide-react'
import type { PlayRequest } from '@/lib/nav'
import { traktMarkWatched } from '@/lib/trakt'
import { simklMarkWatched } from '@/lib/simkl'
import { opensubsDownloadVtt } from '@/lib/opensubs'
import { useNav } from '@/lib/nav'
import { streamKind, formatBytes, isDebridStream, isDebridDown, setDebridDown, streamAudio, RISKY_AUDIO_RE, SAFE_AUDIO_RE } from '@/lib/addons'
import { useProgress } from '@/lib/library'
import { readJSON, writeJSON } from '@/lib/store'
import { getSubPrefs, initSubPrefs, setSubPrefs, shiftVtt, type SubPrefs } from '@/lib/subprefs'
import {
  createRoom, enterRoomAsGuest, fetchRoom, getActiveRoom, guestHeartbeat, joinRoomAndPlay,
  leaveRoom, normalizeRoomCode, pushRoomState, roomPosition, setRoomFollow, subscribeRoom,
  type ActiveRoom, type RoomMedia,
} from '@/lib/room'
import { toast } from '@/lib/toast'
import type { SubtitleTrack } from '@/types'

/**
 * Compteur d'échecs P2P serveur (persistant par appareil). Certains réseaux
 * bloquent totalement le P2P sortant : après 2 échecs d'affilée, on démarre
 * directement sur le cloud au lieu de faire attendre 45 s à chaque film.
 * Remis à zéro dès qu'une lecture P2P démarre réellement.
 */
const P2P_FAILS_KEY = 'novastream:p2p-fails'
const p2pFails = () => readJSON<number>(P2P_FAILS_KEY, 0)
const noteP2PFail = () => writeJSON(P2P_FAILS_KEY, p2pFails() + 1)
const noteP2POk = () => { if (p2pFails() !== 0) writeJSON(P2P_FAILS_KEY, 0) }

/** Évite de répéter le toast « clé debrid refusée » à chaque source essayée. */
let debridWarned = false

interface TorrentStats {
  peers: number
  downSpeed: number
  progress: number
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** Codes langue → libellé français lisible pour le menu audio. */
const AUDIO_LANG_FR: Record<string, string> = {
  fre: 'Français', fra: 'Français', fr: 'Français', vf: 'Français (VF)',
  eng: 'Anglais', en: 'Anglais', vo: 'Version originale',
  spa: 'Espagnol', es: 'Espagnol', ger: 'Allemand', deu: 'Allemand', de: 'Allemand',
  ita: 'Italien', it: 'Italien', por: 'Portugais', pt: 'Portugais',
  jpn: 'Japonais', ja: 'Japonais', kor: 'Coréen', ko: 'Coréen',
  ara: 'Arabe', ar: 'Arabe', rus: 'Russe', ru: 'Russe',
  mul: 'Multi', und: 'Piste', original: 'Version originale',
}

/** Transforme un nom de piste brut (« fre », « FR 5.1 »…) en libellé propre. */
function audioLabel(raw: string, index: number): string {
  const key = raw.trim().toLowerCase()
  const base = AUDIO_LANG_FR[key]
  if (base) return base
  // « fr 5.1 », « eng-aac »… : on tente le préfixe
  const prefix = Object.keys(AUDIO_LANG_FR).find((k) => key.startsWith(k) && key !== k)
  if (prefix) {
    const suffix = key.slice(prefix.length).replace(/^[-_ ]+/, '')
    return suffix ? `${AUDIO_LANG_FR[prefix]} (${suffix.toUpperCase()})` : AUDIO_LANG_FR[prefix]
  }
  return raw.trim() || `Piste ${index + 1}`
}

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

/** Convertit un sous-titre SRT/VTT distant en texte VTT. */
async function fetchVtt(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!res.ok) throw new Error('subtitles fetch failed')
  const text = await res.text()
  return text.startsWith('WEBVTT')
    ? text
    : 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

export default function Player({ req, onClose, minimized, onToggleMinimize }: {
  req: PlayRequest
  onClose: () => void
  minimized: boolean
  onToggleMinimize: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const torrentRef = useRef<{ destroy: () => void } | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const trackUrlRef = useRef<string | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  // Volume façon Netflix : POSITION (0→1) ≠ PUISSANCE (courbe x² perceptuelle)
  const uiVolRef = useRef(1)
  const [volPct, setVolPct] = useState(100)
  const setVol = useCallback((x: number) => {
    uiVolRef.current = x
    setVolPct(Math.round(x * 100))
    const v = videoRef.current
    if (v) { v.volume = Math.pow(x, 2); if (x > 0) { v.muted = false; setMuted(false) } }
  }, [])
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<TorrentStats | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [subMenu, setSubMenu] = useState(false)
  const [activeSub, setActiveSub] = useState<string | null>(null)
  // Pistes audio multiples (HLS multi-langues, ou pistes natives exposées
  // par le navigateur) : liste + piste active + menu.
  const [audioTracks, setAudioTracks] = useState<{ id: number; label: string }[]>([])
  const [activeAudio, setActiveAudio] = useState(0)
  const [audioMenu, setAudioMenu] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)
  // --- Gestes mobiles (double-tap ±10 s, balayages volume / luminosité) ---
    // « Passer l'intro » façon Netflix : les sources ne fournissent pas de
  // repère d'intro — raccourci temporel de 90 s pendant le début de l'épisode.
  const [pos, setPos] = useState(0)
  const introSkippedFor = useRef<string | null>(null)
  useEffect(() => {
    const iv = setInterval(() => {
      const v = videoRef.current
      if (v && v.duration > 0) setPos(v.currentTime)
    }, 2500)
    return () => clearInterval(iv)
  }, [])

  const skipIntro = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.min(
      v.currentTime + 90,
      Number.isFinite(v.duration) ? v.duration - 5 : v.currentTime + 90,
    )
    introSkippedFor.current = req.meta.id
    showHud('seek-right')
  }

const [sleepMin, setSleepMin] = useState<number | null>(null)
  // Réencode serveur 1080p H264 : répare l'image H265 (noire sur téléphone) + économise les données
  const [fix1080, setFix1080] = useState(false)

  // Minuteur sommeil : décompte chaque minute, pause à zéro.
  useEffect(() => {
    if (sleepMin === null) return
    const iv = setInterval(() => {
      setSleepMin((m) => {
        if (m === null) return null
        if (m <= 1) {
          const v = videoRef.current
          if (v) { v.pause(); showHud('pause') }
          return null
        }
        return m - 1
      })
    }, 60_000)
    return () => clearInterval(iv)
  }, [sleepMin])

  const cycleSleep = () => {
    setSleepMin((m) => (m === null ? 30 : m >= 90 ? null : m + 30))
  }

const [hud, setHud] = useState<{ kind: 'seek-left' | 'seek-right' | 'volume' | 'brightness' | 'play' | 'pause'; value: number; id: number } | null>(null)
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const brightnessRef = useRef(readJSON<number>('novastream:brightness', 1))
  const [brightness, setBrightness] = useState(brightnessRef.current)
  // Mode « Remplir » : recadre la vidéo pour occuper tout l'écran (crop des
  // bandes noires) — préférence persistée. Par défaut : « Ajuster » (fidèle).
  const [zoom, setZoom] = useState(() => readJSON<boolean>('novastream:zoom', false))
  const lastTouchEnd = useRef(0)
  const controlsVisibleRef = useRef(true)
  const menuOpenRef = useRef(false) // menu ouvert → contrôles épinglés
  const playingRef = useRef(false) // vidéo en pause → contrôles épinglés
  const shownAtRef = useRef(0) // instant d'apparition des contrôles (anti-tap accidentel)
  // Mode « transcodage audio » (DERNIER RECOURS anti film-muet) : le serveur
  // copie la vidéo telle quelle et ré-encode l'audio AC3/DTS en AAC. Le
  // <video> lit alors un flux qui DÉMARRE à tcOffset (seek = nouveau flux) —
  // tout le code de temps utilise le temps VIRTUEL = tcOffset + currentTime.
  const [, setTcActive] = useState(false)
  const tcOffsetRef = useRef(0)
  const tcFinalUrlRef = useRef<string | null>(null)
  // Auto-retry : les torrents frais mettent 1-3 min à être cachés chez
  // Debrid (« downloaded to Debrid »). On relance la MÊME source après 50 s
  // avant de sauter à la suivante.
  const debridRetryRef = useRef<string | null>(null)
  const tcDurationRef = useRef(0)
  const tcActiveRef = useRef(false)
  const showHud = useCallback((kind: 'seek-left' | 'seek-right' | 'volume' | 'brightness' | 'play' | 'pause' | 'subdelay', value = 0) => {
    setHud({ kind, value, id: Date.now() })
    clearTimeout(hudTimer.current ?? undefined)
    hudTimer.current = setTimeout(() => setHud(null), 650)
  }, [])
  // Chaîne de fallback torrent : serveur → navigateur → webtor (cloud)
  // Si le P2P serveur a échoué 2+ fois d'affilée sur CET appareil, on démarre
  // directement sur le cloud (évite 45 s d'attente avant chaque film).
  const [torrentMode, setTorrentMode] = useState<'server' | 'browser' | 'webtor'>(
    () => (p2pFails() >= 2 ? 'webtor' : 'server'),
  )
  // Ref miroir pour que les timers lancés dans un mode lisent le mode ACTUEL
  const torrentModeRef = useRef(torrentMode)
  useEffect(() => { torrentModeRef.current = torrentMode }, [torrentMode])
  const [proxied, setProxied] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // --- Chromecast / TV (Remote Playback API — natif Chrome & Android) ---
  type RemotePlaybackLike = {
    watchAvailability: (cb: (available: boolean) => void) => Promise<number>
    cancelWatchAvailability: (id: number) => void
    prompt: () => Promise<void>
    addEventListener?: (type: string, cb: () => void) => void
    removeEventListener?: (type: string, cb: () => void) => void
  }
  const remoteOf = (v: HTMLVideoElement | null): RemotePlaybackLike | null =>
    (v as unknown as { remote?: RemotePlaybackLike } | null)?.remote ?? null
  const [castState, setCastState] = useState<'unavailable' | 'available' | 'connecting' | 'connected'>('unavailable')
  // Google Cast framework (Chrome Android + ordinateur) et AirPlay (Apple) :
  // deux voies natives pour envoyer la lecture sur la TV.
  const [castFw, setCastFw] = useState(false)
  const [airplay, setAirplay] = useState(false)
  // Télécommande du récepteur Cast : play/pause/seek pilotent la TV.
  const castPlayerRef = useRef<{ isPaused: boolean; currentTime: number; duration: number } | null>(null)
  const castCtlRef = useRef<{ playOrPause(): void; seek(): void } | null>(null)

  /** Magnet enrichi avec les trackers de la source + trackers publics. */
  const buildMagnet = useCallback(() => {
    const trackers = [
      ...(req.stream.sources ?? [])
        .filter((s) => s.startsWith('tracker:'))
        .map((s) => s.slice('tracker:'.length)),
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.tracker.cl:1337/announce',
      'udp://tracker.openbittorrent.com:6969/announce',
      'wss://tracker.openwebtorrent.com',
    ]
    return (
      `magnet:?xt=urn:btih:${req.stream.infoHash}&dn=${encodeURIComponent(req.meta.name)}` +
      trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('')
    )
  }, [req.stream, req.meta.name])

  const kind = streamKind(req.stream)
  const { save } = useProgress()
  const lastSaved = useRef(0)
  const scrobbledRef = useRef(false)

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

  const wakeControls = useCallback(() => {
    setControlsVisible((v) => {
      if (!v) shownAtRef.current = Date.now() // les contrôles viennent d'apparaître
      return true
    })
    clearTimeout(hideTimer.current)
    // Sur tactile, on laisse LARGEMENT le temps de régler : 10 s. Et tant
    // qu'un menu est ouvert (sous-titres, audio, salon…) ou que la vidéo est
    // en pause, les contrôles restent ÉPINGLÉS — on repousse le masquage au
    // lieu de tout faire disparaître pendant qu'on règle.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    hideTimer.current = setTimeout(() => {
      if (menuOpenRef.current || !playingRef.current) {
        wakeControls()
        return
      }
      setControlsVisible(false)
    }, coarse ? 10000 : 3500)
    // Si le navigateur a suspendu le contexte audio (arrière-plan, appel,
    // autre app qui joue du son…), le son est coupé → chaque toucher tente
    // de le relancer.
    const ctx = audioCtxRef.current
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ })
  }, [])

  useEffect(() => { playingRef.current = playing }, [playing])

  useEffect(() => { controlsVisibleRef.current = controlsVisible }, [controlsVisible])

  // --- Gestes tactiles (mobile) : double-tap ±10 s, balayage vertical droit = volume,
  // gauche = luminosité simulée, tap simple = afficher/masquer les contrôles.
  // Listeners natifs en { passive: false } : React rend les handlers tactiles
  // passifs par défaut, ce qui empêcherait preventDefault() pendant le balayage.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || minimized) return
    let sx = 0
    let sy = 0
    let mode: 'volume' | 'brightness' | null = null
    let ignore = false
    let startVol = 1
    let startBright = 1
    let lastTapT = 0
    let lastTapX = -999
    let tapTimer: ReturnType<typeof setTimeout> | null = null

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { ignore = true; return }
      // Les gestes ne s'appliquent pas quand le doigt part d'un contrôle.
      ignore = !!(e.target as HTMLElement | null)?.closest?.('button, a, input, select, [data-no-gesture]')
      if (ignore) return
      const t = e.touches[0]
      sx = t.clientX; sy = t.clientY; mode = null
      startVol = uiVolRef.current
      startBright = brightnessRef.current
    }
    const onMove = (e: TouchEvent) => {
      if (ignore || e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - sx
      const dy = t.clientY - sy
      if (!mode) {
        if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          mode = sx > window.innerWidth / 2 ? 'volume' : 'brightness'
        } else return
      }
      e.preventDefault()
      const base = mode === 'volume' ? startVol : startBright
      const next = Math.min(1, Math.max(mode === 'brightness' ? 0.15 : 0, base - dy / (window.innerHeight * 0.6)))
      if (mode === 'volume') {
        setVol(next)
        showHud('volume', next)
      } else {
        brightnessRef.current = next
        setBrightness(next)
        showHud('brightness', next)
      }
    }
    const onEnd = (e: TouchEvent) => {
      lastTouchEnd.current = Date.now()
      if (ignore) { ignore = false; return }
      if (mode) { writeJSON('novastream:brightness', brightnessRef.current); mode = null; return }
      const t = e.changedTouches[0]
      if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) return
      const now = Date.now()
      const dbl = now - lastTapT < 300 && Math.abs(t.clientX - lastTapX) < 70
      if (dbl) {
        if (tapTimer) clearTimeout(tapTimer)
        lastTapT = 0
        const v = videoRef.current
        if (v && (v.duration || tcActiveRef.current)) {
          const right = t.clientX > window.innerWidth / 2
          const delta = right ? 10 : -10
          if (tcActiveRef.current) {
            // Flux transcodé : seek virtuel → nouveau flux ffmpeg à la cible.
            const cur = tcOffsetRef.current + v.currentTime
            void startTranscode(Math.max(0, cur + delta))
          } else {
            v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta))
          }
          showHud(right ? 'seek-right' : 'seek-left')
        }
        wakeControls()
      } else {
        lastTapT = now; lastTapX = t.clientX
        tapTimer = setTimeout(() => {
          // TAP SIMPLE = LECTURE/PAUSE (façon Netflix) : on bascule la
          // lecture et on affiche les contrôles (ils se masquent seuls).
          const v = videoRef.current
          if (v && (v.duration || tcActiveRef.current)) {
            if (v.paused) { void v.play().catch(() => {}); showHud('play') }
            else { v.pause(); showHud('pause') }
          }
          wakeControls()
        }, 290)
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      if (tapTimer) clearTimeout(tapTimer)
    }
  }, [minimized, wakeControls, showHud])

  const saveProgress = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    // Mode transcodage : currentTime est RELATIF au fragment ffmpeg et
    // v.duration vaut Infinity — on utilise le temps virtuel + la durée ffprobe.
    const tc = tcActiveRef.current
    const dur = tc ? tcDurationRef.current : v.duration
    if (!dur || !Number.isFinite(dur)) return
    if (Date.now() - lastSaved.current < 4000) return
    lastSaved.current = Date.now()
    save({
      id: req.meta.id,
      baseId: req.meta.baseId,
      type: req.meta.type,
      name: req.meta.name,
      poster: req.meta.poster,
      background: req.meta.background,
      episodeLabel: req.episodeLabel,
      time: tc ? tcOffsetRef.current + v.currentTime : v.currentTime,
      duration: dur,
      stream: req.stream,
    })
    // Scrobble Trakt : marque le titre comme vu à 80 % de lecture
    // (une fois par visionnage ; se réarme si on rembobine sous 50 %).
    const watchedRatio = (tc ? tcOffsetRef.current + v.currentTime : v.currentTime) / dur
    if (watchedRatio < 0.5) scrobbledRef.current = false
    else if (watchedRatio >= 0.8 && !scrobbledRef.current) {
      scrobbledRef.current = true
      traktMarkWatched(req.meta, req.episodeLabel)
      simklMarkWatched(req.meta, req.episodeLabel)
    }
  }, [req, save])

  // Détecteur de piste audio non décodée (AC3/E-AC3/DTS) : Chrome lit la
  // vidéo H.264 mais JETTE la piste audio → image SANS SON.
  // Signal principal : webkitAudioDecodedByteCount (Chrome/Android/Safari) —
  // si le navigateur ne décode AUCUN octet audio pendant la lecture, la piste
  // est illisible → bascule cloud (qui transcode l'audio en AAC). Ce signal
  // ne se trompe jamais sur les intros silencieuses (une piste AAC
  // silencieuse est quand même décodée, elle). Repli : mesure RMS pour Firefox.
  const audioCheckedRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  // Une coupure réseau en pleine lecture ne doit PAS envoyer au cloud :
  // on tente UNE reprise transparente au timecode courant d'abord.
  const errorRetriedRef = useRef(false)
  // Refs miroirs pour le détecteur d'audio (défini avant tryNextSource) :
  // il doit connaître le type de source et pouvoir déclencher le repli.
  const kindRef = useRef(kind)
  kindRef.current = kind
  const tryNextSourceRef = useRef<() => boolean>(() => false)

  const runSilenceDetector = useCallback(() => {
    const v = videoRef.current
    if (!v || audioCheckedRef.current) return
    // Le mode torrent ne concerne que les sources P2P ; pour un lien HTTP
    // (debrid, direct) il est sans rapport — ne pas laisser un mode 'webtor'
    // hérité bloquer la détection.
    if (kindRef.current === 'torrent' && torrentModeRef.current !== 'server') return
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      // Contexte RÉUTILISÉ s'il existe : en créer un nouveau à chaque essai
      // on épuisait la limite de Chrome (~6 contextes) et le détecteur
      // mourait silencieusement après quelques lectures.
      const ctx = audioCtxRef.current ?? new Ctx()
      audioCtxRef.current = ctx
      void ctx.resume().then(() => {
        // Pas de geste utilisateur → contexte suspendu → on réessaiera au
        // prochain 'playing' (créer le routage maintenant couperait le son
        // des sources saines).
        if (ctx.state !== 'running') return
        // createMediaElementSource ne peut être appelé QU'UNE FOIS par
        // élément : le routage est créé une seule fois, puis réutilisé.
        if (!analyserRef.current) {
          const srcNode = ctx.createMediaElementSource(v)
          const gain = ctx.createGain()
          gain.gain.value = v.muted ? 0 : v.volume
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          srcNode.connect(gain)
          gain.connect(ctx.destination) // le son passe normalement
          srcNode.connect(analyser)     // tap de mesure
          // Une fois routée, la vidéo ignore volume/muted natifs → on les
          // répercute sur le gain pour que les contrôles continuent de marcher.
          v.addEventListener('volumechange', () => {
            gain.gain.value = v.muted ? 0 : v.volume
          })
          // Chrome SUSPEND le contexte quand l'app passe en arrière-plan ou
          // qu'une autre app prend l'audio → le son est coupé au retour.
          // C'était la cause du « son qui marche une fois sur deux » : on
          // relance le contexte dès que l'état change (et à chaque toucher).
          ctx.onstatechange = () => {
            if (ctx.state === 'suspended' && !v.paused) void ctx.resume().catch(() => { /* ignore */ })
          }
          analyserRef.current = analyser
        }
        const analyser = analyserRef.current
        const decodedBytes = () =>
          (v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount
        const startDecoded = decodedBytes()
        const buf = new Float32Array(analyser.fftSize)
        let maxRms = 0
        const startedAt = v.currentTime
        const iv = setInterval(() => {
          analyser.getFloatTimeDomainData(buf)
          let s = 0
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
          maxRms = Math.max(maxRms, Math.sqrt(s / buf.length))
        }, 250)
        setTimeout(() => {
          clearInterval(iv)
          // Le cloud Webtor gère son propre transcodage : pas de verdict.
          if (kindRef.current === 'torrent' && torrentModeRef.current === 'webtor') { audioCheckedRef.current = true; return }
          // La lecture n'a pas vraiment avancé (pause, attente de données) :
          // pas de verdict — on réessaiera au prochain 'playing'.
          const played = v.currentTime - startedAt > 6 && !v.paused
          if (!played) return
          audioCheckedRef.current = true // verdict définitif pour cette source
          if (v.muted) return
          const d0 = startDecoded
          const d1 = decodedBytes()
          const silent = d0 != null && d1 != null
            ? d1 - d0 < 64         // Chrome : aucun octet audio décodé
            : maxRms < 0.00005     // Firefox : silence mesuré
          if (silent) {
            if (kindRef.current === 'torrent' && torrentModeRef.current === 'server') {
              // Torrent servi par le backend : le cloud peut transcoder la
              // piste AC3/DTS → on tente Webtor avant d'abandonner.
              toast('Piste audio incompatible détectée (AC3/DTS) → bascule sur le lecteur cloud')
              setTorrentMode('webtor')
            } else {
              // Lien direct OU torrent navigateur sans son (AC3/DTS) :
              // source suivante, sinon TRANSCODAGE serveur — jamais de film
              // muet quand le lien direct est connu.
              toast('Piste audio incompatible (AC3/DTS) → essai de la source suivante…')
              if (!tryNextSourceRef.current()) {
                if (tcFinalUrlRef.current) {
                  toast('🎧 Conversion audio en direct (AAC)…')
                  tcDurationRef.current = 0
                  void startTranscode(v.currentTime)
                } else {
                  setError('Son indécodable par ce navigateur (AC3/DTS), et aucune autre source n\'a répondu. Essaie une autre source.')
                }
              }
            }
          }
        }, 10000)
      }).catch(() => { /* ignore */ })
    } catch { /* ignore */ }
  }, [])

  /**
   * Détecteur LÉGER anti film-muet pour les liens DIRECTS cross-origin.
   * Le détecteur RMS (Web Audio) est impossible sans CORS — le routage
   * réduirait le son au silence. Mais webkitAudioDecodedByteCount est une
   * STATISTIQUE média : aucune mesure de signal nécessaire, elle fonctionne
   * cross-origin. Si aucun octet audio n'est décodé après 10 s de lecture
   * réelle → piste AC3/DTS non déclarée → source suivante, ou transcodage
   * serveur en dernier recours. Chrome/Android/Safari uniquement.
   */
  const runByteCountDetector = useCallback(() => {
    const v = videoRef.current
    if (!v || audioCheckedRef.current) return
    const probe = v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }
    const d0 = probe.webkitAudioDecodedByteCount
    if (d0 == null) return // navigateur sans le compteur → pas de verdict possible
    const t0 = v.currentTime
    setTimeout(() => {
      if (audioCheckedRef.current) return
      if (v.currentTime - t0 < 6 || v.paused) return // pas assez joué : prochain 'playing'
      audioCheckedRef.current = true
      if (v.muted) return
      const d1 = probe.webkitAudioDecodedByteCount
      if (d1 != null && d1 - d0 < 64) {
        toast('Piste audio incompatible (AC3/DTS) → essai de la source suivante…')
        if (!tryNextSourceRef.current()) {
          // AUCUNE autre source : transcodage audio de CELLE-CI plutôt qu'un
          // film muet — la vidéo est copiée, seul l'audio est ré-encodé AAC.
          if (tcFinalUrlRef.current) {
            toast('🎧 Conversion audio en direct (AAC)…')
            tcDurationRef.current = 0
            void startTranscode(v.currentTime)
          } else {
            setError('Son indécodable par ce navigateur (AC3/DTS), et aucune autre source n\'a répondu. Essaie une autre source.')
          }
        }
      }
    }, 10000)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false

    async function setup() {
      try {
        if (kind === 'http' && req.stream.url) {
          // Liens debrid (/resolve/ Torrentio, CDN premium…) : lecture DIRECTE
          // navigateur → CDN. Crucial : AllDebrid & co bannissent les comptes
          // dont les téléchargements viennent d'IPs de serveurs — faire
          // transiter le flux par notre proxy ferait flagger le compte. Le
          // navigateur de l'utilisateur a une IP résidentielle = usage normal.
          let playUrl = req.stream.url
          if (isDebridStream(req.stream)) {
            // Pré-résolution côté serveur SANS toucher au CDN (redirection
            // manuelle : une requête à Torrentio, lecture du Location, stop).
            // Détecte les clés refusées (failed_access) et les placeholders
            // « downloading » (fichier pas encore en cache) AVANT la lecture.
            // Bonus : on joue l'URL finale (CDN) directement, sans
            // re-résolution à chaque seek.
            try {
              // Pré-vérification via l'API serveur. EN ABSENCE D'API
              // (hébergement statique : 404, ou serveur éteint), on NE
              // considère PAS la source comme morte — on joue directement
              // et c'est le navigateur qui tranchera si le lien est invalide.
              let j: { finalUrl?: string } = {}
              // NE JAMAIS résoudre côté serveur : le lien débrid est IP-locked
              // sur l'IP qui résout. La résolution navigateur garde le lien
              // valide pour ce téléphone (sinon : écran "Wrong IP").
              const apiOk = false
              if (cancelled) return
              if (apiOk) {
              // Torrentio n'a pas réussi à ouvrir le fichier chez le
              // debrideur (failed_opening) : source morte — SUIVANTE.
              // (Distinct de failed_access = clé refusée, traité juste après :
              // ici la clé n'est PAS en cause, on ne désactive pas le debrid.)
              if (j.finalUrl && /failed_opening/i.test(j.finalUrl)) {
                if (!tryNextSource()) {
                  setError('Cette source est indisponible chez le debrideur et aucune autre n\'a répondu. Réessaie plus tard.')
                }
                return
              }
              if (!j.finalUrl || /failed_access/i.test(j.finalUrl)) {
                setDebridDown(true)
                if (!debridWarned) {
                  debridWarned = true
                  toast('Clé debrid refusée par le service (abonnement expiré ?) — sources gratuites utilisées. Vérifie ta clé dans Addons.')
                }
                if (!tryNextSource()) {
                  setError('Ta clé debrid est refusée par le service. Vérifie ton abonnement, puis reconnecte-la dans l\'onglet Addons.')
                }
                return
              }
              // Torrent PAS ENCORE dans le cache du debrideur : Torrentio
              // sert alors une vidéo placeholder « downloading… » (le fichier
              // se télécharge sur le cloud, ça peut prendre des minutes).
              // On enchaîne immédiatement sur une source DÉJÀ en cache.
              if (/\/videos?\/downloading/i.test(j.finalUrl)) {
                toast('Pas encore dans le cache premium — essai de la source suivante…')
                if (!tryNextSource()) {
                  setError('Aucune source premium en cache pour l\'instant. Le fichier se télécharge sur ton cloud : réessaie dans quelques minutes, ou choisis une source gratuite.')
                }
                return
              }
              } // fin if (apiOk) — sans API, on saute toute la pré-vérification
              const finalUrl: string | null = apiOk ? (j.finalUrl ?? null) : null
              // SON : en lecture directe cross-origin, le détecteur Web Audio
              // est impossible. Les pistes AC3/E-AC3/DTS sont MUETTES dans
              // Chrome/Firefox — on sonde donc les en-têtes du fichier
              // pour connaître le codec AVANT de lancer. Si le titre déclare
              // déjà un codec (sûr ou risqué — regex partagée, toutes
              // variantes : DD 5.1, DDP 5.1, DD+…), la sonde est inutile.
              const titleProbe = `${req.stream.name ?? ''} ${req.stream.title ?? ''} ${req.stream.description ?? ''}`
              const declaredSafe = SAFE_AUDIO_RE.test(titleProbe)
              const declaredRisky = !req.stream.audioFix && RISKY_AUDIO_RE.test(titleProbe)
              let risky = declaredRisky
              if (finalUrl && !declaredSafe && !declaredRisky) {
                try {
                  const ap = await fetch(`/api/stream/audio-probe?url=${encodeURIComponent(finalUrl)}`)
                  const pj = (await ap.json()) as { audio?: string }
                  risky = pj.audio === 'risky'
                } catch { /* sonde impossible : on tente quand même */ }
              }
              if (cancelled) return
              if (risky) {
                if (tryNextSource()) {
                  toast('Piste audio incompatible (AC3/DTS) → essai de la source suivante…')
                  return
                }
                // AUCUNE alternative : au lieu de jouer la vidéo EN SILENCE,
                // on bascule sur le transcodage serveur (vidéo copiée bit à
                // bit, seul l'audio est ré-encodé en AAC) — son garanti.
                toast('🎧 Piste AC3/DTS incompatible → conversion audio en direct…')
                tcFinalUrlRef.current = finalUrl
                tcDurationRef.current = 0
                await startTranscode(req.startAt ?? 0)
                return
              }
              if (j.finalUrl) playUrl = j.finalUrl
            } catch { /* vérification impossible (réseau) : on tente quand même */ }
          }
          const forceProxy = proxied // premium : DIRECT navigateur→CDN par défaut ; proxy = repli non-debrid uniquement
          const url = forceProxy ? `/api/stream/proxy?url=${encodeURIComponent(playUrl)}` : playUrl
          if (/\.m3u8(\?|$)/i.test(req.stream.url) && Hls.isSupported() && !forceProxy) {
            const hls = new Hls({ maxBufferLength: 60 })
            hlsRef.current = hls
            hls.loadSource(url)
            hls.attachMedia(video!)
            // Flux multi-langues (VF / VOSTFR / VO…) : le manifeste déclare
            // les pistes audio → on les expose dans le menu du lecteur.
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, d) => {
              setAudioTracks(
                d.audioTracks.map((t, i) => ({
                  id: i,
                  // lang en priorité (« fr » → « Français ») : les name sont
                  // souvent techniques (« audio_1 ») et peu parlants.
                  label: audioLabel(t.lang || t.name || '', i),
                })),
              )
              setActiveAudio(Math.max(0, hls.audioTrack))
            })
            hls.on(Hls.Events.ERROR, (_e, d) => {
              if (d.fatal) setProxied(true) // bascule sur le proxy serveur
            })
          } else {
            video!.src = url
            video!.load() // demarrage explicite : sans load(), preload empeche la requete
            // Mémorise l'URL directe : si le son s'avère indécodable (AC3/DTS
            // non déclaré), le transcodage serveur repartira de CE lien.
            tcFinalUrlRef.current = playUrl
            video!.load()
            tryAutoplay(video!)
            const wdogSrc = url
            setTimeout(() => {
              const vv = videoRef.current
              if (!vv || vv.src !== wdogSrc) return
              if (vv.readyState < 2 && vv.currentTime < 0.5) {
                if (!tryNextSourceRef.current()) setError("Cette source ne repond pas apres 20 s. Essaie une autre source ci-dessous.")
              }
            }, 90000)
            // Détecteur anti film-muet cross-origin (compteur d'octets audio
            // décodés) : actif pour TOUTE lecture directe, pas seulement le
            // proxy. Un film ne doit JAMAIS rester muet sans réaction.
            video!.addEventListener('playing', runByteCountDetector)
            runByteCountDetector()
            // Liens servis par NOTRE proxy (debrid /resolve/, secours CORS) :
            // same-origin → la mesure Web Audio est possible. Les grosses
            // releases premium sont souvent en AC3/DTS (silence dans Chrome)
            // → détecteur actif, repli sur la source suivante si muet.
            if (forceProxy) {
              video!.addEventListener('playing', runSilenceDetector)
              runSilenceDetector()
            }
            // Pistes audio natives (Safari / MKV multi-pistes dans les
            // navigateurs compatibles) : on les liste si disponibles.
            const v0 = video! as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { label?: string; language?: string } } }
            video!.addEventListener('loadedmetadata', () => {
              const at = v0.audioTracks
              if (at && at.length > 1) {
                setAudioTracks(
                  Array.from({ length: at.length }, (_, i) => ({
                    id: i,
                    label: audioLabel(at[i].label || at[i].language || '', i),
                  })),
                )
              }
            })
          }
        } else if (kind === 'torrent' && req.stream.infoHash && torrentMode === 'server') {
          // Mode serveur : le backend télécharge le torrent (pairs TCP/UDP)
          // et le sert en HTTP au lecteur.
          const ih = req.stream.infoHash
          const fileQ = req.stream.fileIdx != null ? `&fileIdx=${req.stream.fileIdx}` : ''
          // Trackers de la source : transmis au serveur pour un démarrage
          // bien plus rapide (sinon DHT seule = métadonnées très lentes).
          const trQ = (req.stream.sources ?? [])
            .filter((s) => s.startsWith('tracker:'))
            .map((s) => `&tr=${encodeURIComponent(s.slice('tracker:'.length))}`)
            .join('')
          const src = `/api/stream/torrent?infoHash=${ih}${fileQ}${trQ}`
          // 1. Warmup : démarre le torrent côté serveur — réponse immédiate,
          //    sans attendre les métadonnées (évite le timeout de passerelle).
          const probe = await fetch(`${src}&warm=1`).catch(() => null)
          if (!probe || !probe.ok) {
            // Pas de backend : Webtor (cloud) directement. WebTorrent navigateur
            // n'atteint que les rares pairs WebRTC — presque toujours un échec
            // précédé de 15 s d'attente. Webtor stream depuis ses serveurs.
            setTorrentMode('webtor')
            return
          }
          // 2. Surveillance : on attend assez de données AVANT de brancher la
          //    vidéo (sinon le lecteur n'a rien à lire → écran noir). Et si le
          //    swarm est trop lent, on bascule sur le cloud au lieu d'attendre.
          let attached = false
          const startedAt = Date.now()
          const lastStats = { peers: 0, progress: 0, ready: false }
          statsTimerRef.current = setInterval(async () => {
            try {
              const r = await fetch(`/api/stream/stats?infoHash=${ih}${fileQ}${trQ}`)
              const j = await r.json()
              lastStats.peers = j.peers ?? 0
              lastStats.progress = j.progress ?? 0
              lastStats.ready = !!j.ready
              setStats({ peers: j.peers, downSpeed: j.downloadSpeed, progress: j.progress })
              // Dès que le nom du fichier est connu : on ne renvoie vers le
              // cloud QUE ce que le navigateur ne peut vraiment pas lire :
              // - codec x265/HEVC (pas de décodage dans Chrome/Edge/Firefox)
              // - conteneurs exotiques (AVI, TS, WMV…)
              // Un MKV en x264, Chrome le lit nativement → on tente le direct,
              // avec onError/chien de garde vers le cloud en secours.
              if (!attached && j.fileName) {
                const fn = String(j.fileName).toLowerCase()
                const ext = fn.split('.').pop() ?? ''
                const probe = `${fn} ${req.stream.title ?? ''} ${req.stream.name ?? ''}`.toLowerCase()
                const badCodec = /x265|hevc|h[.\s-]?265|xvid|divx/.test(probe)
                const badContainer = ['avi', 'ts', 'wmv', 'flv', 'mpg', 'mpeg'].includes(ext)
                // Audio non décodé par Chrome/Firefox (AC3, E-AC3, DTS, TrueHD) :
                // la vidéo passerait mais SANS SON → cloud direct (transcodage).
                const badAudio = RISKY_AUDIO_RE.test(probe)
                if (badCodec || badContainer || badAudio) {
                  attached = true // empêche tout branchement ultérieur
                  setTorrentMode('webtor')
                  return
                }
              }
              if (!attached && j.ready && j.fileName) {
                // Branchement DÈS que le torrent est prêt : c'est la vidéo
                // ELLE-MÊME qui devient le lecteur et tire les données via ses
                // requêtes Range. Attendre un seuil de Mo téléchargés ne servait
                // à rien (le préchargement côté serveur fait déjà avancer le
                // swarm) et retardait le démarrage. Le chien de garde de 20 s
                // bascule sur le cloud si le flux ne démarre pas.
                attached = true
                const v = videoRef.current
                if (v) {
                  v.src = src
                  tryAutoplay(v)
                  // Détecteur d'audio non décodé : on tente à l'attache et à
                  // chaque reprise de lecture (le 1er essai peut échouer sans
                  // geste utilisateur — le clic sur Lecture le débloque).
                  runSilenceDetector()
                  v.addEventListener('playing', runSilenceDetector)
                  // Chien de garde anti-blocage : si 15 s après le branchement
                  // la lecture n'a toujours pas démarré (données trop lentes),
                  // on bascule sur le cloud plutôt que de laisser un écran noir.
                  setTimeout(() => {
                    if (torrentModeRef.current === 'server' && v.readyState < 3 && v.currentTime < 1) {
                      noteP2PFail()
                      setTorrentMode('webtor')
                    }
                  }, 15000)
                }
              } else if (!attached && Date.now() - startedAt > 45000) {
                // 45 s sans métadonnées complètes : ce swarm est mort → cloud.
                // (Si le cloud échoue aussi, le repli automatique enchaîne
                // sur la source suivante.)
                attached = true
                noteP2PFail()
                setTorrentMode('webtor')
                return
              }
            } catch { /* ignore */ }
          }, 1000)
          // 3. Watchdog : si le serveur ne trouve vraiment rien (0 pair ET 0
          //    octet) après 30 s → Webtor. Sinon on ré-arme (téléchargement lent).
          const armWatchdog = () => {
            watchdogRef.current = setTimeout(() => {
              const alive = lastStats.peers > 0 || lastStats.progress > 0.0005
              if (!attached && !alive) setTorrentMode('webtor')
              else if (!attached) armWatchdog()
            }, 30000)
          }
          armWatchdog()
        } else if (kind === 'torrent' && req.stream.infoHash && torrentMode === 'browser') {
          // Fallback navigateur : WebTorrent (pairs WebRTC uniquement)
          const mod = await import('webtorrent/dist/webtorrent.min.js')
          const WebTorrent = (mod as { default?: unknown }).default ?? mod
          if (cancelled) return
          const client = new (WebTorrent as new () => import('webtorrent').default)()
          const magnet = buildMagnet()
          const torrent = client.add(magnet)
          torrentRef.current = { destroy: () => client.destroy() }
          statsTimerRef.current = setInterval(() => {
            setStats({
              peers: torrent.numPeers,
              downSpeed: torrent.downloadSpeed,
              progress: torrent.progress,
            })
          }, 1000)
          // Watchdog : aucun pair après 15 s → Webtor (cloud)
          watchdogRef.current = setTimeout(() => {
            const v = videoRef.current
            if (torrent.numPeers === 0 && v && v.readyState === 0) setTorrentMode('webtor')
          }, 15000)
          torrent.on('error', () => setTorrentMode('webtor'))
          torrent.on('ready', () => {
            let file = torrent.files[req.stream.fileIdx ?? -1] ?? null
            if (!file) {
              file = torrent.files.reduce((a, b) => (a.length > b.length ? a : b))
            }
            file.renderTo(video!, { autoplay: false })
            setBuffering(true)
          })
        } else if (kind === 'torrent' && req.stream.infoHash && torrentMode === 'webtor') {
          setBuffering(false)
          return // géré par l'embed Webtor (cloud)
        } else if (kind === 'youtube' && req.stream.ytId) {
          return // géré par l'iframe
        } else {
          setError("Cette source n'est pas lisible directement dans le navigateur.")
          return
        }
        video!.addEventListener('loadedmetadata', () => {
          // Filet de sécurité : un placeholder Torrentio (« failed_opening »,
          // « downloading ») qui aurait glissé entre les mailles du contrôle
          // préalable ne doit JAMAIS être joué — source suivante aussitôt.
          if (/\/videos?\/(failed|downloading)/i.test(video!.currentSrc)) {
            if (!tryNextSourceRef.current()) setError('Cette source est indisponible et aucune autre n\'a répondu. Réessaie plus tard.')
            return
          }
          // Mode transcodage : la reprise est gérée côté ffmpeg (-ss) — le
          // fragment démarre à 0, ne PAS y appliquer startAt.
          if (tcActiveRef.current) { tryAutoplay(video!); return }
          if (req.startAt && req.startAt > 10) video!.currentTime = req.startAt
          tryAutoplay(video!)
        })
      } catch {
        setError('Erreur lors du chargement de la source.')
      }
    }
    setup()
    wakeControls()

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      torrentRef.current?.destroy()
      if (statsTimerRef.current) clearInterval(statsTimerRef.current)
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      if (trackUrlRef.current) URL.revokeObjectURL(trackUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentMode, proxied])

  // Verrouille le défilement de la page tant que le lecteur est ouvert :
  // sinon sur mobile la page défile sous le lecteur et décale l'interface
  // (bouton lecture hors de portée).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Audio : libère le contexte au démontage (sinon on épuise la limite de
  // Chrome après quelques lectures) et le relance au retour au premier plan.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && audioCtxRef.current?.state === 'suspended') {
        void audioCtxRef.current.resume().catch(() => { /* ignore */ })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void audioCtxRef.current?.close().catch(() => { /* ignore */ })
      audioCtxRef.current = null
      analyserRef.current = null
    }
  }, [])

  // Mode Webtor (cloud) : streaming via les serveurs Webtor (HLS, aucun P2P
  // côté client) — fonctionne même quand le réseau bloque le P2P, et transcode
  // les formats non lisibles par le navigateur (MKV, HEVC…).
  useEffect(() => {
    if (kind !== 'torrent' || torrentMode !== 'webtor' || !req.stream.infoHash) return

    // Détecteur de panne : Webtor communique via postMessage. Si aucun signal
    // après 12 s, l'iframe est bloquée (cookies tiers refusés — WebView,
    // Safari, navigation privée…) → on affiche les options de secours.
    let alive = false
    const deadTimer = setTimeout(() => {
      if (!alive) {
        // Cloud bloqué (cookies tiers, réseau…) → source suivante en auto.
        if (!tryNextSource()) {
          setError(
            "Lecteur cloud bloqué : ce navigateur refuse les cookies tiers (aperçu intégré d'app, Safari, navigation privée). Ouvre le site publié dans Chrome, ou tente une autre source.",
          )
        }
      }
    }, 12000)

    const pushConfig = () => {
      const w = window as unknown as { webtor?: Array<Record<string, unknown>> }
      w.webtor = w.webtor ?? []
      const subs = (req.subtitles ?? [])
        .filter((s) => /^https?:\/\//.test(s.url))
        .slice(0, 8)
        .map((s) => ({ srclang: s.lang.slice(0, 2), label: s.label, src: s.url }))
      w.webtor.push({
        id: 'webtor-player',
        magnet: buildMagnet(),
        title: req.meta.name + (req.episodeLabel ? ` — ${req.episodeLabel}` : ''),
        poster: req.meta.background ?? req.meta.poster,
        imdbId: /^tt\d+/.test(req.meta.id) ? req.meta.id : undefined,
        lang: 'fr',
        // Dimensions en pixels = taille EXACTE de l'écran. Avec '100%', le
        // lecteur héritait d'une hauteur trop grande (page défilante) et son
        // bouton lecture se retrouvait coupé, hors de portée du doigt.
        width: window.innerWidth,
        height: window.innerHeight,
        subtitles: subs.length ? subs : undefined,
        features: { embed: false, opensubtitles: true, subtitles: true, fullscreen: true },
        on: (e: { name?: string }) => {
          alive = true // tout signal = l'iframe fonctionne
          if (e.name && /ERROR/i.test(e.name)) {
            // Le cloud n'a pas réussi → source suivante automatiquement.
            if (!tryNextSource()) {
              setError("Le cloud n'a pas réussi à lire cette source, et aucune autre n'a répondu. Réessaie plus tard.")
            }
          }
        },
      })
    }

    const existing = document.querySelector('script[data-webtor]') as HTMLScriptElement | null
    if (existing) {
      // SDK déjà chargé : push direct
      pushConfig()
      return () => clearTimeout(deadTimer)
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/@webtor/embed-sdk-js/dist/index.min.js'
    s.async = true
    s.dataset.webtor = '1'
    // La config est poussée APRÈS le chargement du SDK (évite la race condition)
    s.onload = pushConfig
    s.onerror = () => {
      if (!tryNextSource()) setError('Impossible de charger le lecteur cloud (réseau bloqué ?).')
    }
    document.body.appendChild(s)
    return () => clearTimeout(deadTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentMode])

  // Sauvegarde périodique + à la fermeture.
  // IMPORTANT : l'effet ne doit JAMAIS dépendre de saveProgress — une identité
  // instable recréerait l'effet à chaque rendu, et le cleanup appellerait
  // saveProgress → writeJSON → re-render → boucle infinie (React #185).
  // On passe par une ref : effet monté une seule fois, toujours à jour.
  const saveProgressRef = useRef(saveProgress)
  useEffect(() => { saveProgressRef.current = saveProgress })
  useEffect(() => {
    const t = setInterval(() => saveProgressRef.current(), 5000)
    return () => {
      clearInterval(t)
      lastSaved.current = 0
      saveProgressRef.current()
    }
  }, [])

  // Framework Google Cast officiel (Chromecast, Android TV, Google TV…).
  // Le script n'appelle __onGCastApiAvailable QUE sur Chrome ; ailleurs on
  // retombe sur AirPlay (Safari/Apple) ou l'API Remote Playback.
  useEffect(() => {
    const w = window as unknown as {
      __onGCastApiAvailable?: (ok: boolean) => void
      cast?: { framework: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
      chrome?: { cast: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    w.__onGCastApiAvailable = (ok) => {
      if (!ok || !w.cast || !w.chrome) return
      try {
        const fw = w.cast.framework
        const ctx = fw.CastContext.getInstance()
        ctx.setOptions({
          receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        })
        ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, (e: { castState: string }) => {
          setCastState(
            e.castState === fw.CastState.CONNECTED
              ? 'connected'
              : e.castState === fw.CastState.CONNECTING
                ? 'connecting'
                : 'available',
          )
        })
        // Télécommande : les événements du récepteur mettent à jour l'UI du
        // téléphone (lecture, position, durée).
        const player = new fw.RemotePlayer()
        const ctl = new fw.RemotePlayerController(player)
        castPlayerRef.current = player
        castCtlRef.current = ctl
        ctl.addEventListener(fw.RemotePlayerEventType.IS_PAUSED_CHANGED, () => setPlaying(!player.isPaused))
        ctl.addEventListener(fw.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => setTime(player.currentTime))
        ctl.addEventListener(fw.RemotePlayerEventType.DURATION_CHANGED, () => {
          if (player.duration > 0) setDuration(player.duration)
        })
        setCastFw(true)
      } catch { /* framework indisponible : les replis prennent le relais */ }
    }
    if (!document.querySelector('script[data-castfw]')) {
      const s = document.createElement('script')
      s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
      s.async = true
      s.dataset.castfw = '1'
      document.head.appendChild(s)
    }
  }, [])

  // AirPlay (iPhone, iPad, Mac) : Safari expose son propre sélecteur natif.
  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }) | null
    // iOS récents : l'API standard Remote Playback (video.remote) a remplacé
    // l'ancien webkitShowPlaybackTargetPicker — sans cette détection, le
    // bouton de diffusion ne s'affichait jamais sur iPhone moderne.
    const hasAirplay = !!v && (typeof v.webkitShowPlaybackTargetPicker === 'function' || !!v.remote)
    if (!hasAirplay) return
    setAirplay(true)
    const onWireless = () => {
      const wireless = (v as unknown as { webkitCurrentPlaybackTargetIsWireless?: boolean })
        .webkitCurrentPlaybackTargetIsWireless
      setCastState(wireless ? 'connected' : 'available')
      if (wireless) toast('📺 Lecture sur la TV (AirPlay)')
    }
    v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless)
    return () => v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless)
  }, [torrentMode])

  // Surveillance des appareils Cast (Chromecast, Android TV, box…) sur le
  // réseau local — repli Remote Playback quand le framework n'est pas là.
  useEffect(() => {
    const remote = remoteOf(videoRef.current)
    if (!remote || typeof remote.watchAvailability !== 'function') return
    let watchId = -1
    let dead = false
    remote.watchAvailability((ok) => {
      if (!dead) setCastState((s) => (s === 'connected' || s === 'connecting' ? s : ok ? 'available' : 'unavailable'))
    }).then((id) => { watchId = id }).catch(() => { /* le framework ou AirPlay prennent le relais */ })
    const onConnecting = () => setCastState('connecting')
    const onConnect = () => { setCastState('connected'); toast('📺 Lecture sur la TV') }
    const onDisconnect = () => { setCastState('available'); toast('Lecture revenue sur cet appareil') }
    remote.addEventListener?.('connecting', onConnecting)
    remote.addEventListener?.('connect', onConnect)
    remote.addEventListener?.('disconnect', onDisconnect)
    return () => {
      dead = true
      try { if (watchId >= 0) remote.cancelWatchAvailability(watchId) } catch { /* ignore */ }
      remote.removeEventListener?.('connecting', onConnecting)
      remote.removeEventListener?.('connect', onConnect)
      remote.removeEventListener?.('disconnect', onDisconnect)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentMode])

  /**
   * URL HTTP(S) lisible par une TV : le téléphone n'envoie que l'ADRESSE du
   * flux, la TV la télécharge elle-même. Les torrents en mode cloud passent
   * aussi : c'est NOTRE serveur qui fait le P2P et sert le fichier en HTTP.
   * Seuls échecs : P2P dans le navigateur (blob:) et YouTube.
   */
  const castableUrl = (): string | null => {
    if (req.stream.ytId) return null
    if (kind === 'torrent' && torrentMode === 'webtor') return null
    const src = videoRef.current?.currentSrc ?? ''
    if (!src || src.startsWith('blob:')) return null
    return new URL(src, window.location.href).href
  }

  const castContentType = (url: string): string => {
    const u = url.toLowerCase()
    if (u.includes('.m3u8')) return 'application/x-mpegurl'
    if (u.includes('/api/stream/transcode')) return 'video/x-matroska'
    if (u.includes('.webm')) return 'video/webm'
    return 'video/mp4'
  }

  /** Envoie la lecture sur la TV : Google Cast, AirPlay ou Remote Playback. */
  const cast = async () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }) | null

    // AirPlay (iPhone / iPad / Mac) : le sélecteur natif gère tout, y compris
    // la déconnexion si une session est en cours.
    if (airplay && !castFw) {
      if (v?.remote) {
        try { await v.remote.prompt() } catch { /* sélecteur annulé */ }
      } else {
        v?.webkitShowPlaybackTargetPicker?.()
      }
      return
    }

    // Déjà sur la TV via Google Cast → le bouton devient « arrêter ».
    const w = window as unknown as {
      cast?: { framework: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
      chrome?: { cast: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    if (castFw && w.cast && castState === 'connected') {
      try {
        w.cast.framework.CastContext.getInstance().endCurrentSession(true)
        toast('Diffusion arrêtée — lecture de retour ici')
      } catch { /* ignore */ }
      return
    }

    const url = castableUrl()
    if (!url) {
      if (req.stream.ytId) toast("YouTube : utilise le bouton Cast de sa propre application.")
      else if (kind === 'torrent' && torrentMode === 'webtor')
        toast('Le P2P navigateur ne peut pas partir sur la TV — touche ☁ (lecteur cloud) puis relance le Cast.')
      else toast("Lance d'abord la vidéo, puis touche à nouveau Cast.")
      return
    }

    // Les conteneurs MKV ne passent PAS sur Chromecast (MP4/WebM uniquement)
    // → on prévient une fois, l'utilisateur pourra basculer sur le cloud.
    const probe = `${v?.currentSrc ?? ''} ${req.stream.title ?? ''} ${req.stream.name ?? ''}`.toLowerCase()
    if (/\.mkv|mkv/.test(probe)) {
      toast('⚠️ Source MKV : si la TV reste noire, bascule sur le lecteur cloud (icône ☁) qui convertit le format.')
    }

    // Google Cast (Chrome Android + ordinateur)
    if (castFw && w.cast && w.chrome) {
      try {
        setCastState('connecting')
        const fw = w.cast.framework
        const cm = w.chrome.cast.media
        const ctx = fw.CastContext.getInstance()
        const session = ctx.getCurrentSession() ?? (await ctx.requestSession())
        const info = new cm.MediaInfo(url, castContentType(url))
        info.streamType = cm.StreamType.BUFFERED
        const meta = new cm.GenericMediaMetadata()
        meta.title = req.meta.name + (req.episodeLabel ? ` — ${req.episodeLabel}` : '')
        const poster = req.meta.background ?? req.meta.poster
        if (poster) meta.images = [{ url: new URL(poster, window.location.href).href }]
        info.metadata = meta
        // Sous-titres actifs, WebVTT uniquement (seul format lu par les TV)
        const sub = allSubs.find((s) => s.id === activeSub)
        if (sub && /format=vtt|\.vtt/i.test(sub.url)) {
          const track = new cm.Track(1, cm.TrackType.TEXT)
          track.trackContentId = new URL(sub.url, window.location.href).href
          track.trackContentType = 'text/vtt'
          track.subtype = cm.TextTrackType.SUBTITLES
          track.name = sub.label
          track.language = sub.lang
          info.tracks = [track]
        }
        const load = new cm.LoadRequest(info)
        load.currentTime = tcActiveRef.current && v ? tcOffsetRef.current + v.currentTime : v?.currentTime ?? 0
        if (info.tracks) load.activeTrackIds = [1]
        await session.loadMedia(load)
        v?.pause() // la TV prend le relais, le téléphone devient télécommande
        toast('📺 Lecture sur la TV — ton téléphone sert de télécommande')
      } catch (e) {
        const code = (e as { code?: string } | null)?.code
        setCastState('available')
        if (code !== 'cancel') toast('Cast impossible sur cet appareil')
      }
      return
    }

    // Repli : API Remote Playback (certains Android sans framework)
    const remote = remoteOf(v)
    if (!remote) {
      toast('Cast non géré par ce navigateur — utilise Chrome (Android) ou Safari (iPhone).')
      return
    }
    try {
      setCastState('connecting')
      await remote.prompt()
    } catch {
      // Annulé par l'utilisateur ou aucun appareil : on reste discret.
      setCastState('available')
    }
  }

  // Raccourcis clavier (désactivés en mini-lecteur : la navigation prime)
  const minimizedRef = useRef(minimized)
  useEffect(() => { minimizedRef.current = minimized }, [minimized])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (minimizedRef.current) return
      const v = videoRef.current
      if (!v) return
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault()
          if (v.paused) v.play(); else v.pause()
          break
        case 'arrowright': v.currentTime += 10; break
        case 'arrowleft': v.currentTime -= 10; break
        case 'arrowup': e.preventDefault(); setVol(Math.min(1, uiVolRef.current + 0.05)); break
        case 'arrowdown': e.preventDefault(); setVol(Math.max(0, uiVolRef.current - 0.05)); break
        case 'f': fullscreen(); break
        case 'm': v.muted = !v.muted; setMuted(v.muted); break
        case 'escape': closeAndLeave(); break
      }
      wakeControls()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const togglePlay = () => {
    // TV connectée : le bouton pilote le grand écran, pas la vidéo locale.
    if (castState === 'connected' && castCtlRef.current) {
      castCtlRef.current.playOrPause()
      return
    }
    const v = videoRef.current
    if (!v) return
    // Flash Netflix : icône géante du NOUVEL état (lecture ou pause).
    const willPlay = v.paused
    if (willPlay) v.play(); else v.pause()
    showHud(willPlay ? 'play' : 'pause')
  }

  /** Bascule mini-lecteur : sort du plein écran d'abord (sinon conflit). */
  const handleToggleMinimize = () => {
    if (!minimized && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* ignore */ })
    }
    onToggleMinimize()
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    // TV connectée : la barre de progression pilote le récepteur.
    if (castState === 'connected' && castPlayerRef.current && castCtlRef.current) {
      castPlayerRef.current.currentTime = Number(e.target.value)
      castCtlRef.current.seek()
      return
    }
    const v = videoRef.current
    if (!v) return
    if (tcActiveRef.current) {
      // Flux transcodé : seek = nouveau flux ffmpeg démarrant à la cible.
      void startTranscode(Number(e.target.value))
      return
    }
    v.currentTime = Number(e.target.value)
  }

  const skip = (delta: number) => {
    if (castState === 'connected' && castPlayerRef.current && castCtlRef.current) {
      castPlayerRef.current.currentTime += delta
      castCtlRef.current.seek()
      return
    }
    const v = videoRef.current
    if (!v) return
    if (tcActiveRef.current) {
      void startTranscode(tcOffsetRef.current + v.currentTime + delta)
      return
    }
    v.currentTime += delta
  }

  /**
   * Dernier recours anti « film muet » : la source a une piste AC3/DTS que le
   * navigateur ne sait pas décoder et AUCUNE autre source n'est disponible.
   * Le serveur copie la vidéo bit à bit et ré-encode seul l'audio en AAC.
   * `at` = position virtuelle de départ (le flux ffmpeg démarre là).
   */
  const startTranscode = async (at: number) => {
    const base = tcFinalUrlRef.current
    const v = videoRef.current
    if (!base || !v) return
    const target = Math.max(0, at)
    // Sonde serveur (ffprobe, cache 10 min) : vraie durée + codec vidéo.
    if (!tcDurationRef.current) {
      try {
        const r = await fetch(`/api/stream/tc-info?url=${encodeURIComponent(base)}`)
        const j = (await r.json()) as { duration?: number; videoCodec?: string }
        if (j.duration) {
          tcDurationRef.current = j.duration
          setDuration(j.duration)
        }
        // HEVC/x265 : le transcodage ne ré-encode QUE l'audio — la vidéo
        // resterait illisible dans Chrome. Inutile de continuer.
        if (/hevc|h265/.test(j.videoCodec ?? '')) {
          // Le transcodage ne touche QUE l'audio : la vidéo HEVC est copiée.
          // Sur un appareil qui décode le HEVC (téléphones récents), ça passe.
          const hevcPlayable = /android|iphone|ipad/i.test(navigator.userAgent)
          if (!hevcPlayable) {
            setError('Cette source combine vidéo HEVC et audio AC3/DTS — illisible dans ce navigateur. Choisis une autre source (x264 de préférence).')
            return
          }
        }
      } catch { /* sonde impossible : on tente quand même */ }
    }
    tcOffsetRef.current = target
    setTcActive(true)
    tcActiveRef.current = true
    setBuffering(true)
    v.src = `/api/stream/transcode?url=${encodeURIComponent(base)}&t=${Math.floor(target)}${fix1080 ? '&q=1080' : ''}`
    tryAutoplay(v)
    const wdogTc = v.src
    setTimeout(() => {
      const vv = videoRef.current
      if (!vv || vv.src !== wdogTc) return
      if (vv.readyState < 2 && vv.currentTime < 0.5) {
        setError("Le transcodage audio ne repond pas apres 20 s. Essaie une autre source ci-dessous.")
      }
    }, 90000)
    // Recale la piste de sous-titres sur le nouveau décalage temporel
    if (activeSubObjRef.current) applySubTrack(activeSubObjRef.current.label, activeSubObjRef.current.lang)
  }

  /**
   * Lecture directe, sans avoir à appuyer sur play. Le branchement du flux
   * arrive APRÈS le clic (préchauffage torrent) : le geste est « périmé » et
   * Chrome mobile refuse alors l'autoplay AVEC son. Stratégie : on tente
   * avec son ; si refusé, on démarre muet (toujours autorisé) puis on
   * réactive le son dès que la lecture tourne — autorisé une fois lancée.
   */
  const tryAutoplay = (v: HTMLVideoElement) => {
    v.play().catch(() => {
      v.muted = true
      setMuted(true)
      v.play().then(() => {
        const unmute = () => {
          v.removeEventListener('playing', unmute)
          v.muted = false
          setMuted(false)
          // Certains navigateurs mettent en pause au rétablissement du son
          // sans geste : dans ce cas on repart muet plutôt que d'arrêter.
          if (v.paused) { v.muted = true; setMuted(true); v.play().catch(() => { /* ignore */ }) }
        }
        v.addEventListener('playing', unmute)
      }).catch(() => { /* le bouton lecture central reste disponible */ })
    })
  }

  /**
   * Repli automatique : quand la source courante est morte (swarm sans pairs,
   * cloud bloqué, lien direct HS…), on enchaîne SEUL sur la meilleure source
   * suivante au lieu d'afficher une erreur. Le Player est remonté à chaque
   * changement de source (clé = infoHash), donc l'état repart propre.
   */
  const tryNextSource = useCallback(() => {
    const tried = req.triedHashes ?? []
    // Accepte P2P (infoHash) ET liens directs (url) : la chaîne de repli
    // mélange les deux pour maximiser les chances qu'une source passe.
    // Clé debrid refusée ? On saute les liens premium (ils échoueraient tous).
    const debridDown = isDebridDown()
    const next = (req.fallbackStreams ?? []).find((x) => {
      const k = x.infoHash ?? x.url
      if (!k || tried.includes(k)) return false
      if (debridDown && isDebridStream(x)) return false
      return true
    })
    if (next && req.onFallback) {
      toast('Source injoignable — essai automatique de la suivante…')
      req.onFallback(next)
      return true
    }
    return false
  }, [req])
  tryNextSourceRef.current = tryNextSource

  /** Appareil tactile (mobile/tablette) — détecte le mode « doigt ». */
  const isCoarse =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  /** Verrouille le téléphone en paysage quand on passe en plein écran
   *  (Android Chrome) ; déverrouille à la sortie. iOS ignore silencieusement. */
  const lockLandscape = () => {
    try {
      const o = screen.orientation as unknown as { lock?: (m: string) => Promise<void> }
      o.lock?.('landscape').catch(() => { /* non supporté */ })
    } catch { /* ignore */ }
  }
  const unlockOrientation = () => {
    try {
      const o = screen.orientation as unknown as { unlock?: () => void }
      o.unlock?.()
    } catch { /* ignore */ }
  }

  const fullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      wrapRef.current?.requestFullscreen()
        ?.then(() => { if (isCoarse) lockLandscape() })
        .catch(() => { /* geste requis ou API absente */ })
    }
  }

  // Déverrouille l'orientation quand on quitte le plein écran (bouton,
  // ÉCHAP, geste système…)
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) unlockOrientation()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PLEIN ÉCRAN AUTOMATIQUE SUR MOBILE : la vidéo occupe tout l'écran dès le
  // lancement (comportement Netflix/Stremio). On est dans le sillage du tap
  // sur la source → le geste utilisateur est encore valide pour Chrome
  // Android. iOS Safari refuse le fullscreen sur un <div> : on ignore.
  const autoFsTried = useRef(false)
  useEffect(() => {
    if (autoFsTried.current || minimized || !isCoarse) return
    autoFsTried.current = true
    if (document.fullscreenElement) return
    try {
      wrapRef.current?.requestFullscreen()
        ?.then(() => lockLandscape())
        .catch(() => { /* l'utilisateur le fera via le bouton */ })
    } catch { /* iOS */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized])

  const pip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch { /* non supporté */ }
  }

  /** Bascule la piste audio : hls.js pour le HLS, audioTracks natif sinon. */
  const pickAudio = (id: number) => {
    const hls = hlsRef.current
    if (hls) {
      hls.audioTrack = id
    } else {
      const v = videoRef.current as (HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }) | null
      if (v?.audioTracks) {
        for (let i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = i === id
      }
    }
    setActiveAudio(id)
    setAudioMenu(false)
    toast(`🔊 Audio : ${audioTracks.find((t) => t.id === id)?.label ?? `piste ${id + 1}`}`)
  }

  /**
   * Sélecteur de VERSION (langue du film) : la plupart des fichiers MKV/MP4
   * ne permettent pas au navigateur de changer de piste audio à l'intérieur
   * du même fichier — on bascule donc sur une AUTRE SOURCE dans la langue
   * voulue, en reprenant exactement à la position courante. Le pool complet
   * des sources (toutes langues) est fourni par la page détail.
   */
  type VersionKey = 'VF' | 'MULTI' | 'VOSTFR' | 'VO'
  const VERSION_DEFS: { key: VersionKey; label: string }[] = [
    { key: 'VF', label: '🇫🇷 Français (VF)' },
    { key: 'MULTI', label: '🌐 Multi (FR incluse)' },
    { key: 'VOSTFR', label: '💬 VOSTFR' },
    { key: 'VO', label: '🇺🇸 Version originale' },
  ]
  const matchVersion = (a: ReturnType<typeof streamAudio>, k: VersionKey) =>
    k === 'VO' ? a === null : a === k
  const currentVersion: VersionKey | null = (() => {
    const a = streamAudio(req.stream)
    if (a === 'VF') return 'VF'
    if (a === 'MULTI') return 'MULTI'
    if (a === 'VOSTFR') return 'VOSTFR'
    return 'VO'
  })()
  // Une version est proposée si le pool contient au moins une AUTRE source
  // dans cette langue (inutile de montrer un bouton qui ne mène nulle part).
  const versionPool = req.streamsPool ?? req.fallbackStreams ?? []
  const curStreamKey = req.stream.infoHash ?? req.stream.url
  const availableVersions = VERSION_DEFS.filter((d) =>
    versionPool.some((x) => matchVersion(streamAudio(x), d.key) && (x.infoHash ?? x.url) !== curStreamKey),
  )

  const switchVersion = (target: VersionKey) => {
    setAudioMenu(false)
    if (currentVersion === target) {
      toast('Cette source est déjà dans cette langue')
      return
    }
    const next = versionPool.find(
      (x) => matchVersion(streamAudio(x), target) && (x.infoHash ?? x.url) !== curStreamKey,
    )
    if (!next) {
      toast('Aucune autre source disponible dans cette langue')
      return
    }
    const def = VERSION_DEFS.find((d) => d.key === target)
    toast(`🔊 ${def?.label ?? target} — reprise à ${fmt(time)}`)
    req.onFallback?.(next, time)
  }

  const changeSpeed = () => {
    const v = videoRef.current
    if (!v) return
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    v.playbackRate = next
    setSpeed(next)
  }

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

  // ------------------------------------------------------------- SALON
  // « Regarder ensemble » : hôte = pousse son état, invité = suit l'hôte.
  const { play } = useNav()
  const [room, setRoom] = useState<ActiveRoom | null>(() => getActiveRoom())
  const [salonMenu, setSalonMenu] = useState(false)
  const [salonInput, setSalonInput] = useState('')
  const [salonBusy, setSalonBusy] = useState(false)
  const [guestCount, setGuestCount] = useState(0)

  // Menus ouverts (sous-titres, audio, salon) : les contrôles ne doivent
  // JAMAIS se masquer pendant qu'on règle — la minuterie est relancée à la
  // fermeture du menu. (Déclaré ici : salonMenu n'existe qu'à partir d'ici.)
  useEffect(() => {
    menuOpenRef.current = subMenu || audioMenu || salonMenu
    if (!menuOpenRef.current) wakeControls() // menu refermé → minuterie relancée
  }, [subMenu, audioMenu, salonMenu, wakeControls])
  useEffect(() => subscribeRoom(() => setRoom(getActiveRoom())), [])

  const roomMedia = useCallback((): RoomMedia => ({
    id: req.meta.id,
    baseId: req.meta.baseId,
    type: req.meta.type,
    name: req.meta.name,
    poster: req.meta.poster,
    background: req.meta.background,
    episodeLabel: req.episodeLabel,
    infoHash: req.stream.infoHash?.toLowerCase(),
  }), [req])

  // HÔTE : pousse lecture/pause/seek + battement toutes les 10 s + compteur
  // d'invités. Se redéclenche à chaque changement de contenu (épisode suivant
  // hôte → les invités suivent automatiquement).
  useEffect(() => {
    if (room?.role !== 'host') return
    const v = videoRef.current
    const code = room.code
    const push = () => {
      const vv = videoRef.current
      if (!vv || !vv.duration) return
      void pushRoomState(code, roomMedia(), !vv.paused, vv.currentTime)
    }
    push()
    v?.addEventListener('play', push)
    v?.addEventListener('pause', push)
    v?.addEventListener('seeked', push)
    const hb = setInterval(() => {
      push()
      void fetchRoom(code).then((r) => {
        if (r) setGuestCount(Object.keys(r.state.guests ?? {}).length)
      })
    }, 10_000)
    return () => {
      v?.removeEventListener('play', push)
      v?.removeEventListener('pause', push)
      v?.removeEventListener('seeked', push)
      clearInterval(hb)
    }
  }, [room?.role, room?.code, req.meta.id, roomMedia])

  // INVITÉ : polling ~2,5 s — cale la position, aligne play/pause, suit le
  // contenu si l'hôte change de film/épisode.
  useEffect(() => {
    if (room?.role !== 'guest') return
    const code = room.code
    let stop = false
    const tick = async () => {
      const r = await fetchRoom(code)
      if (stop) return
      if (!r) {
        toast("L'hôte a fermé le salon")
        void leaveRoom()
        return
      }
      void guestHeartbeat(code)
      const { state, serverNow } = r
      // L'hôte a changé de contenu → on le suit
      if (state.media.id !== req.meta.id) {
        toast(`Le salon passe à : ${state.media.name}${state.media.episodeLabel ? ` ${state.media.episodeLabel}` : ''}`)
        void joinRoomAndPlay(code, play)
        return
      }
      if (!getActiveRoom()?.follow) return
      const v = videoRef.current
      if (!v || (!v.duration && !tcActiveRef.current)) return
      const target = roomPosition(state, serverNow)
      const cur = tcOffsetRef.current + v.currentTime
      if (Math.abs(cur - target) > 4) {
        if (tcActiveRef.current) void startTranscode(target)
        else v.currentTime = target
      }
      if (state.playing && v.paused) void v.play().catch(() => { /* geste requis */ })
      if (!state.playing && !v.paused) v.pause()
    }
    void tick()
    const t = setInterval(() => void tick(), 2500)
    return () => { stop = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.role, room?.code, room?.follow, req.meta.id])

  const salonCreate = async () => {
    const v = videoRef.current
    setSalonBusy(true)
    const code = await createRoom(roomMedia(), v ? !v.paused : true, v?.currentTime ?? 0)
    setSalonBusy(false)
    if (!code) { toast('Impossible de créer le salon — réessaie'); return }
    toast('Salon créé ✓ Partage le code à tes amis')
  }

  const salonJoin = async () => {
    const code = normalizeRoomCode(salonInput)
    if (!code) { toast('Format invalide — le code ressemble à SN-XXXX-XXXX'); return }
    if (getActiveRoom()?.code === code) { setSalonMenu(false); return }
    setSalonBusy(true)
    const res = await joinRoomAndPlay(code, play)
    setSalonBusy(false)
    if (!res.ok) { toast(res.error ?? 'Salon introuvable'); return }
    enterRoomAsGuest(code) // au cas où le play a remonté le Player
    toast('Salon rejoint — la lecture suit l\'hôte')
    setSalonMenu(false)
  }

  const salonLeave = async () => {
    const wasHost = room?.role === 'host'
    await leaveRoom()
    setGuestCount(0)
    setSalonMenu(false)
    toast(wasHost ? 'Salon fermé pour tout le monde' : 'Tu as quitté le salon')
  }

  // Fermer le lecteur = quitter le salon (explicite). Le changement de
  // contenu (remontage via key) ne quitte PAS le salon, lui.
  const closeAndLeave = () => {
    if (getActiveRoom()) void leaveRoom()
    onClose()
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
      rawVttRef.current = await fetchVttSub(sub)
      activeSubObjRef.current = sub
      applySubTrack(sub.label, sub.lang)
      setActiveSub(sub.id)
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

  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`
  }

  const nearEnd = duration > 0 && duration - time < 60 && !!req.onNextEpisode

  // Enchaînement automatique (façon Netflix) : à 25 s de la fin, compte à
  // rebours de 10 s → épisode suivant sans toucher la télécommande.
  // En pause ou après « Annuler », le compte à rebours se retire.
  const [nextIn, setNextIn] = useState<number | null>(null)
  const nextCancelRef = useRef(false)
  useEffect(() => { setNextIn(null); nextCancelRef.current = false }, [req.meta.id, req.episodeLabel])
  const autoZone = duration > 0 && duration - time <= 25 && !!req.onNextEpisode
  useEffect(() => {
    if (!autoZone || !playing || nextCancelRef.current) { setNextIn(null); return }
    setNextIn((n) => n ?? 10)
  }, [autoZone, playing])
  useEffect(() => {
    if (nextIn === null) return
    if (nextIn <= 0) {
      setNextIn(null)
      req.onNextEpisode?.()
      return
    }
    const t = setTimeout(() => setNextIn((n) => (n === null ? null : n - 1)), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextIn])

  if (kind === 'youtube' && req.stream.ytId) {
    return (
      <div className={minimized
        ? 'fixed bottom-24 right-3 md:right-5 z-[60] w-[min(400px,88vw)] aspect-video rounded-lg overflow-hidden border border-[rgb(var(--acc))]/30 bg-black shadow-2xl'
        : 'fixed inset-0 z-[60] bg-black flex flex-col'
      }>
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <button onClick={onToggleMinimize} className="rounded-full bg-white/10 p-2 hover:bg-white/25">
            {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
          <button onClick={closeAndLeave} className="rounded-full bg-white/10 p-2 hover:bg-white/25">
            <X size={16} />
          </button>
        </div>
        <iframe
          src={`https://www.youtube.com/embed/${req.stream.ytId}?autoplay=1`}
          className="h-full w-full"
          allow="autoplay; fullscreen"
          allowFullScreen

        />
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={minimized ? undefined : wakeControls}
      onClick={minimized ? undefined : (e) => {
        // Après un geste tactile, le navigateur génère un clic synthétique :
        // il ne doit rien déclencher (le tap tactile s'en charge).
        if (Date.now() - lastTouchEnd.current < 600) return
        // Un clic sur un BOUTON/contrôle reste géré par ce bouton (pas de
        // bascule lecture/pause parasites).
        if ((e.target as HTMLElement | null)?.closest?.('button, a, input, select')) return
        const v = videoRef.current
        if (v && (v.duration || tcActiveRef.current)) {
          if (v.paused) { void v.play().catch(() => {}); showHud('play') }
          else { v.pause(); showHud('pause') }
        }
        wakeControls()
      }}
      onDoubleClick={minimized ? undefined : (e) => {
        if ((e.target as HTMLElement | null)?.closest?.('button, a, input, select')) return
        fullscreen()
      }}
      className={minimized
        ? 'group fixed bottom-24 right-3 md:right-5 z-[60] w-[min(400px,88vw)] aspect-video rounded-lg overflow-hidden border border-[rgb(var(--acc))]/30 bg-black shadow-2xl select-none'
        : 'fixed inset-0 z-[60] bg-black flex items-center justify-center select-none'
      }
    >
      {/* La balise <video> est démontée en mode Webtor : le SDK Webtor scanne
          tous les <video> de la page et remplacerait le nôtre. */}
      {!(kind === 'torrent' && torrentMode === 'webtor') && (
      <video
        ref={videoRef}
        className={`player-premium ${controlsVisible ? "" : "cursor-none "}h-full w-full ${zoom ? 'object-cover' : 'object-contain'}`}
        crossOrigin={kind === 'http' && isDebridStream(req.stream) && !proxied ? undefined : 'anonymous'}
        preload="auto"
        onPlay={() => { setPlaying(true); noteP2POk(); wakeControls() }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(tcOffsetRef.current + e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          // En mode transcodage, le flux ffmpeg n'a pas de durée finie — on
          // garde celle mesurée par ffprobe (tc-info).
          if (tcActiveRef.current) return
          setDuration(e.currentTarget.duration)
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onEnded={() => req.onNextEpisode?.()}
        onError={(e) => {
          // Mode transcodage : pas de repli proxy (le transcodage EST le
          // dernier recours) — une erreur = ffmpeg/CDN mort → source suivante.
          if (tcActiveRef.current) {
            if (!tryNextSource()) setError('La conversion audio a échoué et aucune autre source n\'a répondu.')
            return
          }
          if (kind === 'http' && !proxied) setProxied(true)
          else if (kind === 'http') {
            // Source débridée non encore cachée (message « downloaded to
            // Debrid ») : on retente la MÊME source après 50 s — le torrent
            // sera prêt — au lieu de sauter directement.
            if (isDebridStream(req.stream) && debridRetryRef.current !== req.stream.url) {
              debridRetryRef.current = req.stream.url
              toast('⏳ Mise en cache Debrid en cours — nouvelle tentative automatique dans 50 s…')
              setTimeout(() => {
                debridRetryRef.current = null
                const v = videoRef.current
                if (v) { v.load(); v.play().catch(() => { /* ignore */ }) }
              }, 50000)
              return
            }
            // Lien direct HS (même via le proxy) → source suivante en auto.
            if (!tryNextSource()) setError('Lecture impossible. La source est peut-être hors ligne ou bloquée.')
          }
          else if (kind === 'torrent' && torrentMode === 'server') {
            const v = e.currentTarget
            // Coupure réseau transitoire EN PLEINE LECTURE (4G/5G instable) :
            // on recharge le flux et on reprend exactement au timecode
            // courant — une seule fois — au lieu de basculer brutalement
            // sur le cloud (qui repartait de zéro et « cassait » le lien).
            if (!errorRetriedRef.current && v.currentTime > 0.5 && v.currentSrc) {
              errorRetriedRef.current = true
              const resumeAt = v.currentTime
              const src = v.currentSrc
              v.addEventListener('loadedmetadata', () => {
                v.currentTime = resumeAt
                void v.play().catch(() => { /* ignore */ })
              }, { once: true })
              v.src = src
              v.load()
            } else {
              setTorrentMode('webtor')
            }
          }
          else if (kind === 'torrent' && torrentMode === 'browser') setTorrentMode('webtor')
          else if (!tryNextSource()) setError('Lecture impossible avec cette source, et aucune autre n\'a répondu. Réessaie plus tard.')
        }}
        onClick={(e) => {
          e.stopPropagation()
          // Sur mobile, un tap génère un clic synthétique après touchend :
          // sans ce garde-fou, chaque tap mettrait la vidéo en pause.
          if (Date.now() - lastTouchEnd.current < 600) return
          togglePlay()
        }}
        playsInline
      />
      )}

      {/* Luminosité simulée (le web ne peut pas piloter l'écran) : balayage
          vertical sur la moitié gauche de l'écran. Persistée par appareil. */}
      {!minimized && brightness < 0.999 && (
        <div className="pointer-events-none absolute inset-0 z-[5] bg-black" style={{ opacity: 1 - brightness }} />
      )}

      {/* HUD des gestes : flash ±10 s sur les côtés, jauge volume/luminosité au centre */}
      {!minimized && req.meta.type === 'series' && introSkippedFor.current !== req.meta.id && pos > 3 && pos < 150 && (
        <button
          onClick={skipIntro}
          className="absolute right-4 top-20 z-30 rounded bg-white px-4 py-2 text-sm font-bold text-black shadow-lg transition-colors hover:bg-white/80"
        >
          Passer l'intro
        </button>
      )}

      {!minimized && hud && (
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

      {/* Lecteur Webtor (cloud) — UI autonome, sans P2P côté client.
          100dvh = hauteur visible réelle sur mobile (barres du navigateur
          déduites) : empêche le lecteur de dépasser de l'écran. */}
      {kind === 'torrent' && torrentMode === 'webtor' && (
        <div
          id="webtor-player"
          className={`absolute inset-0 overflow-hidden ${minimized ? 'invisible' : ''}`}
          style={{ height: '100dvh', width: '100vw' }}
        />
      )}
      {/* Mini-lecteur en mode cloud : l'iframe Webtor garde ses dimensions
          plein écran — on affiche un voile propre, le son continue. */}
      {kind === 'torrent' && torrentMode === 'webtor' && minimized && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
          <p className="text-[10px] font-mono text-[rgb(var(--acc))]/80">☁ Lecture cloud en cours</p>
        </div>
      )}

      {/* Titre */}
      {!minimized && (
      <div
        className={`absolute top-0 inset-x-0 p-5 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-start justify-between">
          <div />
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleMinimize}
              className="rounded-full bg-white/10 p-2.5 hover:bg-[rgb(var(--acc))] hover:text-white transition-colors"

            >
              <Minimize2 size={18} />
            </button>
            <button onClick={closeAndLeave} className="rounded-full bg-white/10 p-2.5 hover:bg-[rgb(var(--acc))] hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Mini-lecteur : barre de contrôle compacte au survol */}
      {minimized && (
        <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/60 via-transparent to-black/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="truncate px-3 pt-2 text-[11px] font-semibold text-white/90">
            {req.meta.name}{req.episodeLabel ? ` — ${req.episodeLabel}` : ''}
          </p>
          <div className="flex items-center justify-center gap-3 pb-2">
            <button onClick={togglePlay} className="rounded-full bg-white/15 p-2 hover:bg-[rgb(var(--acc))] hover:text-white transition-colors" aria-label="Lecture/pause">
              {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            </button>
            <button onClick={handleToggleMinimize} className="rounded-full bg-white/15 p-2 hover:bg-[rgb(var(--acc))] hover:text-white transition-colors">
              <Maximize2 size={15} />
            </button>
            <button onClick={closeAndLeave} className="rounded-full bg-white/15 p-2 hover:bg-red-500 transition-colors" aria-label="Fermer">
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Statut P2P — visible UNIQUEMENT en rebufferisation. Pendant la
          lecture, l'écran appartient au film (le chargement initial a son
          propre écran cinématique ci-dessous). */}
      {kind === 'torrent' && torrentMode !== 'webtor' && stats && buffering && (playing || time > 0) && (
        <div className="absolute top-24 right-5 rounded-md border border-white/10 bg-black/70 backdrop-blur px-3 py-2 text-[10px] font-mono space-y-1">
          <p className="flex items-center gap-2 text-white/80">
            <ArrowDownToLine size={11} className="text-[rgb(var(--acc))]" /> {formatBytes(stats.downSpeed)}/s
            <span className="text-white/40">·</span>
            <Users size={11} className="text-[rgb(var(--acc))]" /> {stats.peers}
          </p>
        </div>
      )}

      {/* Épisode suivant : compte à rebours auto + déclenchement manuel */}
      {nearEnd && !minimized && (
        <div className="absolute bottom-28 right-6 flex items-center gap-2 rise-in">
          <button
            onClick={(e) => { e.stopPropagation(); req.onNextEpisode?.() }}
            className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-5 py-3 text-sm font-bold text-white hover:scale-105 transition-transform"
          >
            <SkipForward size={16} fill="currentColor" />
            Épisode suivant {req.nextEpisodeLabel ?? ''}
            {nextIn !== null && <span className="font-mono">({nextIn})</span>}
          </button>
          {nextIn !== null && (
            <button
              onClick={(e) => { e.stopPropagation(); nextCancelRef.current = true; setNextIn(null) }}
              className="rounded-sm border border-white/25 bg-black/60 px-3 py-3 text-xs text-white/70 hover:text-white backdrop-blur"
            >
              Annuler
            </button>
          )}
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-md text-center space-y-4">
            <AlertTriangle size={36} className="mx-auto text-amber-400" />
            <p className="text-white/85">{error}</p>
            <p className="text-white/40 text-sm">
              Astuce : privilégie les sources avec le plus de seeders (👤), ou les liens Direct / HLS.
            </p>
            <button onClick={closeAndLeave} className="rounded-sm bg-[rgb(var(--acc))] px-6 py-2.5 text-sm font-bold text-white">
              Choisir une autre source
            </button>
            {kind === 'torrent' && torrentMode === 'webtor' && (
              <button
                onClick={() => { setError(null); setTorrentMode('browser') }}
                className="block mx-auto text-xs text-white/40 hover:text-[rgb(var(--acc))] underline underline-offset-4"
              >
                ou tenter en P2P navigateur (WebRTC)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Écran de chargement initial — cinématique : l'affiche du film en
          fond (pan lent), titre, et état de la connexion P2P. Plus d'écran
          noir pendant l'attente. */}
      {buffering && !playing && time === 0 && !error && !(kind === 'torrent' && torrentMode === 'webtor') && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {(req.meta.background || req.meta.poster) && (
            <img
              src={req.meta.background ?? req.meta.poster}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-45 kenburns"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/35" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
            <p className="bracket-label !text-[10px] rise-in">Préparation de ta séance</p>
            <h3 className="font-display font-black uppercase leading-[0.9] text-[clamp(1.6rem,5vw,3.2rem)] rise-in" style={{ animationDelay: '80ms' }}>
              {req.meta.name}
            </h3>
            {req.episodeLabel && (
              <p className="font-mono-label text-xs text-[rgb(var(--acc))] rise-in" style={{ animationDelay: '120ms' }}>{req.episodeLabel}</p>
            )}
            <div className="rise-in" style={{ animationDelay: '180ms' }}>
              <div className="h-12 w-12 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
            </div>
            {kind === 'torrent' && (
              <p className="text-[11px] font-mono text-white/55 rise-in" style={{ animationDelay: '240ms' }}>
                {stats && stats.peers > 0
                  ? `${stats.peers} pair${stats.peers > 1 ? 's' : ''} · ${formatBytes(stats.downSpeed)}/s`
                  : 'Connexion aux pairs…'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Rebufferisation en cours de lecture : simple spinner discret */}
      {buffering && (playing || time > 0) && !error && !(kind === 'torrent' && torrentMode === 'webtor') && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
        </div>
      )}

      {/* Contrôles (masqués en mode Webtor : le lecteur embarque les siens ;
          masqués aussi en mini-lecteur, qui a sa propre barre compacte) */}
      {!minimized && !(kind === 'torrent' && torrentMode === 'webtor') && (
      <div
        className={`absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/90 to-transparent transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={seek}
          className="w-full accent-[rgb(var(--acc))] h-1 cursor-pointer"
          aria-label="Position de lecture"
        />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => skip(-10)} className="text-white/70 hover:text-white" aria-label="Reculer de 10 s">
            <Rewind size={18} />
          </button>
          {req.onPrevEpisode && req.meta.type === 'series' && (
            <button
              onClick={req.onPrevEpisode}
              title={req.prevEpisodeLabel ? `Épisode précédent (${req.prevEpisodeLabel})` : 'Épisode précédent'}
              aria-label="Épisode précédent"
              className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <SkipBack size={15} />
              {req.prevEpisodeLabel && <span className="hidden sm:inline">{req.prevEpisodeLabel}</span>}
            </button>
          )}
          <button onClick={togglePlay} className="rounded-full bg-[rgb(var(--acc))] p-3 text-white hover:scale-105 transition-transform">
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          {req.onNextEpisode && req.meta.type === 'series' && (
            <button
              onClick={req.onNextEpisode}
              title={req.nextEpisodeLabel ? `Épisode suivant (${req.nextEpisodeLabel})` : 'Épisode suivant'}
              aria-label="Épisode suivant"
              className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              {req.nextEpisodeLabel && <span className="hidden sm:inline">{req.nextEpisodeLabel}</span>}
              <SkipForward size={15} />
            </button>
          )}
          <button onClick={() => skip(10)} className="text-white/70 hover:text-white" aria-label="Avancer de 10 s">
            <FastForward size={18} />
          </button>
          <button
            onClick={() => {
              const v = videoRef.current
              if (!v) return
              v.muted = !v.muted
              setMuted(v.muted)
            }}
            className="text-white/80 hover:text-white"
            aria-label="Son"
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volPct}
            onChange={(e) => setVol(Number(e.target.value) / 100)}
            aria-label="Volume"
            title={`Volume ${volPct}%`}
            className="h-1 w-20 cursor-pointer accent-[rgb(var(--acc))] md:w-28"
          />
          <span className="text-xs font-mono text-white/70">
            {fmt(time)} / {fmt(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Secours cloud : son absent (AC3/DTS), image qui rame… un tap
                et le lecteur cloud (transcodé) prend le relais. */}
            {kind === 'torrent' && torrentMode === 'server' && req.stream.infoHash && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toast('Bascule sur le lecteur cloud (audio reconverti)…')
                  setTorrentMode('webtor')
                }}
                className="p-1.5 text-white/70 hover:text-[rgb(var(--acc))] transition-colors"

                aria-label="Passer au lecteur cloud"
              >
                <Cloud size={19} />
              </button>
            )}
            <button
              onClick={changeSpeed}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-mono text-white/70 hover:text-[rgb(var(--acc))]"

            >
              <Gauge size={16} /> ×{speed}
            </button>
            <button
              onClick={cycleSleep}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-mono text-white/70 hover:text-[rgb(var(--acc))]"
              title={sleepMin === null ? 'Minuteur sommeil (30 → 60 → 90 min)' : `Arrêt dans ${sleepMin} min`}
            >
              <Moon size={16} />
              {sleepMin !== null && <span className="text-[10px]">{sleepMin}min</span>}
            </button>
            <button
              onClick={() => setFix1080((v) => !v)}
              className={`flex items-center gap-1 rounded px-2 py-1.5 text-xs font-mono ${fix1080 ? 'bg-emerald-400/15 text-emerald-400' : 'text-white/70 hover:text-[rgb(var(--acc))]'}`}
              title={fix1080
                ? 'Réencodage 1080p ACTIF : le serveur réencode en H264 — image réparée (H265), 3× moins de données'
                : 'Réencoder en 1080p H264 : répare l\u2019image noire (H265) et économise les données'}
            >
              <Gauge size={16} /> FIX{fix1080 && <span className="text-[10px]">1080</span>}
            </button>
            {/* Langue audio : pistes internes du fichier (HLS multi-pistes)
                ET sélecteur de version — changer de source VF/VOSTFR/VO en
                gardant la position, pour les fichiers à piste unique. */}
            {(audioTracks.length > 1 || availableVersions.length > 0) && (
              <div className="relative">
                <button
                  onClick={() => setAudioMenu((s) => !s)}
                  className={`p-1.5 ${audioMenu ? 'text-[rgb(var(--acc))]' : 'text-white/70 hover:text-white'}`}

                  aria-label="Langue audio"
                >
                  <Languages size={19} />
                </button>
                {audioMenu && (
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
                )}
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => setSubMenu((s) => !s)}
                className={`p-1.5 ${activeSub ? 'text-[rgb(var(--acc))]' : 'text-white/70 hover:text-white'}`}

              >
                <Captions size={19} />
              </button>
              {subMenu && (
                <div className="absolute bottom-10 right-0 w-64 rounded-md border border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-1.5 max-h-72 overflow-y-auto">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-mono tracking-[0.2em] text-white/40">
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
                    <p className="text-[10px] font-mono tracking-[0.2em] text-white/40">RÉGLAGES</p>
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
              )}
            </div>
            {/* Cast vers la TV : TOUJOURS visible (YouTube excepté — son
                iframe a son propre bouton). Google Cast sur Chrome, AirPlay
                sur iPhone/Mac, Remote Playback en repli. */}
            {!req.stream.ytId && (
              <button
                onClick={() => void cast()}
                className={`p-1.5 transition-colors ${
                  castState === 'connected'
                    ? 'text-[rgb(var(--acc))]'
                    : castState === 'connecting'
                      ? 'text-[rgb(var(--acc))] animate-pulse'
                      : 'text-white/70 hover:text-white'
                }`}

                aria-label="Caster sur la TV"
              >
                {airplay && !castFw ? <Airplay size={19} /> : <Cast size={19} />}
              </button>
            )}
            {/* Salon « regarder ensemble » : lecture synchronisée entre
                appareils via un code à partager. */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setSalonMenu((s) => !s) }}
                className={`p-1.5 transition-colors ${room ? 'text-[rgb(var(--acc))]' : 'text-white/70 hover:text-white'}`}

                aria-label="Salon"
              >
                <Users size={19} />
              </button>
              {salonMenu && (
                <div className="absolute bottom-10 right-0 w-72 rounded-md border border-white/10 bg-[#0a0a0a]/95 backdrop-blur p-3 space-y-2.5">
                  <p className="text-[10px] font-mono tracking-[0.2em] text-white/40">SALON — REGARDER ENSEMBLE</p>
                  {!room ? (
                    <>
                      <button
                        onClick={() => void salonCreate()}
                        disabled={salonBusy}
                        className="w-full rounded-sm bg-[rgb(var(--acc))] px-3 py-2 text-sm font-bold text-white hover:bg-[#e8252f] disabled:opacity-50 transition-colors"
                      >
                        {salonBusy ? 'Création…' : 'Créer un salon'}
                      </button>
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        Tes amis ouvrent le lecteur, touchent cette icône et entrent le code : lecture, pause et position synchronisées.
                      </p>
                      <div className="border-t border-white/10 pt-2.5">
                        <p className="mb-1.5 text-[10px] font-mono tracking-[0.2em] text-white/40">REJOINDRE</p>
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
              )}
            </div>
            <button onClick={pip} className="p-1.5 text-white/70 hover:text-white">
              <PictureInPicture2 size={19} />
            </button>
            <button
              onClick={() => setZoom((z) => { const n = !z; writeJSON('novastream:zoom', n); return n })}
              className={`p-1.5 transition-colors ${zoom ? 'text-[rgb(var(--acc2))]' : 'text-white/80 hover:text-[rgb(var(--acc))]'}`}
              aria-label={zoom ? 'Ajuster : toute l\'image visible' : 'Remplir : occupe tout l\'écran'}

            >
              {zoom ? <Shrink size={19} /> : <Expand size={19} />}
            </button>
            <button onClick={fullscreen} className="p-1.5 text-white/80 hover:text-[rgb(var(--acc))]" aria-label="Plein écran">
              <Maximize size={20} />
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Badge Webtor */}
      {kind === 'torrent' && torrentMode === 'webtor' && (
        <p className="absolute bottom-4 left-5 z-10 rounded-sm border border-white/10 bg-black/70 backdrop-blur px-3 py-1.5 text-[10px] font-mono text-[rgb(var(--acc))]">
          ☁ Lecture via Webtor (cloud) — transcodage HLS sans P2P
        </p>
      )}

      {/* Badge Cast : lecture en cours sur la TV */}
      {castState === 'connected' && (
        <p className="absolute top-20 left-5 z-10 flex items-center gap-2 rounded-sm border border-[rgb(var(--acc))]/30 bg-black/70 backdrop-blur px-3 py-1.5 text-[10px] font-mono text-[rgb(var(--acc))]">
          <Cast size={12} /> Lecture sur la TV — les contrôles ici pilotent le grand écran
        </p>
      )}
    </div>
  )
}
