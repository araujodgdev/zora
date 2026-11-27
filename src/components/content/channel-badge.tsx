import type { CSSProperties, ComponentProps } from 'react'
import { ClayBadge } from '@/components/clay/clay-badge'
import { ChannelIcon } from '@/components/content/channel-icon'
import { Badge } from '@/components/ui/badge'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import type { SocialChannel } from '@/lib/social'
import { useUiMode } from '@/lib/ui-mode'
import { cn } from '@/lib/utils'

// The one place that decides how each channel looks: a solid fill in the
// channel's hue (tokens in app.css) with ink text, like a swatch.
const CHANNEL_CLASS_NAMES: Record<Channel, string> = {
  x: 'bg-channel-x text-channel-x-foreground',
  linkedin: 'bg-channel-linkedin text-ink',
  instagram: 'bg-channel-instagram text-ink',
  tiktok: 'bg-channel-tiktok text-ink',
  youtube: 'bg-channel-youtube text-ink',
  blog: 'bg-channel-blog text-ink',
}

// Saturated brand swatches with white icons for social connection tiles.
const CHANNEL_TILE_CLASS_NAMES: Record<SocialChannel, string> = {
  x: 'bg-channel-tile-x text-channel-tile-foreground dark:ring-1 dark:ring-foreground/15',
  linkedin: 'bg-channel-tile-linkedin text-channel-tile-foreground',
  instagram: 'bg-channel-tile-instagram text-channel-tile-foreground',
  tiktok: 'bg-channel-tile-tiktok text-channel-tile-foreground',
  youtube: 'bg-channel-tile-youtube text-channel-tile-foreground',
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
  const uiMode = useUiMode()

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

  // Fun mode: a pill of clay in the channel's hue (the same token).
  if (uiMode === 'fun') {
    return (
      <ClayBadge
        {...props}
        size="sm"
        color='cream'
        data-channel={channel}
        className={className}
        // The channel token for the clay; X flips between ink and bone with the
        // theme, so its lettering takes the paired foreground token.
        style={
          {
            '--clay': `var(--channel-${channel})`,
            ...(channel === 'x' && {
              '--clay-ink': 'var(--channel-x-foreground)',
              '--clay-ink-shadow': 'transparent',
            }),
            ...props.style,
          } as CSSProperties
        }
      >
        {label}
      </ClayBadge>
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

/**
 * A square icon tile in the social channel's token colour with its real brand
 * mark. Kept here so channel colours stay defined in one place only.
 */
export function ChannelIconTile({
  channel,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { channel: SocialChannel }) {
  return (
    <span
      data-channel={channel}
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
        CHANNEL_TILE_CLASS_NAMES[channel],
        className,
      )}
      {...props}
    >
      <ChannelIcon channel={channel} className="size-[1.125rem]" />
    </span>
  )
}
