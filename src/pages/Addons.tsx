import { useEffect, useState } from 'react'
import { Download, HardDriveDownload, Upload, AlertTriangle, Check, Crown, Layers, Link2, Plus, Power, Settings, Trash2, Zap } from 'lucide-react'
import { downloadBackup, importBackupText } from '@/lib/backup'
import { RECOMMENDED_ADDONS, getDebrids, installAddon, normalizeAddonUrl, removeAddon, removeDebrid, setDebrid, toggleAddon, upsertDebrid, type DebridConfig } from '@/lib/addons'
import { useStored } from '@/lib/store'
import type { InstalledAddon } from '@/types'

const DEBRID_SERVICES: { id: DebridConfig['service']; name: string; site: string; note: string }[] = [
  { id: 'alldebrid', name: 'AllDebrid', site: 'https://alldebrid.com', note: 'français, essai gratuit' },
  { id: 'realdebrid', name: 'Real-Debrid', site: 'https://real-debrid.com', note: 'le plus populaire' },
  { id: 'torbox', name: 'TorBox', site: 'https://torbox.app', note: 'plan gratuit dispo, multi-IP autorisé' },
  { id: 'premiumize', name: 'Premiumize', site: 'https://premiumize.me', note: '' },
  { id: 'debridlink', name: 'Debrid-Link', site: 'https://debrid-link.com', note: 'français' },
  { id: 'easydebrid', name: 'EasyDebrid', site: 'https://easydebrid.com', note: '' },
  { id: 'offcloud', name: 'Offcloud', site: 'https://offcloud.com', note: '' },
]

