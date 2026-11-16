import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { createDb } from '../src/db/client.server'
import type { Database } from '../src/db/client.server'

/**
 * Connection string of the test database. Refuses to run against the
 * development database because tests truncate tables.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `pnpm env:setup` and `pnpm db:up`.',
    )
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.')
  }
  return url
}

export function createTestDb(): Database {
  return createDb(getTestDatabaseUrl())
}

/** Empties every application and auth table. */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE content_item, session, account, verification, "user" RESTART IDENTITY CASCADE`,
  )
}
