import type { Database } from '../db/client.server'
import type { TeamMember } from './content'
import type { Auth } from './auth.server'
import type { Workspace } from './workspace'
import { NoWorkspaceError, resolveWorkspace } from './workspace.server'

/** The signed-in user, as exposed to route context and server functions. */
export type SessionUser = TeamMember

export class UnauthorizedError extends Error {
  constructor() {
    super('Não autorizado: entre para continuar.')
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

/**
 * The signed-in user and the workspace they act in: the session's active
 * organization while they are still a member of it, else their oldest
 * workspace (`null` when they belong to none). `null` when signed out.
 */
export async function findSessionState(
  auth: Auth,
  db: Database,
  headers: Headers,
): Promise<{ user: SessionUser; workspace: Workspace | null } | null> {
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  const { id, name, email } = session.user
  const workspace = await resolveWorkspace(db, id, session.session.activeOrganizationId)
  return { user: { id, name, email }, workspace }
}

/**
 * The data boundary: a signed-in user and a workspace they belong to. Throws
 * `UnauthorizedError` when signed out and `NoWorkspaceError` without one.
 */
export async function requireWorkspaceSession(
  auth: Auth,
  db: Database,
  headers: Headers,
): Promise<{ user: SessionUser; workspace: Workspace }> {
  const state = await findSessionState(auth, db, headers)
  if (!state) throw new UnauthorizedError()
  if (!state.workspace) throw new NoWorkspaceError()
  return { user: state.user, workspace: state.workspace }
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
