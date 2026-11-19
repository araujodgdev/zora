import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client.server'

// The designs migration only adds tables; prove it applies on top of
// existing data and that its constraints hold.
const DESIGNS_MIGRATION = '20261118034355_flaky_millenium_guard'

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

describe('designs migration', () => {
  it('keeps existing items and enforces the design constraints', async () => {
    for (const name of readdirSync('./drizzle')) {
      if (name < DESIGNS_MIGRATION) cpSync(join('./drizzle', name), join(before, name), { recursive: true })
    }
    await migrate(db, { migrationsFolder: before })

    await db.run(sql`insert into user (id, name, email, created_at, updated_at)
      values ('u1', 'Ana', 'ana@example.com', 1000, 1000)`)
    await db.run(sql`insert into organization (id, name, slug, created_at)
      values ('ws', 'Signum', 'signum', 1000)`)
    await db.run(sql`insert into content_item (id, organization_id, title, channel, format, created_by_id)
      values ('i1', 'ws', 'Teaser', 'instagram', 'post', 'u1')`)

    await migrate(db, { migrationsFolder: './drizzle' })

    expect(await db.all(sql`select id, title from content_item`)).toEqual([{ id: 'i1', title: 'Teaser' }])
    await db.run(sql`insert into content_design (id, content_item_id, name, width_px, height_px, created_by_id)
      values ('d1', 'i1', 'Post', 1080, 1080, 'u1')`)
    await db.run(sql`insert into content_design_version (id, design_id, number, author_kind, created_by_id, source_size, preview_size)
      values ('v1', 'd1', 1, 'user', 'u1', 10, 10)`)

    const rejects = (statement: ReturnType<typeof sql>) => expect(db.run(statement)).rejects.toThrow()
    // Size bounds, empty names, unknown items.
    await rejects(sql`insert into content_design (id, content_item_id, name, width_px, height_px, created_by_id)
      values ('d2', 'i1', 'Big', 16385, 10, 'u1')`)
    await rejects(sql`insert into content_design (id, content_item_id, name, width_px, height_px, created_by_id)
      values ('d3', 'i1', '', 10, 10, 'u1')`)
    await rejects(sql`insert into content_design (id, content_item_id, name, width_px, height_px, created_by_id)
      values ('d4', 'missing', 'X', 10, 10, 'u1')`)
    // Author kind, duplicate numbers, sizes.
    await rejects(sql`insert into content_design_version (id, design_id, number, author_kind, created_by_id, source_size, preview_size)
      values ('v2', 'd1', 2, 'robot', 'u1', 10, 10)`)
    await rejects(sql`insert into content_design_version (id, design_id, number, author_kind, created_by_id, source_size, preview_size)
      values ('v3', 'd1', 1, 'agent', 'u1', 10, 10)`)
    await rejects(sql`insert into content_design_version (id, design_id, number, author_kind, created_by_id, source_size, preview_size)
      values ('v4', 'd1', 2, 'agent', 'u1', 0, 10)`)

    // Deleting the item takes its designs and versions with it.
    await db.run(sql`delete from content_item where id = 'i1'`)
    expect(await db.all(sql`select id from content_design`)).toEqual([])
    expect(await db.all(sql`select id from content_design_version`)).toEqual([])
  })
})
