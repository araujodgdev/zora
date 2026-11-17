import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { mcp } from '@better-auth/mcp'
import { APIError } from 'better-auth/api'
import { betterAuth } from 'better-auth/minimal'
import { jwt } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import * as authSchema from '../db/auth-schema'
import type { Database } from '../db/client.server'
import {
  SIGNUP_NOT_ALLOWED_MESSAGE,
  isEmailAllowed,
  parseAllowlist,
} from './allowlist'
import type { ServerEnv } from './env.server'

/**
 * The MCP endpoint (`src/routes/mcp.ts`) as an OAuth protected resource: MCP
 * access tokens are issued for, and only accepted at, this URL.
 */
export function mcpResourceUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`
}

export type AuthEnv = Pick<
  ServerEnv,
  'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'ALLOWED_SIGNUP_EMAILS'
>

/**
 * Builds the Better Auth instance for one database client.
 *
 * The app calls this once per request through `getRequestServices()`.
 */
export function createAuth(db: Database, env: AuthEnv) {
  const allowlist = parseAllowlist(env.ALLOWED_SIGNUP_EMAILS)

  return betterAuth({
    appName: 'Zora',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      // Workers do not set X-Forwarded-For; Cloudflare sends the client IP here.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    // Per-request auth instances must not reset the counters. D1 shares them
    // across Worker instances; especially important for anonymous registration.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/oauth2/register': { window: 60, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // The sign-up allowlist. Enforced at user creation so it covers
          // every path that can create a user, not only the sign-up form.
          before: async (user) => {
            if (!isEmailAllowed(user.email, allowlist)) {
              throw new APIError('FORBIDDEN', {
                message: SIGNUP_NOT_ALLOWED_MESSAGE,
              })
            }
            return { data: user }
          },
        },
      },
    },
    // The JWT plugin's own `/token` endpoint would hand out session JWTs signed
    // with the same key as MCP access tokens; OAuth clients use /oauth2/token.
    disabledPaths: ['/token'],
    plugins: [
      // Signing keys (stored in the `jwks` table) for OAuth access tokens.
      jwt({ disableSettingJwtHeader: true }),
      // Zora as the OAuth 2.1 authorization server for MCP clients (Claude,
      // ChatGPT, editors): they send the user through /sign-in and /consent,
      // then call /mcp with an access token bound to that user.
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        signup: { page: '/sign-up' },
        resource: mcpResourceUrl(env.BETTER_AUTH_URL),
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        clientRegistrationDefaultScopes: ['openid', 'profile', 'email', 'offline_access'],
      }),
      // Must stay last: lets auth.api calls set cookies through TanStack Start.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>
