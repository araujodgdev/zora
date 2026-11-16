import { describe, expect, it } from 'vitest'
import {
  CHANNELS,
  CHANNEL_LABELS,
  FORMATS,
  FORMAT_LABELS,
  SCHEDULED_REQUIRES_DATE_MESSAGE,
  STATUSES,
  STATUS_LABELS,
  changeContentItemStatusSchema,
  contentListFiltersSchema,
  createContentItemSchema,
  normalizeScheduleState,
  rescheduleContentItemSchema,
  scheduleStateError,
  updateContentItemSchema,
} from './content'

const id = '0b7c8a52-4c2f-4a8e-9a51-2a0c7f3e9d10'

describe('enumerations', () => {
  it('have a label for every value', () => {
    expect(Object.keys(CHANNEL_LABELS)).toEqual([...CHANNELS])
    expect(Object.keys(FORMAT_LABELS)).toEqual([...FORMATS])
    expect(Object.keys(STATUS_LABELS)).toEqual([...STATUSES])
  })
})

describe('createContentItemSchema', () => {
  it('applies defaults to a minimal item', () => {
    const parsed = createContentItemSchema.parse({
      title: '  Launch teaser  ',
      channel: 'x',
      format: 'thread',
    })
    expect(parsed).toEqual({
      title: 'Launch teaser',
      body: '',
      channel: 'x',
      format: 'thread',
      status: 'idea',
      scheduledAt: null,
      publishedAt: null,
      publishedUrl: null,
      notes: '',
      assetLinks: [],
      assigneeId: null,
    })
  })

  it('requires a non-blank title', () => {
    const result = createContentItemSchema.safeParse({
      title: '   ',
      channel: 'x',
      format: 'post',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown channels, formats and statuses', () => {
    for (const patch of [
      { channel: 'tiktok' },
      { format: 'video' },
      { status: 'archived' },
    ]) {
      const result = createContentItemSchema.safeParse({
        title: 'T',
        channel: 'x',
        format: 'post',
        ...patch,
      })
      expect(result.success).toBe(false)
    }
  })

  it('requires scheduledAt when status is scheduled', () => {
    const result = createContentItemSchema.safeParse({
      title: 'T',
      channel: 'blog',
      format: 'article',
      status: 'scheduled',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      SCHEDULED_REQUIRES_DATE_MESSAGE,
    )
    expect(result.error?.issues[0]?.path).toEqual(['scheduledAt'])
  })

  it('accepts Date objects and ISO strings with an offset as instants', () => {
    const fromString = createContentItemSchema.parse({
      title: 'T',
      channel: 'blog',
      format: 'article',
      status: 'scheduled',
      scheduledAt: '2026-02-01T09:30:00+02:00',
    })
    expect(fromString.scheduledAt?.toISOString()).toBe(
      '2026-02-01T07:30:00.000Z',
    )

    const date = new Date('2026-02-01T07:30:00Z')
    const fromDate = createContentItemSchema.parse({
      title: 'T',
      channel: 'blog',
      format: 'article',
      scheduledAt: date,
    })
    expect(fromDate.scheduledAt?.getTime()).toBe(date.getTime())
  })

  it('rejects date strings without an offset', () => {
    const result = createContentItemSchema.safeParse({
      title: 'T',
      channel: 'blog',
      format: 'article',
      scheduledAt: '2026-02-01T09:30',
    })
    expect(result.success).toBe(false)
  })

  it('only accepts http and https URLs', () => {
    const base = { title: 'T', channel: 'x', format: 'post' } as const
    expect(
      createContentItemSchema.safeParse({
        ...base,
        publishedUrl: 'https://x.com/zora/status/1',
        assetLinks: ['http://example.com/a.png', 'https://example.com/b'],
      }).success,
    ).toBe(true)

    for (const bad of ['ftp://example.com/x', 'javascript:alert(1)', 'not a url']) {
      expect(
        createContentItemSchema.safeParse({ ...base, publishedUrl: bad }).success,
      ).toBe(false)
      expect(
        createContentItemSchema.safeParse({ ...base, assetLinks: [bad] }).success,
      ).toBe(false)
    }
  })

  it('treats an empty publishedUrl as no URL', () => {
    const parsed = createContentItemSchema.parse({
      title: 'T',
      channel: 'x',
      format: 'post',
      publishedUrl: '',
    })
    expect(parsed.publishedUrl).toBeNull()
  })
})

describe('updateContentItemSchema', () => {
  it('accepts a partial patch and leaves other fields undefined', () => {
    const parsed = updateContentItemSchema.parse({ id, title: 'New' })
    expect(parsed).toEqual({ id, title: 'New' })
  })

  it('requires a uuid id', () => {
    expect(updateContentItemSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('validates URLs in a patch', () => {
    expect(
      updateContentItemSchema.safeParse({ id, assetLinks: ['mailto:a@b.c'] })
        .success,
    ).toBe(false)
  })
})

describe('reschedule and status schemas', () => {
  it('accepts setting and clearing scheduledAt', () => {
    expect(
      rescheduleContentItemSchema.parse({ id, scheduledAt: null }).scheduledAt,
    ).toBeNull()
    expect(
      rescheduleContentItemSchema.parse({
        id,
        scheduledAt: '2026-03-01T10:00:00Z',
      }).scheduledAt,
    ).toBeInstanceOf(Date)
  })

  it('only accepts known statuses', () => {
    expect(
      changeContentItemStatusSchema.safeParse({ id, status: 'ready' }).success,
    ).toBe(true)
    expect(
      changeContentItemStatusSchema.safeParse({ id, status: 'done' }).success,
    ).toBe(false)
  })
})

describe('contentListFiltersSchema', () => {
  it('accepts an empty filter', () => {
    expect(contentListFiltersSchema.parse({})).toEqual({})
  })

  it('rejects an empty or reversed date range', () => {
    expect(
      contentListFiltersSchema.safeParse({
        scheduledFrom: '2026-03-02T00:00:00Z',
        scheduledTo: '2026-03-01T00:00:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('scheduling rules', () => {
  const now = new Date('2026-04-01T12:00:00Z')

  it('fills publishedAt with now when publishing without one', () => {
    const item = normalizeScheduleState(
      { status: 'published', scheduledAt: null, publishedAt: null },
      now,
    )
    expect(item.publishedAt).toEqual(now)
    expect(scheduleStateError(item)).toBeNull()
  })

  it('keeps a supplied publishedAt', () => {
    const publishedAt = new Date('2026-03-31T08:00:00Z')
    const item = normalizeScheduleState(
      { status: 'published', scheduledAt: null, publishedAt },
      now,
    )
    expect(item.publishedAt).toBe(publishedAt)
  })

  it('reports a scheduled item without a date', () => {
    expect(
      scheduleStateError({
        status: 'scheduled',
        scheduledAt: null,
        publishedAt: null,
      }),
    ).toBe(SCHEDULED_REQUIRES_DATE_MESSAGE)
  })

  it('accepts other statuses without dates', () => {
    for (const status of ['idea', 'draft', 'ready'] as const) {
      expect(
        scheduleStateError({ status, scheduledAt: null, publishedAt: null }),
      ).toBeNull()
    }
  })
})
