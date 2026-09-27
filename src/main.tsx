import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { applyStoredAccent } from './lib/theme'
import App from './App.tsx'
import { checkDebridHealth } from '@/lib/addons'
void ensureServerDebridAddon()
import { ensureServerDebridAddon } from '@/lib/addons'

// Contrôle de santé de la clé debrid dès le démarrage : compte banni ou
// abonnement expiré → bascule immédiate en sources gratuites, sans attendre
// un premier échec de lecture. Non bloquant.
void checkDebridHealth()

// PWA : enregistre le service worker (cache shell + affiches → démarrage
// instantané, accueil disponible hors-ligne). Uniquement en production :
// en dev, le cache gênerait le rechargement à chaud.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Chemin RELATIF : sous un sous-dossier de déploiement, '/sw.js' serait
    // hors du scope et l'enregistrement échouerait silencieusement.
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => { /* non critique */ })
    ;(AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const c = new AbortController()
    setTimeout(() => c.abort(new DOMException('Timeout', 'TimeoutError')), ms)
    return c.signal
  }
  })
}

applyStoredAccent()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
