/** Menu profils dans la barre de navigation : bascule, création, PIN. */
import { useEffect, useRef, useState } from 'react'
import { Lock, Plus, Trash2, UserRound } from 'lucide-react'
import {
  createProfile,
  deleteProfile,
  getActiveProfileId,
  getProfiles,
  setProfilePin,
  switchProfile,
  type Profile,
} from '@/lib/profiles'

export default function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>(() => getProfiles())
  const [activeId, setActiveId] = useState<string | null>(() => getActiveProfileId())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinFor, setPinFor] = useState<string | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const refresh = () => {
    setProfiles(getProfiles())
    setActiveId(getActiveProfileId())
  }

  const doSwitch = (p: Profile) => {
    setError(null)
    if (p.id === activeId) { setOpen(false); return }
    if (p.pin) {
      setPinFor(p.id)
      setPinInput('')
      return
    }
    if (switchProfile(p.id)) window.location.reload()
  }

  const confirmPin = (p: Profile) => {
    if (pinInput === p.pin) {
      if (switchProfile(p.id)) window.location.reload()
    } else {
      setError('Code PIN incorrect')
    }
  }

  const active = profiles.find((p) => p.id === activeId) ?? null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profils"
        title="Profils"
        className="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-2.5 transition-colors hover:bg-white/10"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: active?.color ?? '#555' }}
        >
          {(active?.name ?? 'P').slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[90px] truncate text-xs text-white/70 md:block">{active?.name ?? 'Profil'}</span>
      </button>

      {open && (
        <div className="fixed right-4 top-16 z-[999] w-64 rounded-md border border-white/10 bg-[#0a0a0a]/95 p-2 shadow-xl backdrop-blur">
          <p className="px-2 pb-1.5 text-[10px] font-mono tracking-[0.2em] text-white/40">PROFILS</p>

          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <button
                onClick={() => doSwitch(p)}
                className={`flex flex-1 items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  p.id === activeId ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                {p.pin && <Lock size={11} className="text-white/40" />}
              </button>
              {profiles.length > 1 && (
                <button
                  onClick={() => { deleteProfile(p.id); refresh() }}
                  aria-label={`Supprimer ${p.name}`}
                  className="rounded p-1.5 text-white/30 transition-colors hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {pinFor && (
            <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
                <Lock size={11} /> Code PIN de « {profiles.find((p) => p.id === pinFor)?.name} »
              </p>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const p = profiles.find((x) => x.id === pinFor); if (p) confirmPin(p) } }}
                  className="w-full rounded border border-white/15 bg-white/5 px-2 py-1.5 text-center text-sm tracking-[0.4em] outline-none focus:border-[rgb(var(--acc))]"
                  placeholder="····"
                  autoFocus
                />
                <button
                  onClick={() => { const p = profiles.find((x) => x.id === pinFor); if (p) confirmPin(p) }}
                  className="rounded bg-[rgb(var(--acc))] px-3 text-xs font-bold text-white"
                >
                  OK
                </button>
              </div>
            </div>
          )}
          {error && <p className="mt-1.5 px-2 text-[11px] text-red-400">{error}</p>}

          {creating ? (
            <div className="mt-2 rounded border border-white/10 bg-white/[0.03] p-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom du profil"
                maxLength={20}
                className="mb-1.5 w-full rounded border border-white/15 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[rgb(var(--acc))]"
                autoFocus
              />
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="PIN (optionnel, 4 chiffres)"
                inputMode="numeric"
                maxLength={4}
                className="mb-2 w-full rounded border border-white/15 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[rgb(var(--acc))]"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const p = createProfile(name, pin || null)
                    setCreating(false)
                    setName('')
                    setPin('')
                    refresh()
                    if (profiles.length === 0 && switchProfile(p.id)) window.location.reload()
                  }}
                  className="flex-1 rounded bg-[rgb(var(--acc))] py-1.5 text-xs font-bold text-white"
                >
                  Créer
                </button>
                <button onClick={() => setCreating(false)} className="rounded border border-white/15 px-3 text-xs text-white/60">
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setCreating(true); setPinFor(null); setError(null) }}
              className="mt-1.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Plus size={13} /> Nouveau profil
            </button>
          )}

          {active && profiles.length > 1 && (
            <button
              onClick={() => {
                const newPin = window.prompt(`Nouveau PIN pour « ${active.name} » (4 chiffres, vide = retirer) :`, '')
                if (newPin !== null) { setProfilePin(active.id, newPin === '' ? null : newPin); refresh() }
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-[11px] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
            >
              <UserRound size={12} /> {active.pin ? 'Modifier le PIN du profil actif' : 'Protéger le profil actif par PIN'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
