import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, resetDatabase } from '../../test/db'
import { closeDb } from '../db/client.server'
import { user } from '../db/schema'
import { createContentItemSchema } from './content'
import type { CreateContentItemInput } from './content'
import {
  ContentRuleError,
  changeContentItemStatus,
  createContentItem,
  deleteContentItem,
  getContentItem,
  listContentItems,
  listTeamMembers,
  rescheduleContentItem,
  updateContentItem,
} from './content.server'

// Runs against TEST_DATABASE_URL (local Docker Postgres).
const db = createTestDb()
const alice = { id: 'user-alice', name: 'Alice', email: 'alice@example.com' }
const bob = { id: 'user-bob', name: 'Bob', email: 'bob@example.com' }
const missingId = '00000000-0000-4000-8000-000000000000'

function create(input: CreateContentItemInput, now?: Date) {
  return createContentItem(
    db,
    alice.id,
    createContentItemSchema.parse(input),
    now,
  )
}

beforeEach(async () => {
  await resetDatabase(db)
  await db.insert(user).values([bob, alice])
})

afterAll(async () => {
  await closeDb(db)
})

describe('createContentItem', () => {
  it('stores the item with defaults and the creator', async () => {
    const item = await create({ title: 'Teaser', channel: 'x', format: 'thread' })
    expect(item).toMatchObject({
      title: 'Teaser',
      body: '',
      channel: 'x',
      format: 'thread',
      status: 'idea',
      scheduledAt: null,
      notes: '',
      assetLinks: [],
      assigneeId: null,
      createdById: alice.id,
    })
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(item.createdAt).toBeInstanceOf(Date)
    expect(await getContentItem(db, item.id)).toEqual(item)
  })

  it('stores scheduledAt as the same UTC instant', async () => {
    const item = await create({
      title: 'Launch',
      channel: 'linkedin',
      format: 'post',
      status: 'scheduled',
      scheduledAt: '2026-05-01T09:00:00+02:00',
    })
    expect(item.scheduledAt?.toISOString()).toBe('2026-05-01T07:00:00.000Z')
  })

  it('sets publishedAt to now when publishing without one', async () => {
    const now = new Date('2026-05-02T10:00:00Z')
    const item = await create(
      { title: 'Live', channel: 'blog', format: 'article', status: 'published' },
      now,
    )
    expect(item.publishedAt).toEqual(now)
  })

  it('rejects an unknown assignee', async () => {
    await expect(
      create({ title: 'T', channel: 'x', format: 'post', assigneeId: 'ghost' }),
    ).rejects.toBeInstanceOf(ContentRuleError)
  })
})

describe('listContentItems', () => {
  beforeEach(async () => {
    await create({
      title: 'March X',
      channel: 'x',
      format: 'post',
      status: 'scheduled',
      scheduledAt: '2026-03-10T09:00:00Z',
      assigneeId: bob.id,
    })
    await create({
      title: 'April LinkedIn',
      channel: 'linkedin',
      format: 'carousel',
      status: 'draft',
      scheduledAt: '2026-04-01T00:00:00Z',
    })
    await create({ title: 'Unscheduled idea', channel: 'blog', format: 'article' })
  })

  it('returns everything ordered by scheduledAt, unscheduled last', async () => {
    const titles = (await listContentItems(db)).map((item) => item.title)
    expect(titles).toEqual(['March X', 'April LinkedIn', 'Unscheduled idea'])
  })

  it('filters by a half-open scheduledAt range', async () => {
    const items = await listContentItems(db, {
      scheduledFrom: new Date('2026-03-01T00:00:00Z'),
      scheduledTo: new Date('2026-04-01T00:00:00Z'),
    })
    expect(items.map((item) => item.title)).toEqual(['March X'])
  })

  it('filters by channels, statuses and assignee', async () => {
    expect(
      (await listContentItems(db, { channels: ['linkedin', 'blog'] })).map(
        (item) => item.title,
      ),
    ).toEqual(['April LinkedIn', 'Unscheduled idea'])
    expect(
      (await listContentItems(db, { statuses: ['scheduled'] })).map(
        (item) => item.title,
      ),
    ).toEqual(['March X'])
    expect(
      (await listContentItems(db, { assigneeId: bob.id })).map(
        (item) => item.title,
      ),
    ).toEqual(['March X'])
  })
})

