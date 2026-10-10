import { useState, useSyncExternalStore } from 'react'
import { Check, Copy, Link2, Loader2, RefreshCw, Share2, Smartphone, Unlink } from 'lucide-react'
import {
  createSyncVault,
  disconnectSync,
  getSyncCode,
  getSyncMeta,
  joinSyncVault,
  shareMyLibrary,
  subscribeSync,
  syncNow,
  syncSnapshot,
} from '@/lib/sync'
import { toast } from '@/lib/toast'

function ago(ts: number): string {
  if (!ts) return 'jamais'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 10) return "à l'instant"
  if (s < 60) return `il y a ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  return `il y a ${Math.round(m / 60)} h`
}

export default function SyncCard() {
  useSyncExternalStore(subscribeSync, syncSnapshot)
  const code = getSyncCode()
  const meta = getSyncMeta()
  const [busy, setBusy] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // repli : sélection manuelle, le code reste affiché
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="mt-14">
      <h2 className="bracket-label mb-4">Synchro entre appareils</h2>
      <div className="rounded-md border border-white/8 bg-white/[0.03] p-5 max-w-2xl">
        {!code ? (
          <>
            <div className="flex items-start gap-3">
              <Smartphone size={18} className="text-[rgb(var(--acc))] mt-0.5 shrink-0" />
              <p className="text-sm text-white/60 leading-relaxed">
                Reprends ton film là où tu l'as laissé, sur n'importe quel appareil. Crée un code ici,
                puis saisis-le sur ton téléphone ou ton PC — ta progression et ta liste suivent.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  run(async () => {
                    const c = await createSyncVault()
                    toast(`Code de synchro créé : ${c}`)
                  })
                }
                disabled={busy}
                className="flex items-center gap-2 rounded bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-[#e8252f] transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Créer mon code
              </button>
              <div className="flex items-center gap-2 flex-1 min-w-56">
                <input
                  value={joinInput}
                  onChange={(e) => {
                    setJoinInput(e.target.value)
                    setJoinError(null)
                  }}
                  placeholder="J'ai déjà un code : NS-XXXX-XXXX"
                  className="flex-1 min-w-0 rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono uppercase placeholder:normal-case placeholder:text-white/25 focus:border-[rgb(var(--acc))]/50 focus:outline-none"
                />
                <button
                  onClick={() =>
                    run(async () => {
                      const r = await joinSyncVault(joinInput)
                      if (!r.ok) setJoinError(r.error ?? 'Erreur')
                      else toast('Appareil associé — synchro en cours ✓')
                    })
                  }
                  disabled={busy || !joinInput.trim()}
                  className="rounded border border-[rgb(var(--acc))]/40 px-3 py-2 text-xs font-bold uppercase text-[rgb(var(--acc))] hover:bg-[rgb(var(--acc))]/10 transition-colors disabled:opacity-40"
                >
                  Associer
                </button>
              </div>
            </div>
            {joinError && <p className="mt-2 text-xs text-red-400">{joinError}</p>}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={copy}
                title="Copier le code"
                className="flex items-center gap-2 rounded border border-[rgb(var(--acc))]/40 bg-[rgb(var(--acc))]/10 px-4 py-2 font-mono text-base font-bold tracking-widest text-[rgb(var(--acc))] hover:bg-[rgb(var(--acc))]/20 transition-colors"
              >
                {code}
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const ok = await syncNow()
                    toast(ok ? 'Synchro terminée ✓' : 'Synchro impossible pour le moment')
                  })
                }
                disabled={busy}
                className="flex items-center gap-2 rounded border border-white/15 px-3 py-2 text-xs font-bold uppercase text-white/70 hover:border-[rgb(var(--acc))]/40 hover:text-[rgb(var(--acc))] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
                Synchroniser
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    const url = await shareMyLibrary()
                    if (!url) {
                      toast('Partage impossible pour le moment — réessaie')
                      return
                    }
                    try {
                      await navigator.clipboard.writeText(url)
                      toast('Lien de partage copié ✓ (lecture seule, sans ta progression)')
                    } catch {
                      toast(`Lien de partage : ${url}`)
                    }
                  })
                }
                disabled={busy}
                className="flex items-center gap-2 rounded border border-white/15 px-3 py-2 text-xs font-bold uppercase text-white/70 hover:border-[rgb(var(--acc))]/40 hover:text-[rgb(var(--acc))] transition-colors disabled:opacity-40"
              >
                <Share2 size={13} />
                Partager ma liste
              </button>
              <button
                onClick={() => {
                  disconnectSync()
                  toast('Appareil dissocié — tes données restent sur cet appareil')
                }}
                className="flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-red-400/40 hover:text-red-400 transition-colors"
              >
                <Unlink size={13} />
                Dissocier
              </button>
            </div>
            <p className="mt-3 text-[11px] font-mono text-white/35">
              {meta.lastError ? (
                <span className="text-red-400">Erreur : {meta.lastError} — nouvel essai automatique.</span>
              ) : (
                <>Dernière synchro : {ago(meta.lastSyncAt)} · automatique à chaque lecture</>
              )}
            </p>
            <p className="mt-2 text-[11px] text-white/30 leading-relaxed">
              Saisis ce code dans « Ma liste » sur ton autre appareil pour tout retrouver.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
