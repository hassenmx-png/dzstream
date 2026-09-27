import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, BookOpen, ChevronLeft, ChevronRight, Library, List, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────
   SCANS — lecteur maison. API MangaDex native (/api/manga/*).
   V3 : repères de lecture (tome/chapitre toujours visibles),
   reprise de lecture, sélecteur de chapitres.
   ───────────────────────────────────────────────────────────── */

type Manga = { id: number | string; title: string; thumbnailUrl?: string; inLibrary?: boolean; sourceId?: string }
type Chapter = { id: number; name?: string; chapterNumber?: number; volume?: string | null; scanlator?: string }
type Screen =
  | { kind: 'library' }
  | { kind: 'search' }
  | { kind: 'detail'; manga: Manga }
  | { kind: 'reader'; manga: Manga; chapters: Chapter[]; index: number }

const img = (u?: string) => u ?? ''

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(String(r.status))
  return r.json() as Promise<T>
}

/* ── Progression de lecture (localStorage) ────────────────── */
type Progress = { chapterIndex: number; page: number }
const progressKey = (id: number | string) => `mg-progress-${id}`
function loadProgress(id: number | string): Progress | null {
  try { return JSON.parse(localStorage.getItem(progressKey(id)) || 'null') } catch { return null }
}
function saveProgress(id: number | string, p: Progress) {
  try { localStorage.setItem(progressKey(id), JSON.stringify(p)) } catch { /* quota */ }
}

function Thumb({ url, title, className = '' }: { url?: string; title: string; className?: string }) {
  const [err, setErr] = useState(false)
  if (!url || err)
    return (
      <div className={`flex items-center justify-center bg-white/5 text-[rgb(var(--acc))] ${className}`}>
        <BookOpen size={28} aria-hidden />
      </div>
    )
  return <img src={img(url)} alt={title} loading="lazy" onError={() => setErr(true)} className={`object-cover ${className}`} />
}

export default function MangasPage() {
  const [screen, setScreen] = useState<Screen>({ kind: 'library' })
  const [library, setLibrary] = useState<Manga[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const loadLibrary = useCallback(() => {
    setErr(null)
    j<Manga[]>('/api/manga/library').then(setLibrary).catch(() => setErr('Bibliothèque indisponible'))
  }, [])

  useEffect(loadLibrary, [loadLibrary])

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-[#0a0a12]/95 px-4 pb-3 pt-14 backdrop-blur">
        {screen.kind !== 'library' && (
          <button
            onClick={() => setScreen(screen.kind === 'reader' ? { kind: 'detail', manga: screen.manga } : { kind: 'library' })}
            className="rounded-sm p-1.5 text-white/70 hover:bg-white/10"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-wide text-white">
          {screen.kind === 'library' && 'Ma bibliothèque'}
          {screen.kind === 'search' && 'Recherche'}
          {screen.kind === 'detail' && screen.manga.title}
          {screen.kind === 'reader' && `Lecture — ${screen.manga.title}`}
        </h1>
        {screen.kind === 'library' && (
          <button
            onClick={() => setScreen({ kind: 'search' })}
            className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-3 py-1.5 text-xs font-bold text-white"
          >
            <Search size={14} aria-hidden /> Rechercher
          </button>
        )}
      </header>

      <main>
        {screen.kind === 'library' && (
          <LibraryView library={library} err={err} onRetry={loadLibrary} onOpen={(m) => setScreen({ kind: 'detail', manga: m })} />
        )}
        {screen.kind === 'search' && <SearchView onOpen={(m) => setScreen({ kind: 'detail', manga: m })} />}
        {screen.kind === 'detail' && <DetailView manga={screen.manga} onRead={(chapters, index) => setScreen({ kind: 'reader', manga: screen.manga, chapters, index })} />}
        {screen.kind === 'reader' && <Reader manga={screen.manga} chapters={screen.chapters} index={screen.index} />}
      </main>
    </div>
  )
}

/* ── Bibliothèque ─────────────────────────────────────────── */
function LibraryView({ library, err, onRetry, onOpen }: { library: Manga[] | null; err: string | null; onRetry: () => void; onOpen: (m: Manga) => void }) {
  if (err)
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-white/70">{err}</p>
        <button onClick={onRetry} className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold text-white">
          <RefreshCw size={14} aria-hidden /> Réessayer
        </button>
      </div>
    )
  if (!library)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={36} className="animate-spin text-[rgb(var(--acc))]" aria-hidden />
      </div>
    )
  if (library.length === 0)
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-white/50">
        <Library size={40} aria-hidden />
        <p className="text-sm">Bibliothèque vide — recherche un manga pour commencer</p>
      </div>
    )
  return (
    <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4 md:grid-cols-6">
      {library.map((m) => (
        <button key={m.id} onClick={() => onOpen(m)} className="group flex flex-col gap-1.5 text-left">
          <Thumb url={m.thumbnailUrl} title={m.title} className="aspect-[3/4] w-full rounded-sm transition group-hover:ring-2 group-hover:ring-[rgb(var(--acc))]" />
          <span className="line-clamp-2 text-xs text-white/80">{m.title}</span>
        </button>
      ))}
    </div>
  )
}

