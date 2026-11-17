/**
 * Workspaces, shared by client and server. A workspace is a Better Auth
 * organization: content items belong to one, and its members see and edit
 * all of its content. Members join through invitations.
 */
import { z } from 'zod'

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Dono',
  admin: 'Admin',
  member: 'Membro',
}

/** The workspace a request acts in, with the signed-in user's role there. */
export type Workspace = {
  id: string
  name: string
  slug: string
  /** Better Auth role string; several roles are comma-separated. */
  role: string
}

export type WorkspaceMember = {
  /** The membership id (what Better Auth's member endpoints take). */
  memberId: string
  /** The user id (what `assigneeId` holds). */
  id: string
  name: string
  email: string
  role: string
  joinedAt: Date
}

export type PendingInvitation = {
  id: string
  email: string
  expiresAt: Date
  createdAt: Date
  /** Past `expiresAt` when listed; the link no longer works. */
  expired: boolean
}

/** The link an invitation email carries (`/invite/<id>`). */
export function invitationPath(id: string): string {
  return `/invite/${id}`
}

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'

/** What the invitation page shows, before the visitor has signed in. */
export type InvitationPreview = {
  id: string
  email: string
  status: InvitationStatus
  workspaceName: string
  inviterName: string
}

export function parseRoles(role: string): Array<string> {
  return role
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

/** The label of the highest role in a role string. */
export function roleLabel(role: string): string {
  const roles = parseRoles(role)
  const known = WORKSPACE_ROLES.find((value) => roles.includes(value))
  return known ? ROLE_LABELS[known] : role
}

/**
 * Whether the role may invite, cancel invitations and remove members (Better
 * Auth's default permissions: owner and admin). The server checks it again.
 */
export function canManageMembers(role: string): boolean {
  const roles = parseRoles(role)
  return roles.includes('owner') || roles.includes('admin')
}

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Informe o nome do workspace.' })
  .max(80, { message: 'Use no máximo 80 caracteres.' })

export const inviteEmailSchema = z.email({ message: 'Informe um e-mail válido.' })

/**
 * A URL slug for a new workspace. Slugs are unique in Better Auth, so a short
 * random suffix keeps two workspaces with the same name apart.
 */
export function workspaceSlug(name: string, suffix: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return [base || 'workspace', suffix].join('-')
}
