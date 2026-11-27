import * as React from 'react'
import { cn } from 'cn'
import { Tabs } from 'radix-ui'
import { useClaySeed } from './clay-button'
import type { ClayColor } from './clay-button'

export const CLAY_TABS_SIZES = ['sm', 'md', 'lg'] as const
export type ClayTabsSize = (typeof CLAY_TABS_SIZES)[number]

/** Lettering on the pill for the clays dark enough to need light ink. */
const LIGHT_INK: Partial<Record<ClayColor, [ink: string, shadow: string]>> = {
  violet: ['#ffffff', 'rgb(0 0 0 / 0.28)'],
  charcoal: ['#efe9de', 'rgb(0 0 0 / 0.5)'],
}

/**
 * Tabs in clay, on Radix Tabs (keyboard, roles and focus handling come from
 * it). Compose them like Radix's:
 *
 *   <ClayTabs defaultValue="ideas">
 *     <ClayTabsList aria-label="Etapas">
 *       <ClayTabsTrigger value="ideas">Ideias</ClayTabsTrigger>
 *       ...
 *     </ClayTabsList>
 *     <ClayTabsContent value="ideas">...</ClayTabsContent>
 *   </ClayTabs>
 *
 * Styles in `src/styles/clay.css` (`.clay-tabs-*`).
 */
export function ClayTabs(props: React.ComponentProps<typeof Tabs.Root>) {
  return <Tabs.Root data-slot="clay-tabs" {...props} />
}

type PillBox = { left: number; top: number; width: number; height: number }

export function ClayTabsList({
  color = 'lime',
  size = 'md',
  className,
  style,
  children,
  ...props
}: React.ComponentProps<typeof Tabs.List> & {
  /** The clay of the pill under the active tab. */
  color?: ClayColor
  size?: ClayTabsSize
}) {
  const seed = useClaySeed()
  const listRef = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<PillBox | null>(null)
  const [flip, setFlip] = React.useState<'a' | 'b' | undefined>(undefined)

  // Follow the active tab: on a change of tab and on any resize.
  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    let last: PillBox | null = null
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (!active) return
      const next = {
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
      }
      if (last && last.left !== next.left) setFlip((f) => (f === 'a' ? 'b' : 'a'))
      last = next
      setBox(next)
    }
    measure()
    const mutations = new MutationObserver(measure)
    mutations.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
    const resizes = new ResizeObserver(measure)
    resizes.observe(list)
    return () => {
      mutations.disconnect()
      resizes.disconnect()
    }
  }, [])

  const lightInk = LIGHT_INK[color]
  const vars = {
    ...seed,
    ...(box && {
      '--pill-left': `${box.left}px`,
      '--pill-top': `${box.top}px`,
      '--pill-width': `${box.width}px`,
      '--pill-height': `${box.height}px`,
    }),
    ...(lightInk && {
      '--clay-tabs-active-ink': lightInk[0],
      '--clay-tabs-active-ink-shadow': lightInk[1],
    }),
  } as React.CSSProperties

  return (
    <Tabs.List
      ref={listRef}
      data-slot="clay-tabs-list"
      data-size={size}
      className={cn('clay-tabs-list', 'clay-cream', className)}
      style={{ ...vars, ...style }}
      {...props}
    >
      <span className="clay-tabs-tray" aria-hidden="true" />
      <span
        className={cn('clay-tabs-pill', `clay-${color}`)}
        data-hidden={box ? undefined : ''}
        data-flip={flip}
        aria-hidden="true"
      />
      {children}
    </Tabs.List>
  )
}

export function ClayTabsTrigger({ className, children, ...props }: React.ComponentProps<typeof Tabs.Trigger>) {
  return (
    <Tabs.Trigger data-slot="clay-tabs-trigger" className={cn('clay-tabs-trigger', className)} {...props}>
      <span className="clay-lettering">{children}</span>
    </Tabs.Trigger>
  )
}

export function ClayTabsContent({ className, ...props }: React.ComponentProps<typeof Tabs.Content>) {
  return <Tabs.Content data-slot="clay-tabs-content" className={cn('clay-tabs-content', className)} {...props} />
}
