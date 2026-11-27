import * as React from 'react'
import { cn } from 'cn'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_CHECKBOX_SIZES = ['sm', 'md', 'lg'] as const
export type ClayCheckboxSize = (typeof CLAY_CHECKBOX_SIZES)[number]

export type ClayCheckboxProps = Omit<React.ComponentProps<'input'>, 'size' | 'type' | 'color'> & {
  /** The clay of the tick. Lime, the action colour, by default. */
  color?: ClayColor
  size?: ClayCheckboxSize
  /** Shows a dash instead of the tick (some, not all, of a group). */
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const TICK = 'M4.8 12.6 C6.6 14.2 8.3 16 9.9 17.8 C12.6 13.6 15.8 9.6 19.6 6'
const DASH = 'M6 12.3 C10 11.7 14 12.5 18 11.9'

/**
 * A checkbox in clay: a little cup, and a rolled snake of clay that lays
 * itself into a tick. A real `<input type="checkbox">` (invisible, on top),
 * so `checked`/`defaultChecked`, `name`, forms, labels and the keyboard work
 * as usual; every prop not listed goes to it. Styles in
 * `src/styles/clay.css` (`.clay-check`).
 */
export function ClayCheckbox({
  color = 'lime',
  size = 'md',
  indeterminate = false,
  onCheckedChange,
  onChange,
  className,
  ref,
  ...props
}: ClayCheckboxProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const seed = useClaySeed()

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span data-slot="clay-checkbox" data-size={size} className={cn('clay-check', 'clay-cream', className)} style={seed}>
      <span className="clay-check-cup" />
      <input
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="checkbox"
        className="clay-check-input"
        aria-checked={indeterminate ? 'mixed' : undefined}
        onChange={(event) => {
          onChange?.(event)
          onCheckedChange?.(event.target.checked)
        }}
        {...props}
      />
      <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('clay-check-mark', `clay-${color}`)}>
        {[
          ['clay-check-tick', TICK],
          ['clay-check-dash', DASH],
        ].map(([group, d]) => (
          <g key={group} className={group}>
            <path className="clay-check-body" d={d} pathLength={1} />
          </g>
        ))}
      </svg>
    </span>
  )
}
