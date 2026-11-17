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
  MAX_ASSET_BYTES,
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
import { MediaLightbox } from './media-lightbox'

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
  // Images and videos open in the lightbox; PDFs open in a new tab.
  const viewable = assets.filter((asset) => assetKind(asset.contentType) !== 'document')
  const [viewingIndex, setViewingIndex] = useState<number | null>(null)
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
          error instanceof Error ? error.message : `${file.name}: o envio falhou.`
        setErrors((current) => [...current, message])
      } finally {
        setUploads((current) => current.filter((entry) => entry.key !== key))
      }
    }
  }

  return (
    <section aria-labelledby="media-heading" className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 id="media-heading" className="text-sm font-medium">
          Mídia
          {assets.length > 0 ? (
            <span className="text-muted-foreground ml-2 font-normal tabular-nums">
              {assets.length}
            </span>
          ) : null}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <Upload data-icon="inline-start" />
          Enviar arquivos
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={MEDIA_ACCEPT}
          aria-label="Enviar arquivos"
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
          'bg-card rounded-xl border border-dashed border-foreground/15 p-3 transition-colors',
          dragging && 'bg-lime/10 border-lime/60',
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
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full flex-col items-center gap-1 rounded-lg py-8 text-sm transition-colors outline-none focus-visible:ring-3"
          >
            <Upload className="mb-1 size-5" />
            <span>Arraste arquivos para cá ou clique para escolher.</span>
            <span className="text-xs">Imagens, vídeos e PDFs, até {formatBytes(MAX_ASSET_BYTES)}.</span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset) => (
              <li key={asset.id}>
                <AssetTile
                  asset={asset}
                  onOpen={() => setViewingIndex(viewable.indexOf(asset))}
                  onDelete={() => setDeleting(asset)}
                />
              </li>
            ))}
            {uploads.map((entry) => (
              <li
                key={entry.key}
                className="bg-muted flex aspect-video flex-col justify-end gap-2 rounded-lg p-3 text-xs"
              >
                <span className="truncate">{entry.name}</span>
                <progress
                  className="w-full"
                  value={entry.progress}
                  max={1}
                  aria-label={`Enviando ${entry.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <MediaLightbox
        assets={viewable}
        index={viewingIndex}
        onIndexChange={setViewingIndex}
        onClose={() => setViewingIndex(null)}
        onDelete={(asset) => {
          // Close the viewer first: the confirmation is a normal dialog.
          setViewingIndex(null)
          setDeleting(asset)
        }}
      />

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
    'bg-muted block w-full overflow-hidden rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

  return (
    <div className="relative">
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
        aria-label={`Excluir ${asset.filename}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
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
      toast.success('Arquivo excluído.')
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Não foi possível excluir o arquivo.',
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
          <DialogTitle>Excluir este arquivo?</DialogTitle>
          <DialogDescription>
            “{asset?.filename}” some para toda a equipe. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Manter
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteAsset.isPending}
            onClick={() => void confirm()}
          >
            {deleteAsset.isPending ? 'Excluindo…' : 'Excluir arquivo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
