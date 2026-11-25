/**
 * Workspace (Better Auth organization) lookups. Server-only and independent of
 * TanStack Start, so they can be tested against D1. Membership changes
 * themselves (invite, accept, remove) go through Better Auth's endpoints,
 * which check permissions.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import {
  invitation,
  mcpWorkspaceState,
  member,
  organization,
  session,
  user,
} from '../db/schema'
import {
  canManageMembers,
  normalizeEmail,
  workspaceNameSchema,
  workspaceSlug,
} from './workspace'
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

/** A workspace rule or permission check failed (message shown to the user/agent). */
export class WorkspaceRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRuleError'
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
 * The workspace an MCP client acts in. Access tokens authenticate the user
 * across all their workspaces, so MCP remembers the workspace selected via
 * `switch_workspace` / `create_workspace` in `mcp_workspace_state`, falling
 * back to the user's most recently used browser session, then their oldest
 * workspace, else `null`.
 */
export async function resolveMcpWorkspace(
  db: Database,
  userId: string,
): Promise<Workspace | null> {
  const workspaces = await listUserWorkspaces(db, userId)
  if (workspaces.length === 0) return null

  const [saved] = await db
    .select({ organizationId: mcpWorkspaceState.organizationId })
    .from(mcpWorkspaceState)
    .where(eq(mcpWorkspaceState.userId, userId))
    .limit(1)
  if (saved) {
    const match = workspaces.find((workspace) => workspace.id === saved.organizationId)
    if (match) return match
  }

  const [latest] = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.updatedAt))
    .limit(1)
  return (
    workspaces.find((workspace) => workspace.id === latest?.activeOrganizationId) ??
    workspaces[0] ??
    null
  )
}

function findUserWorkspaceByRef(
  workspaces: ReadonlyArray<Workspace>,
  workspaceRef: string,
): Workspace {
  const key = workspaceRef.trim()
  const found =
    workspaces.find((workspace) => workspace.id === key) ??
    workspaces.find((workspace) => workspace.slug === key)
  if (!found) {
    throw new WorkspaceRuleError('Workspace não encontrado ou você não faz parte dele.')
  }
  return found
}

function parseWorkspaceName(rawName: string): string {
  const parsed = workspaceNameSchema.safeParse(rawName)
  if (!parsed.success) {
    throw new WorkspaceRuleError(
      parsed.error.issues[0]?.message ?? 'Informe um nome válido para o workspace.',
    )
  }
  return parsed.data
}

/**
 * Persists which workspace `userId` acts in across stateless MCP calls.
 * Accepts either a workspace id or slug and verifies membership first.
 */
export async function setMcpActiveWorkspace(
  db: Database,
  userId: string,
  workspaceRef: string,
  now: Date = new Date(),
): Promise<Workspace> {
  const workspaces = await listUserWorkspaces(db, userId)
  const target = findUserWorkspaceByRef(workspaces, workspaceRef)
  await db
    .insert(mcpWorkspaceState)
    .values({ userId, organizationId: target.id, updatedAt: now })
    .onConflictDoUpdate({
      target: mcpWorkspaceState.userId,
      set: { organizationId: target.id, updatedAt: now },
    })
  return target
}

/**
 * Creates a workspace owned by `userId`. Uses a single D1 batch so the
 * organization and its owner membership are committed atomically.
 */
export async function createWorkspace(
  db: Database,
  userId: string,
  rawName: string,
  now: Date = new Date(),
): Promise<Workspace> {
  const name = parseWorkspaceName(rawName)
  const id = crypto.randomUUID()
  const slug = workspaceSlug(name, crypto.randomUUID().slice(0, 6))
  const memberId = crypto.randomUUID()
  await db.batch([
    db.insert(organization).values({ id, name, slug, createdAt: now }),
    db.insert(member).values({
      id: memberId,
      organizationId: id,
      userId,
      role: 'owner',
      createdAt: now,
    }),
  ])
  return { id, name, slug, role: 'owner' }
}

/**
 * Renames a workspace (accepts id or slug). Only owners and admins may rename;
 * the slug stays stable so existing references do not break.
 */
export async function renameWorkspace(
  db: Database,
  userId: string,
  workspaceRef: string,
  rawName: string,
): Promise<Workspace> {
  const name = parseWorkspaceName(rawName)
  const workspaces = await listUserWorkspaces(db, userId)
  const target = findUserWorkspaceByRef(workspaces, workspaceRef)
  if (!canManageMembers(target.role)) {
    throw new WorkspaceRuleError('Só donos e admins podem renomear o workspace.')
  }
  await db
    .update(organization)
    .set({ name })
    .where(eq(organization.id, target.id))
  return { ...target, name }
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
