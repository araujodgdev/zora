import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ContentItem } from './content'
import {
  applyContentItemPatch,
  contentKeys,
  patchContentItem,
  rollbackContentItemPatch,
} from './content-cache'

const now = new Date('2026-03-10T12:00:00Z')

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'item-1',
    title: 'Launch post',
    body: '',
    channel: 'linkedin',
    format: 'post',
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    publishedUrl: null,
    notes: '',
    assetLinks: [],
    assigneeId: null,
    createdById: 'user-1',
    createdAt: new Date('2026-03-01T08:00:00Z'),
    updatedAt: new Date('2026-03-01T08:00:00Z'),
    ...overrides,
  }
}

/** A cache holding two lists (one filtered) and the detail of `item-1`. */
function seedCache() {
  const queryClient = new QueryClient()
  const first = makeItem()
  const second = makeItem({ id: 'item-2', title: 'Teaser', channel: 'x' })
  const allKey = contentKeys.list({})
  const filteredKey = contentKeys.list({ channels: ['linkedin'] })
  queryClient.setQueryData(allKey, [first, second])
  queryClient.setQueryData(filteredKey, [first])
  queryClient.setQueryData(contentKeys.detail(first.id), first)
  return { queryClient, first, second, allKey, filteredKey }
}

describe('patchContentItem', () => {
  it('applies the patch without mutating the item', () => {
    const item = makeItem()
    const scheduledAt = new Date('2026-03-12T09:00:00Z')
    const patched = patchContentItem(item, { scheduledAt }, now)
    expect(patched.scheduledAt).toEqual(scheduledAt)
    expect(item.scheduledAt).toBeNull()
  })

  it('gives a newly published item a publishedAt', () => {
    const patched = patchContentItem(makeItem(), { status: 'published' }, now)
    expect(patched.status).toBe('published')
    expect(patched.publishedAt).toEqual(now)
  })

  it('keeps an existing publishedAt', () => {
    const publishedAt = new Date('2026-03-05T10:00:00Z')
    const patched = patchContentItem(
      makeItem({ publishedAt }),
      { status: 'published' },
      now,
    )
    expect(patched.publishedAt).toEqual(publishedAt)
  })
})

describe('applyContentItemPatch', () => {
  it('updates the item in every cached list and in its detail entry', () => {
    const { queryClient, first, second, allKey, filteredKey } = seedCache()

    applyContentItemPatch(queryClient, first.id, { status: 'ready' }, now)

    const all = queryClient.getQueryData<Array<ContentItem>>(allKey)
    expect(all?.map((item) => item.status)).toEqual(['ready', 'draft'])
    expect(all?.[1]).toBe(second)
    expect(
      queryClient.getQueryData<Array<ContentItem>>(filteredKey)?.[0]?.status,
    ).toBe('ready')
    expect(
      queryClient.getQueryData<ContentItem>(contentKeys.detail(first.id))
        ?.status,
    ).toBe('ready')
  })

  it('shows a publishedAt at once when the status becomes published', () => {
    const { queryClient, first, allKey } = seedCache()

    applyContentItemPatch(queryClient, first.id, { status: 'published' }, now)

    const item = queryClient.getQueryData<Array<ContentItem>>(allKey)?.[0]
    expect(item?.publishedAt).toEqual(now)
    expect(
      queryClient.getQueryData<ContentItem>(contentKeys.detail(first.id))
        ?.publishedAt,
    ).toEqual(now)
  })

  it('sets and clears scheduledAt', () => {
    const { queryClient, first, allKey } = seedCache()
    const scheduledAt = new Date('2026-03-12T09:00:00Z')

    applyContentItemPatch(queryClient, first.id, { scheduledAt }, now)
    expect(
      queryClient.getQueryData<Array<ContentItem>>(allKey)?.[0]?.scheduledAt,
    ).toEqual(scheduledAt)

    applyContentItemPatch(queryClient, first.id, { scheduledAt: null }, now)
    expect(
      queryClient.getQueryData<Array<ContentItem>>(allKey)?.[0]?.scheduledAt,
    ).toBeNull()
  })

  it('does not create cache entries that were not there', () => {
    const { queryClient, second } = seedCache()

    applyContentItemPatch(queryClient, second.id, { status: 'ready' }, now)

    expect(
      queryClient.getQueryData(contentKeys.detail(second.id)),
    ).toBeUndefined()
    expect(queryClient.getQueryData(contentKeys.list({ channels: ['x'] }))).toBe(
      undefined,
    )
  })
})

describe('rollbackContentItemPatch', () => {
  it('restores every list and the detail entry', () => {
    const { queryClient, first, second, allKey, filteredKey } = seedCache()

    const snapshot = applyContentItemPatch(
      queryClient,
      first.id,
      { status: 'published' },
      now,
    )
    rollbackContentItemPatch(queryClient, snapshot)

    expect(queryClient.getQueryData(allKey)).toEqual([first, second])
    expect(queryClient.getQueryData(filteredKey)).toEqual([first])
    expect(queryClient.getQueryData(contentKeys.detail(first.id))).toEqual(
      first,
    )
  })

  it('leaves a missing detail entry missing', () => {
    const { queryClient, second, allKey } = seedCache()

    const snapshot = applyContentItemPatch(
      queryClient,
      second.id,
      { scheduledAt: new Date('2026-03-12T09:00:00Z') },
      now,
    )
    rollbackContentItemPatch(queryClient, snapshot)

    expect(
      queryClient.getQueryData<Array<ContentItem>>(allKey)?.[1]?.scheduledAt,
    ).toBeNull()
    expect(
      queryClient.getQueryData(contentKeys.detail(second.id)),
    ).toBeUndefined()
  })
})
