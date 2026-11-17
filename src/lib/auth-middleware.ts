import { createMiddleware } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseStatus,
} from '@tanstack/react-start/server'
import { getRequestServices } from './services.server'
import { UnauthorizedError, requireWorkspaceSession } from './session.server'
import { NoWorkspaceError } from './workspace.server'

/**
 * Server function middleware that requires a signed-in user.
 *
 * Attach it to every server function that reads or writes private data:
 *
 *   createServerFn({ method: 'GET' })
 *     .middleware([authMiddleware])
 *     .handler(({ context }) => { context.user; context.db })
 *
 * It rejects requests without a valid session (HTTP 401) or without a
 * workspace the user belongs to (HTTP 403), and provides `context.user` (id,
 * name, email), `context.workspace` (the workspace the request acts in; scope
 * every query by `context.workspace.id`) and `context.db` (this request's
 * Drizzle client). Route guards (`beforeLoad`) are UX only; this is the data
 * boundary.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const { auth, db } = getRequestServices()
    const { user, workspace } = await requireWorkspaceSession(
      auth,
      db,
      new Headers(getRequestHeaders()),
    ).catch((error: unknown) => {
      if (error instanceof UnauthorizedError) setResponseStatus(401)
      if (error instanceof NoWorkspaceError) setResponseStatus(403)
      throw error
    })
    return next({ context: { user, workspace, db } })
  },
)
