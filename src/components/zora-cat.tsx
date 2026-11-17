import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/*
 * Zora's cat: a lime silhouette drawn to sit with the Fraunces italic
 * wordmark (forward lean, soft ear tips, a tail that ends in a ball terminal).
 * The motion lives in `src/styles/app.css` (`.zora-cat-*`) and stops under
 * `prefers-reduced-motion`. `scripts/app-icon.html` draws the lounging pose
 * for the app icon; keep the two in step when the drawing changes.
 */

const limb = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
} as const

/** Walking to the right; feet on y = 44 of a 80 x 48 box. */
function WalkingCat(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 80 48" fill="currentColor" aria-hidden="true" {...props}>
      <g className="zora-cat-tail">
        <path {...limb} strokeWidth={2.4} d="M20.5 25C13 24 13 16 17 12C20 9 17 5 13 6" />
        <circle cx="13" cy="6" r="2.2" />
      </g>
      <g {...limb} strokeWidth={2.6}>
        <path className="zora-cat-leg-a" d="M23 27C25.5 32 24 35.5 22.5 38.5C21.6 40.5 22 42.5 23 44" />
        <path className="zora-cat-leg-b" d="M27.5 28C29.5 33 28.5 36 27.6 39C27 41 27.4 42.8 28.6 44" />
        <path className="zora-cat-leg-b" d="M51 26C52.4 32 51.6 38 50.4 44" />
        <path className="zora-cat-leg-a" d="M55 24.5C57 30 57.2 37 56.4 44" />
      </g>
      <path d="M20 25C24 19 34 18.5 42 20C47 21 51 19.5 54 17.5C57 16 59 19 58.5 22.5C58 27 54 29.5 49 29.5C42 29.5 37 28 31 29C26 30 21 30 19.5 28C18.8 27 19 26 20 25Z" />
      <path d="M55.5 18.5C55 14 57.5 10.5 60 9.6L60.2 5Q60.5 4 61.3 4.6L63.8 8.4C64.8 8.3 65.8 8.5 66.6 8.9L69.4 5.4Q70.2 4.7 70.3 5.7L69.6 10.4C71.2 11.6 72 13 71.8 14.6C71.6 16.4 69.6 17.6 67 18.4C64 19.4 61 20.2 58.5 20.5Z" />
    </svg>
  )
}

/**
 * Lying on a ledge (y = 36.6 of a 80 x 40 box), head on its paws, one paw
 * and the tail hanging over the edge.
 */
function LoungingCat(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 80 40" fill="currentColor" aria-hidden="true" {...props}>
      <g className="zora-cat-hanging-tail">
        <path {...limb} strokeWidth={2.4} d="M13.5 34C8 34.5 6 37.5 6.5 41.5C7 45 9.5 46 10 48.5" />
        <circle cx="10" cy="48.6" r="2.2" />
      </g>
      <path
        className="zora-cat-body"
        d="M12 36.6C10 29.5 15 24.5 24 24C34 23.5 44 24.5 52 27C56 28.5 58 31.5 58.5 36.6Z"
      />
      <g className="zora-cat-front">
        <path d="M54 36.6C58 34.6 66 34.8 72 35.3C74.5 35.5 74.8 36.4 73.6 36.6Z" />
        <path d="M65.5 35C67 36.5 67.2 40 66.8 43.5C66.6 45 68.4 45.4 69.2 44.4C69.9 42 69.6 38.5 68.6 35.5Z" />
        <path
          className="zora-cat-head"
          d="M56 33C55 28 57 24.5 60 23.5L60.3 19Q60.6 18 61.4 18.6L64 22.5C65 22.3 66 22.5 66.8 22.9L69.6 19.4Q70.4 18.7 70.5 19.7L69.8 24.4C71.4 25.8 72.5 28 72.2 30C71.8 32.6 69 34.4 65 34.6C61 34.8 57.5 34.6 56 33Z"
        />
      </g>
    </svg>
  )
}

/** Crouched, batting a ball of yarn while a scrap of paper drifts by. */
function PlayingCat(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 96 48" fill="currentColor" aria-hidden="true" {...props}>
      <g className="zora-cat-play-tail">
        <path {...limb} strokeWidth={2.4} d="M27 29C20 26 19 18 23 14C26 11 24 7 20.5 7.5" />
        <circle cx="20.5" cy="7.5" r="2.2" />
      </g>
      <path d="M28 34C26.5 38 27.5 42 31 43.6L37.5 43.6C37.5 42 35.5 41.2 33.5 41C32.5 38.5 32.5 36 32.5 34Z" />
      <g {...limb} strokeWidth={2.6}>
        <path d="M57 35C60 39 63 42 67 43.6" />
        <path className="zora-cat-bat" d="M60 33C64 32 68 29.5 71 26.5" />
      </g>
      <path
        className="zora-cat-rump"
        d="M26 30C28 22 38 20 46 23C52 25 56 28 60 31C62 33 61 36 58 36.5C50 37 40 36 32 36.5C28 37 25 34 26 30Z"
      />
      <path d="M58 33C57.5 28.5 59.5 25.5 62.5 24.6L63.6 20.2Q64 19.2 64.7 20L66.6 24.2C67.6 24.2 68.6 24.5 69.4 25L72.8 22Q73.7 21.4 73.6 22.4L72.3 26.8C73.6 28.4 74.4 30.4 74 32C73.4 34.2 70.6 35.4 67 35.6C63.4 35.8 59.6 35.4 58 33Z" />
      <g className="zora-cat-yarn" {...limb} stroke="var(--coral)" strokeWidth={1.3}>
        <path d="M79.2 39.8C76 41 74 43.6 70 43.6C66 43.6 64 43 61 43.6" />
        <g className="zora-cat-yarn-ball">
          <circle cx="84" cy="38.6" r="5" />
          <path d="M79.6 36.4C82 37.6 85.6 37 88.4 34.8M79.4 40C82.6 41.2 86.4 40.6 88.8 38.4M81.2 43C84 43.4 86.8 42.6 88.4 41.6M82 34C81 37 81.5 40.5 83.4 43.6" />
        </g>
      </g>
      <path
        className="zora-cat-paper"
        fill="var(--secondary)"
        d="M84 12L90.5 10.6L91.6 16.4L88 17.2L86.6 15.8L85 17.6Z"
      />
    </svg>
  )
}

/**
 * The "Zora" wordmark (Fraunces italic) with the cat on it: `walk` paces
 * across the top of the letters (sign-in and sign-up), `lounge` lies on the
 * Z's top bar and now and then stretches (the app shell). Size it with a
 * font size; the cat is drawn in `em`, smaller than a letter.
 */
export function ZoraWordmark({
  cat,
  className,
  ...props
}: { cat: 'walk' | 'lounge' } & ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'font-display wonk relative inline-block leading-[0.85] font-semibold tracking-[-0.03em] italic',
        className,
      )}
      {...props}
    >
      Zora
      {cat === 'walk' ? (
        <span aria-hidden="true" className="zora-cat-walker text-brand">
          <WalkingCat className="zora-cat-walker-figure" />
        </span>
      ) : (
        <LoungingCat aria-hidden="true" className="zora-cat-lounger text-brand" />
      )}
    </span>
  )
}

/** The pending screen of slow navigations: the cat at play. */
export function CatLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center gap-3 py-16', className)}
    >
      <PlayingCat className="zora-cat-player text-brand w-28" />
      <span className="text-muted-foreground text-sm">Carregando…</span>
    </div>
  )
}
