import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, User } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'Quoi regarder ce soir ?',
  'Un animé comme Death Note',
  'Un thriller qui retourne le cerveau',
  'Un manga vengeance dans le style de Bones',
]

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: t }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const d = await r.json().catch(() => ({}))
      setMsgs([...next, { role: 'assistant', content: d.reply ?? "L'IA est saturée — réessaie dans une minute." }])
    } catch {
      setMsgs([...next, { role: 'assistant', content: 'Erreur réseau — réessaie.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-[#0a0a12]/95 px-4 pb-3 pt-14 backdrop-blur">
        <Bot size={20} className="text-[rgb(var(--acc))]" aria-hidden />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-wide text-white">Assistant IA</h1>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-40">
        {msgs.length === 0 && (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5 text-center">
            <Bot size={44} className="text-[rgb(var(--acc))]" aria-hidden />
            <p className="max-w-xs text-sm text-white/60">
              Demande-moi quoi regarder ou lire — films, séries, animés, mangas.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && <Bot size={18} className="mt-1 shrink-0 text-[rgb(var(--acc))]" aria-hidden />}
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-[rgb(var(--acc))] text-white' : 'bg-white/8 text-white/90'
                }`}
              >
                {m.content}
              </div>
              {m.role === 'user' && <User size={18} className="mt-1 shrink-0 text-white/50" aria-hidden />}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-white/50">
              <Bot size={18} className="text-[rgb(var(--acc))]" aria-hidden />
              <Loader2 size={16} className="animate-spin" aria-hidden />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </main>

      <div className="fixed bottom-20 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0a12]/95 px-4 py-3 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            placeholder="Demande une recommandation…"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--acc))] text-white disabled:opacity-40"
            aria-label="Envoyer"
          >
            <Send size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
