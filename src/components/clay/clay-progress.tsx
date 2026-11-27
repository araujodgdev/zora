import * as React from 'react'
import { cn } from 'cn'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_PROGRESS_SIZES = ['sm', 'md', 'lg'] as const
export type ClayProgressSize = (typeof CLAY_PROGRESS_SIZES)[number]

export type ClayProgressProps = Omit<React.ComponentProps<'div'>, 'color'> & {
  /** How far along, from 0 to `max`. `null` (or left out) for "working, no idea how long". */
  value?: number | null
  max?: number
  /** The clay of the snake that fills the groove. Lime by default. */
  color?: ClayColor
  size?: ClayProgressSize
}

/**
 * A progress bar in clay: a groove pressed into a slab, filled by a snake of
 * clay that grows with `value`; without one, a short snake rolls back and
 * forth. `role="progressbar"` with the ARIA values; name it with
 * `aria-label` or `aria-labelledby`. Styles in `src/styles/clay.css`
 * (`.clay-progress`).
 */
export function ClayProgress({
  value = null,
  max = 100,
  color = 'lime',
  size = 'md',
  className,
  style,
  ...props
}: ClayProgressProps) {
  const seed = useClaySeed()
  const indeterminate = value === null
  const ratio = indeterminate ? 0 : Math.min(Math.max(value / max, 0), 1)

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.min(Math.max(value, 0), max)}
      data-slot="clay-progress"
      data-size={size}
      data-value={indeterminate ? undefined : ratio === 0 ? '0' : String(Math.round(ratio * 100))}
      data-indeterminate={indeterminate ? '' : undefined}
      className={cn('clay-progress', 'clay-cream', className)}
      style={{ ...seed, '--clay-value': ratio, ...style } as React.CSSProperties}
      {...props}
    >
      <div className="clay-progress-groove">
        <div className={cn('clay-progress-fill', `clay-${color}`)} />
      </div>
    </div>
  )
}
