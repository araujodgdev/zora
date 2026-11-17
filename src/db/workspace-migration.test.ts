import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/d1/migrator'
import { getPlatformProxy } from 'wrangler'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client.server'

// The workspace migration rebuilds content_item by hand; prove it keeps the
// existing rows (including media, which reference the items) and puts them
// in the Signum workspace.
const WORKSPACE_MIGRATION = '20261117134314_useful_frightful_four'
const SIGNUM_ID = 'a6f3c1d2-5b7e-4c39-9f0a-2e8d4b6c1a57'

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

describe('workspace migration', () => {
  it('moves existing users, items and media into Signum', async () => {
    for (const name of readdirSync('./drizzle')) {
      if (name < WORKSPACE_MIGRATION) cpSync(join('./drizzle', name), join(before, name), { recursive: true })
    }
    await migrate(db, { migrationsFolder: before })

    await db.run(sql`insert into user (id, name, email, created_at, updated_at) values
      ('u-first', 'First', 'first@example.com', 1000, 1000),
      ('u-second', 'Second', 'second@example.com', 2000, 2000)`)
    await db.run(sql`insert into session (id, expires_at, token, updated_at, user_id)
      values ('s1', 9999999999999, 't1', 1, 'u-second')`)
    await db.run(sql`insert into content_item (id, title, channel, format, status, scheduled_at, assignee_id, created_by_id)
      values ('i1', 'Teaser', 'x', 'post', 'scheduled', 5000, 'u-second', 'u-first')`)
    await db.run(sql`insert into content_asset (id, content_item_id, filename, content_type, size, created_by_id)
      values ('a1', 'i1', 'teaser.png', 'image/png', 10, 'u-first')`)

    await migrate(db, { migrationsFolder: './drizzle' })

    expect(await db.all(sql`select id, name, slug from organization`)).toEqual([
      { id: SIGNUM_ID, name: 'Signum', slug: 'signum' },
    ])
    expect(
      await db.all(sql`select user_id, role from member where organization_id = ${SIGNUM_ID} order by user_id`),
    ).toEqual([
      { user_id: 'u-first', role: 'owner' },
      { user_id: 'u-second', role: 'member' },
    ])
    expect(await db.all(sql`select active_organization_id from session`)).toEqual([
      { active_organization_id: SIGNUM_ID },
    ])
    expect(
      await db.all(sql`select id, organization_id, title, status, scheduled_at, assignee_id from content_item`),
    ).toEqual([
      { id: 'i1', organization_id: SIGNUM_ID, title: 'Teaser', status: 'scheduled', scheduled_at: 5000, assignee_id: 'u-second' },
    ])
    expect(await db.all(sql`select id, content_item_id from content_asset`)).toEqual([
      { id: 'a1', content_item_id: 'i1' },
    ])
    // The rebuilt tables keep their constraints.
    await expect(
      db.run(sql`insert into content_item (id, organization_id, title, channel, format, status, created_by_id)
        values ('i2', ${SIGNUM_ID}, 'Bad', 'x', 'post', 'scheduled', 'u-first')`),
    ).rejects.toThrow()
    await db.run(sql`delete from content_item where id = 'i1'`)
    expect(await db.all(sql`select id from content_asset`)).toEqual([])
  })
})
