import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

export type Database = NodePgDatabase

/**
 * Creates a Drizzle client over node-postgres (TCP).
 *
 * On Cloudflare Workers a connection cannot be reused across requests, so the
 * app creates one client per request (see `getRequestServices`). Never hold
 * the result in module scope inside the Worker.
 */
export function createDb(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    // One connection per request is enough for this app; queries in the same
    // request queue on it.
    max: 1,
  })
  return drizzle({ client: pool })
}

/** Closes the connection behind a client created by `createDb`. */
export async function closeDb(db: Database): Promise<void> {
  const client = (db as Database & { $client: Pool }).$client
  await client.end()
}
