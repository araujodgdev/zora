import { useSuspenseQuery } from '@tanstack/react-query'
import { FileText, Play, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MEDIA_ACCEPT,
  assetFileUrl,
  assetKind,
  assetUploadError,
  formatBytes,
} from '@/lib/content-assets'
import type { ContentAsset } from '@/lib/content-assets'
import {
  contentAssetsQueryOptions,
  useDeleteContentAsset,
  useUploadContentAsset,
} from '@/lib/content.queries'
import { cn } from '@/lib/utils'

/** A file being uploaded, shown until it is stored (or has failed). */
type Upload = { key: string; name: string; progress: number }

/**
 * The media of a content item: upload (button or drop) and preview in place.
 * Images and videos open in a viewer; PDFs open in a new tab.
 */
export function ContentAssets({ itemId }: { itemId: string }) {
  const { data: assets } = useSuspenseQuery(contentAssetsQueryOptions(itemId))
  const upload = useUploadContentAsset(itemId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<Array<Upload>>([])
  const [errors, setErrors] = useState<Array<string>>([])
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<ContentAsset | null>(null)
  const [deleting, setDeleting] = useState<ContentAsset | null>(null)

  async function uploadFiles(files: Array<File>) {
    const problems: Array<string> = []
    const accepted = files.filter((file) => {
      const problem = assetUploadError(file)
      if (problem) problems.push(problem)
      return !problem
    })
    setErrors(problems)
    // One at a time: simpler to follow, and each file gets the full bandwidth.
    for (const file of accepted) {
      const key = `${file.name}:${crypto.randomUUID()}`
      setUploads((current) => [...current, { key, name: file.name, progress: 0 }])
      try {
        await upload.mutateAsync({
          file,
          onProgress: (progress) =>
            setUploads((current) =>
              current.map((entry) =>
                entry.key === key ? { ...entry, progress } : entry,
              ),
            ),
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `${file.name}: the upload failed.`
        setErrors((current) => [...current, message])
      } finally {
        setUploads((current) => current.filter((entry) => entry.key !== key))
      }
    }
  }

  return (
    <section aria-labelledby="media-heading" className="grid max-w-3xl gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="media-heading" className="text-lg font-semibold tracking-tight">
            Media
          </h2>
          <p className="text-muted-foreground text-sm">
            Images, videos and PDFs for this item.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          <Upload data-icon="inline-start" />
          Upload media
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={MEDIA_ACCEPT}
          aria-label="Upload media"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void uploadFiles(files)
          }}
        />
      </div>

      {errors.length > 0 ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className={cn(
          'rounded-lg border border-dashed p-3 transition-colors',
          dragging && 'bg-accent border-ring',
        )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void uploadFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {assets.length === 0 && uploads.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No media yet. Drop files here or use Upload media.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset) => (
              <li key={asset.id}>
                <AssetTile
                  asset={asset}
                  onOpen={() => setViewing(asset)}
                  onDelete={() => setDeleting(asset)}
                />
              </li>
            ))}
            {uploads.map((entry) => (
              <li
                key={entry.key}
                className="bg-muted/40 flex aspect-video flex-col justify-end gap-2 rounded-md border p-3 text-xs"
              >
                <span className="truncate">{entry.name}</span>
                <progress
                  className="w-full"
                  value={entry.progress}
                  max={1}
                  aria-label={`Uploading ${entry.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{viewing?.filename}</DialogTitle>
            <DialogDescription>
              {viewing ? formatBytes(viewing.size) : null}
            </DialogDescription>
          </DialogHeader>
          {viewing ? <AssetViewer asset={viewing} /> : null}
        </DialogContent>
      </Dialog>

      <DeleteAssetDialog
        itemId={itemId}
        asset={deleting}
        onClose={() => setDeleting(null)}
      />
    </section>
  )
}

function AssetTile({
  asset,
  onOpen,
  onDelete,
}: {
  asset: ContentAsset
  onOpen: () => void
  onDelete: () => void
}) {
  const kind = assetKind(asset.contentType)
  const url = assetFileUrl(asset.id)
  const preview = (
    <>
      <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden">
        {kind === 'image' ? (
          <img
            src={url}
            alt={asset.filename}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : kind === 'video' ? (
          <>
            {/* #t=0.1 makes the browser paint a frame as the poster. */}
            <video
              src={`${url}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              className="size-full object-cover"
            />
            <span className="absolute flex size-9 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="size-4" />
            </span>
          </>
        ) : (
          <FileText className="text-muted-foreground size-8" />
        )}
      </div>
      <div className="p-2 pr-9 text-left">
        <p className="truncate text-xs font-medium">{asset.filename}</p>
        <p className="text-muted-foreground text-xs">{formatBytes(asset.size)}</p>
      </div>
    </>
  )
  const tileClass =
    'block w-full overflow-hidden rounded-md border text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

  return (
    <div className="bg-card relative">
      {kind === 'document' ? (
        <a href={url} target="_blank" rel="noreferrer" className={tileClass}>
          {preview}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className={tileClass}>
          {preview}
        </button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 bottom-1"
        aria-label={`Delete ${asset.filename}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function AssetViewer({ asset }: { asset: ContentAsset }) {
  const url = assetFileUrl(asset.id)
  return assetKind(asset.contentType) === 'video' ? (
    <video
      src={url}
      controls
      autoPlay
      playsInline
      className="max-h-[70vh] w-full rounded-md bg-black"
    />
  ) : (
    <img
      src={url}
      alt={asset.filename}
      className="max-h-[70vh] w-full rounded-md object-contain"
    />
  )
}

function DeleteAssetDialog({
  itemId,
  asset,
  onClose,
}: {
  itemId: string
  asset: ContentAsset | null
  onClose: () => void
}) {
  const deleteAsset = useDeleteContentAsset(itemId)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!asset) return
    try {
      await deleteAsset.mutateAsync(asset.id)
      toast.success('File deleted.')
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Could not delete the file.',
      )
    }
  }

  return (
    <Dialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this file?</DialogTitle>
          <DialogDescription>
            “{asset?.filename}” will be removed for everyone on the team. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteAsset.isPending}
            onClick={() => void confirm()}
          >
            {deleteAsset.isPending ? 'Deleting…' : 'Delete file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
