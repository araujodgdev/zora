import { APIError } from 'better-auth/api'
import type { Auth } from './auth.server'
import { authErrorMessage } from './auth-errors'
import { invitationEmail } from './invitation-email'
import type { Mailer } from './mailer.server'
import { invitationPath } from './workspace'

/** Better Auth refused the invitation; the message is in Portuguese. */
export class InvitationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'InvitationError'
  }
}

/**
 * Invites `email` to a workspace as a member and emails the link.
 *
 * Better Auth creates the invitation (and checks that the inviter may invite);
 * then the email is sent here. A failed send does not undo the invitation:
 * `emailSent: false` tells the inviter to copy the link instead. With
 * `resend`, a pending invitation keeps its link and gets a new expiry.
 */
export async function inviteToWorkspace(
  auth: Auth,
  mailer: Mailer,
  headers: Headers,
  input: {
    workspace: { id: string; name: string }
    inviterName: string
    email: string
    resend?: boolean
    appUrl: string
  },
): Promise<{ invitationId: string; emailSent: boolean }> {
  let invitation: { id: string; email: string }
  try {
    invitation = await auth.api.createInvitation({
      body: {
        email: input.email,
        role: 'member',
        organizationId: input.workspace.id,
        resend: input.resend ?? false,
      },
      headers,
    })
  } catch (error) {
    if (error instanceof APIError) {
      throw new InvitationError(
        authErrorMessage(
          { code: error.body?.code, message: error.message },
          'Não foi possível criar o convite.',
        ),
        error.statusCode,
      )
    }
    throw error
  }

  const url = new URL(invitationPath(invitation.id), input.appUrl).toString()
  try {
    await mailer.send(
      invitationEmail({
        to: invitation.email,
        workspaceName: input.workspace.name,
        inviterName: input.inviterName,
        url,
      }),
    )
    return { invitationId: invitation.id, emailSent: true }
  } catch (error) {
    console.error('Could not send the invitation email', invitation.id, error)
    return { invitationId: invitation.id, emailSent: false }
  }
}
