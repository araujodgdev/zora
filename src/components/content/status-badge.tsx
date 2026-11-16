import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS } from '@/lib/content'
import type { ContentStatus } from '@/lib/content'
import { cn } from '@/lib/utils'

// The one place that decides how each status looks. Statuses are outlined
// with a coloured dot so they never read as a (filled) channel badge.
const STATUS_CLASS_NAMES: Record<ContentStatus, { badge: string; dot: string }> =
  {
    idea: {
      badge: 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
      dot: 'bg-zinc-400',
    },
    draft: {
      badge:
        'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300',
      dot: 'bg-amber-500',
    },
    ready: {
      badge:
        'border-violet-300 text-violet-800 dark:border-violet-800 dark:text-violet-300',
      dot: 'bg-violet-500',
    },
    scheduled: {
      badge: 'border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-300',
      dot: 'bg-sky-500',
    },
    published: {
      badge:
        'border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300',
      dot: 'bg-emerald-500',
    },
  }

type StatusBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  status: ContentStatus
}

/** A pipeline status, in its colour, with its label from `@/lib/content`. */
export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const classNames = STATUS_CLASS_NAMES[status]
  return (
    <Badge
      variant="outline"
      data-status={status}
      className={cn(classNames.badge, className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', classNames.dot)}
      />
      {STATUS_LABELS[status]}
    </Badge>
  )
}
