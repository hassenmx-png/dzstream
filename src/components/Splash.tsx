import { useEffect, useState } from 'react'

const NOVA = ['D','Z']
const STREAM = ['S','T','R','E','A','M']

/**
 * Écran de démarrage : logo qui se déploie lettre par lettre sur une ligne
 * lumineuse, puis fondu sortant. Un clic permet de passer. Affiché une seule
 * fois par session (App le monte uniquement au premier chargement).
 */
export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [vgReady, setVgReady] = useState(false)

  // Le splash attend l'arrivee de Vegeta (max 2,6 s si connexion lente) :
  // sans ca, l'anim jouerait sur une image pas encore telechargee.
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), vgReady ? 1100 : 2600)
    return () => clearTimeout(t1)
  }, [vgReady])

  useEffect(() => {
    if (!leaving) return
    const t2 = setTimeout(onDone, 420)
    return () => clearTimeout(t2)
  }, [leaving, onDone])

  return (
    <div
      onClick={() => setLeaving(true)}
      className={`fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-[#050505] transition-opacity duration-500 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden
    >
      {/* Halo central discret */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(45% 35% at 50% 55%, rgba(var(--acc),0.07), transparent 70%)',
        }}
      />
      {/* Vegeta fonce dans l'ecran a l'ouverture : ancre par la gauche
          du centre, derriere les textes (z-0 + ordre DOM) */}
      <div className="vegeta-wrap" aria-hidden>
        <img
          src="/vegeta.webp"
          alt=""
          onLoad={() => setVgReady(true)}
          className={vgReady
            ? 'vegeta-enter w-28 drop-shadow-[0_0_35px_rgba(59,130,246,0.45)] md:w-52'
            : 'w-28 opacity-0 md:w-52'}
          onAnimationEnd={(e) => e.currentTarget.classList.add('vegeta-float')}
        />
      </div>
      <p
        className="bracket-label rise-in relative mb-5 text-white/40"
        style={{ animationDelay: '100ms' }}
      >
        Lecteur multimédia ouvert
      </p>
      <h1 className="relative flex font-display text-[clamp(2.6rem,9vw,5.5rem)] font-black uppercase leading-none tracking-tight">
        {NOVA.map((l, i) => (
          <span
            key={`n${i}`}
            className="rise-in inline-block"
            style={{ animationDelay: `${120 + i * 55}ms` }}
          >
            {l}
          </span>
        ))}
        {STREAM.map((l, i) => (
          <span
            key={`s${i}`}
            className="rise-in inline-block text-aurora"
            style={{ animationDelay: `${340 + i * 55}ms` }}
          >
            {l}
          </span>
        ))}
      </h1>
      {/* Ligne lumineuse qui se déploie sous le logo */}
      <div
        className="splash-line relative mt-6 h-px w-48 md:w-64 bg-gradient-to-r from-transparent via-[rgb(var(--acc))] to-transparent shadow-[0_0_24px_rgba(196, 14, 29,0.8)]"
      />
      {/* Signature émotionnelle de DZ STREAM */}
      <p
        className="rise-in relative mt-6 font-display text-sm italic tracking-[0.35em] uppercase text-white/70"
        style={{ animationDelay: '720ms', textShadow: '0 0 18px rgba(var(--acc),0.35)' }}
      >
        Libère tes émotions
      </p>
      <p
        className="rise-in relative mt-6 text-[10px] font-mono uppercase tracking-[0.3em] text-white/25"
        style={{ animationDelay: '650ms' }}
      >
        Compatible protocole Stremio
      </p>
    </div>
  )
}
