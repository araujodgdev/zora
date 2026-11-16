import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

/** Cookie written by `SidebarProvider` (`@/components/ui/sidebar`). */
const SIDEBAR_COOKIE = 'sidebar_state'

/**
 * Whether the app sidebar starts expanded. Read on the server too, so a
 * collapsed sidebar does not flash open while the page hydrates.
 */
export const readSidebarOpen = createIsomorphicFn()
  .server(() => getCookie(SIDEBAR_COOKIE) !== 'false')
  .client(
    () => !document.cookie.split('; ').includes(`${SIDEBAR_COOKIE}=false`),
  )
