/** Page Réglages : centralise thème, profils, sauvegarde et accès debrid. */
import { useEffect, useState } from 'react'
import { HardDriveDownload, Download, Upload, Zap, Palette, UserRound, Info } from 'lucide-react'
import AccentMenu from '@/components/Nav'
import { downloadBackup, importBackupText } from '@/lib/backup'
import { getActiveProfile, getProfiles } from '@/lib/profiles'
import { getOpensubsKey, setOpensubsKey } from '@/lib/opensubs'
import {
  getTrakt, patchTrakt, saveTrakt, clearTrakt,
  startDeviceFlow, pollDeviceToken, type DeviceFlow,
} from '@/lib/trakt'
import {
  getSimkl, patchSimkl, saveSimkl, clearSimkl,
  simklStartDeviceFlow, simklPollDeviceToken, simklFetchWatchlist, type SimklDeviceFlow,
} from '@/lib/simkl'
import { readJSON, writeJSON } from '@/lib/store'
import { LIB_KEY } from '@/lib/library'
import { toast } from '@/lib/toast'
import type { LibraryItem } from '@/types'

/** Connexion Trakt : flux appareil (code affiché à l'écran). */
function TraktCard() {
  const [cfg, setCfg] = useState(() => getTrakt())
  const [clientId, setClientId] = useState(cfg?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState(cfg?.clientSecret ?? '')
  const [flow, setFlow] = useState<DeviceFlow | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const connected = !!cfg?.accessToken

  useEffect(() => {
    if (!flow) return
    const iv = setInterval(() => {
      if (Date.now() > flow.expiresAt) {
        setStatus('Code expiré — relance la connexion')
        setFlow(null)
        return
      }
      void pollDeviceToken(flow.deviceCode).then((r) => {
        if (r === 'ok') { setFlow(null); setCfg(getTrakt()); setStatus('Connecté à Trakt ✓') }
        else if (r !== 'pending') setStatus(r)
      })
    }, Math.max(flow.interval, 2) * 1000)
    return () => clearInterval(iv)
  }, [flow])

  const connect = async () => {
    saveTrakt({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), accessToken: '', refreshToken: '', username: '', scrobble: cfg?.scrobble ?? true })
    setStatus('Demande de code…')
    const r = await startDeviceFlow()
    if ('error' in r) { setStatus(r.error); return }
    setFlow(r)
    setStatus(null)
  }

  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-2">
        <span className="text-base">🎞️</span>
        <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">TRAKT.TV</p>
        {connected && <span className="rounded-sm bg-[rgb(var(--acc))] px-2 py-0.5 text-[10px] font-bold text-white">CONNECTÉ</span>}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Synchronise ton historique : les films et épisodes regardés (à 80 %) sont marqués comme vus sur Trakt, visible partout.
      </p>
      {!connected && (
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-white/45">
          <li>Crée un compte gratuit sur trakt.tv</li>
          <li>Ouvre <a href="https://trakt.tv/oauth/applications" target="_blank" rel="noopener noreferrer" className="font-semibold text-[rgb(var(--acc))] underline">trakt.tv/oauth/applications</a> → <em>New Application</em> : nom « DZ STREAM », Redirect URI <code className="rounded bg-white/10 px-1">urn:ietf:wg:oauth:2.0:oob</code></li>
          <li>Copie le <strong>Client ID</strong> et le <strong>Client Secret</strong> (PAS ton pseudo/mot de passe !) ci-dessous</li>
        </ol>
      )}
      {!connected ? (
        <div className="mt-4 space-y-2">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID Trakt"
            className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-xs outline-none focus:border-[rgb(var(--acc))]"
          />
          <input
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client Secret Trakt"
            type="password"
            className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-xs outline-none focus:border-[rgb(var(--acc))]"
          />
          <button
            onClick={() => void connect()}
            disabled={!clientId.trim() || !clientSecret.trim() || !!flow}
            className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {flow ? 'En attente de validation…' : 'Connecter Trakt'}
          </button>
          {flow && (
            <div className="rounded border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <p>1. Va sur <a href={flow.verificationUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[rgb(var(--acc))] underline">{flow.verificationUrl.replace('https://', '')}</a></p>
              <p className="mt-1.5">2. Entre le code : <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-base font-bold tracking-[0.3em] text-white">{flow.userCode}</span></p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-white/70">Compte : <span className="font-bold text-white">@{cfg?.username || 'inconnu'}</span></p>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={cfg?.scrobble ?? true}
              onChange={(e) => { patchTrakt({ scrobble: e.target.checked }); setCfg(getTrakt()) }}
              className="accent-[rgb(var(--acc))]"
            />
            Marquer automatiquement les vus (à 80 % de lecture)
          </label>
          <button
            onClick={() => { clearTrakt(); setCfg(null); setFlow(null); setStatus(null); setClientSecret('') }}
            className="rounded-sm border border-red-400/40 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-400/10"
          >
            Déconnecter
          </button>
        </div>
      )}
      {status && <p className="mt-3 text-xs text-[rgb(var(--acc))]">{status}</p>}
    </section>
  )
}

/** Clé API OpenSubtitles.com (gratuite) : sous-titres VOSTFR/anime. */
function OpensubsCard() {
  const [key, setKey] = useState(() => getOpensubsKey())
  const [saved, setSaved] = useState(false)
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-2">
        <span className="text-base">📝</span>
        <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">OPENSUBTITLES.COM (VOSTFR)</p>
        {getOpensubsKey() && <span className="rounded-sm bg-[rgb(var(--acc))] px-2 py-0.5 text-[10px] font-bold text-white">ACTIF</span>}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Source complémentaire de sous-titres français — couverture anime/VOSTFR supérieure. Clé gratuite :
        créez un compte sur opensubtitles.com → <em>API consumers</em> → « Add new consumer » → copiez la clé.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={key}
          onChange={(e) => { setKey(e.target.value); setSaved(false) }}
          placeholder="Clé API OpenSubtitles.com"
          className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs outline-none focus:border-[rgb(var(--acc))]"
        />
        <button
          onClick={() => { setOpensubsKey(key); setSaved(true) }}
          className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
        >
          Enregistrer
        </button>
      </div>
      {saved && <p className="mt-2 text-xs text-[rgb(var(--acc))]">Clé enregistrée ✓ — les sous-titres VOSTFR arrivent.</p>}
    </section>
  )
}

