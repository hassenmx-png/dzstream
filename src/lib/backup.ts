/**
 * Sauvegarde / restauration complète de DZ STREAM (fichier JSON).
 *
 * Regroupe TOUTES les données locales de l'application : bibliothèque,
 * progression de visionnage, clés debrid, thème, préférences sous-titres,
 * historique de recherche… Exporte un fichier JSON téléchargeable,
 * restaurable sur n'importe quel appareil (puis rechargement de la page).
 */

export interface BackupFile {
  app: 'novastream'
  version: 1
  exportedAt: string
  data: Record<string, unknown>
}

const PREFIX = 'novastream:'

export function exportBackup(): BackupFile {
  const data: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(PREFIX)) continue
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    try {
      data[key] = JSON.parse(raw) as unknown
    } catch {
      data[key] = raw
    }
  }
  return { app: 'novastream', version: 1, exportedAt: new Date().toISOString(), data }
}

/** Déclenche le téléchargement du fichier de sauvegarde. */
export function downloadBackup(): void {
  const backup = exportBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `novastream-sauvegarde-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function importBackupText(text: string): { ok: true; count: number } | { ok: false; error: string } {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(text) as BackupFile
  } catch {
    return { ok: false, error: 'Fichier illisible : ce n’est pas un JSON valide.' }
  }
  if (parsed?.app !== 'novastream' || typeof parsed.data !== 'object' || parsed.data === null) {
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde DZ STREAM.' }
  }
  let count = 0
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!key.startsWith(PREFIX)) continue
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
      count++
    } catch { /* quota dépassé : clé ignorée */ }
  }
  return { ok: true, count }
}
