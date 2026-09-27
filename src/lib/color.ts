/**
 * Couleur dominante d'une affiche — utilisée pour le halo ambiant des
 * fiches (chaque page prend l'ambiance lumineuse de son visuel).
 *
 * Moyenne pondérée par saturation : les pixels vifs (verts Matrix, rouges
 * néon…) comptent plus que les gris, sinon tout vire au boueux. Les pixels
 * quasi noirs ou quasi blancs sont écartés (pas d'info d'ambiance).
 * TMDB/metahub servent leurs images avec CORS * — si une source refuse
 * (canvas « tainted »), on retombe proprement sur null (pas de halo).
 */

const cache = new Map<string, string | null>()

async function extract(url: string): Promise<string> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const w = 24
  const h = Math.max(1, Math.round((w * img.height) / (img.width || w)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-2d')
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h) // lève si canvas « souillé » (CORS)
  let r = 0
  let g = 0
  let b = 0
  let tot = 0
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i]
    const G = data[i + 1]
    const B = data[i + 2]
    const mx = Math.max(R, G, B)
    const mn = Math.min(R, G, B)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255
    if (lum < 0.06 || lum > 0.94) continue // noir/blanc pur : ignorés
    const weight = 0.2 + sat * 0.8
    r += R * weight
    g += G * weight
    b += B * weight
    tot += weight
  }
  if (!tot) throw new Error('empty')
  return `rgb(${Math.round(r / tot)}, ${Math.round(g / tot)}, ${Math.round(b / tot)})`
}

export async function dominantColor(url?: string): Promise<string | null> {
  if (!url) return null
  const hit = cache.get(url)
  if (hit !== undefined) return hit
  let col: string | null = null
  try {
    col = await extract(url)
  } catch {
    // CORS refusé par l'hôte (ex. metahub) → même image via notre proxy
    // serveur, qui ajoute les en-têtes manquants (liste blanche côté API).
    try {
      col = await extract(`/api/img?url=${encodeURIComponent(url)}`)
    } catch {
      col = null
    }
  }
  cache.set(url, col)
  return col
}

/** rgb(r, g, b) → rgba(r, g, b, a) pour doser l'intensité du halo. */
export function withAlpha(rgb: string, alpha: number): string {
  return rgb.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`)
}
