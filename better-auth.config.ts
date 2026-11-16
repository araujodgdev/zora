/**
 * Entry point for the Better Auth CLI only (schema generation). The app
 * builds its auth instance per request in src/lib/services.server.ts.
 *
 * Regenerate the auth tables after changing the auth config:
 *   pnpm auth:generate && pnpm db:generate
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { createAuth } from './src/lib/auth.server'

export const auth = createAuth(drizzle.mock(), {
  BETTER_AUTH_SECRET: 'cli-only-placeholder-secret-not-used-at-runtime',
  BETTER_AUTH_URL: 'http://localhost:3000',
  ALLOWED_SIGNUP_EMAILS: '',
})
