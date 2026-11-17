/**
 * Workspace server functions (reads). Membership changes (invite, cancel,
 * accept, remove, switch, create) go through Better Auth's organization
 * endpoints via `authClient.organization`, which check the permissions.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseStatus } from '@tanstack/react-start/server'
import { z } from 'zod'
import { authMiddleware } from './auth-middleware'
import { InvitationError, inviteToWorkspace } from './invitations.server'
import { getMailer } from './mailer.server'
import { getRequestServices } from './services.server'
import { canManageMembers, inviteEmailSchema } from './workspace'
import type {
  InvitationPreview,
  PendingInvitation,
  Workspace,
  WorkspaceMember,
} from './workspace'
import * as workspaces from './workspace.server'

/** The workspaces the signed-in user belongs to, for the switcher. */
export const listMyWorkspaces = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(
    ({ context }): Promise<Array<Workspace>> =>
      workspaces.listUserWorkspaces(context.db, context.user.id),
  )

export const listWorkspaceMembers = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(
    ({ context }): Promise<Array<WorkspaceMember>> =>
      workspaces.listWorkspaceMembers(context.db, context.workspace.id),
  )

/**
 * Invites an email to the current workspace and sends the invitation email.
 * `emailSent: false` means the invitation exists but its email failed: the
 * link can be copied from the team page.
 */
export const inviteWorkspaceMember = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ email: inviteEmailSchema, resend: z.boolean().optional() }))
  .handler(async ({ context, data }) => {
    const { auth, env } = getRequestServices()
    try {
      return await inviteToWorkspace(auth, getMailer(), new Headers(getRequestHeaders()), {
        workspace: context.workspace,
        inviterName: context.user.name,
        email: data.email,
        resend: data.resend,
        appUrl: env.BETTER_AUTH_URL,
      })
    } catch (error) {
      if (error instanceof InvitationError) setResponseStatus(error.status)
      throw error
    }
  })

/** Pending invitations; only owners and admins see them (others get none). */
export const listWorkspaceInvitations = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<Array<PendingInvitation>> =>
      canManageMembers(context.workspace.role)
        ? workspaces.listPendingInvitations(context.db, context.workspace.id)
        : [],
  )

/**
 * What `/invite/<id>` shows. Public on purpose: the visitor may not have an
 * account yet, and the id is only known from the invitation email.
 */
export const getInvitationPreview = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(({ data }): Promise<InvitationPreview | null> => {
    const { db } = getRequestServices()
    return workspaces.getInvitationPreview(db, data.id)
  })
