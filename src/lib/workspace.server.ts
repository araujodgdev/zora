/**
 * Workspace (Better Auth organization) lookups. Server-only and independent of
 * TanStack Start, so they can be tested against D1. Membership changes
 * themselves (invite, accept, remove) go through Better Auth's endpoints,
 * which check permissions.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { invitation, member, organization, session, user } from '../db/schema'
import { normalizeEmail } from './allowlist'
import type {
  InvitationPreview,
  InvitationStatus,
  PendingInvitation,
  Workspace,
  WorkspaceMember,
} from './workspace'

/** The request has a user but no workspace they belong to. */
export class NoWorkspaceError extends Error {
  constructor() {
    super('Você ainda não faz parte de nenhum workspace.')
    this.name = 'NoWorkspaceError'
  }
}


/** Whether a not-yet-expired invitation is waiting for this email. */
export async function hasPendingInvitation(
  db: Database,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [found] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${normalizeEmail(email)}`,
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
      ),
    )
    .limit(1)
  return found !== undefined
}

/** Every workspace the user belongs to, oldest membership first. */
export async function listUserWorkspaces(
  db: Database,
  userId: string,
): Promise<Array<Workspace>> {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(member.id))
}

/** The workspace a new session opens: the user's oldest membership. */
export async function initialWorkspaceId(
  db: Database,
  userId: string,
): Promise<string | null> {
  const [first] = await listUserWorkspaces(db, userId)
  return first?.id ?? null
}

/**
 * The workspace a request acts in: `preferredId` (the session's active
 * organization) while the user is still a member of it, else their oldest
 * workspace, else `null`.
 */
export async function resolveWorkspace(
  db: Database,
  userId: string,
  preferredId: string | null | undefined,
): Promise<Workspace | null> {
  const workspaces = await listUserWorkspaces(db, userId)
  return workspaces.find((workspace) => workspace.id === preferredId) ?? workspaces[0] ?? null
}

/**
 * The workspace an MCP client acts in. Access tokens carry no workspace, so
 * this is the one the user has open in the app (their most recently used
 * session), falling back to their oldest workspace.
 */
export async function resolveMcpWorkspace(
  db: Database,
  userId: string,
): Promise<Workspace | null> {
  const [latest] = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.updatedAt))
    .limit(1)
  return resolveWorkspace(db, userId, latest?.activeOrganizationId)
}

export async function isWorkspaceMember(
  db: Pick<Database, 'select'>,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const [found] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return found !== undefined
}

/** Members of a workspace, by name. */
export async function listWorkspaceMembers(
  db: Database,
  organizationId: string,
): Promise<Array<WorkspaceMember>> {
  return db
    .select({
      memberId: member.id,
      id: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(user.name), asc(user.email))
}

/** Invitations of a workspace still waiting for an answer (expired ones too). */
export async function listPendingInvitations(
  db: Database,
  organizationId: string,
  now: Date = new Date(),
): Promise<Array<PendingInvitation>> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt))
  return rows.map((row) => ({ ...row, expired: row.expiresAt <= now }))
}

/**
 * The public face of an invitation, for `/invite/<id>`. The id is the secret
 * (it is only in the invitee's email), so this needs no session; accepting it
 * still requires signing in with the invited email.
 */
export async function getInvitationPreview(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<InvitationPreview | null> {
  const [found] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      workspaceName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, id))
    .limit(1)
  if (!found) return null
  const { expiresAt, status, ...rest } = found
  const effective: InvitationStatus =
    status === 'pending' && expiresAt <= now
      ? 'expired'
      : (['pending', 'accepted', 'rejected', 'canceled'] as const).find((s) => s === status) ??
        'canceled'
  return { ...rest, status: effective }
}