/* ── Recherche ────────────────────────────────────────────── */
function SearchView({ onOpen }: { onOpen: (m: Manga) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Manga[] | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const run = (value: string) => {
    setQ(value)
    const n = ++seq.current
    if (value.trim().length < 2) { setResults(null); return }
    setBusy(true)
    j<Manga[]>(`/api/manga/search?q=${encodeURIComponent(value.trim())}`)
      .then((r) => { if (n === seq.current) setResults(r) })
      .catch(() => { if (n === seq.current) setResults([]) })
      .finally(() => { if (n === seq.current) setBusy(false) })
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2 rounded-sm border border-white/15 bg-white/5 px-3 py-2">
        <Search size={16} className="text-white/50" aria-hidden />
        <input
          value={q}
          onChange={(e) => run(e.target.value)}
          placeholder="Titre d'un manga…"
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/40"
          autoFocus
        />
        {busy && <Loader2 size={16} className="animate-spin text-[rgb(var(--acc))]" aria-hidden />}
      </div>
      {results === null ? (
        <p className="text-center text-sm text-white/40">Tape au moins 2 lettres — recherche sur toutes les sources FR</p>
      ) : results.length === 0 ? (
        <p className="text-center text-sm text-white/40">Aucun résultat</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {results.map((m, i) => (
            <button key={`${m.id}-${i}`} onClick={() => onOpen(m)} className="group flex flex-col gap-1.5 text-left">
              <Thumb url={m.thumbnailUrl} title={m.title} className="aspect-[3/4] w-full rounded-sm transition group-hover:ring-2 group-hover:ring-[rgb(var(--acc))]" />
              <span className="line-clamp-2 text-xs text-white/80">{m.title}</span>
              <span className="text-[10px] text-white/40">{(m as any).sourceName}{typeof (m as any).readableCount === 'number' && (m as any).readableCount === 0 ? ' · externe' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Détail + chapitres (groupés par tome, reprise de lecture) ── */
function DetailView({ manga, onRead }: { manga: Manga; onRead: (chapters: Chapter[], index: number) => void }) {
  const [info, setInfo] = useState<Manga | null>(null)
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [resumeIdx, setResumeIdx] = useState<number | null>(null)

  const refresh = useCallback(() => {
    setBusy(true)
    j<Manga>(`/api/manga/${manga.id}`).then(setInfo).catch(() => setInfo(manga))
    j<Chapter[]>(`/api/manga/${manga.id}/chapters`)
      .then((chs) => {
        setChapters(chs)
        const p = loadProgress(manga.id)
        if (p && p.chapterIndex >= 0 && p.chapterIndex < chs.length) setResumeIdx(p.chapterIndex)
      })
      .catch(() => setChapters([]))
      .finally(() => setBusy(false))
  }, [manga])

  useEffect(refresh, [refresh])

  const toggleLibrary = () => {
    const target = !(info?.inLibrary ?? manga.inLibrary)
    j(`/api/manga/${manga.id}/library`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inLibrary: target }),
    }).then(() => setInfo((v) => (v ? { ...v, inLibrary: target } : v)))
  }

  const inLib = info?.inLibrary ?? manga.inLibrary ?? false

  // Groupage par tome pour l'affichage
  const rows: { type: 'volume'; label: string } | { type: 'chapter'; chapter: Chapter; index: number } = [] as any
  const listRows: any[] = []
  if (chapters) {
    let lastVol: string | null = null
    chapters.forEach((ch, i) => {
      const vol = ch.volume || null
      if (vol !== lastVol) {
        lastVol = vol
        listRows.push({ type: 'volume', label: vol ? `Tome ${vol}` : 'Hors tome' })
      }
      listRows.push({ type: 'chapter', chapter: ch, index: i })
    })
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:flex-row">
      <div className="mx-auto w-40 shrink-0 md:mx-0">
        <Thumb url={info?.thumbnailUrl ?? manga.thumbnailUrl} title={manga.title} className="aspect-[3/4] w-full rounded-sm" />
        {resumeIdx !== null && chapters && (
          <button
            onClick={() => onRead(chapters, resumeIdx)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-3 py-2 text-xs font-bold text-white"
          >
            <BookMarked size={14} aria-hidden /> Reprendre — Ch. {chapters[resumeIdx]?.chapterNumber}
          </button>
        )}
        <button
          onClick={toggleLibrary}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs font-bold ${
            inLib ? 'bg-white/10 text-white/70' : 'bg-white/15 text-white'
          }`}
        >
          {inLib ? <><Library size={14} aria-hidden /> Dans ma bibliothèque</> : <><Plus size={14} aria-hidden /> Ajouter à ma bibliothèque</>}
        </button>
      </div>
      <div className="min-w-0 flex-1">
        {(info as any)?.description && <p className="mb-4 line-clamp-6 text-sm text-white/60">{(info as any).description}</p>}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white/70">
            Chapitres{chapters ? ` (${chapters.length})` : ''}
          </h2>
          <button onClick={refresh} className="rounded-sm p-1.5 text-white/60 hover:bg-white/10" aria-label="Rafraîchir">
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
        {chapters === null ? (
          <div className="flex justify-center py-8"><Loader2 size={28} className="animate-spin text-[rgb(var(--acc))]" aria-hidden /></div>
        ) : chapters.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-white/60">Aucun chapitre FR hébergé pour ce manga</p>
            <p className="max-w-xs text-xs text-white/40">Licence : les chapitres FR pointent vers MangaPlus. Essaie une version « Colored » ou un autre titre.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {listRows.map((row, k) =>
              row.type === 'volume' ? (
                <li key={`vol-${k}`} className="sticky top-[104px] z-10 -mx-4 bg-[#0a0a12]/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[rgb(var(--acc))] backdrop-blur">
                  {row.label}
                </li>
              ) : (
                <li key={row.chapter.id}>
                  <button
                    onClick={() => onRead(chapters, row.index)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-white/90">
                      <span className="mr-2 inline-block w-10 text-white/40">#{row.chapter.chapterNumber}</span>
                      {row.chapter.name && row.chapter.name !== `Chapitre ${row.chapter.chapterNumber}` ? row.chapter.name : `Chapitre ${row.chapter.chapterNumber}`}
                    </span>
                    <span className="shrink-0 text-xs text-white/40">{row.chapter.scanlator}</span>
                    <ChevronRight size={16} className="shrink-0 text-white/30" aria-hidden />
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

type ReadMode = 'webtoon' | 'h' | 'v'

/* ── Lecteur liseuse V3 — on sait TOUJOURS où on en est ───── */
function Reader({ manga, chapters, index }: { manga: Manga; chapters: Chapter[]; index: number }) {
  const [idx, setIdx] = useState(index)
  const [pages, setPages] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [showUi, setShowUi] = useState(true)
  const [picker, setPicker] = useState(false)
  const [curPage, setCurPage] = useState(1)
  const [reloadTick, setReloadTick] = useState(0)
  const seq = useRef(0)
  const [mode, setMode] = useState<ReadMode>('webtoon')
  const [zoom, setZoom] = useState(1)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const chapter = chapters[idx]
  const nextChrono = idx > 0 ? chapters[idx - 1] : null
  const prevChrono = idx < chapters.length - 1 ? chapters[idx + 1] : null

  const load = useCallback((cid: number) => j<string[]>(`/api/manga/chapter/${cid}/pages`), [])

  useEffect(() => {
    const n = ++seq.current
    setPages(null); setFailed(false); setCurPage(1); setShowUi(true); setPicker(false); setMode('webtoon')
    load(chapter.id)
      .then((p) => { if (n === seq.current) { setPages(p); window.scrollTo({ top: 0 }) } })
      .catch(() => { if (n === seq.current) setFailed(true) })
  }, [chapter.id, load, reloadTick])

  // Prechargement des 10 premieres pages
  useEffect(() => {
    if (!pages) return
    pages.slice(0, 10).forEach((u) => { const i = new Image(); i.src = u })
  }, [pages])

  // Suivi scroll : page courante + sauvegarde de la position
  useEffect(() => {
    if (!pages) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-pg]'))
        let n = 0
        for (const im of imgs) {
          if (im.naturalHeight === 0) continue
          if (im.getBoundingClientRect().top < window.innerHeight * 0.5) n++
        }
        const page = Math.min(Math.max(n, 1), pages.length)
        setCurPage(page)
        saveProgress(manga.id, { chapterIndex: idx, page })
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    const t = setTimeout(onScroll, 1200)
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); clearTimeout(t) }
  }, [pages, idx, manga.id])

  const goTo = (i: number) => {
    if (i >= 0 && i < chapters.length) { setPicker(false); setIdx(i) }
  }

  return (
    <div className="relative bg-black" onClick={() => setShowUi((v) => !v)}>
      {/* En-tête de chapitre bien visible (tome + numero + titre) */}
      {pages && (
        <div className="flex flex-col items-center gap-1 border-b border-white/10 px-4 py-8 text-center">
          {chapter.volume ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[rgb(var(--acc))]">Tome {chapter.volume}</span>
          ) : null}
          <span className="text-2xl font-bold text-white">Chapitre {chapter.chapterNumber}</span>
          {chapter.name && chapter.name !== `Chapitre ${chapter.chapterNumber}` && (
            <span className="text-sm italic text-white/50">{chapter.name}</span>
          )}
          <span className="mt-1 text-[10px] text-white/30">{pages.length} pages · scroll vers le bas pour lire</span>
        </div>
      )}

      {pages === null && !failed && (
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-[rgb(var(--acc))]" aria-hidden /></div>
      )}
      {failed && (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-white/60">Impossible de charger les pages</p>
          <button onClick={() => setReloadTick((t) => t + 1)} className="rounded-sm bg-[rgb(var(--acc))] px-4 py-2 text-xs font-bold text-white">
            Réessayer
          </button>
        </div>
      )}

      {mode === 'webtoon' && pages?.map((u, i) => (
        <img key={`${chapter.id}-${i}`} data-pg src={u} alt={`Page ${i + 1}`}
          loading="eager" draggable={false}
          className="mx-auto block w-full max-w-3xl select-none" />
      ))}

      {mode !== 'webtoon' && pages && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-center overflow-hidden bg-black" style={{ top: 92 }}
          onClick={(e) => {
            const x = e.clientX / window.innerWidth
            if (x < 0.3) setCurPage((p) => Math.min(p + 1, pages.length))
            else if (x > 0.7) setCurPage((p) => Math.max(p - 1, 1))
            else setShowUi((v) => !v)
          }}
          onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
          onTouchEnd={(e) => {
            if (!touch.current) return
            const dx = e.changedTouches[0].clientX - touch.current.x
            const dy = e.changedTouches[0].clientY - touch.current.y
            touch.current = null
            if (mode === 'h') { if (dx < -40) setCurPage((p) => Math.min(p + 1, pages.length)); else if (dx > 40) setCurPage((p) => Math.max(p - 1, 1)) }
            else { if (dy < -40) setCurPage((p) => Math.min(p + 1, pages.length)); else if (dy > 40) setCurPage((p) => Math.max(p - 1, 1)) }
          }}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 1.75))}>
          <img src={pages[curPage - 1]} alt={`Page ${curPage}`} draggable={false}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }} />
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-sm bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white/90">
            {chapter.volume ? `Tome ${chapter.volume} · ` : ''}Ch. {chapter.chapterNumber} — {curPage}/{pages.length}
          </div>
          {curPage >= pages.length && nextChrono && (
            <button onClick={(e) => { e.stopPropagation(); goTo(idx - 1) }}
              className="absolute inset-x-0 bottom-12 z-20 mx-auto flex w-fit items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-5 py-2.5 text-sm font-bold text-white">
              Chapitre suivant : {nextChrono.chapterNumber} <ChevronRight size={15} aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* Fin de chapitre */}
      {pages && nextChrono && (
        <div className="flex flex-col items-center gap-2 border-t border-white/10 py-10" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-white/40">Fin du chapitre {chapter.chapterNumber}</p>
          <button onClick={() => goTo(idx - 1)}
            className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-6 py-3 text-sm font-bold text-white">
            Chapitre suivant : {nextChrono.chapterNumber} <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}
      {pages && !nextChrono && (
        <p className="py-12 text-center text-sm text-white/40">Dernier chapitre disponible — à jour ! 🎉</p>
      )}

      {/* Repere PERMANENT : toujours savoir ou on en est */}
      {pages && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-sm bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur">
          {chapter.volume ? `Tome ${chapter.volume} · ` : ''}Ch. {chapter.chapterNumber} — {curPage}/{pages.length}
        </div>
      )}

      {/* Bouton sélecteur de chapitres */}
      {pages && (
        <button
          onClick={(e) => { e.stopPropagation(); setPicker(true) }}
          className="fixed bottom-3 right-3 z-40 flex items-center gap-1 rounded-sm bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 backdrop-blur hover:bg-white/20"
          aria-label="Liste des chapitres"
        >
          <List size={14} aria-hidden /> {chapters.length}
        </button>
      )}

      {/* UI flottante : navigation chapitres */}
      <div className={`fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-12 pt-12 transition-opacity duration-200 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={(e) => e.stopPropagation()}>
        <button disabled={!prevChrono} onClick={() => goTo(idx + 1)}
          className="flex items-center gap-1 rounded-sm bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20 disabled:opacity-30">
          <ChevronLeft size={14} aria-hidden /> Ch. {prevChrono?.chapterNumber ?? '—'}
        </button>
        <button onClick={() => setMode((mm) => (mm === 'webtoon' ? 'h' : mm === 'h' ? 'v' : 'webtoon'))}
          className="rounded-sm bg-white/10 px-3 py-2 text-xs font-bold text-white/90 hover:bg-white/20">
          {mode === 'webtoon' ? 'Webtoon' : mode === 'h' ? 'Manga RTL' : 'Vertical'}
        </button>
        <button onClick={() => setPicker(true)}
          className="flex items-center gap-1 rounded-sm bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20">
          <List size={14} aria-hidden /> Chapitres
        </button>
        <button disabled={!nextChrono} onClick={() => goTo(idx - 1)}
          className="flex items-center gap-1 rounded-sm bg-[rgb(var(--acc))] px-3 py-2 text-xs font-bold text-white disabled:opacity-30">
          Ch. {nextChrono?.chapterNumber ?? '—'} <ChevronRight size={14} aria-hidden />
        </button>
      </div>

      {/* Sélecteur de chapitres */}
      {pages && (
        <button
          onClick={(e) => { e.stopPropagation(); setMode((mm) => (mm === 'webtoon' ? 'h' : mm === 'h' ? 'v' : 'webtoon')) }}
          className="fixed bottom-3 right-3 z-40 rounded-sm bg-black/80 px-3 py-2 text-[11px] font-bold text-white/90 backdrop-blur hover:bg-black/60">
          {mode === 'webtoon' ? '⇊ Webtoon' : mode === 'h' ? '⇇ RTL' : '⇊ Vert'}
        </button>
      )}

      {picker && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-bold text-white">Chapitres — {chapters.length} dispo</h3>
            <button onClick={() => setPicker(false)} className="rounded-sm p-1.5 text-white/70 hover:bg-white/10" aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <ul className="divide-y divide-white/5">
              {chapters.map((ch, i) => (
                <li key={ch.id}>
                  <button
                    onClick={() => goTo(i)}
                    className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${
                      i === idx ? 'text-[rgb(var(--acc))]' : 'text-white/85 hover:bg-white/5'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="mr-2 inline-block w-10 text-white/40">#{ch.chapterNumber}</span>
                      {ch.volume ? <span className="mr-2 text-[10px] text-white/40">T{ch.volume}</span> : null}
                      {ch.name && ch.name !== `Chapitre ${ch.chapterNumber}` ? ch.name : `Chapitre ${ch.chapterNumber}`}
                    </span>
                    {i === idx && <span className="text-[10px] font-bold uppercase">En lecture</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
