import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getRequestServices } from './services.server'
import { findSessionState } from './session.server'
import type { SessionUser } from './session.server'
import type { Workspace } from './workspace'

/**
 * The signed-in user and their current workspace, or `null`s. Used by route
 * guards (`beforeLoad`); it is not a data boundary. Protect data with
 * `authMiddleware` instead.
 */
export const getSessionState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ user: SessionUser | null; workspace: Workspace | null }> => {
    const { auth, db } = getRequestServices()
    const state = await findSessionState(auth, db, new Headers(getRequestHeaders()))
    return { user: state?.user ?? null, workspace: state?.workspace ?? null }
  },
)
