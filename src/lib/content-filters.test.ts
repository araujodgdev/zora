import { describe, expect, it } from 'vitest'
import {
  contentFilterSearchSchema,
  hasContentFilters,
  toContentListFilters,
} from './content-filters'

describe('contentFilterSearchSchema', () => {
  it('accepts valid filters', () => {
    expect(
      contentFilterSearchSchema.parse({
        channels: ['x', 'blog'],
        statuses: ['draft'],
        assigneeId: 'user-1',
      }),
    ).toEqual({
      channels: ['x', 'blog'],
      statuses: ['draft'],
      assigneeId: 'user-1',
    })
  })

  it('yields no filters for an empty search', () => {
    expect(contentFilterSearchSchema.parse({})).toEqual({})
  })

  it('drops unknown values but keeps the valid ones', () => {
    const parsed = contentFilterSearchSchema.parse({
      channels: ['nonsense', 'linkedin', 7],
      statuses: ['published', 'archived'],
    })
    expect(parsed.channels).toEqual(['linkedin'])
    expect(parsed.statuses).toEqual(['published'])
  })

  it('drops malformed params instead of throwing', () => {
    const parsed = contentFilterSearchSchema.parse({
      channels: 'nonsense',
      statuses: { a: 1 },
      assigneeId: 42,
    })
    expect(parsed.channels).toBeUndefined()
    expect(parsed.statuses).toBeUndefined()
    expect(parsed.assigneeId).toBeUndefined()
  })

  it('drops lists with no valid value and blank assignees', () => {
    const parsed = contentFilterSearchSchema.parse({
      channels: ['nope'],
      statuses: [],
      assigneeId: '   ',
    })
    expect(parsed.channels).toBeUndefined()
    expect(parsed.statuses).toBeUndefined()
    expect(parsed.assigneeId).toBeUndefined()
  })

  it('removes duplicates and normalizes the order', () => {
    const parsed = contentFilterSearchSchema.parse({
      channels: ['blog', 'x', 'blog'],
      statuses: ['published', 'idea'],
    })
    expect(parsed.channels).toEqual(['x', 'blog'])
    expect(parsed.statuses).toEqual(['idea', 'published'])
  })

  it('ignores unrelated search params', () => {
    expect(contentFilterSearchSchema.parse({ view: 'month' })).toEqual({})
  })
})

describe('toContentListFilters', () => {
  it('returns an empty object when nothing is set', () => {
    expect(toContentListFilters({})).toEqual({})
    expect(
      toContentListFilters({
        channels: undefined,
        statuses: [],
        assigneeId: undefined,
      }),
    ).toEqual({})
  })

  it('passes set filters through', () => {
    expect(
      toContentListFilters({
        channels: ['instagram'],
        statuses: ['idea', 'draft'],
        assigneeId: 'user-1',
      }),
    ).toEqual({
      channels: ['instagram'],
      statuses: ['idea', 'draft'],
      assigneeId: 'user-1',
    })
  })

  it('has no undefined keys, so equal filters share a query key', () => {
    const filters = toContentListFilters({ channels: ['x'] })
    expect(Object.keys(filters)).toEqual(['channels'])
  })
})

describe('hasContentFilters', () => {
  it('reports whether any filter is set', () => {
    expect(hasContentFilters({})).toBe(false)
    expect(hasContentFilters({ statuses: [] })).toBe(false)
    expect(hasContentFilters({ assigneeId: 'user-1' })).toBe(true)
  })
})
