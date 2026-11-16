import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, resetDatabase } from '../../test/db'
import { closeDb } from '../db/client.server'
import { SIGNUP_NOT_ALLOWED_MESSAGE } from './allowlist'
import { createAuth } from './auth.server'
import {
  UnauthorizedError,
  findSessionUser,
  requireSessionUser,
} from './session.server'

// Exercises the real Better Auth configuration against TEST_DATABASE_URL.
const db = createTestDb()
const auth = createAuth(db, {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3000',
  ALLOWED_SIGNUP_EMAILS: 'Alice@Example.com, bob@example.com',
})

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
})

afterAll(async () => {
  await closeDb(db)
})

describe('sign-up allowlist (server side)', () => {
  it('accepts an allowlisted email regardless of case', async () => {
    const response = await signUp('ALICE@example.com')
    expect(response.status).toBe(200)
  })

  it('rejects any other email with a clear message', async () => {
    const response = await signUp('mallory@example.com')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      message: SIGNUP_NOT_ALLOWED_MESSAGE,
    })
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
    await auth.api.signOut({ headers })
    await expect(requireSessionUser(auth, headers)).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })
})
