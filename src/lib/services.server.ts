import { getRequest } from '@tanstack/react-start/server'
import { createDb } from '../db/client.server'
import type { Database } from '../db/client.server'
import { createAuth } from './auth.server'
import type { Auth } from './auth.server'
import { getServerEnv } from './env.server'
import type { ServerEnv } from './env.server'

export type RequestServices = {
  env: ServerEnv
  db: Database
  auth: Auth
}

// Keyed by the current Request so each request gets its own database
// connection and auth instance. Cloudflare Workers forbid reusing I/O objects
// (such as a socket) across requests, so these must never live in module scope.
const servicesByRequest = new WeakMap<Request, RequestServices>()

/**
 * Returns the database client and Better Auth instance for the current
 * request, creating them on first use. Server-only: call it from server
 * function handlers, middleware `.server()` and server route handlers.
 */
export function getRequestServices(): RequestServices {
  const request = getRequest()
  let services = servicesByRequest.get(request)
  if (!services) {
    const env = getServerEnv()
    const db = createDb(env.DATABASE_URL)
    services = { env, db, auth: createAuth(db, env) }
    servicesByRequest.set(request, services)
  }
  return services
}
