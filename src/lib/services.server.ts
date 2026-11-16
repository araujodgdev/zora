import { getRequest } from '@tanstack/react-start/server'
import { env as bindings } from 'cloudflare:workers'
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

// Keyed by the current Request: each request gets its own Drizzle client and
// Better Auth instance. Both are cheap (the D1 binding holds no connection),
// and keeping them per request means nothing request-bound lives in module
// scope on Workers.
const servicesByRequest = new WeakMap<Request, RequestServices>()

/**
 * Returns the D1 database client and Better Auth instance for the current
 * request, creating them on first use. Server-only: call it from server
 * function handlers, middleware `.server()` and server route handlers.
 */
export function getRequestServices(): RequestServices {
  const request = getRequest()
  let services = servicesByRequest.get(request)
  if (!services) {
    const env = getServerEnv()
    const db = createDb(bindings.DB)
    services = { env, db, auth: createAuth(db, env) }
    servicesByRequest.set(request, services)
  }
  return services
}
