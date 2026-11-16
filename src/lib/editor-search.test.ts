import { describe, expect, it } from 'vitest'
import {
  editItemSearchSchema,
  editorReturnPath,
  newItemSearchSchema,
} from './editor-search'

describe('editItemSearchSchema', () => {
  it('accepts a known origin', () => {
    expect(editItemSearchSchema.parse({ from: 'pipeline' })).toEqual({
      from: 'pipeline',
    })
  })

  it('drops an unknown origin', () => {
    expect(editItemSearchSchema.parse({ from: 'elsewhere' }).from).toBeUndefined()
    expect(editItemSearchSchema.parse({}).from).toBeUndefined()
  })
})

describe('newItemSearchSchema', () => {
  it('accepts valid presets', () => {
    const search = {
      from: 'calendar',
      scheduledAt: '2026-03-01T09:00:00Z',
      status: 'scheduled',
      channel: 'linkedin',
    }
    expect(newItemSearchSchema.parse(search)).toEqual(search)
  })

  it('accepts an instant with a numeric offset', () => {
    expect(
      newItemSearchSchema.parse({ scheduledAt: '2026-03-01T09:00:00+02:00' })
        .scheduledAt,
    ).toBe('2026-03-01T09:00:00+02:00')
  })

  it('drops malformed values one by one', () => {
    const parsed = newItemSearchSchema.parse({
      from: 'calendar',
      scheduledAt: '2026-03-01T09:00', // no offset: ambiguous
      status: 'archived',
      channel: 12,
    })
    expect(parsed.from).toBe('calendar')
    expect(parsed.scheduledAt).toBeUndefined()
    expect(parsed.status).toBeUndefined()
    expect(parsed.channel).toBeUndefined()
  })
})

describe('editorReturnPath', () => {
  it('maps origins to their pages and defaults to the content list', () => {
    expect(editorReturnPath('calendar')).toBe('/calendar')
    expect(editorReturnPath('pipeline')).toBe('/pipeline')
    expect(editorReturnPath('content')).toBe('/content')
    expect(editorReturnPath(undefined)).toBe('/content')
  })
})