describe('updateContentItem', () => {
  it('changes only the supplied fields', async () => {
    const item = await create({
      title: 'Old',
      channel: 'x',
      format: 'post',
      notes: 'keep me',
    })
    const updated = await updateContentItem(db, {
      id: item.id,
      title: 'New',
      assetLinks: ['https://example.com/a.png'],
      assigneeId: bob.id,
    })
    expect(updated).toMatchObject({
      title: 'New',
      notes: 'keep me',
      assetLinks: ['https://example.com/a.png'],
      assigneeId: bob.id,
    })
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      item.updatedAt.getTime(),
    )
  })

  it('checks the rules against the merged item', async () => {
    const item = await create({ title: 'T', channel: 'x', format: 'post' })
    await expect(
      updateContentItem(db, { id: item.id, status: 'scheduled' }),
    ).rejects.toThrow('A scheduled item needs a scheduled date and time.')

    const ok = await updateContentItem(db, {
      id: item.id,
      status: 'scheduled',
      scheduledAt: new Date('2026-06-01T08:00:00Z'),
    })
    expect(ok?.status).toBe('scheduled')
  })

  it('returns null for a missing item', async () => {
    expect(await updateContentItem(db, { id: missingId, title: 'X' })).toBeNull()
  })
})

describe('rescheduleContentItem', () => {
  it('sets and clears scheduledAt without touching other fields', async () => {
    const item = await create({ title: 'T', channel: 'x', format: 'post' })
    const date = new Date('2026-07-01T15:30:00Z')
    const moved = await rescheduleContentItem(db, item.id, date)
    expect(moved).toMatchObject({ scheduledAt: date, status: 'idea', title: 'T' })
    const cleared = await rescheduleContentItem(db, item.id, null)
    expect(cleared?.scheduledAt).toBeNull()
  })

  it('refuses to clear the date of a scheduled item', async () => {
    const item = await create({
      title: 'T',
      channel: 'x',
      format: 'post',
      status: 'scheduled',
      scheduledAt: '2026-07-01T15:30:00Z',
    })
    await expect(
      rescheduleContentItem(db, item.id, null),
    ).rejects.toBeInstanceOf(ContentRuleError)
  })

  it('returns null for a missing item', async () => {
    expect(await rescheduleContentItem(db, missingId, null)).toBeNull()
  })
})

describe('changeContentItemStatus', () => {
  it('fills publishedAt when publishing', async () => {
    const item = await create({ title: 'T', channel: 'x', format: 'post' })
    const now = new Date('2026-08-01T12:00:00Z')
    const published = await changeContentItemStatus(db, item.id, 'published', now)
    expect(published).toMatchObject({ status: 'published', publishedAt: now })
  })

  it('requires a date before scheduling', async () => {
    const item = await create({ title: 'T', channel: 'x', format: 'post' })
    await expect(
      changeContentItemStatus(db, item.id, 'scheduled'),
    ).rejects.toBeInstanceOf(ContentRuleError)
    await rescheduleContentItem(db, item.id, new Date('2026-08-02T09:00:00Z'))
    expect((await changeContentItemStatus(db, item.id, 'scheduled'))?.status).toBe(
      'scheduled',
    )
  })
})

describe('deleteContentItem', () => {
  it('deletes once and reports missing items', async () => {
    const item = await create({ title: 'T', channel: 'x', format: 'post' })
    expect(await deleteContentItem(db, item.id)).toBe(true)
    expect(await getContentItem(db, item.id)).toBeNull()
    expect(await deleteContentItem(db, item.id)).toBe(false)
  })
})

describe('listTeamMembers', () => {
  it('returns id, name and email ordered by name', async () => {
    expect(await listTeamMembers(db)).toEqual([alice, bob])
  })
})
