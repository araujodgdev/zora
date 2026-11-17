import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import { cn } from '@/lib/utils'

// The one place that decides how each channel looks: a solid fill in the
// channel's hue (tokens in app.css) with ink text, like a swatch.
const CHANNEL_CLASS_NAMES: Record<Channel, string> = {
  x: 'bg-channel-x text-ink',
  linkedin: 'bg-channel-linkedin text-ink',
  instagram: 'bg-channel-instagram text-ink',
  blog: 'bg-channel-blog text-ink',
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
          'inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] text-[0.5625rem] leading-none font-bold',
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
      className={cn('rounded-md font-semibold', CHANNEL_CLASS_NAMES[channel], className)}
      {...props}
    >
      {label}
    </Badge>
  )
}
