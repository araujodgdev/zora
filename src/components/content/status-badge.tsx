import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS } from '@/lib/content'
import type { ContentStatus } from '@/lib/content'
import { cn } from '@/lib/utils'

// The one place that decides how each status looks. Statuses are outlined
// with a dot in the status hue (tokens in app.css), so they never read as a
// (filled) channel badge.
const STATUS_DOT_CLASS_NAMES: Record<ContentStatus, string> = {
  idea: 'bg-status-idea',
  draft: 'bg-status-draft',
  ready: 'bg-status-ready',
  scheduled: 'bg-status-scheduled',
  published: 'bg-status-published',
}

type StatusBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  status: ContentStatus
}

/** A pipeline status, in its colour, with its label from `@/lib/content`. */
export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      data-status={status}
      className={cn('border-foreground/15 text-foreground/90 rounded-md', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', STATUS_DOT_CLASS_NAMES[status])}
      />
      {STATUS_LABELS[status]}
    </Badge>
  )
}
