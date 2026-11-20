import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  Aperture,
  Bot,
  Check,
  History,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { toast } from 'sonner'
import { LocalDateTime } from '@/components/local-date-time'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { assetFileUrl, formatBytes } from '@/lib/content-assets'
import type { ContentAsset } from '@/lib/content-assets'
import {
  PHOTO_ORIGINAL_ACCEPT,
  isPhotoSourceMediaType,
  photoEditNameSchema,
  photoEditPreviewUrl,
  photoOriginalUploadError,
} from '@/lib/content-photo-edits'
import type { ContentPhotoEdit, ContentPhotoEditVersion } from '@/lib/content-photo-edits'
import {
  contentPhotoEditsQueryOptions,
  photoEditVersionsQueryOptions,
  useCreateContentPhotoEdit,
  useDeleteContentPhotoEdit,
  usePublishPhotoEditPreview,
  useRenameContentPhotoEdit,
  useRestorePhotoEditVersion,
  useUploadPhotoEditOriginal,
} from '@/lib/content-photo-edits.queries'
import { contentAssetsQueryOptions } from '@/lib/content.queries'
import { cn } from '@/lib/utils'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Dialog forms are portalled but still inside the item form in React's tree. */
function submitOnly(handler: () => void) {
  return (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    handler()
  }
}

/**
 * The photo edits of a content item (LightCraft developments): preview cards
 * (the latest saved render, or the original's file name before the first
 * save, since browsers cannot show a raw), a new edit from an image of the
 * item's media or an uploaded original, and per edit: open, versions
 * (restore), use as media, rename and delete.
 */
