/** Détection des codecs audio incompatibles navigateur (partagé Detail + Player). */
export function detectRiskyAudio(text: string): string | null {
  const t = ` ${text.toLowerCase()} `
  const m = t.match(
    /\b(dts-?hd(?:\.?ma|\.?hr)?|dts-?x|dtsx|dd\+|ddp\d*\.?\d*|e-?ac-?3|ec3|ac-?3|dd[257]\.?\d|dd1\.0|true-?hd|thd|mlp|atmos|dolby)\b/i,
  )
  if (m) {
    const c = m[1].toLowerCase().replace(/[-.+]/g, '')
    if (c.startsWith('dts')) return 'DTS'
    if (c.startsWith('ddp') || c === 'dd' || c.startsWith('eac3') || c === 'ec3') return 'EAC3'
    if (c.startsWith('dd') || c.startsWith('ac3')) return 'AC3'
    if (c.startsWith('truehd') || c === 'thd' || c === 'mlp') return 'TrueHD'
    if (c.startsWith('atmos') || c === 'dolby') return 'Atmos'
    return m[1].toUpperCase()
  }
  if (/\b[57][.,]1\b/.test(t) && !/aac/.test(t)) return '5.1 ?'
  return null
}

/** URL du serveur de transcodage configuré (option Réglages). */
const TRANSCODE_KEY = 'novastream:transcode-server'
export function getTranscodeServer(): string {
  try {
    return localStorage.getItem(TRANSCODE_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setTranscodeServer(url: string): void {
  try {
    localStorage.setItem(TRANSCODE_KEY, url.trim().replace(/\/$/, ''))
  } catch { /* ignore */ }
}

/** Si la source a un audio risqué ET un serveur configuré → URL transcodée. */
export function maybeTranscode(streamUrl: string, title: string): string {
  const server = getTranscodeServer()
  if (!server) return streamUrl
  if (!detectRiskyAudio(title)) return streamUrl
  return `${server}/api/transcode?url=${encodeURIComponent(streamUrl)}`
}
