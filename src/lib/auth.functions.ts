import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getRequestServices } from './services.server'
import { findSessionUser } from './session.server'
import type { SessionUser } from './session.server'

/**
 * The signed-in user, or `null`. Used by route guards (`beforeLoad`); it is
 * not a data boundary. Protect data with `authMiddleware` instead.
 */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  (): Promise<SessionUser | null> => {
    const { auth } = getRequestServices()
    return findSessionUser(auth, new Headers(getRequestHeaders()))
  },
)
