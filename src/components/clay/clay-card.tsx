import * as React from 'react'
import { cn } from 'cn'
import { Slot } from 'radix-ui'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export type ClayCardProps = React.ComponentProps<'div'> & {
  /** The colour of the slab. Cream by default. */
  color?: ClayColor
  /**
   * Lifts on hover and sinks when pressed. Use it with `asChild` around a
   * `<Link>`, `<a>` or `<button>`, so the whole card is one control.
   */
  interactive?: boolean
  asChild?: boolean
}

/**
 * A card: a thick slab of clay. Compose it with `ClayCardMedia` (a window
 * pressed into the clay for a picture), `ClayCardTitle`, `ClayCardText` and
 * `ClayCardFooter`. Styles in `src/styles/clay.css` (`.clay-card`).
 */
export function ClayCard({
  color = 'cream',
  interactive = false,
  asChild = false,
  className,
  style,
  ...props
}: ClayCardProps) {
  const Comp = asChild ? Slot.Root : 'div'
  const seed = useClaySeed()
  return (
    <Comp
      data-slot="clay-card"
      data-interactive={interactive ? '' : undefined}
      className={cn('clay-card', `clay-${color}`, className)}
      style={{ ...seed, ...style }}
      {...props}
    />
  )
}

/** A window pressed into the card for an image or video; size it with a class (`aspect-video`). */
export function ClayCardMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="clay-card-media" className={cn('clay-card-media', className)} {...props} />
}

/** The title, in raised clay lettering. An `<h3>` unless `asChild` wraps another heading. */
export function ClayCardTitle({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'h3'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'h3'
  return <Comp data-slot="clay-card-title" className={cn('clay-card-title', className)} {...props} />
}

export function ClayCardText({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="clay-card-text" className={cn('clay-card-text', className)} {...props} />
}

/** Actions or details at the bottom; pushed down so cards in a row line up. */
export function ClayCardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="clay-card-footer" className={cn('clay-card-footer', className)} {...props} />
}