/** Connexion Simkl (gratuit) : flux appareil, même principe que Trakt. */
function SimklCard() {
  const [cfg, setCfg] = useState(() => getSimkl())
  const [clientId, setClientId] = useState(cfg?.clientId ?? '')
  const [flow, setFlow] = useState<SimklDeviceFlow | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const connected = !!cfg?.accessToken
  const [importing, setImporting] = useState(false)

  // Importe la watchlist Simkl dans « Ma Liste » DZ STREAM (fusion par id,
  // sans doublon, sans toucher à la progression ni à l'historique).
  const importWatchlist = async () => {
    if (importing) return
    setImporting(true)
    try {
      const items = await simklFetchWatchlist()
      const cur = readJSON<LibraryItem[]>(LIB_KEY, [])
      const have = new Set(cur.map((i) => i.id))
      const fresh = items.filter((i) => !have.has(i.id))
      if (fresh.length > 0) {
        writeJSON(LIB_KEY, [...cur, ...fresh.map((i) => ({ ...i, addedAt: Date.now() }))])
      }
      toast(fresh.length > 0 ? `${fresh.length} titre${fresh.length > 1 ? 's' : ''} importé${fresh.length > 1 ? 's' : ''} de Simkl ✅` : 'Watchlist déjà à jour ✅')
    } catch {
      toast('Import impossible — vérifie la connexion Simkl')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    if (!flow) return
    const iv = setInterval(() => {
      if (Date.now() > flow.expiresAt) {
        setStatus('Code expiré — relance la connexion')
        setFlow(null)
        return
      }
      void simklPollDeviceToken(flow.userCode).then((r) => {
        if (r === 'ok') { setFlow(null); setCfg(getSimkl()); setStatus('Connecté à Simkl ✓') }
        else if (r !== 'pending') setStatus(r)
      })
    }, Math.max(flow.interval, 2) * 1000)
    return () => clearInterval(iv)
  }, [flow])

  const connect = async () => {
    saveSimkl({ clientId: clientId.trim(), accessToken: '', username: '', scrobble: cfg?.scrobble ?? true })
    setStatus('Demande de code…')
    const r = await simklStartDeviceFlow()
    if ('error' in r) { setStatus(r.error); return }
    setFlow(r)
    setStatus(null)
  }

  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-2">
        <span className="text-base">🆓</span>
        <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">SIMKL (GRATUIT — recommandé)</p>
        {connected && <span className="rounded-sm bg-[rgb(var(--acc))] px-2 py-0.5 text-[10px] font-bold text-white">CONNECTÉ</span>}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Historique et watchlist synchronisés, 100 % gratuit (l'équivalent de Trakt sans abonnement).
      </p>
      {!connected ? (
        <div className="mt-4 space-y-2">
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-white/45">
            <li>Compte gratuit sur simkl.com</li>
            <li>Va dans <strong>Settings → Developer</strong> → « Create New Application » → copie le <strong>Client ID</strong></li>
          </ol>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID Simkl"
            className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-xs outline-none focus:border-[rgb(var(--acc))]"
          />
          <button
            onClick={() => void connect()}
            disabled={!clientId.trim() || !!flow}
            className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {flow ? 'En attente de validation…' : 'Connecter Simkl'}
          </button>
          {flow && (
            <div className="rounded border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <p>1. Va sur <a href={flow.verificationUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[rgb(var(--acc))] underline">{flow.verificationUrl.replace('https://', '')}</a></p>
              <p className="mt-1.5">2. Entre le code : <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-base font-bold tracking-[0.3em] text-white">{flow.userCode}</span></p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-white/70">Compte : <span className="font-bold text-white">@{cfg?.username || 'inconnu'}</span></p>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={cfg?.scrobble ?? true}
              onChange={(e) => { patchSimkl({ scrobble: e.target.checked }); setCfg(getSimkl()) }}
              className="accent-[rgb(var(--acc))]"
            />
            Marquer automatiquement les vus (à 80 % de lecture)
          </label>
          <div className="flex gap-2">
            <button
              onClick={importWatchlist}
              disabled={importing}
              className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {importing ? 'Import…' : 'Importer ma liste Simkl'}
            </button>
            <button
              onClick={() => { clearSimkl(); setCfg(null); setFlow(null); setStatus(null) }}
              className="rounded-sm border border-red-400/40 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-400/10"
            >
              Déconnecter
            </button>
          </div>
        </div>
      )}
      {status && <p className="mt-3 text-xs text-[rgb(var(--acc))]">{status}</p>}
    </section>
  )
}


export default function SettingsPage() {
  const [ok, setOk] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const profiles = getProfiles()
  const active = getActiveProfile()

  return (
    <div className="min-h-screen pb-28 pt-24 md:pb-16 md:pt-28">
      <div className="px-5 md:px-12">
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">Réglages</h1>
        <p className="mt-1 text-sm text-white/50">Tout ce qui concerne ton apparence, tes comptes et tes données.</p>
      </div>

      <div className="mt-8 grid gap-5 px-5 md:grid-cols-2 md:px-12">
        {/* Thème */}
        <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-white/60" />
            <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">THÈME</p>
          </div>
          <p className="mt-2 text-xs text-white/50">Palette de couleurs de l'interface, appliquée instantanément et retenue sur cet appareil.</p>
          <div className="mt-4">
            <AccentMenu />
          </div>
        </section>

        {/* Profils */}
        <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-white/60" />
            <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">PROFILS</p>
          </div>
          <p className="mt-2 text-xs text-white/50">
            {profiles.length === 0
              ? 'Un seul espace pour le moment. Crée des profils pour chaque membre de la famille — chacun sa liste, sa progression et son PIN.'
              : `${profiles.length} profil${profiles.length > 1 ? 's' : ''} — actif : ${active?.name ?? '—'}. Le menu profils dans la barre de navigation permet de basculer.`}
          </p>
          <p className="mt-3 text-[11px] text-white/35">Utilise le bouton profil (avatar) en haut de l'écran pour créer ou changer de profil.</p>
        </section>

        {/* Sauvegarde */}
        <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <HardDriveDownload size={16} className="text-white/60" />
            <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">SAUVEGARDE &amp; RESTAURATION</p>
          </div>
          <p className="mt-2 text-xs text-white/50">Bibliothèque, progression, réglages : exporte tout dans un fichier JSON et restaure-le sur n'importe quel appareil.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => { setBackupError(null); downloadBackup(); setOk('Sauvegarde téléchargée.') }}
              className="flex items-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/5"
            >
              <Download size={14} /> Exporter
            </button>
            <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/5">
              <Upload size={14} /> Importer
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
        </section>

        {/* Debrid */}
        <section className="rounded-md border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-white/60" />
            <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">STREAMING PREMIUM (DEBRID)</p>
          </div>
          <p className="mt-2 text-xs text-white/50">Tes clés AllDebrid et TorBox, les addons installés et leur santé se gèrent dans la page Addons.</p>
          <a href="#/addons" className="mt-4 inline-block rounded-sm border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/5">
            Ouvrir la page Addons →
          </a>
        </section>

        {/* Clé API OpenSubtitles.com (sous-titres VOSTFR/anime) */}
        <OpensubsCard />

        <SimklCard />
        <TraktCard />

        {/* À propos */}
        <section className="rounded-md border border-white/10 bg-white/[0.02] p-5 md:col-span-2">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-white/60" />
            <p className="text-[10px] font-mono-label tracking-[0.25em] text-white/60">À PROPOS</p>
          </div>
          <p className="mt-2 text-xs text-white/50">
            DZ STREAM v11 — application de streaming française. Catalogue Cinemeta, enrichissements TMDB,
            sources premium AllDebrid/TorBox via Torrentio et HDHub. Tes données restent sur ton appareil.
          </p>
          <p className="mt-3 text-[11px] font-mono text-white/40">
            Build : 2026-10-05 17:23 UTC — correctifs audio/sous-titres inclus
          </p>
        </section>
      </div>

      {ok && <p className="mt-6 px-5 text-sm text-[rgb(var(--acc))] md:px-12">{ok}</p>}
    </div>
  )
}
