import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { assetFileUrl, assetKind, formatBytes } from '@/lib/content-assets'
import type { ContentAsset } from '@/lib/content-assets'
import { cn } from '@/lib/utils'

/**
 * Full-screen viewer for an item's images and videos: the file itself on a
 * dark backdrop, with controls floating over it (name, position, download,
 * open in a new tab, delete, close, previous/next). ←/→ move between files,
 * Esc closes, a click on the backdrop closes.
 *
 * Always dark, whatever the theme: photos read best on black.
 */
export function MediaLightbox({
  assets,
  index,
  onIndexChange,
  onClose,
  onDelete,
}: {
  /** The viewable files (images and videos), in display order. */
  assets: ReadonlyArray<ContentAsset>
  /** The file shown, or `null` when closed. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  onDelete: (asset: ContentAsset) => void
}) {
  const asset = index === null ? null : (assets[index] ?? null)
  const count = assets.length
  const hasMany = count > 1

  function go(step: number) {
    if (index === null || !hasMany) return
    onIndexChange((index + step + count) % count)
  }

  // Arrow keys move between files while the viewer is open.
  useEffect(() => {
    if (!asset || !hasMany) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <DialogPrimitive.Root open={asset !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 bg-black/92 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] fixed inset-0 z-50 flex items-center justify-center text-white outline-none"
          // A click outside the media (on the backdrop area) closes.
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          {asset ? (
            <>
              <DialogPrimitive.Title className="sr-only">{asset.filename}</DialogPrimitive.Title>
              <Media asset={asset} />

              {/* Top: name and position on the left, actions on the right. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-linear-to-b from-black/70 to-transparent p-3 pb-10 sm:p-4 sm:pb-12">
                <div className="min-w-0 px-1 pt-1.5 text-sm">
                  <p className="truncate font-medium">{asset.filename}</p>
                  <p className="text-xs text-white/60 tabular-nums">
                    {formatBytes(asset.size)}
                    {hasMany ? ` · ${(index ?? 0) + 1} de ${count}` : ''}
                  </p>
                </div>
                <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur-md">
                  <ControlLink href={assetFileUrl(asset.id)} download={asset.filename} label="Baixar">
                    <Download />
                  </ControlLink>
                  <ControlLink href={assetFileUrl(asset.id)} target="_blank" label="Abrir em nova aba">
                    <ExternalLink />
                  </ControlLink>
                  <ControlButton label="Excluir" onClick={() => onDelete(asset)}>
                    <Trash2 />
                  </ControlButton>
                  <DialogPrimitive.Close asChild>
                    <ControlButton label="Fechar (Esc)">
                      <X />
                    </ControlButton>
                  </DialogPrimitive.Close>
                </div>
              </div>

              {hasMany ? (
                <>
                  <ControlButton
                    label="Anterior (←)"
                    onClick={() => go(-1)}
                    className="absolute top-1/2 left-2 -translate-y-1/2 bg-white/10 backdrop-blur-md sm:left-4 sm:size-12"
                  >
                    <ChevronLeft />
                  </ControlButton>
                  <ControlButton
                    label="Próximo (→)"
                    onClick={() => go(1)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 bg-white/10 backdrop-blur-md sm:right-4 sm:size-12"
                  >
                    <ChevronRight />
                  </ControlButton>
                </>
              ) : null}
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Media({ asset }: { asset: ContentAsset }) {
  const url = assetFileUrl(asset.id)
  const className =
    'max-h-[calc(100svh-7rem)] max-w-[calc(100vw-2rem)] object-contain shadow-2xl shadow-black/60 sm:max-w-[calc(100vw-9rem)]'
  return assetKind(asset.contentType) === 'video' ? (
    <video key={asset.id} src={url} controls autoPlay playsInline className={cn(className, 'bg-black')} />
  ) : (
    <img key={asset.id} src={url} alt={asset.filename} className={className} />
  )
}

const controlClassName =
  'flex size-10 items-center justify-center rounded-full text-white/85 transition-colors outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 [&_svg]:size-[1.15rem]'

function ControlButton({
  label,
  className,
  children,
  ...props
}: {
  label: string
  className?: string
  children: ReactNode
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(controlClassName, className)}
      {...props}
    >
      {children}
    </button>
  )
}

function ControlLink({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<ComponentProps<'a'>, 'children'>) {
  return (
    <a aria-label={label} title={label} rel="noreferrer" className={controlClassName} {...props}>
      {children}
    </a>
  )
}
