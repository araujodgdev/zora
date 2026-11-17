import { useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import catYarnAlpha from '@/assets/brand/cat-yarn-alpha.mp4'
import catYarnStill from '@/assets/brand/cat-yarn-still.webp'
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
 * A looping clip with transparency, drawn straight on the page background.
 * `src` is a "stacked alpha" MP4: the colour on the top half, the matte
 * (white = opaque) on the bottom half. H.264 has no alpha channel and
 * Safari does not decode VP9 alpha, so each frame is combined in a canvas;
 * this works in every browser and keeps the file small (an animated WebP of
 * the same clip is ten times larger). `still` (a WebP with alpha) shows
 * until the first frame is drawn, and stays under reduced motion or when
 * autoplay is blocked.
 */
export function AlphaLoop({
  src,
  still,
  width,
  height,
  className,
}: {
  src: string
  still: string
  /** Size of one half of the stacked video, in pixels. */
  width: number
  height: number
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const output = canvas.getContext('2d')
    const scratch = document.createElement('canvas')
    scratch.width = width
    scratch.height = height * 2
    const source = scratch.getContext('2d', { willReadFrequently: true })
    if (!output || !source) return

    const frame = output.createImageData(width, height)
    const alphaOffset = width * height * 4
    let stopped = false
    let pending = 0
    let shown = false

    const draw = () => {
      if (stopped) return
      if (video.readyState >= 2) {
        source.drawImage(video, 0, 0, width, height * 2)
        const pixels = source.getImageData(0, 0, width, height * 2).data
        const out = frame.data
        out.set(pixels.subarray(0, alphaOffset))
        for (let i = 3; i < alphaOffset; i += 4) {
          // The matte's red channel; video compression leaves faint noise
          // in its black, which would show as a haze around the cat.
          const alpha = pixels[alphaOffset + i - 3] ?? 0
          out[i] = alpha < 10 ? 0 : alpha
        }
        output.putImageData(frame, 0, 0)
        if (!shown) {
          shown = true
          setDrawing(true)
        }
      }
      schedule()
    }
    const schedule = () => {
      pending =
        'requestVideoFrameCallback' in video
          ? video.requestVideoFrameCallback(draw)
          : requestAnimationFrame(draw)
    }

    // Rejected when the browser blocks autoplay: the still stays.
    video
      .play()
      .then(schedule)
      .catch(() => {})
    return () => {
      stopped = true
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(pending)
      cancelAnimationFrame(pending)
      video.pause()
    }
  }, [width, height])

  return (
    <div aria-hidden="true" className={cn('relative', className)} style={{ aspectRatio: `${width} / ${height}` }}>
      <img
        src={still}
        alt=""
        width={width}
        height={height}
        draggable={false}
        className={cn('absolute inset-0 size-full select-none', drawing && 'invisible')}
      />
      <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0 size-full" />
      {/* Decoded only to be drawn on the canvas, never shown. */}
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        className="pointer-events-none absolute size-px opacity-0"
      />
    </div>
  )
}

/**
 * The router's pending page: the clay cat playing with yarn, right on the
 * page background. It eases in, so a short wait never flashes it.
 */
export function CatLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center gap-3', className)}
    >
      <AlphaLoop
        src={catYarnAlpha}
        still={catYarnStill}
        width={320}
        height={242}
        className="animate-in fade-in zoom-in-95 fill-mode-backwards w-40 delay-150 duration-500 ease-out motion-reduce:animate-none"
      />
      <span className="text-muted-foreground animate-in fade-in fill-mode-backwards text-sm delay-300 duration-500 motion-reduce:animate-none">
        Carregando…
      </span>
    </div>
  )
}
