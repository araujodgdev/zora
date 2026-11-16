import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { APIError } from 'better-auth/api'
import { betterAuth } from 'better-auth/minimal'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import * as authSchema from '../db/auth-schema'
import type { Database } from '../db/client.server'
import {
  SIGNUP_NOT_ALLOWED_MESSAGE,
  isEmailAllowed,
  parseAllowlist,
} from './allowlist'
import type { ServerEnv } from './env.server'

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
    // Must stay last: lets auth.api calls set cookies through TanStack Start.
    plugins: [tanstackStartCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>