export function ContentPhotoEdits({ itemId }: { itemId: string }) {
  const { data: edits } = useSuspenseQuery(contentPhotoEditsQueryOptions(itemId))
  const publish = usePublishPhotoEditPreview(itemId)
  const [creating, setCreating] = useState(false)
  const [versionsOf, setVersionsOf] = useState<ContentPhotoEdit | null>(null)
  const [renaming, setRenaming] = useState<ContentPhotoEdit | null>(null)
  const [deleting, setDeleting] = useState<ContentPhotoEdit | null>(null)

  function publishEdit(edit: ContentPhotoEdit) {
    publish.mutate(edit.id, {
      onSuccess: (asset) => toast.success(`“${asset.filename}” foi adicionada à mídia.`),
      onError: (error) =>
        toast.error(errorMessage(error, 'Não foi possível usar a foto como mídia.')),
    })
  }

  return (
    <section aria-labelledby="photo-edits-heading" className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 id="photo-edits-heading" className="text-sm font-medium">
          Fotos
          {edits.length > 0 ? (
            <span className="text-muted-foreground ml-2 font-normal tabular-nums">
              {edits.length}
            </span>
          ) : null}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          Nova edição de foto
        </Button>
      </div>

      <div className="bg-card rounded-xl p-3">
        {edits.length === 0 ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full flex-col items-center gap-1 rounded-lg py-8 text-center text-sm transition-colors outline-none focus-visible:ring-3"
          >
            <Aperture className="mb-1 size-5" />
            <span>Revele e ajuste uma foto deste item no LightCraft.</span>
            <span className="text-xs">
              Comece de uma imagem da mídia ou envie o arquivo original, inclusive raw.
            </span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {edits.map((edit) => (
              <li key={edit.id}>
                <PhotoEditCard
                  edit={edit}
                  publishing={publish.isPending && publish.variables === edit.id}
                  onVersions={() => setVersionsOf(edit)}
                  onPublish={() => publishEdit(edit)}
                  onRename={() => setRenaming(edit)}
                  onDelete={() => setDeleting(edit)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewPhotoEditDialog itemId={itemId} open={creating} onClose={() => setCreating(false)} />
      <PhotoEditVersionsDialog
        itemId={itemId}
        edit={versionsOf ? (edits.find((e) => e.id === versionsOf.id) ?? versionsOf) : null}
        onClose={() => setVersionsOf(null)}
      />
      <RenamePhotoEditDialog
        key={renaming?.id ?? 'none'}
        itemId={itemId}
        edit={renaming}
        onClose={() => setRenaming(null)}
      />
      <DeletePhotoEditDialog itemId={itemId} edit={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function PhotoEditCard({
  edit,
  publishing,
  onVersions,
  onPublish,
  onRename,
  onDelete,
}: {
  edit: ContentPhotoEdit
  publishing: boolean
  onVersions: () => void
  onPublish: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const saved = edit.currentVersionId !== null
  // TODO(Z3): the card and "Abrir" link to /content/$itemId/photos/$editId
  // (the LightCraft editor page) once that route exists; until then, opening
  // is disabled so the type-checked router never points at a missing route.
  return (
    <div className="bg-muted relative overflow-hidden rounded-lg">
      <div className="bg-background/40 flex aspect-video items-center justify-center overflow-hidden">
        {saved ? (
          <img
            // The URL names the version, so a new save shows a new image.
            src={photoEditPreviewUrl(edit.id, edit.currentVersionId)}
            alt={`Prévia de ${edit.name}`}
            loading="lazy"
            className="size-full object-contain"
          />
        ) : (
          <span className="text-muted-foreground flex min-w-0 flex-col items-center gap-1 px-3 text-center text-xs">
            <Aperture className="size-6" />
            <span className="max-w-full truncate">{edit.originalName}</span>
            Ainda não revelada.
          </span>
        )}
      </div>
      <div className="p-2 pr-9 text-left">
        <p className="truncate text-xs font-medium">{edit.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {formatBytes(edit.originalSize)}
          {edit.currentVersionNumber !== null ? ` · v${edit.currentVersionNumber}` : ''}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 bottom-1"
            aria-label={`Ações de ${edit.name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>
            <SlidersHorizontal />
            Abrir no LightCraft (em breve)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!saved} onSelect={onVersions}>
            <History />
            Versões
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!saved || publishing} onSelect={onPublish}>
            <ImagePlus />
            {publishing ? 'Adicionando…' : 'Usar como mídia'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

type PhotoSource = 'media' | 'upload'

function NewPhotoEditDialog({
  itemId,
  open,
  onClose,
}: {
  itemId: string
  open: boolean
  onClose: () => void
}) {
  const assets = useQuery({ ...contentAssetsQueryOptions(itemId), enabled: open })
  const images = (assets.data ?? []).filter((asset) => isPhotoSourceMediaType(asset.contentType))
  const create = useCreateContentPhotoEdit(itemId)
  const upload = useUploadPhotoEditOriginal(itemId)
  const [source, setSource] = useState<PhotoSource>('media')
  const [assetId, setAssetId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = create.isPending || upload.isPending

  function reset() {
    setSource('media')
    setAssetId(null)
    setFile(null)
    setProgress(null)
    setName('')
    setError(null)
  }

  function close() {
    if (pending) return
    reset()
    onClose()
  }

  function pickFile(picked: File | null) {
    setError(null)
    if (!picked) return setFile(null)
    const problem = photoOriginalUploadError(picked)
    if (problem) {
      setFile(null)
      setError(problem)
      return
    }
    setFile(picked)
  }

  async function submit() {
    setError(null)
    const trimmed = name.trim()
    if (trimmed && !photoEditNameSchema.safeParse(trimmed).success) {
      setError('O nome pode ter no máximo 200 caracteres.')
      return
    }
    try {
      if (source === 'media') {
        if (!assetId) return setError('Escolha uma imagem da mídia do item.')
        await create.mutateAsync({ assetId, ...(trimmed ? { name: trimmed } : {}) })
      } else {
        if (!file) return setError('Escolha o arquivo da foto.')
        setProgress(0)
        await upload.mutateAsync({
          file,
          name: trimmed || undefined,
          onProgress: (fraction) => setProgress(fraction),
        })
      }
      toast.success('Edição de foto criada.')
      reset()
      onClose()
    } catch (caught) {
      setProgress(null)
      setError(errorMessage(caught, 'Não foi possível criar a edição de foto.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid min-w-0 gap-4" onSubmit={submitOnly(() => void submit())}>
          <DialogHeader>
            <DialogTitle>Nova edição de foto</DialogTitle>
            <DialogDescription>
              A foto é copiada para a edição: a mídia original continua como está.
            </DialogDescription>
          </DialogHeader>

          <ToggleGroup
            type="single"
            variant="outline"
            value={source}
            onValueChange={(value) => {
              if (value === 'media' || value === 'upload') {
                setSource(value)
                setError(null)
              }
            }}
            className="w-full"
            disabled={pending}
          >
            <ToggleGroupItem value="media" className="flex-1">
              <ImagePlus />
              Da mídia do item
            </ToggleGroupItem>
            <ToggleGroupItem value="upload" className="flex-1">
              <Upload />
              Enviar arquivo
            </ToggleGroupItem>
          </ToggleGroup>

          {source === 'media' ? (
            <MediaPicker
              loading={assets.isPending}
              images={images}
              selected={assetId}
              disabled={pending}
              onSelect={(asset) => {
                setAssetId(asset.id)
                setError(null)
              }}
            />
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="photo-edit-file">Arquivo da foto</Label>
              <input
                ref={fileInput}
                id="photo-edit-file"
                type="file"
                accept={PHOTO_ORIGINAL_ACCEPT}
                className="sr-only"
                disabled={pending}
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => fileInput.current?.click()}
                className="min-w-0 justify-start"
              >
                <Upload data-icon="inline-start" />
                <span className="truncate">{file ? file.name : 'Escolher arquivo…'}</span>
              </Button>
              <p className="text-muted-foreground text-xs">
                JPEG, PNG, WebP, AVIF, TIFF ou raw de câmera (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG
                e outros), até 100 MB.
                {file ? ` Selecionado: ${formatBytes(file.size)}.` : ''}
              </p>
              {progress !== null ? (
                <progress
                  className="w-full"
                  value={progress}
                  max={1}
                  aria-label={`Enviando ${file?.name ?? 'a foto'}`}
                />
              ) : null}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="photo-edit-name">Nome</Label>
            <Input
              id="photo-edit-name"
              value={name}
              placeholder="Nome do arquivo, se vazio"
              maxLength={200}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {upload.isPending ? 'Enviando…' : create.isPending ? 'Criando…' : 'Criar edição'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MediaPicker({
  loading,
  images,
  selected,
  disabled,
  onSelect,
}: {
  loading: boolean
  images: Array<ContentAsset>
  selected: string | null
  disabled: boolean
  onSelect: (asset: ContentAsset) => void
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="aspect-square" />
        <Skeleton className="aspect-square" />
        <Skeleton className="aspect-square" />
      </div>
    )
  }
  if (images.length === 0) {
    return (
      <p className="bg-muted text-muted-foreground rounded-lg p-4 text-center text-sm">
        Este item ainda não tem imagens JPEG, PNG, WebP ou AVIF na mídia. Envie um arquivo.
      </p>
    )
  }
  return (
    <div
      role="radiogroup"
      aria-label="Imagens da mídia"
      className="-mx-1 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto px-1 py-1"
    >
      {images.map((asset) => {
        const checked = asset.id === selected
        return (
          <button
            key={asset.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={asset.filename}
            title={asset.filename}
            disabled={disabled}
            onClick={() => onSelect(asset)}
            className={cn(
              'bg-muted focus-visible:ring-ring/50 relative aspect-square overflow-hidden rounded-lg outline-none focus-visible:ring-3',
              checked && 'ring-primary ring-2',
            )}
          >
            <img
              src={assetFileUrl(asset.id)}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
            {checked ? (
              <span className="bg-primary text-primary-foreground absolute top-1 right-1 rounded-full p-0.5">
                <Check className="size-3.5" />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function PhotoEditVersionsDialog({
  itemId,
  edit,
  onClose,
}: {
  itemId: string
  edit: ContentPhotoEdit | null
  onClose: () => void
}) {
  const versions = useQuery({
    ...photoEditVersionsQueryOptions(edit?.id ?? ''),
    enabled: edit !== null,
  })
  const restore = useRestorePhotoEditVersion(itemId)

  function restoreVersion(version: ContentPhotoEditVersion) {
    if (!edit) return
    restore.mutate(
      { editId: edit.id, versionId: version.id },
      {
        onSuccess: (saved) =>
          toast.success(`Versão ${version.number} restaurada como versão ${saved.number}.`),
        onError: (error) =>
          toast.error(errorMessage(error, 'Não foi possível restaurar a versão.')),
      },
    )
  }

  return (
    <Dialog open={edit !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Versões de “{edit?.name}”</DialogTitle>
          <DialogDescription>
            Cada salvamento é uma versão. Restaurar copia a versão escolhida como a mais recente;
            nada se perde.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
          {versions.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : versions.isError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {errorMessage(versions.error, 'Não foi possível carregar as versões.')}
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="grid gap-2">
              {versions.data.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  current={version.id === edit?.currentVersionId}
                  restoring={restore.isPending && restore.variables?.versionId === version.id}
                  disabled={restore.isPending}
                  onRestore={() => restoreVersion(version)}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VersionRow({
  version,
  current,
  restoring,
  disabled,
  onRestore,
}: {
  version: ContentPhotoEditVersion
  current: boolean
  restoring: boolean
  disabled: boolean
  onRestore: () => void
}) {
  let author: ReactNode = version.createdByName ?? 'Alguém'
  if (version.authorKind === 'agent') {
    author = (
      <span className="inline-flex items-center gap-1">
        <Bot className="size-3.5" />
        Agente de {version.createdByName ?? 'alguém'}
      </span>
    )
  }
  return (
    <li className="bg-muted flex items-center gap-3 rounded-lg p-2">
      <img
        src={photoEditPreviewUrl(version.editId, version.id)}
        alt=""
        loading="lazy"
        className="bg-background/40 h-12 w-16 shrink-0 rounded object-contain"
      />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-medium">
          Versão {version.number}
          {current ? <span className="text-brand ml-2 font-normal">atual</span> : null}
        </p>
        <p className="text-muted-foreground truncate">{author}</p>
        <p className="text-muted-foreground">
          <LocalDateTime value={version.createdAt} /> · {formatBytes(version.previewSize)}
        </p>
      </div>
      {current ? null : (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRestore}>
          <RotateCcw data-icon="inline-start" />
          {restoring ? 'Restaurando…' : 'Restaurar'}
        </Button>
      )}
    </li>
  )
}

function RenamePhotoEditDialog({
  itemId,
  edit,
  onClose,
}: {
  itemId: string
  edit: ContentPhotoEdit | null
  onClose: () => void
}) {
  const rename = useRenameContentPhotoEdit(itemId)
  // The parent keys this dialog by edit, so it starts from the current name.
  const [name, setName] = useState(edit?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!edit) return
    const parsed = photoEditNameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nome inválido.')
      return
    }
    try {
      await rename.mutateAsync({ editId: edit.id, name: parsed.data })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível renomear a edição de foto.'))
    }
  }

  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <form noValidate className="grid gap-4" onSubmit={submitOnly(() => void submit())}>
          <DialogHeader>
            <DialogTitle>Renomear edição de foto</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="photo-edit-rename">Nome</Label>
            <Input
              id="photo-edit-rename"
              value={name}
              maxLength={200}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? 'Salvando…' : 'Salvar nome'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeletePhotoEditDialog({
  itemId,
  edit,
  onClose,
}: {
  itemId: string
  edit: ContentPhotoEdit | null
  onClose: () => void
}) {
  const deleteEdit = useDeleteContentPhotoEdit(itemId)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!edit) return
    try {
      await deleteEdit.mutateAsync(edit.id)
      toast.success('Edição de foto excluída.')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível excluir a edição de foto.'))
    }
  }

  return (
    <Dialog
      open={edit !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir esta edição de foto?</DialogTitle>
          <DialogDescription>
            “{edit?.name}”, sua cópia da foto original e todas as versões somem para toda a equipe. A
            mídia do item fica. Não dá para desfazer.
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
            disabled={deleteEdit.isPending}
            onClick={() => void confirm()}
          >
            {deleteEdit.isPending ? 'Excluindo…' : 'Excluir edição'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
