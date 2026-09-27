import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface ToastItem {
  id: number
  message: string
}

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail
      const id = Date.now() + Math.random()
      setItems((prev) => [...prev.slice(-2), { id, message }])
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200)
    }
    window.addEventListener('nova-toast', onToast)
    return () => window.removeEventListener('nova-toast', onToast)
  }, [])

  return (
    <div className="fixed bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className="rise-in flex items-center gap-2.5 rounded-full border border-[rgb(var(--acc))]/40 bg-[#0a0a0a]/95 backdrop-blur px-5 py-2.5 text-sm shadow-2xl"
        >
          <CheckCircle2 size={16} className="text-[rgb(var(--acc))] shrink-0" />
          <span className="whitespace-nowrap">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
