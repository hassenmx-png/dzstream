/** Notifications toast ultra-légères via événement global. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('nova-toast', { detail: message }))
}
