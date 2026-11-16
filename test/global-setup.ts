import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closeDb } from '../src/db/client.server'
import { createTestDb } from './db'

/** Brings the test database up to date with the committed migrations. */
export default async function setup() {
  const db = createTestDb()
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
  } finally {
    await closeDb(db)
  }
}
