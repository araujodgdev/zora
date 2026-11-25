import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase } from '../../test/db'
import { createAuth } from './auth.server'
import { inviteToWorkspace } from './invitations.server'
import type { Mailer, OutgoingEmail } from './mailer.server'
import {
  UnauthorizedError,
  findSessionState,
  findSessionUser,
  requireSessionUser,
  requireWorkspaceSession,
} from './session.server'
import { NoWorkspaceError, hasPendingInvitation } from './workspace.server'

// Exercises the real Better Auth configuration against an in-memory D1 database.
const db = await createTestDb()
const auth = createAuth(db, {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3000',
})

/** Records the emails "sent"; fails while `mailerFails` is set. */
const sent: Array<OutgoingEmail> = []
let mailerFails = false
const mailer: Mailer = {
  async send(message) {
    if (mailerFails) throw Object.assign(new Error('Sending failed'), { code: 'E_DELIVERY_FAILED' })
    sent.push(message)
    return { messageId: 'm1' }
  },
}

function signUp(email: string) {
  return auth.api.signUpEmail({
    body: { name: 'Test User', email, password: 'correct-horse-battery' },
    asResponse: true,
  })
}

function sessionHeaders(response: Response): Headers {
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  return new Headers({ cookie: cookies })
}

beforeEach(async () => {
  await resetDatabase(db)
  sent.length = 0
  mailerFails = false
})

afterAll(async () => {
  await closeTestDb(db)
})

describe('sign-up (server side)', () => {
  it('allows anyone to sign up without an invitation', async () => {
    const response = await signUp('anyone@example.com')
    expect(response.status).toBe(200)
    const user = await requireSessionUser(auth, sessionHeaders(response))
    expect(user).toMatchObject({ name: 'Test User', email: 'anyone@example.com' })
  })
})

