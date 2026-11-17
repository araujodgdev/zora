import { queryOptions } from '@tanstack/react-query'
import { getSessionState } from './auth.functions'

/**
 * The signed-in user and their workspace, as the root route's `beforeLoad`
 * reads it (through `loadQuery`, so navigations do not wait on it once it is
 * cached; it refreshes in the background after a minute).
 *
 * Whatever changes the session must drop the cache before navigating:
 * `queryClient.clear()` after signing in or out, switching or creating a
 * workspace, and accepting an invitation. Route guards are UX only;
 * `authMiddleware` still checks every server function.
 */
export function sessionStateQueryOptions() {
  return queryOptions({
    queryKey: ['session-state'] as const,
    queryFn: () => getSessionState(),
    staleTime: 60_000,
  })
}
