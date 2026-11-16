import { describe, expect, it } from 'vitest'
import {
  calendarSearchSchema,
  defaultTimeOnDay,
  formatDay,
  getCalendarRange,
  groupItemsByDay,
  moveToDay,
  parseDay,
  resolveCalendarSearch,
  shiftAnchor,
} from './calendar'
import type { ContentItem } from './content'

// Local-time constructors throughout: the helpers work in the runtime's zone.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

function item(id: string, scheduledAt: Date | null): ContentItem {
  return {
    id,
    title: id,
    body: '',
    channel: 'x',
    format: 'post',
    status: 'idea',
    scheduledAt,
    publishedAt: null,
    publishedUrl: null,
    notes: '',
    assetLinks: [],
    assigneeId: null,
    createdById: 'u',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

describe('parseDay / formatDay', () => {
  it('round-trips a canonical day', () => {
    expect(formatDay(parseDay('2026-11-23')!)).toBe('2026-11-23')
  })

  it.each(['2026-1-5', '2026-02-30', 'nonsense', '', '2026-11-23T10:00'])(
    'rejects %j',
    (value) => {
      expect(parseDay(value)).toBeUndefined()
    },
  )
})

describe('calendarSearchSchema', () => {
  it('keeps valid values', () => {
    expect(
      calendarSearchSchema.parse({ view: 'week', date: '2026-11-23' }),
    ).toEqual({ view: 'week', date: '2026-11-23' })
  })

  it('drops malformed values', () => {
    expect(calendarSearchSchema.parse({ view: 'year', date: '23/11' })).toEqual(
      {},
    )
  })
})

describe('resolveCalendarSearch', () => {
  it('defaults to the month of today', () => {
    const today = day(2026, 11, 16)
    expect(resolveCalendarSearch({}, today)).toEqual({
      view: 'month',
      anchor: today,
    })
  })

  it('uses the requested view and day', () => {
    const { view, anchor } = resolveCalendarSearch(
      { view: 'week', date: '2026-11-23' },
      day(2026, 1, 1),
    )
    expect(view).toBe('week')
    expect(formatDay(anchor)).toBe('2026-11-23')
  })
})

describe('getCalendarRange', () => {
  it('shows whole weeks (Monday first) for a month', () => {
    const range = getCalendarRange('month', day(2026, 11, 16))
    // 1 Nov 2026 is a Sunday; 30 Nov is a Monday.
    expect(formatDay(range.start)).toBe('2026-10-26')
    expect(formatDay(range.end)).toBe('2026-12-07')
    expect(range.days).toHaveLength(42)
    expect(range.days.length % 7).toBe(0)
  })

  it('shows the Monday-to-Sunday week of the anchor', () => {
    const range = getCalendarRange('week', day(2026, 11, 25))
    expect(formatDay(range.start)).toBe('2026-11-23')
    expect(formatDay(range.end)).toBe('2026-11-30')
    expect(range.days.map(formatDay)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ])
  })

  it('keeps the range half-open: the last day is before `end`', () => {
    const range = getCalendarRange('week', day(2026, 11, 25))
    const last = range.days[range.days.length - 1]!
    expect(last.getTime()).toBeLessThan(range.end.getTime())
  })
})

describe('shiftAnchor', () => {
  it('moves by a month or a week', () => {
    expect(formatDay(shiftAnchor('month', day(2026, 11, 16), 1))).toBe(
      '2026-12-16',
    )
    expect(formatDay(shiftAnchor('week', day(2026, 11, 16), -1))).toBe(
      '2026-11-09',
    )
  })

  it('does not overflow short months', () => {
    expect(formatDay(shiftAnchor('month', day(2026, 1, 31), 1))).toBe(
      '2026-02-28',
    )
  })
})

describe('groupItemsByDay', () => {
  it('groups by local day, orders by time and skips unscheduled items', () => {
    const grouped = groupItemsByDay([
      item('late', new Date(2026, 10, 23, 18, 0)),
      item('other-day', new Date(2026, 10, 24, 9, 0)),
      item('early', new Date(2026, 10, 23, 8, 30)),
      item('none', null),
    ])
    expect(grouped.get('2026-11-23')!.map((i) => i.id)).toEqual([
      'early',
      'late',
    ])
    expect(grouped.get('2026-11-24')!.map((i) => i.id)).toEqual(['other-day'])
    expect(grouped.size).toBe(2)
  })
})

describe('moveToDay', () => {
  it('keeps the local time of day', () => {
    const moved = moveToDay(
      new Date(2026, 10, 23, 14, 45, 10),
      day(2026, 12, 2),
    )
    expect(moved).toEqual(new Date(2026, 11, 2, 14, 45, 10))
  })
})

describe('defaultTimeOnDay', () => {
  it('is 09:00 local', () => {
    expect(defaultTimeOnDay(day(2026, 11, 23))).toEqual(
      new Date(2026, 10, 23, 9, 0),
    )
  })
})

