import { useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'
import catYarnMp4 from '@/assets/brand/cat-yarn.mp4'
import catYarnWebm from '@/assets/brand/cat-yarn.webm'
import catYarnPoster from '@/assets/brand/cat-yarn.webp'
import markUrl from '@/assets/brand/zora-mark.webp'
import { cn } from '@/lib/utils'

/*
 * Zora's brand: a lime clay Z with the cream clay cat asleep on it, in the
 * claymation style of clay.com. The artwork and the loops are generated
 * (see `scripts/brand/README.md`) and live in `src/assets/brand`.
 */

/** The clay Z with the cat, sized by the font size (1.5em tall). */
export function ZoraMark({ className }: { className?: string }) {
  return (
    <img
      src={markUrl}
      alt=""
      width={179}
      height={256}
      draggable={false}
      className={cn('zora-mark h-[1.5em] w-auto select-none', className)}
    />
  )
}

/**
 * The logo: the clay mark and the lowercase wordmark in heavy Figtree. Size
 * it with a font size. Hovering it (or the link around it) squishes the clay.
 */
export function ZoraLogo({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'zora-logo inline-flex items-center gap-[0.22em] font-sans leading-none font-extrabold tracking-[-0.05em]',
        className,
      )}
      {...props}
    >
      <ZoraMark />
      <span>zora</span>
    </span>
  )
}

/** The lowercase "zora" in heavy Figtree, without the mark. */
export function ZoraWordmark({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('font-sans leading-none font-extrabold tracking-[-0.05em]', className)}
      {...props}
    >
      zora
    </span>
  )
}

/**
 * A muted, looping claymation clip. The server renders its poster (the first
 * frame). After hydration the clip loads and plays only while it is on screen
 * (a hidden or scrolled-away loop costs nothing) and never under reduced
 * motion, where the poster stays.
 */
export function ClayLoop({
  webm,
  mp4,
  poster,
  className,
}: {
  webm: string
  mp4: string
  poster: string
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false
    const sync = () => {
      if (visible && !reduce.matches) {
        // Rejected when the browser blocks autoplay: the poster stays.
        video.play().catch(() => {})
      } else {
        video.pause()
      }
    }
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      sync()
    })
    observer.observe(video)
    reduce.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      reduce.removeEventListener('change', sync)
    }
  }, [])

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
      aria-hidden="true"
      disablePictureInPicture
      className={cn('pointer-events-none object-cover', className)}
    >
      {/* VP9 when the browser decodes it (smaller), else H.264. */}
      <source src={webm} type='video/webm; codecs="vp9"' />
      <source src={mp4} type="video/mp4" />
    </video>
  )
}

/**
 * The router's pending page: the clay cat playing with yarn on a cream clay
 * tile. It eases in, so a short wait never flashes it.
 */
export function CatLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center gap-4', className)}
    >
      <div className="animate-in fade-in zoom-in-90 fill-mode-backwards size-32 overflow-hidden rounded-[2.25rem] bg-[#e2d5c0] delay-150 duration-500 ease-out motion-reduce:animate-none">
        <ClayLoop
          webm={catYarnWebm}
          mp4={catYarnMp4}
          poster={catYarnPoster}
          className="size-full"
        />
      </div>
      <span className="text-muted-foreground animate-in fade-in fill-mode-backwards text-sm delay-300 duration-500 motion-reduce:animate-none">
        Carregando…
      </span>
    </div>
  )
}
