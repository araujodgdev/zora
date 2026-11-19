import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client.server'
import { contentAsset } from './schema'

// The attribution migration adds a nullable JSON column to content_asset:
// existing files keep working (attribution null) and new ones round-trip.
const ATTRIBUTION_MIGRATION = '20261118042243_salty_sasquatch'

const platform = await getPlatformProxy<{ DB: never }>({
  configPath: './test/wrangler.jsonc',
  persist: false,
  remoteBindings: false,
})
const db = createDb(platform.env.DB)
const before = mkdtempSync(join(tmpdir(), 'zora-migrations-'))

afterAll(async () => {
  rmSync(before, { recursive: true, force: true })
  await platform.dispose()
})

describe('asset attribution migration', () => {
  it('keeps existing files and stores attributions', async () => {
    for (const name of readdirSync('./drizzle')) {
      if (name < ATTRIBUTION_MIGRATION) cpSync(join('./drizzle', name), join(before, name), { recursive: true })
    }
    await migrate(db, { migrationsFolder: before })

    await db.run(sql`insert into user (id, name, email, created_at, updated_at)
      values ('u1', 'Ana', 'ana@example.com', 1000, 1000)`)
    await db.run(sql`insert into organization (id, name, slug, created_at)
      values ('ws', 'Signum', 'signum', 1000)`)
    await db.run(sql`insert into content_item (id, organization_id, title, channel, format, created_by_id)
      values ('i1', 'ws', 'Teaser', 'instagram', 'post', 'u1')`)
    await db.run(sql`insert into content_asset (id, content_item_id, filename, content_type, size, created_by_id)
      values ('a1', 'i1', 'old.png', 'image/png', 10, 'u1')`)

    await migrate(db, { migrationsFolder: './drizzle' })

    const [old] = await db.select().from(contentAsset).where(eq(contentAsset.id, 'a1'))
    expect(old).toMatchObject({ filename: 'old.png', attribution: null })

    const attribution = {
      provider: 'unsplash' as const,
      photoId: 'abc',
      photographer: 'Ana Lúcia',
      photographerUrl: 'https://unsplash.com/@analu?utm_source=zora&utm_medium=referral',
      photoUrl: 'https://unsplash.com/photos/abc?utm_source=zora&utm_medium=referral',
    }
    await db.insert(contentAsset).values({
      id: 'a2', contentItemId: 'i1', filename: 'new.jpg', contentType: 'image/jpeg', size: 5, createdById: 'u1', attribution,
    })
    const [added] = await db.select().from(contentAsset).where(eq(contentAsset.id, 'a2'))
    expect(added!.attribution).toEqual(attribution)
  })
})