describe('session check used by authMiddleware', () => {
  it('resolves the signed-in user from the session cookie', async () => {
    const response = await signUp('bob@example.com')
    const user = await requireSessionUser(auth, sessionHeaders(response))
    expect(user).toMatchObject({ name: 'Test User', email: 'bob@example.com' })
  })

  it('rejects requests without a session', async () => {
    expect(await findSessionUser(auth, new Headers())).toBeNull()
    await expect(
      requireSessionUser(auth, new Headers()),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('rejects a session after sign-out', async () => {
    const headers = sessionHeaders(await signUp('bob@example.com'))
    const signOut = await auth.api.signOut({ headers, asResponse: true })
    // The browser drops both cookies (the token and the cached session).
    const cleared = signOut.headers
      .getSetCookie()
      .filter((cookie) => /max-age=0/i.test(cookie))
      .map((cookie) => cookie.split('=')[0])
    expect(cleared).toEqual(
      expect.arrayContaining(['better-auth.session_token', 'better-auth.session_data']),
    )
    // The token alone (no cached session) is checked against the database.
    const tokenOnly = new Headers({
      cookie: headers
        .get('cookie')!
        .split('; ')
        .filter((cookie) => !cookie.startsWith('better-auth.session_data='))
        .join('; '),
    })
    await expect(requireSessionUser(auth, tokenOnly)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  it('trusts a copied session cookie only until the cookie cache expires', async () => {
    // The trade-off of `session.cookieCache` (5 minutes): a session_data
    // cookie copied before sign-out keeps working that long.
    const headers = sessionHeaders(await signUp('bob@example.com'))
    await auth.api.signOut({ headers })
    await expect(requireSessionUser(auth, headers)).resolves.toMatchObject({
      email: 'bob@example.com',
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000)
      await expect(requireSessionUser(auth, headers)).rejects.toBeInstanceOf(
        UnauthorizedError,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Alice signs up and creates the Signum workspace. */
async function ownerWithWorkspace() {
  const headers = sessionHeaders(await signUp('alice@example.com'))
  const workspace = await auth.api.createOrganization({
    body: { name: 'Signum', slug: 'signum' },
    headers,
  })
  return { headers, workspace: workspace! }
}

function invite(headers: Headers, workspace: { id: string; name: string }, email: string) {
  return inviteToWorkspace(auth, mailer, headers, {
    workspace,
    inviterName: 'Alice',
    email,
    appUrl: 'http://localhost:3000',
  })
}

describe('workspaces and invitations', () => {
  it('lets an invited email sign up, accept and land in the workspace', async () => {
    const { headers, workspace } = await ownerWithWorkspace()
    const invitation = await invite(headers, workspace, 'Carol@Example.com')
    expect(invitation.emailSent).toBe(true)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'carol@example.com',
      from: { email: 'zora@notify.lume.software', name: 'Zora' },
      subject: 'Alice convidou você para Signum no Zora',
    })
    expect(sent[0]!.text).toContain(`http://localhost:3000/invite/${invitation.invitationId}`)
    expect(await hasPendingInvitation(db, 'carol@example.com')).toBe(true)

    const carolResponse = await signUp('carol@example.com')
    expect(carolResponse.status).toBe(200)
    const carol = sessionHeaders(carolResponse)
    expect((await findSessionState(auth, db, carol))?.workspace).toBeNull()
    await expect(requireWorkspaceSession(auth, db, carol)).rejects.toBeInstanceOf(NoWorkspaceError)

    await auth.api.acceptInvitation({
      body: { invitationId: invitation.invitationId },
      headers: carol,
    })
    const state = await requireWorkspaceSession(auth, db, carol)
    expect(state.workspace).toMatchObject({ id: workspace.id, name: 'Signum', role: 'member' })
    expect(await hasPendingInvitation(db, 'carol@example.com')).toBe(false)

    // A member may not invite (owners and admins only).
    await expect(invite(carol, workspace, 'dave@example.com')).rejects.toMatchObject({
      status: 403,
      message: 'Só donos e admins podem convidar pessoas.',
    })
    expect(sent).toHaveLength(1)
  })

  it('opens the oldest workspace in a new session', async () => {
    const { workspace } = await ownerWithWorkspace()
    const response = await auth.api.signInEmail({
      body: { email: 'alice@example.com', password: 'correct-horse-battery' },
      asResponse: true,
    })
    const state = await findSessionState(auth, db, sessionHeaders(response))
    expect(state?.workspace).toMatchObject({ id: workspace.id, role: 'owner' })
  })

  it('keeps the invitation and says so when the email cannot be sent', async () => {
    const { headers, workspace } = await ownerWithWorkspace()
    mailerFails = true
    expect(await invite(headers, workspace, 'carol@example.com')).toMatchObject({
      emailSent: false,
    })
    expect(await hasPendingInvitation(db, 'carol@example.com')).toBe(true)
  })

  it('refuses a second invitation unless it is a resend, which keeps the link', async () => {
    const { headers, workspace } = await ownerWithWorkspace()
    const first = await invite(headers, workspace, 'carol@example.com')
    await expect(invite(headers, workspace, 'carol@example.com')).rejects.toMatchObject({
      message: 'Essa pessoa já tem um convite pendente.',
    })
    const again = await inviteToWorkspace(auth, mailer, headers, {
      workspace,
      inviterName: 'Alice',
      email: 'carol@example.com',
      resend: true,
      appUrl: 'http://localhost:3000',
    })
    expect(again).toEqual({ invitationId: first.invitationId, emailSent: true })
    expect(sent).toHaveLength(2)
  })

  it('does not let an invitation for one email be accepted by another', async () => {
    const { headers, workspace } = await ownerWithWorkspace()
    const invitation = await invite(headers, workspace, 'carol@example.com')
    const bob = sessionHeaders(await signUp('bob@example.com'))
    await expect(
      auth.api.acceptInvitation({ body: { invitationId: invitation.invitationId }, headers: bob }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })
})
