import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client.server'

// The photo edits migration only adds tables; prove it applies on top of
// existing data and that its constraints and foreign keys hold.
const PHOTO_EDITS_MIGRATION = '20261120172221_brave_hawkeye'

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

describe('photo edits migration', () => {
  it('keeps existing items and media and enforces the photo edit constraints', async () => {
    for (const name of readdirSync('./drizzle')) {
      if (name < PHOTO_EDITS_MIGRATION) {
        cpSync(join('./drizzle', name), join(before, name), { recursive: true })
      }
    }
    await migrate(db, { migrationsFolder: before })

    await db.run(sql`insert into user (id, name, email, created_at, updated_at)
      values ('u1', 'Ana', 'ana@example.com', 1000, 1000)`)
    await db.run(sql`insert into organization (id, name, slug, created_at)
      values ('ws', 'Signum', 'signum', 1000)`)
    await db.run(sql`insert into content_item (id, organization_id, title, channel, format, created_by_id)
      values ('i1', 'ws', 'Teaser', 'instagram', 'post', 'u1')`)
    await db.run(sql`insert into content_asset (id, content_item_id, filename, content_type, size, created_by_id)
      values ('a1', 'i1', 'p.jpg', 'image/jpeg', 10, 'u1')`)

    await migrate(db, { migrationsFolder: './drizzle' })

    expect(await db.all(sql`select id from content_item`)).toEqual([{ id: 'i1' }])
    expect(await db.all(sql`select id from content_asset`)).toEqual([{ id: 'a1' }])

    await db.run(sql`insert into content_photo_edit (id, content_item_id, name, source_asset_id, original_key, original_name, original_size, created_by_id)
      values ('e1', 'i1', 'Foto', 'a1', 'photo-edits/e1/original.jpg', 'p.jpg', 10, 'u1')`)
    await db.run(sql`insert into content_photo_edit_version (id, edit_id, number, author_kind, created_by_id, settings_size, preview_size)
      values ('v1', 'e1', 1, 'user', 'u1', 10, 10)`)

    const rejects = (statement: ReturnType<typeof sql>) => expect(db.run(statement)).rejects.toThrow()
    // Empty names, empty originals, unknown items.
    await rejects(sql`insert into content_photo_edit (id, content_item_id, name, original_key, original_name, original_size, created_by_id)
      values ('e2', 'i1', '', 'k', 'p.jpg', 10, 'u1')`)
    await rejects(sql`insert into content_photo_edit (id, content_item_id, name, original_key, original_name, original_size, created_by_id)
      values ('e3', 'i1', 'X', 'k', 'p.jpg', 0, 'u1')`)
    await rejects(sql`insert into content_photo_edit (id, content_item_id, name, original_key, original_name, original_size, created_by_id)
      values ('e4', 'missing', 'X', 'k', 'p.jpg', 10, 'u1')`)
    // Author kind, duplicate numbers, sizes.
    await rejects(sql`insert into content_photo_edit_version (id, edit_id, number, author_kind, created_by_id, settings_size, preview_size)
      values ('v2', 'e1', 2, 'robot', 'u1', 10, 10)`)
    await rejects(sql`insert into content_photo_edit_version (id, edit_id, number, author_kind, created_by_id, settings_size, preview_size)
      values ('v3', 'e1', 1, 'agent', 'u1', 10, 10)`)
    await rejects(sql`insert into content_photo_edit_version (id, edit_id, number, author_kind, created_by_id, settings_size, preview_size)
      values ('v4', 'e1', 2, 'agent', 'u1', 10, 0)`)

    // Deleting the source media keeps the edit and clears the link.
    await db.run(sql`delete from content_asset where id = 'a1'`)
    expect(await db.all(sql`select id, source_asset_id from content_photo_edit`)).toEqual([
      { id: 'e1', source_asset_id: null },
    ])

    // Deleting the item takes its edits and versions with it.
    await db.run(sql`delete from content_item where id = 'i1'`)
    expect(await db.all(sql`select id from content_photo_edit`)).toEqual([])
    expect(await db.all(sql`select id from content_photo_edit_version`)).toEqual([])
  })
})
