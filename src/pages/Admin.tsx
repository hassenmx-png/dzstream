import { useCallback, useEffect, useState } from 'react'
import { Activity, Cpu, Gauge, RefreshCw, Satellite, Users } from 'lucide-react'

interface Stats {
  systeme: {
    uptimeAppMin: number
    uptimeHoteJours: number
    load: number[]
    ramUtiliseeMo: number
    ramTotaleMo: number
    nodeMo: number
    disque: { usedPct: number; freeGo: number } | null
  }
  activite: {
    lectures24h: number
    fluxProbablesActifs: number
    dernieres: { at: number; host: string }[]
  }
  pushAbonnes: number
  torbox: {
    premium: boolean
    expireLe: string | null
    joursRestants: number | null
    telechargeGo: number | null
  } | null
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Cpu; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50">
        <Icon size={14} className="text-[rgb(var(--acc))]" />
        {title}
      </div>
      {children}
    </div>
  )
}

function Bar({ pct, color = 'rgb(var(--acc))' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

const heure = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Tableau de bord admin : état du serveur, activité streaming, compte
 *  Torbox, abonnés push. Rafraîchi toutes les 10 s. */
export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [err, setErr] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/stats', { signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error()
      setStats(await r.json() as Stats)
      setErr(false)
    } catch {
      setErr(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen px-4 pb-24 pt-24 md:px-10 md:pt-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl font-black uppercase tracking-tight">
            Admin<span className="text-aurora">.</span>
          </h1>
          <button onClick={() => void load()} className="rounded-full border border-white/15 p-2.5 text-white/60 transition hover:text-white">
            <RefreshCw size={15} />
          </button>
        </div>

        {err && <p className="mb-4 text-sm text-red-400">Impossible de joindre le serveur de stats.</p>}
        {!stats && !err && <p className="text-sm text-white/60">Chargement…</p>}

        {stats && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card title="Système" icon={Cpu}>
              <div className="space-y-2.5 text-sm">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-white/55">
                    <span>Charge (1 min)</span><span>{stats.systeme.load[0]}</span>
                  </div>
                  <Bar pct={stats.systeme.load[0] * 25} color={stats.systeme.load[0] > 3 ? '#f87171' : 'rgb(var(--acc))'} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-white/55">
                    <span>RAM</span><span>{stats.systeme.ramUtiliseeMo} / {stats.systeme.ramTotaleMo} Mo</span>
                  </div>
                  <Bar pct={(stats.systeme.ramUtiliseeMo / stats.systeme.ramTotaleMo) * 100} />
                </div>
                {stats.systeme.disque && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-white/55">
                      <span>Disque</span><span>{stats.systeme.disque.usedPct}% · {stats.systeme.disque.freeGo} Go libres</span>
                    </div>
                    <Bar pct={stats.systeme.disque.usedPct} color={stats.systeme.disque.usedPct > 85 ? '#f87171' : 'rgb(var(--acc))'} />
                  </div>
                )}
                <p className="pt-1 text-xs text-white/40">
                  App up depuis {stats.systeme.uptimeAppMin} min · hôte {stats.systeme.uptimeHoteJours} j · Node {stats.systeme.nodeMo} Mo
                </p>
              </div>
            </Card>

            <Card title="Activité streaming" icon={Activity}>
              <div className="flex gap-6">
                <div>
                  <p className="font-display text-3xl font-black text-[rgb(var(--acc))]">{stats.activite.fluxProbablesActifs}</p>
                  <p className="text-xs text-white/55">flux en cours</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-black">{stats.activite.lectures24h}</p>
                  <p className="text-xs text-white/55">lectures / 24 h</p>
                </div>
              </div>
              {stats.activite.dernieres.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-white/8 pt-2">
                  {stats.activite.dernieres.slice(0, 6).map((p, i) => (
                    <p key={i} className="flex justify-between text-xs text-white/45">
                      <span className="truncate">{p.host}</span>
                      <span className="ml-2 shrink-0">{heure(p.at)}</span>
                    </p>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Torbox" icon={Gauge}>
              {stats.torbox ? (
                <div className="space-y-1.5 text-sm">
                  <p className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${stats.torbox.premium ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    {stats.torbox.premium ? 'Premium actif' : 'Premium inactif'}
                  </p>
                  {stats.torbox.joursRestants != null && (
                    <p className="text-white/70">
                      Expire dans <span className={`font-bold ${stats.torbox.joursRestants < 14 ? 'text-amber-400' : 'text-white'}`}>{stats.torbox.joursRestants} jours</span>
                    </p>
                  )}
                  {stats.torbox.telechargeGo != null && (
                    <p className="text-xs text-white/45">{stats.torbox.telechargeGo} Go téléchargés au total</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/50">Compte injoignable</p>
              )}
            </Card>

            <Card title="Notifications push" icon={Users}>
              <p className="font-display text-3xl font-black">{stats.pushAbonnes}</p>
              <p className="text-xs text-white/55">appareil{stats.pushAbonnes > 1 ? 's' : ''} abonné{stats.pushAbonnes > 1 ? 's' : ''} aux alertes épisodes</p>
            </Card>

            <div className="sm:col-span-2">
              <Card title="Accès rapide" icon={Satellite}>
                <div className="flex flex-wrap gap-2 text-xs">
                  <a href="#/statut" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 transition hover:border-[rgb(var(--acc))]/50 hover:text-white">Statut des services</a>
                  <a href="#/tv" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 transition hover:border-[rgb(var(--acc))]/50 hover:text-white">TV en direct</a>
                  <a href="#/reglages" className="rounded-full border border-white/15 px-3 py-1.5 text-white/70 transition hover:border-[rgb(var(--acc))]/50 hover:text-white">Réglages</a>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
