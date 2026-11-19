import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client.server'

const SOCIAL_MIGRATION = '20261119200553_social_publishing'

const platform = await getPlatformProxy<{ DB: never }>({
  configPath: './test/wrangler.jsonc',
  persist: false,
  remoteBindings: false,
})
const db = createDb(platform.env.DB)
const before = mkdtempSync(join(tmpdir(), 'zora-social-mig-'))

afterAll(async () => {
  rmSync(before, { recursive: true, force: true })
  await platform.dispose()
})

describe('social publishing migration', () => {
  it('preserves items, assets with attribution, designs and versions while allowing tiktok/youtube', async () => {
    for (const name of readdirSync('./drizzle')) {
      if (name < SOCIAL_MIGRATION) {
        cpSync(join('./drizzle', name), join(before, name), { recursive: true })
      }
    }
    await migrate(db, { migrationsFolder: before })

    await db.run(sql`insert into user (id, name, email, created_at, updated_at)
      values ('u1', 'Ana', 'ana@example.com', 1000, 1000)`)
    await db.run(sql`insert into organization (id, name, slug, created_at)
      values ('ws1', 'Signum', 'signum', 1000)`)
    await db.run(sql`insert into content_item (id, organization_id, title, channel, format, status, created_by_id)
      values ('i1', 'ws1', 'Post', 'instagram', 'post', 'draft', 'u1')`)
    await db.run(sql`insert into content_asset (id, content_item_id, filename, content_type, size, attribution, created_by_id)
      values ('a1', 'i1', 'photo.jpg', 'image/jpeg', 123, '{"provider":"fal","model":"m","prompt":"p"}', 'u1')`)
    await db.run(sql`insert into content_design (id, content_item_id, name, width_px, height_px, current_version_id, created_by_id)
      values ('d1', 'i1', 'Capa', 1080, 1080, 'v1', 'u1')`)
    await db.run(sql`insert into content_design_version (id, design_id, number, author_kind, created_by_id, source_size, preview_size)
      values ('v1', 'd1', 1, 'user', 'u1', 100, 50)`)

    await migrate(db, { migrationsFolder: './drizzle' })

    expect(await db.all(sql`select id, attribution from content_asset`)).toEqual([
      { id: 'a1', attribution: '{"provider":"fal","model":"m","prompt":"p"}' },
    ])
    expect(await db.all(sql`select id, current_version_id from content_design`)).toEqual([
      { id: 'd1', current_version_id: 'v1' },
    ])
    expect(await db.all(sql`select id, design_id, number from content_design_version`)).toEqual([
      { id: 'v1', design_id: 'd1', number: 1 },
    ])

    // New channels and formats are accepted; invalid values remain rejected.
    await db.run(sql`insert into content_item (id, organization_id, title, channel, format, status, created_by_id)
      values ('i2', 'ws1', 'Short YT', 'youtube', 'short', 'idea', 'u1'),
             ('i3', 'ws1', 'Clip TikTok', 'tiktok', 'video', 'idea', 'u1')`)
    await expect(
      db.run(sql`insert into content_item (id, organization_id, title, channel, format, status, created_by_id)
        values ('i4', 'ws1', 'Bad', 'bluesky', 'post', 'idea', 'u1')`),
    ).rejects.toThrow()
  })
})
