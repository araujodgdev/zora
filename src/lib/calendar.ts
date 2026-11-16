/**
 * Calendar maths for the `/calendar` page. Client-safe and free of React.
 *
 * Days are local calendar days, so everything here depends on the runtime's
 * time zone: call it in the browser only (the calendar route has `ssr: false`).
 * The URL carries the anchor day as `yyyy-MM-dd`, which names a local day
 * without a time zone.
 */
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { z } from 'zod'
import type { ContentItem } from './content'

export const CALENDAR_VIEWS = ['month', 'week'] as const
export type CalendarView = (typeof CALENDAR_VIEWS)[number]

/** Monday. */
export const WEEK_STARTS_ON = 1

/** Local time of day given to an item created from an empty calendar day. */
export const NEW_ITEM_HOUR = 9

const DAY_FORMAT = 'yyyy-MM-dd'

/** `yyyy-MM-dd` of a local day; the key of a day in the URL and in the grid. */
export function formatDay(day: Date): string {
  return format(day, DAY_FORMAT)
}

/** The local day named by `yyyy-MM-dd`, or `undefined` when it is not one. */
export function parseDay(value: string): Date | undefined {
  const day = parse(value, DAY_FORMAT, new Date(0))
  // `parse` accepts "2026-1-5"; only the canonical spelling is a day key.
  return isValid(day) && formatDay(day) === value ? day : undefined
}

/**
 * Search params of the calendar page (besides the content filters):
 * `view` defaults to the month and `date` to today; malformed values are
 * dropped, like the other search schemas.
 */
export const calendarSearchSchema = z.object({
  view: z.enum(CALENDAR_VIEWS).optional().catch(undefined),
  date: z
    .string()
    .refine((value) => parseDay(value) !== undefined)
    .optional()
    .catch(undefined),
})
export type CalendarSearch = z.output<typeof calendarSearchSchema>

export type CalendarRange = {
  view: CalendarView
  /** The day the view is built around (the "current" day of the period). */
  anchor: Date
  /** First day shown. */
  start: Date
  /** Day after the last one shown: with `start`, the `[from, to)` list range. */
  end: Date
  days: Array<Date>
}

/** The view and anchor day of a search; today's month when it has neither. */
export function resolveCalendarSearch(
  search: CalendarSearch,
  today: Date = new Date(),
): { view: CalendarView; anchor: Date } {
  return {
    view: search.view ?? 'month',
    anchor: (search.date && parseDay(search.date)) || today,
  }
}

/**
 * The days a view shows. A month view is whole weeks, so it includes the
 * trailing days of the previous month and the leading days of the next.
 */
export function getCalendarRange(
  view: CalendarView,
  anchor: Date,
): CalendarRange {
  const options = { weekStartsOn: WEEK_STARTS_ON } as const
  const first = view === 'month' ? startOfMonth(anchor) : anchor
  const last = view === 'month' ? endOfMonth(anchor) : anchor
  const start = startOfWeek(first, options)
  const lastDay = endOfWeek(last, options)
  return {
    view,
    anchor,
    start,
    end: addDays(lastDay, 1),
    days: eachDayOfInterval({ start, end: lastDay }),
  }
}

/** The anchor of the previous (`-1`) or next (`1`) period. */
export function shiftAnchor(
  view: CalendarView,
  anchor: Date,
  direction: -1 | 1,
): Date {
  return view === 'month'
    ? addMonths(anchor, direction)
    : addWeeks(anchor, direction)
}

/** Items by day key, each day ordered by time. Unscheduled items are skipped. */
export function groupItemsByDay(
  items: ReadonlyArray<ContentItem>,
): Map<string, Array<ContentItem>> {
  const byDay = new Map<string, Array<ContentItem>>()
  for (const item of items) {
    if (!item.scheduledAt) continue
    const key = formatDay(item.scheduledAt)
    const day = byDay.get(key)
    if (day) day.push(item)
    else byDay.set(key, [item])
  }
  for (const day of byDay.values()) {
    day.sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
  }
  return byDay
}

/** `instant` moved to `day`, keeping its local time of day. */
export function moveToDay(instant: Date, day: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    instant.getHours(),
    instant.getMinutes(),
    instant.getSeconds(),
    instant.getMilliseconds(),
  )
}

/** The start time offered for a new item on `day`. */
export function defaultTimeOnDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), NEW_ITEM_HOUR)
}
