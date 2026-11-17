import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { createAuthClient } from 'better-auth/react'

/**
 * Better Auth browser client. Same-origin, so no baseURL is needed.
 * Use for sign-up, sign-in and sign-out; the server reads the session cookie.
 *
 * `oauthProviderClient` carries an MCP client's signed authorization request
 * (the `/sign-in` and `/consent` query) through sign-in and consent; when a
 * response says `{ redirect: true, url }`, the client navigates there itself.
 */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
})
