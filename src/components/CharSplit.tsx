/** Texte dont chaque lettre glisse vers le haut au survol (double couche). */
export default function CharSplit({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`char-split ${className}`} aria-label={text}>
      <span aria-hidden>
        {text.split('').map((c, i) => (
          <span key={`t${i}`} className="char char-top" style={{ transitionDelay: `${i * 22}ms` }}>
            {c === ' ' ? ' ' : c}
          </span>
        ))}
      </span>
      <span aria-hidden className="absolute left-0 top-0">
        {text.split('').map((c, i) => (
          <span key={`b${i}`} className="char char-bottom" style={{ transitionDelay: `${i * 22}ms` }}>
            {c === ' ' ? ' ' : c}
          </span>
        ))}
      </span>
    </span>
  )
}
