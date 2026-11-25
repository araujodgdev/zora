/**
 * Entry point for the Better Auth CLI only (schema generation). The app
 * builds its auth instance per request in src/lib/services.server.ts.
 *
 * Regenerate the auth tables after changing the auth config:
 *   pnpm auth:generate && pnpm db:generate
 */
import { createDb } from './src/db/client.server'
import { createAuth } from './src/lib/auth.server'

// The CLI only reads the config; the empty binding is never queried.
export const auth = createAuth(createDb({} as never), {
  BETTER_AUTH_SECRET: 'cli-only-placeholder-secret-not-used-at-runtime',
  BETTER_AUTH_URL: 'http://localhost:3000',
})
