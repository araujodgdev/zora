import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { createDb } from '../src/db/client.server'
import type { Database } from '../src/db/client.server'
import {
  account,
  contentAsset,
  contentItem,
  session,
  user,
  verification,
} from '../src/db/schema'

const disposers = new WeakMap<Database, () => Promise<void>>()

/**
 * A fresh, in-memory D1 database with every committed migration applied. It
 * runs in workerd through Wrangler's `getPlatformProxy`, so tests exercise the
 * same SQLite engine and Drizzle driver as production, and nothing is
 * persisted. Close it with `closeTestDb`.
 */
export async function createTestDb(): Promise<Database> {
  const platform = await getPlatformProxy<{ DB: never }>({
    configPath: './test/wrangler.jsonc',
    persist: false,
    remoteBindings: false,
  })
  const db = createDb(platform.env.DB)
  disposers.set(db, () => platform.dispose())
  await migrate(db, { migrationsFolder: './drizzle' })
  return db
}

/** Stops the workerd process behind a database from `createTestDb`. */
export async function closeTestDb(db: Database): Promise<void> {
  await disposers.get(db)?.()
}

/** Empties every application and auth table (children before parents). */
export async function resetDatabase(db: Database): Promise<void> {
  for (const table of [
    contentAsset,
    contentItem,
    session,
    account,
    verification,
    user,
  ]) {
    await db.delete(table)
  }
}
