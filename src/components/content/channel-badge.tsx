import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import { cn } from '@/lib/utils'

// The one place that decides how each channel looks.
const CHANNEL_CLASS_NAMES: Record<Channel, string> = {
  x: 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900',
  linkedin: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  instagram: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
  blog: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
}

type ChannelBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  channel: Channel
  /**
   * A small square with a two-letter abbreviation, for tight spaces such as
   * a calendar day cell. The full label stays available on hover and to
   * screen readers.
   */
  compact?: boolean
}

/** A channel, in its colour, with its label from `@/lib/content`. */
export function ChannelBadge({
  channel,
  compact = false,
  className,
  ...props
}: ChannelBadgeProps) {
  const label = CHANNEL_LABELS[channel]

  if (compact) {
    return (
      <span
        data-channel={channel}
        title={label}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[0.5625rem] leading-none font-semibold',
          CHANNEL_CLASS_NAMES[channel],
          className,
        )}
        {...props}
      >
        <span aria-hidden="true">{label.slice(0, 2)}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  return (
    <Badge
      data-channel={channel}
      className={cn(CHANNEL_CLASS_NAMES[channel], className)}
      {...props}
    >
      {label}
    </Badge>
  )
}
