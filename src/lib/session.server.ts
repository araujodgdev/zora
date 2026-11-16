import type { TeamMember } from './content'
import type { Auth } from './auth.server'

/** The signed-in user, as exposed to route context and server functions. */
export type SessionUser = TeamMember

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized: sign in to continue.')
    this.name = 'UnauthorizedError'
  }
}

/** Resolves the session from request headers; `null` when signed out. */
export async function findSessionUser(
  auth: Auth,
  headers: Headers,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  const { id, name, email } = session.user
  return { id, name, email }
}

/** Like `findSessionUser`, but throws `UnauthorizedError` when signed out. */
export async function requireSessionUser(
  auth: Auth,
  headers: Headers,
): Promise<SessionUser> {
  const user = await findSessionUser(auth, headers)
  if (!user) throw new UnauthorizedError()
  return user
}
