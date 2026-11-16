import { drizzle } from 'drizzle-orm/d1'
import type { AnyD1Database, DrizzleD1Database } from 'drizzle-orm/d1'

export type Database = DrizzleD1Database

/**
 * Wraps a D1 binding (`env.DB`) in a Drizzle client. Cheap: it holds no
 * connection, so creating one per request is fine.
 *
 * D1 has no interactive transactions (`db.transaction` throws); use single
 * statements or `db.batch([...])`, and see `patchContentItem` for how a
 * read-then-write is kept safe.
 */
export function createDb(binding: AnyD1Database): Database {
  return drizzle(binding)
}