export default function AddonsPage() {
  const [addons] = useStored<InstalledAddon[]>('novastream:addons', [])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [configureUrl, setConfigureUrl] = useState<string | null>(null)
  const [busyRec, setBusyRec] = useState<string | null>(null)
  // Debrid premium — MULTI-services : AllDebrid + TorBox (et clés perso)
  // actifs EN PARALLÈLE, leurs sources apparaissent côte à côte.
  const [debrids, setDebridsState] = useState<DebridConfig[]>(getDebrids())
  const [debridService, setDebridService] = useState<DebridConfig['service']>('alldebrid')
  const [debridKey, setDebridKey] = useState('')
  const [debridBusy, setDebridBusy] = useState(false)
  const [debridError, setDebridError] = useState<string | null>(null)

  // Statut premium en direct par service (plan, compte, jours restants)
  const [premiums, setPremiums] = useState<Record<string, { username?: string; plan?: number; daysLeft?: number | null }>>({})
  useEffect(() => {
    setPremiums({})
    for (const d of debrids) {
      fetch(`/api/stream/debrid-check?service=${d.service}&key=${encodeURIComponent(d.key)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) setPremiums((p) => ({ ...p, [d.service]: { username: j.username, plan: j.plan, daysLeft: j.daysLeft ?? null } }))
        })
        .catch(() => { /* silencieux : le badge CONNECTÉ suffit */ })
    }
  }, [debrids])

  const TB_PLANS: Record<number, string> = { 0: 'Gratuit', 1: 'Essential', 2: 'Pro', 3: 'Standard' }

  /**
   * Vérifie une clé auprès du service : demande de vraies sources à Torrentio
   * configuré, puis SUIT un lien /resolve/ (via notre serveur, anti-CORS).
   * Torrentio renvoie des liens /resolve/ même avec une fausse clé (résolution
   * paresseuse) ; une clé invalide redirige vers une vidéo « failed_access »,
   * une clé valide vers le vrai fichier (CDN debrid).
   * Renvoie null si la clé fonctionne, sinon le message d'erreur à afficher.
   */
  const verifyKey = async (service: DebridConfig['service'], key: string): Promise<string | null> => {
    try {
      // 1) Diagnostic précis via l'API officielle du service (AllDebrid) :
      //    distingue clé bloquée (email de confirmation à cliquer), compte
      //    expiré, et vraie clé invalide.
      const dc = await fetch(`/api/stream/debrid-check?service=${service}&key=${encodeURIComponent(key)}`)
      if (dc.ok) {
        const j = (await dc.json()) as { ok?: boolean | null; premium?: boolean; code?: string }
        if (j.ok === false) {
          if (j.code === 'AUTH_BLOCKED') {
            return 'AllDebrid a verrouillé ta clé par sécurité (nouvelle localisation) : un EMAIL de confirmation t\'a été envoyé. Clique le lien dans ce mail (regarde les spams), puis reteste ici.'
          }
          if (j.code === 'AUTH_BAD_APIKEY') {
            return 'Clé invalide — recopie-la exactement depuis alldebrid.com → réglages → clés API.'
          }
          if (j.code === 'AUTH_USER_BANNED') return 'Ce compte AllDebrid est banni.'
          return 'Clé refusée par le service — vérifie ta clé API sur le site du service.'
        }
        if (j.ok === true && j.premium === false) {
          return 'Ta clé fonctionne, mais ton compte AllDebrid n\'est PAS premium (essai expiré ?). Renouvelle-le sur alldebrid.com puis reteste.'
        }
      }
      // 2) Test réel : demande de vraies sources à Torrentio configuré, puis
      //    SUIT un lien /resolve/ (via notre serveur, anti-CORS). Torrentio
      //    renvoie des liens /resolve/ même avec une fausse clé (résolution
      //    paresseuse) ; une clé invalide redirige vers une vidéo
      //    « failed_access », une clé valide vers le vrai fichier (CDN debrid).
      const testUrl = `https://torrentio.strem.fun/${service}=${encodeURIComponent(key)}|language=french/stream/movie/tt1517268.json`
      const res = await fetch(testUrl)
      if (!res.ok) throw new Error('réseau')
      const data = (await res.json()) as { streams?: { url?: string }[] }
      const resolveUrl = (data.streams ?? []).find((s) => s.url && /\/resolve\//.test(s.url))?.url
      if (!resolveUrl) {
        return 'Clé refusée ou aucun lien premium retourné — vérifie ta clé API sur le site du service.'
      }
      const check = await fetch(`/api/stream/resolve-check?url=${encodeURIComponent(resolveUrl)}`)
      if (!check.ok) throw new Error('réseau')
      const { finalUrl } = (await check.json()) as { finalUrl?: string }
      if (!finalUrl || /failed_access/i.test(finalUrl)) {
        return 'Le service refuse de débloquer les liens avec cette clé. Si tu viens de confirmer l\'email AllDebrid, attends 1 minute et reteste.'
      }
      return null
    } catch {
      return 'Vérification impossible (réseau). Réessaie.'
    }
  }

  /** Ajoute/remplace un service : vérification puis enregistrement. */
  const connectDebrid = async () => {
    const key = debridKey.trim()
    if (!key) return
    setDebridBusy(true)
    setDebridError(null)
    const err = await verifyKey(debridService, key)
    if (err) {
      setDebridError(err)
    } else {
      upsertDebrid({ service: debridService, key })
      setDebridsState(getDebrids())
      setDebridKey('')
      setOk('Service premium connecté — ses sources instantanées rejoignent les autres.')
    }
    setDebridBusy(false)
  }

  /** Re-teste une clé enregistrée (abonnement expiré ? clé révoquée ?). */
  const testDebrid = async (service: DebridConfig['service'], key: string) => {
    setDebridBusy(true)
    setDebridError(null)
    setOk(null)
    const err = await verifyKey(service, key)
    if (err) {
      setDebridError(err)
    } else {
      upsertDebrid({ service, key }) // réinitialise le drapeau « HS » du service
      setDebridsState(getDebrids())
      setOk(`Connexion ${DEBRID_SERVICES.find((s) => s.id === service)?.name ?? service} vérifiée — tout fonctionne.`)
    }
    setDebridBusy(false)
  }

  /** Retire UN service précis (les autres restent actifs). */
  const removeDebridEntry = (service: DebridConfig['service']) => {
    removeDebrid(service)
    setDebridsState(getDebrids())
  }

  /** Déconnecte tous les services d'un coup. */
  const disconnectAllDebrids = () => {
    setDebrid(null)
    setDebridsState([])
  }

  /** Installation en 1 clic depuis la vitrine « Recommandés ». */
  const installRecommended = async (recUrl: string) => {
    setBusyRec(recUrl)
    setError(null)
    setOk(null)
    try {
      const addon = await installAddon(recUrl)
      setOk(`« ${addon.manifest.name} » installé avec succès.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'installation.")
    } finally {
      setBusyRec(null)
    }
  }

  const isInstalled = (recUrl: string) =>
    addons.some((a) => a.url === normalizeAddonUrl(recUrl))

  const install = async () => {
    if (!url.trim()) return
    setBusy(true)
    setError(null)
    setOk(null)
    setConfigureUrl(null)
    try {
      const addon = await installAddon(url)
      setOk(`« ${addon.manifest.name} » installé avec succès.`)
      // Addons à configuration obligatoire (clés personnelles : debrid, TMDB…)
      // : installés tels quels, ils ne renvoient aucune source. On pointe
      // l'utilisateur vers la page de configuration de l'addon.
      if (addon.manifest.behaviorHints?.configurationRequired) {
        setConfigureUrl(`${normalizeAddonUrl(url)}/configure`)
      }
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'installation.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen max-w-4xl">
      <p className="bracket-label mb-2">Sources & extensions</p>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase">Addons</h1>
      <p className="mt-4 text-white/55 text-sm leading-relaxed max-w-2xl">
        DZ STREAM utilise le protocole ouvert de Stremio : les addons fournissent les sources de
        lecture (liens directs, HLS, torrents P2P). Colle l'URL d'un addon compatible pour l'installer.
      </p>

      {/* Installation */}
      <div className="mt-8 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Link2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && install()}
            placeholder="https://mon-addon.example.com  (ou …/manifest.json)"
            className="w-full rounded-sm border border-white/15 bg-white/[0.04] py-3.5 pl-11 pr-4 text-sm font-mono outline-none focus:border-[rgb(var(--acc))] transition-colors placeholder:text-white/25"
          />
        </div>
        <button
          onClick={install}
          disabled={busy || !url.trim()}
          className="rounded-sm bg-[rgb(var(--acc))] px-7 py-3.5 text-sm font-bold text-white hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-40"
        >
          {busy ? 'Installation…' : 'Installer'}
        </button>
      </div>
      {/* Streaming premium (debrid) */}
      <div className="mt-8 rounded-md border border-[rgb(var(--acc))]/25 bg-[rgb(var(--acc))]/[0.04] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Zap size={16} className="text-[rgb(var(--acc))]" />
          <h2 className="text-sm font-bold tracking-wide">STREAMING PREMIUM (DEBRID)</h2>
          {debrids.length > 0 && (
            <span className="rounded-sm bg-[rgb(var(--acc))] px-2 py-0.5 text-[10px] font-bold text-white">
              CONNECTÉ · {debrids.length} SERVICE{debrids.length > 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-white/50 leading-relaxed max-w-2xl">
          Un compte debrid transforme chaque torrent en lien direct premium :
          <strong className="text-white/75"> lecture instantanée, zéro erreur, 1080p/4K sans chargement.</strong>
          {' '}La clé reste stockée uniquement sur ton appareil.
        </p>
        {debrids.length > 0 && (
          <div className="mt-4 space-y-3">
            {debrids.map((debrid) => {
              const premium = premiums[debrid.service]
              return (
                <div key={debrid.service} className="space-y-3">
            {/* Statut premium en direct : plan, compte, jours restants */}
            {premium && (
              <div className="rounded-md border border-[rgb(var(--acc))]/25 bg-gradient-to-r from-[rgb(var(--acc4))]/10 via-transparent to-[rgb(var(--acc3))]/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-[rgb(var(--acc))]/15 border border-[rgb(var(--acc))]/40 p-2">
                      <Crown size={16} className="text-[rgb(var(--acc))]" />
                    </span>
                    <div>
                      <p className="text-sm font-bold">
                        {debrid.service === 'torbox' ? `Plan ${TB_PLANS[premium.plan ?? 0] ?? premium.plan}` : 'Premium actif'}
                      </p>
                      {premium.username && <p className="text-[11px] text-white/40 font-mono">{premium.username}</p>}
                    </div>
                  </div>
                  {premium.daysLeft !== null && premium.daysLeft !== undefined && (
                    <div className="text-right">
                      <p className={`font-display text-2xl font-black ${premium.daysLeft <= 2 ? 'text-red-400' : premium.daysLeft <= 7 ? 'text-amber-300' : 'text-[rgb(var(--acc))]'}`}>
                        {premium.daysLeft} j
                      </p>
                      <p className="text-[10px] font-mono-label text-white/40">RESTANTS</p>
                    </div>
                  )}
                </div>
                {premium.daysLeft !== null && premium.daysLeft !== undefined && (
                  <>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all ${premium.daysLeft <= 2 ? 'bg-red-400' : premium.daysLeft <= 7 ? 'bg-amber-300' : 'bg-gradient-to-r from-[rgb(var(--acc4))] via-[rgb(var(--acc2))] to-[rgb(var(--acc3))]'}`}
                        style={{ width: `${Math.min(100, (premium.daysLeft / 30) * 100)}%` }}
                      />
                    </div>
                    {premium.daysLeft <= 7 && (
                      <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-xs ${premium.daysLeft <= 2 ? 'border-red-400/40 bg-red-400/10 text-red-200' : 'border-amber-300/40 bg-amber-300/10 text-amber-100'}`}>
                        <AlertTriangle size={14} className="shrink-0" />
                        {premium.daysLeft <= 2
                          ? 'Ton premium expire très bientôt — les sources ⚡ vont disparaître !'
                          : 'Pense à prolonger avant expiration pour garder les sources ⚡ premium.'}
                        <a
                          href={debrid.service === 'torbox' ? 'https://torbox.app/settings?type=subscription' : DEBRID_SERVICES.find((s) => s.id === debrid.service)?.site}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto rounded-sm bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25 transition-colors"
                        >
                          Prolonger →
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-white/45 font-mono">
                Clé : {debrid.key.slice(0, 4)}••••••••{debrid.key.slice(-3)}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => testDebrid(debrid.service, debrid.key)}
                  disabled={debridBusy}
                  className="rounded-sm border border-[rgb(var(--acc))]/40 px-4 py-2 text-xs font-semibold text-[rgb(var(--acc))] hover:bg-[rgb(var(--acc))]/10 transition-colors disabled:opacity-40"
                >
                  {debridBusy ? 'Test…' : 'Tester la connexion'}
                </button>
                <button
                  onClick={() => removeDebridEntry(debrid.service)}
                  className="rounded-sm border border-red-400/40 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10 transition-colors"
                >
                  Retirer
                </button>
              </div>
            </div>
                </div>
              )
            })}
            {debridError && <p className="text-xs text-red-400">{debridError}</p>}
          </div>
        )}
        <div className="mt-4 space-y-3">
          <p className="text-[10px] font-mono-label uppercase tracking-widest text-white/35">Ajouter ou remplacer un service</p>
            <div className="flex flex-wrap gap-2">
              {DEBRID_SERVICES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setDebridService(s.id)}
                  className={`rounded-sm border px-3 py-1.5 text-xs transition-colors ${
                    debridService === s.id
                      ? 'border-[rgb(var(--acc))] bg-[rgb(var(--acc))] font-bold text-white'
                      : 'border-white/15 text-white/60 hover:border-white/40'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={debridKey}
                onChange={(e) => setDebridKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectDebrid()}
                placeholder="Colle ta clé API ici"
                className="flex-1 rounded-sm border border-white/15 bg-white/[0.04] py-3 px-4 text-sm font-mono outline-none focus:border-[rgb(var(--acc))] transition-colors placeholder:text-white/25"
              />
              <button
                onClick={connectDebrid}
                disabled={debridBusy || !debridKey.trim()}
                className="rounded-sm bg-[rgb(var(--acc))] px-6 py-3 text-sm font-bold text-white hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-40"
              >
                {debridBusy ? 'Vérification…' : 'Connecter'}
              </button>
            </div>
            {debridError && <p className="text-xs text-red-400">{debridError}</p>}
            <p className="text-[11px] text-white/35">
              Pas de compte ?{' '}
              <a
                href={DEBRID_SERVICES.find((s) => s.id === debridService)?.site}
                target="_blank"
                rel="noreferrer"
                className="text-[rgb(var(--acc))] underline underline-offset-2"
              >
                Crée-en un sur {DEBRID_SERVICES.find((s) => s.id === debridService)?.name}
              </a>
              {DEBRID_SERVICES.find((s) => s.id === debridService)?.note &&
                ` (${DEBRID_SERVICES.find((s) => s.id === debridService)?.note})`}
              {' '}→ puis copie ta clé API dans les réglages de ton compte.
            </p>
            {debrids.length > 0 && (
              <button
                onClick={disconnectAllDebrids}
                className="rounded-sm border border-red-400/40 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10 transition-colors"
              >
                Tout déconnecter
              </button>
            )}
          </div>
      </div>

      {/* Sauvegarde & restauration */}
      <div className="mt-8 rounded-md border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-2">
          <HardDriveDownload size={16} className="text-white/60" />
          <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">SAUVEGARDE &amp; RESTAURATION</p>
        </div>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/50">
          Exporte l'intégralité de tes données — bibliothèque, progression, clés debrid,
          réglages, thème, historique — dans un fichier JSON. Restaure-le sur n'importe
          quel appareil pour tout retrouver.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => { setBackupError(null); downloadBackup(); setOk('Sauvegarde téléchargée.') }}
            className="flex items-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/5"
          >
            <Download size={14} /> Exporter mes données
          </button>
          <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/5">
            <Upload size={14} /> Importer une sauvegarde
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const r = new FileReader()
                r.onload = () => {
                  const res = importBackupText(String(r.result ?? ''))
                  if (res.ok) {
                    setBackupError(null)
                    setOk(`Sauvegarde restaurée (${res.count} éléments). Rechargement…`)
                    setTimeout(() => window.location.reload(), 1200)
                  } else {
                    setBackupError(res.error)
                  }
                }
                r.readAsText(f)
              }}
            />
          </label>
        </div>
        {backupError && <p className="mt-3 text-xs text-red-400">{backupError}</p>}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {ok && <p className="mt-3 text-sm text-[rgb(var(--acc))]">{ok}</p>}
      {configureUrl && (
        <div className="mt-3 flex items-start gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-4">
          <Settings size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-sm text-amber-200/90 leading-relaxed">
            Cet addon nécessite une configuration personnelle (clés debrid, TMDB…) avant de
            fonctionner.{' '}
            <a
              href={configureUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200"
            >
              Ouvre sa page de configuration
            </a>
            , génère ton lien personnalisé, puis réinstalle l'addon avec CE lien.
          </p>
        </div>
      )}

      {/* Vitrine recommandés — installation en 1 clic */}
      <div className="mt-12">
        <p className="bracket-label mb-2">Sélection DZ STREAM</p>
        <h2 className="font-display text-2xl md:text-3xl font-black uppercase">Addons recommandés</h2>
        <p className="mt-2 text-xs text-white/45 leading-relaxed max-w-2xl">
          Tous testés et vérifiés fonctionnels sans configuration : <strong className="text-white/70">P2P, sources directes,
          sous-titres et catalogues</strong>. Installation en un clic, aucune URL à copier.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {RECOMMENDED_ADDONS.map((r) => {
            const installed = isInstalled(r.url)
            return (
              <div
                key={r.url}
                className={`flex items-start gap-3 rounded-md border p-4 transition-colors ${
                  installed ? 'border-[rgb(var(--acc))]/25 bg-[rgb(var(--acc))]/[0.04]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                {r.logo ? (
                  <img src={r.logo} alt="" className="h-10 w-10 shrink-0 rounded object-contain bg-white/5" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/5">
                    <Layers size={18} className="text-[rgb(var(--acc))]" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm">{r.name}</p>
                    {r.tags?.map((t) => (
                      <span
                        key={t}
                        className="rounded-sm border border-white/15 px-1.5 py-px text-[9px] font-mono uppercase tracking-wider text-white/50"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-white/50 leading-relaxed">{r.desc}</p>
                </div>
                <button
                  onClick={() => installRecommended(r.url)}
                  disabled={installed || busyRec === r.url}
                  className={`shrink-0 rounded-sm px-3.5 py-2 text-xs font-bold transition-all ${
                    installed
                      ? 'cursor-default bg-[rgb(var(--acc))]/15 text-[rgb(var(--acc))]'
                      : 'bg-[rgb(var(--acc))] text-white hover:scale-[1.03] active:scale-95 disabled:opacity-40'
                  }`}
                >
                  {installed ? (
                    <span className="flex items-center gap-1"><Check size={13} /> Installé</span>
                  ) : busyRec === r.url ? (
                    '…'
                  ) : (
                    <span className="flex items-center gap-1"><Plus size={13} /> Installer</span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Liste */}
      <p className="bracket-label mt-12 mb-4">Installés sur cet appareil</p>
      <div className="space-y-3">
        {addons.length === 0 && (
          <div className="rounded-md border border-dashed border-white/15 p-10 text-center">
            <Layers size={28} className="mx-auto mb-3 text-white/25" />
            <p className="text-white/40 text-sm">Aucun addon installé pour l'instant.</p>
            <p className="mt-1 text-white/25 text-xs font-mono">
              Les métadonnées (affiches, synopsis) fonctionnent déjà sans addon.
            </p>
          </div>
        )}
        {addons.map((a) => (
          <div
            key={a.url}
            className={`flex items-center gap-4 rounded-md border p-4 transition-colors ${
              a.enabled ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-transparent opacity-50'
            }`}
          >
            {a.manifest.logo ? (
              <img src={a.manifest.logo} alt="" className="h-10 w-10 rounded object-contain bg-white/5" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded bg-white/5">
                <Layers size={18} className="text-[rgb(var(--acc))]" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm flex items-center gap-2">
                {a.manifest.name}
                <span className="text-[10px] font-mono text-white/30">v{a.manifest.version}</span>
              </p>
              {a.manifest.description && (
                <p className="mt-0.5 line-clamp-1 text-xs text-white/40">{a.manifest.description}</p>
              )}
              <p className="mt-1 flex flex-wrap gap-1.5">
                {a.manifest?.resources?.map((r, i) => (
                  <span key={i} className="rounded border border-white/10 px-1.5 py-px text-[9px] font-mono text-white/45 uppercase">
                    {typeof r === 'string' ? r : r.name}
                  </span>
                ))}
              </p>
            </div>
            <button
              onClick={() => toggleAddon(a.url)}
              className={`p-2.5 rounded-full transition-colors ${
                a.enabled ? 'text-[rgb(var(--acc))] hover:bg-[rgb(var(--acc))]/10' : 'text-white/30 hover:bg-white/10'
              }`}
              title={a.enabled ? 'Désactiver' : 'Activer'}
            >
              <Power size={17} />
            </button>
            <button
              onClick={() => removeAddon(a.url)}
              className="p-2.5 rounded-full text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              title="Désinstaller"
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-md border border-white/8 bg-white/[0.02] p-5 text-xs text-white/40 leading-relaxed space-y-2">
        <p className="bracket-label !text-[10px]">Bon à savoir</p>
        <p>— N'importe quel addon respectant le protocole Stremio (manifest.json) est compatible.</p>
        <p>— Les flux HTTP/HLS se lisent directement. Les torrents passent par WebTorrent (P2P WebRTC dans le navigateur) : seuls les pairs compatibles WebRTC sont joignables.</p>
        <p>— Tu es responsable des addons que tu installes et des contenus auxquels ils donnent accès.</p>
      </div>
    </div>
  )
}
