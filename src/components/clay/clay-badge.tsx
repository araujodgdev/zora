import * as React from 'react'
import { cn } from 'cn'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_BADGE_SIZES = ['sm', 'md', 'lg'] as const
export type ClayBadgeSize = (typeof CLAY_BADGE_SIZES)[number]

export type ClayBadgeProps = React.ComponentProps<'span'> & {
  /** The colour of the pill. Cream by default. */
  color?: ClayColor
  size?: ClayBadgeSize
  /** A tiny ball of clay in front of the text, in this colour (a status light). */
  dot?: ClayColor
  /** The dot in any CSS colour instead (a token such as `var(--status-draft)`). */
  dotClay?: string
}

/**
 * A badge: a small, flat pill of clay with raised lettering, for labels,
 * counts and statuses. Put an icon first in `children` or use `dot`. Styles
 * in `src/styles/clay.css` (`.clay-badge`).
 */
export function ClayBadge({
  color = 'cream',
  size = 'md',
  dot,
  dotClay,
  className,
  style,
  children,
  ...props
}: ClayBadgeProps) {
  const seed = useClaySeed()
  return (
    <span
      data-slot="clay-badge"
      data-size={size}
      className={cn('clay-badge', `clay-${color}`, className)}
      style={{ ...seed, ...style }}
      {...props}
    >
      {(dot ?? dotClay) && (
        <span
          className={cn('clay-badge-dot', `clay-${dot ?? 'cream'}`)}
          style={dotClay ? ({ '--clay': dotClay } as React.CSSProperties) : undefined}
          aria-hidden="true"
        />
      )}
      <span className="clay-lettering">{children}</span>
    </span>
  )
}
