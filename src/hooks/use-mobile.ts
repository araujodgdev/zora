import * as React from 'react'

// The sidebar becomes a sheet below `lg`, so iPads in portrait get the full width.
const MOBILE_BREAKPOINT = 1024
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** Whether the viewport is below the `lg` breakpoint (false during SSR). */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
}
