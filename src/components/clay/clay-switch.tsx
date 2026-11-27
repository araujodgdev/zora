import * as React from 'react'
import { cn } from 'cn'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_SWITCH_SIZES = ['sm', 'md', 'lg'] as const
export type ClaySwitchSize = (typeof CLAY_SWITCH_SIZES)[number]

export type ClaySwitchProps = Omit<React.ComponentProps<'button'>, 'onChange' | 'color'> & {
  /** Controlled state. Leave it out (and use `defaultChecked`) for uncontrolled. */
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  /** The clay that fills the groove when on. Lime, the action colour, by default. */
  color?: ClayColor
  size?: ClaySwitchSize
}

/**
 * An on/off switch in clay: a ball that rolls along a groove, which fills
 * with lime (or `color`) when on. A `<button role="switch">`, so Space and
 * Enter toggle it; name it with `aria-label`, or wrap it in a `<label>` with
 * the text. Styles in `src/styles/clay.css` (`.clay-switch`).
 */
export function ClaySwitch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  color = 'lime',
  size = 'md',
  className,
  style,
  onClick,
  ...props
}: ClaySwitchProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked)
  const [touched, setTouched] = React.useState(false)
  const on = checked ?? uncontrolled
  const seed = useClaySeed()

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-slot="clay-switch"
      data-size={size}
      data-touched={touched ? '' : undefined}
      className={cn('clay-switch', 'clay-cream', className)}
      style={{ ...seed, ...style }}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setTouched(true)
        if (checked === undefined) setUncontrolled(!on)
        onCheckedChange?.(!on)
      }}
      {...props}
    >
      <span className={cn('clay-switch-groove', on ? `clay-${color}` : 'clay-cream')}>
        <span className="clay-switch-knob clay-cream" />
      </span>
    </button>
  )
}
