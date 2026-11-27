import * as React from 'react'
import { cn } from 'cn'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_INPUT_SIZES = ['sm', 'md', 'lg'] as const
export type ClayInputSize = (typeof CLAY_INPUT_SIZES)[number]

export type ClayInputProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  /** The colour of the slab. Cream by default; the rim turns lime on focus. */
  color?: ClayColor
  size?: ClayInputSize
  /** An icon before the text, inside the groove (decorative). */
  icon?: React.ReactNode
  /** Something after the text, inside the groove: a hint, a small button. */
  trailing?: React.ReactNode
  /** Classes for the slab (the outer element); `className` goes to it too. */
  fieldClassName?: string
}

/**
 * A text field pressed into a slab of clay: the text sits in a groove, the
 * rim turns lime on focus and coral when `aria-invalid` is true. Styles in
 * `src/styles/clay.css` (`.clay-field`). Every prop not listed above goes to
 * the `<input>` (including `ref`, `id`, `aria-*`), so pair it with a
 * `<label htmlFor>` as usual.
 */
export function ClayInput({
  color = 'cream',
  size = 'md',
  icon,
  trailing,
  className,
  fieldClassName,
  type = 'text',
  ...props
}: ClayInputProps) {
  const seed = useClaySeed()
  return (
    <div
      data-slot="clay-input"
      data-size={size}
      className={cn('clay-field', `clay-${color}`, fieldClassName, className)}
      style={seed}
    >
      <div className={cn('clay-field-groove', `clay-${color}`)}>
        {icon}
        <input type={type} className="clay-field-input" {...props} />
        {trailing}
      </div>
    </div>
  )
}
