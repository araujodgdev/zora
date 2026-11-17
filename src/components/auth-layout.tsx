import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The tiles around the auth pages: flat swatches in the channel hues, each
 * with one shape in another colour from the palette. Placed off the edges
 * like pinned artwork; hidden on small screens.
 */
const TILES: Array<{
  className: string
  shape: string
  delay: number
}> = [
  {
    // Top right, cut by the top edge.
    className: 'bg-channel-blog -top-10 right-[12%] h-56 w-44',
    shape: 'bg-violet absolute bottom-6 left-6 size-24 rotate-12 rounded-[28%]',
    delay: 0,
  },
  {
    // Left, cut by the left edge.
    className: 'bg-channel-linkedin top-[22%] -left-12 h-80 w-56',
    shape: 'bg-ink absolute top-10 right-8 size-28 rounded-full',
    delay: 120,
  },
  {
    // Bottom left, cut by the bottom edge.
    className: 'bg-coral -bottom-16 left-[22%] h-64 w-52',
    shape:
      'bg-channel-instagram absolute top-8 left-1/2 h-24 w-40 -translate-x-1/2 rounded-t-full',
    delay: 240,
  },
  {
    // Right, cut by the right edge.
    className: 'bg-channel-instagram top-[55%] -right-10 h-72 w-52',
    shape:
      'bg-lime absolute bottom-10 left-8 h-28 w-28 rounded-br-full rounded-tl-full',
    delay: 360,
  },
]

/**
 * The page around sign-in, sign-up and consent: the Zora wordmark set large
 * on the black canvas, the form below it, coloured tiles at the edges. The
 * tiles settle in once on load (skipped with reduced motion).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden="true" className="absolute inset-0 -z-10 hidden md:block">
        {TILES.map((tile) => (
          <div
            key={tile.className}
            style={{ animationDelay: `${tile.delay}ms` } as CSSProperties}
            className={cn(
              'animate-in fade-in slide-in-from-bottom-6 fill-mode-backwards absolute overflow-hidden duration-700 ease-out motion-reduce:animate-none',
              tile.className,
            )}
          >
            <div className={tile.shape} />
          </div>
        ))}
      </div>
      <p
        aria-hidden="true"
        className="font-display wonk mb-8 text-[clamp(4.5rem,14vw,9rem)] leading-[0.85] font-semibold tracking-[-0.03em] italic"
      >
        Zora
      </p>
      {children}
    </main>
  )
}
