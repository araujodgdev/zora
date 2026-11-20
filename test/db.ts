import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { createDb } from '../src/db/client.server'
import type { Database } from '../src/db/client.server'
import {
  account,
  contentAsset,
  contentDesign,
  contentDesignVersion,
  contentItem,
  invitation,
  mcpWorkspaceState,
  member,
  organization,
  session,
  socialConnection,
  socialPublishJob,
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

/**
 * Creates a workspace (organization) with the given users as members; the
 * first one is the owner. Returns its id.
 */
export async function seedWorkspace(
  db: Database,
  id: string,
  userIds: Array<string>,
  name = id,
): Promise<string> {
  await db.insert(organization).values({ id, name, slug: id, createdAt: new Date() })
  if (userIds.length > 0) {
    await db.insert(member).values(
      userIds.map((userId, index) => ({
        id: `${id}-${userId}`,
        organizationId: id,
        userId,
        role: index === 0 ? 'owner' : 'member',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
    )
  }
  return id
}

/** Empties every application and auth table (children before parents). */
export async function resetDatabase(db: Database): Promise<void> {
  for (const table of [
    mcpWorkspaceState,
    socialPublishJob,
    socialConnection,
    contentDesignVersion,
    contentDesign,
    contentAsset,
    contentItem,
    invitation,
    member,
    organization,
    session,
    account,
    verification,
    user,
  ]) {
    await db.delete(table)
  }
}
