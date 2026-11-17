import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept in sync with the window. `serverValue`
 * is used during SSR and hydration (no window there). For layouts that only
 * differ in CSS, prefer Tailwind breakpoints; use this when a breakpoint
 * renders a different component.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}
