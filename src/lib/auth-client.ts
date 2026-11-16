import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth browser client. Same-origin, so no baseURL is needed.
 * Use for sign-up, sign-in and sign-out; the server reads the session cookie.
 */
export const authClient = createAuthClient()
