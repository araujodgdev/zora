import { useHydrated } from '@tanstack/react-router'
import { formatLocalDateTime, formatLocalTime } from '@/lib/dates'

/**
 * Renders an instant in the browser's local time zone. The server does not
 * know that zone, so the text appears after hydration. `format="time"` shows
 * the time of day only.
 */
export function LocalDateTime({
  value,
  fallback = '—',
  format = 'dateTime',
}: {
  value: Date | null
  fallback?: string
  format?: 'dateTime' | 'time'
}) {
  const hydrated = useHydrated()
  if (!value) return <span className="text-muted-foreground">{fallback}</span>
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning>
      {hydrated
        ? format === 'time'
          ? formatLocalTime(value)
          : formatLocalDateTime(value)
        : ''}
    </time>
  )
}
