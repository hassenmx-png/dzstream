import { useEffect, useState } from 'react'
import { Check, Download, Share2 } from 'lucide-react'
import type { LibraryItem } from '@/types'
import { fetchSharedList, importSharedList } from '@/lib/sync'
import { useNav } from '@/lib/nav'
import { toast } from '@/lib/toast'
import PosterCard from '@/components/PosterCard'

/** Page publique en lecture seule : la liste de quelqu'un, via lien de partage. */
export default function SharedListPage({ code }: { code: string }) {
  const { go } = useNav()
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [imported, setImported] = useState(false)

  useEffect(() => {
    fetchSharedList(code).then((list) => {
      if (list === null) setNotFound(true)
      else setItems(list)
    })
  }, [code])

  return (
    <div className="px-5 md:px-12 pt-28 pb-24 min-h-screen">
      <p className="bracket-label mb-2 flex items-center gap-2">
        <Share2 size={13} /> Liste partagée
      </p>
      <h1 className="font-display text-4xl md:text-6xl font-black uppercase">Une liste DZ STREAM</h1>

      {notFound && (
        <div className="mt-10 max-w-xl rounded-md border border-white/10 bg-white/[0.03] p-6">
          <p className="text-white/60 text-sm">
            Cette liste partagée n'existe pas (ou plus). Demande un nouveau lien à la personne qui te l'a envoyé.
          </p>
          <button
            onClick={() => go({ name: 'home' })}
            className="mt-4 rounded-sm bg-[rgb(var(--acc))] px-5 py-2 text-sm font-bold text-white"
          >
            Découvrir DZ STREAM
          </button>
        </div>
      )}

      {items === null && !notFound && (
        <div className="mt-12 flex items-center gap-3 text-white/50 text-sm">
          <div className="h-5 w-5 rounded-full border-2 border-white/15 border-t-[rgb(var(--acc))] animate-spin" />
          Chargement de la liste…
        </div>
      )}

      {items !== null && (
        <>
          <p className="mt-3 text-sm text-white/50">
            {items.length} titre{items.length > 1 ? 's' : ''} partagé{items.length > 1 ? 's' : ''}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => {
                const n = importSharedList(items)
                setImported(true)
                toast(n > 0 ? `${n} titre${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à ta liste ✓` : 'Tout était déjà dans ta liste')
              }}
              disabled={imported}
              className="flex items-center gap-2 rounded-sm bg-[rgb(var(--acc))] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#e8252f] transition-colors disabled:opacity-60"
            >
              {imported ? <Check size={16} /> : <Download size={16} />}
              {imported ? 'Importée dans ta liste' : 'Importer dans ma liste'}
            </button>
            <button
              onClick={() => go({ name: 'home' })}
              className="rounded-sm border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-[rgb(var(--acc))]/50 hover:text-[rgb(var(--acc))] transition-colors"
            >
              Explorer le catalogue
            </button>
          </div>
          <div className="mt-8 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
            {items.map((i) => (
              <PosterCard key={i.id} meta={{ id: i.id, type: i.type, name: i.name, poster: i.poster }} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
