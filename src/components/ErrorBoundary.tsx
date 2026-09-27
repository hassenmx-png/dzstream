import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; onReset?: () => void }
type State = { error: Error | null }

/**
 * Pare-feu React : si un composant plante (ex. boucle de rendu), on affiche
 * un écran de récupération au lieu d'un écran noir total.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(err: Error) {
    console.error('[ErrorBoundary]', err)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-[#050505] p-6 text-center text-white">
          <p className="font-display text-2xl font-black">Oups, le lecteur a planté</p>
          <p className="max-w-md text-sm text-white/50">
            {String(this.state.error.message ?? this.state.error)}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
            className="rounded-full bg-[rgb(var(--acc))] px-8 py-3 font-bold text-white transition hover:bg-[#e8252f]"
          >
            Retour à l'accueil
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
