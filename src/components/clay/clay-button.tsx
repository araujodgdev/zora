import * as React from 'react'
import { cn } from 'cn'
import { Slot } from 'radix-ui'

export const CLAY_COLORS = ['lime', 'cream', 'sky', 'pink', 'butter', 'coral', 'violet', 'charcoal'] as const
export type ClayColor = (typeof CLAY_COLORS)[number]

export const CLAY_BUTTON_SIZES = ['sm', 'md', 'lg', 'icon'] as const
export type ClayButtonSize = (typeof CLAY_BUTTON_SIZES)[number]

export type ClayButtonProps = React.ComponentProps<'button'> & {
  /** The colour of the clay. Lime is the action colour, as in the app. */
  color?: ClayColor
  size?: ClayButtonSize
  /** Render the child element (a `<Link>`, an `<a>`) with the clay look. */
  asChild?: boolean
}

/**
 * A button made of plasticine: rounded, lumpy, with a glossy spot and a
 * grainy surface. It squishes on hover and sinks into the table when
 * pressed. Styles in `src/styles/clay.css` (`.clay-btn`); sizes are in `em`,
 * so `size` only sets the font size. An icon-only button (`size="icon"`)
 * needs an `aria-label`.
 */
export function ClayButton({
  className,
  color = 'lime',
  size = 'md',
  asChild = false,
  type,
  style,
  children,
  ...props
}: ClayButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  const seed = useClaySeed()
  return (
    <Comp
      data-slot="clay-button"
      data-size={size}
      className={cn('clay-btn', `clay-${color}`, className)}
      type={asChild ? undefined : (type ?? 'button')}
      style={{ ...seed, ...style }}
      {...props}
    >
      {asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
        ? React.cloneElement(children, undefined, <ClayLettering>{children.props.children}</ClayLettering>)
        : <ClayLettering>{children}</ClayLettering>}
    </Comp>
  )
}

/** The text and icons of a piece, raised in clay (`clay-relief`, see clay.css). */
function ClayLettering({ children }: { children: React.ReactNode }) {
  return <span className="clay-lettering">{children}</span>
}

/**
 * Where this piece's relief starts, so no two pieces on a page have the same
 * lumps. Derived from `useId`, which is stable between server and browser.
 */
export function useClaySeed(): React.CSSProperties {
  const id = React.useId()
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  const x = (hash >>> 0) % 320
  const y = (hash >>> 9) % 320
  return { '--clay-seed-x': `${x}px`, '--clay-seed-y': `${y}px` } as React.CSSProperties
}
