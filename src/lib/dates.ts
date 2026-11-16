/**
 * Date helpers. Dates are stored and transported as UTC instants (`Date`) and
 * shown in the browser's local time zone. Formatting with the local zone must
 * only happen on the client (see `<LocalDateTime>`), or SSR and hydration will
 * disagree.
 */

// English formatting to match the UI; the time zone is the browser's own.
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** e.g. "Jan 31, 2026, 9:00 AM" in the runtime's local time zone. */
export function formatLocalDateTime(value: Date): string {
  return dateTimeFormat.format(value)
}

const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })

/** e.g. "9:00 AM" in the runtime's local time zone. */
export function formatLocalTime(value: Date): string {
  return timeFormat.format(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Value for `<input type="datetime-local">` in the local time zone. */
export function toDateTimeLocalValue(value: Date | null): string {
  if (!value) return ''
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  )
}

/** Parses `<input type="datetime-local">` (local time); `null` when empty or invalid. */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
