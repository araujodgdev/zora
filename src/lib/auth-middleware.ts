import { createMiddleware } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseStatus,
} from '@tanstack/react-start/server'
import { getRequestServices } from './services.server'
import { UnauthorizedError, requireSessionUser } from './session.server'

/**
 * Server function middleware that requires a signed-in user.
 *
 * Attach it to every server function that reads or writes private data:
 *
 *   createServerFn({ method: 'GET' })
 *     .middleware([authMiddleware])
 *     .handler(({ context }) => { context.user; context.db })
 *
 * It rejects requests without a valid session (HTTP 401) and provides
 * `context.user` (id, name, email) and `context.db` (this request's Drizzle
 * client). Route guards (`beforeLoad`) are UX only; this is the data boundary.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const { auth, db } = getRequestServices()
    const user = await requireSessionUser(
      auth,
      new Headers(getRequestHeaders()),
    ).catch((error: unknown) => {
      if (error instanceof UnauthorizedError) setResponseStatus(401)
      throw error
    })
    return next({ context: { user, db } })
  },
)
