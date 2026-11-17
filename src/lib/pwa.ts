/**
 * Registers the service worker (`public/sw.js`) that makes Zora installable
 * and shows an offline page. Production builds only: in `pnpm dev` a worker
 * would outlive reloads and get in the way of HMR.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Not installable this time; the app works the same without it.
  })
}
