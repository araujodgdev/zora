import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useHydrated } from '@tanstack/react-router'
import {
  Bot,
  History,
  ImagePlus,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Channel } from '@/lib/content'
import { formatBytes } from '@/lib/content-assets'
import {
  DESIGN_PRESETS,
  MAX_DESIGN_SIDE,
  channelDesignPreset,
  designNameSchema,
  designPreviewUrl,
  formatDesignSize,
} from '@/lib/content-designs'
import type { ContentDesign, ContentDesignVersion } from '@/lib/content-designs'
import { isZoraDesktop } from '@/lib/desktop-bridge'
import type { EditorOrigin } from '@/lib/editor-search'
import {
  contentDesignsQueryOptions,
  designVersionsQueryOptions,
  useCreateContentDesign,
  useDeleteContentDesign,
  usePublishDesignPreview,
  useRenameContentDesign,
  useRestoreDesignVersion,
} from '@/lib/content-designs.queries'

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
 * The designs of a content item: preview cards (the latest saved PNG), a new
 * design at the channel's size, and per design: open in Studio, versions
 * (restore), use as media, rename and delete.
 */
export function ContentDesigns({
  itemId,
  channel,
  from,
}: {
  itemId: string
  channel: Channel
  /** The item editor's origin, kept by the design editor's way back. */
  from?: EditorOrigin
}) {
  const { data: designs } = useSuspenseQuery(contentDesignsQueryOptions(itemId))
  const publish = usePublishDesignPreview(itemId)
  const hydrated = useHydrated()
  const desktop = hydrated && isZoraDesktop()
  const [creating, setCreating] = useState(false)
  const [versionsOf, setVersionsOf] = useState<ContentDesign | null>(null)
  const [renaming, setRenaming] = useState<ContentDesign | null>(null)
  const [deleting, setDeleting] = useState<ContentDesign | null>(null)
  const preset = channelDesignPreset(channel)

  function publishDesign(design: ContentDesign) {
    publish.mutate(design.id, {
      onSuccess: (asset) => toast.success(`“${asset.filename}” foi adicionado à mídia.`),
      onError: (error) => toast.error(errorMessage(error, 'Não foi possível usar o design como mídia.')),
    })
  }

  return (
    <section aria-labelledby="designs-heading" className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 id="designs-heading" className="text-sm font-medium">
          Designs
          {designs.length > 0 ? (
            <span className="text-muted-foreground ml-2 font-normal tabular-nums">
              {designs.length}
            </span>
          ) : null}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" />
          Novo design
        </Button>
      </div>

      <div className="bg-card rounded-xl p-3">
        {designs.length === 0 ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full flex-col items-center gap-1 rounded-lg py-8 text-center text-sm transition-colors outline-none focus-visible:ring-3"
          >
            <Palette className="mb-1 size-5" />
            <span>
              {desktop
                ? 'Crie um design para este item no Zora Studio.'
                : 'Crie um design para este item — edite no Zora Desktop ou via agente MCP.'}
            </span>
            <span className="text-xs">
              Começa no tamanho do canal: {preset.label}, {formatDesignSize(preset.width, preset.height)}.
            </span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {designs.map((design) => (
              <li key={design.id}>
                <DesignCard
                  design={design}
                  from={from}
                  desktop={desktop}
                  publishing={publish.isPending && publish.variables === design.id}
                  onVersions={() => setVersionsOf(design)}
                  onPublish={() => publishDesign(design)}
                  onRename={() => setRenaming(design)}
                  onDelete={() => setDeleting(design)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewDesignDialog
        itemId={itemId}
        channel={channel}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <DesignVersionsDialog
        itemId={itemId}
        design={versionsOf ? (designs.find((d) => d.id === versionsOf.id) ?? versionsOf) : null}
        onClose={() => setVersionsOf(null)}
      />
      <RenameDesignDialog
        key={renaming?.id ?? 'none'}
        itemId={itemId}
        design={renaming}
        onClose={() => setRenaming(null)}
      />
      <DeleteDesignDialog itemId={itemId} design={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function DesignCard({
  design,
  from,
  desktop,
  publishing,
  onVersions,
  onPublish,
  onRename,
  onDelete,
}: {
  design: ContentDesign
  from: EditorOrigin | undefined
  desktop: boolean
  publishing: boolean
  onVersions: () => void
  onPublish: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const saved = design.currentVersionId !== null
  return (
    <div className="bg-muted relative overflow-hidden rounded-lg">
      <Link
        to="/content/$itemId/designs/$designId"
        params={{ itemId: design.contentItemId, designId: design.id }}
        search={{ from }}
        className="focus-visible:ring-ring/50 block rounded-lg outline-none focus-visible:ring-3"
      >
        <div className="bg-background/40 flex aspect-video items-center justify-center overflow-hidden">
          {saved ? (
            <img
              // The URL names the version, so a new save shows a new image.
              src={designPreviewUrl(design.id, design.currentVersionId)}
              alt={`Prévia de ${design.name}`}
              loading="lazy"
              className="size-full object-contain"
            />
          ) : (
            <span className="text-muted-foreground flex flex-col items-center gap-1 px-3 text-center text-xs">
              <Palette className="size-6" />
              {desktop
                ? 'Ainda não salvo. Abra para editar.'
                : 'Ainda não salvo. Edite no Zora Desktop ou via MCP.'}
            </span>
          )}
        </div>
        <div className="p-2 pr-9 text-left">
          <p className="truncate text-xs font-medium">{design.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {formatDesignSize(design.widthPx, design.heightPx)}
            {design.currentVersionNumber !== null ? ` · v${design.currentVersionNumber}` : ''}
          </p>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 bottom-1"
            aria-label={`Ações de ${design.name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link
              to="/content/$itemId/designs/$designId"
              params={{ itemId: design.contentItemId, designId: design.id }}
              search={{ from }}
            >
              <Palette />
              Abrir no Studio
            </Link>
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

const CUSTOM_SIZE = 'custom'

function NewDesignDialog({
  itemId,
  channel,
  open,
  onClose,
}: {
  itemId: string
  channel: Channel
  open: boolean
  onClose: () => void
}) {
  const create = useCreateContentDesign(itemId)
  const channelPreset = channelDesignPreset(channel)
  const [size, setSize] = useState<string>(channelPreset.name)
  const [name, setName] = useState('')
  const [width, setWidth] = useState('1080')
  const [height, setHeight] = useState('1080')
  const [error, setError] = useState<string | null>(null)
  const preset = DESIGN_PRESETS.find((entry) => entry.name === size) ?? null

  function reset() {
    setSize(channelPreset.name)
    setName('')
    setError(null)
  }

  async function submit() {
    setError(null)
    const trimmed = name.trim()
    if (trimmed && !designNameSchema.safeParse(trimmed).success) {
      setError(`O nome pode ter no máximo 200 caracteres.`)
      return
    }
    let dimensions: { preset: (typeof DESIGN_PRESETS)[number]['name'] } | { width: number; height: number }
    if (preset) {
      dimensions = { preset: preset.name }
    } else {
      const w = Number(width)
      const h = Number(height)
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_DESIGN_SIDE
      if (!valid(w) || !valid(h)) {
        setError(`Use larguras e alturas inteiras de 1 a ${MAX_DESIGN_SIDE} px.`)
        return
      }
      dimensions = { width: w, height: h }
    }
    try {
      await create.mutateAsync({ ...(trimmed ? { name: trimmed } : {}), ...dimensions })
      toast.success('Design criado.')
      reset()
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível criar o design.'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent>
        <form noValidate className="grid gap-4" onSubmit={submitOnly(() => void submit())}>
          <DialogHeader>
            <DialogTitle>Novo design</DialogTitle>
            <DialogDescription>
              O tamanho já vem do canal do item, mas você pode escolher outro. Edite no Zora
              Desktop ou peça ao seu agente conectado via MCP.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="design-size">Tamanho</Label>
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger id="design-size" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DESIGN_PRESETS.map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.label} ({formatDesignSize(entry.width, entry.height)})
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_SIZE}>Tamanho personalizado</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {preset ? null : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="design-width">Largura (px)</Label>
                <Input
                  id="design-width"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DESIGN_SIDE}
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="design-height">Altura (px)</Label>
                <Input
                  id="design-height"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DESIGN_SIDE}
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="design-name">Nome</Label>
            <Input
              id="design-name"
              value={name}
              placeholder={preset?.label ?? 'Design'}
              maxLength={200}
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
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Criando…' : 'Criar design'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DesignVersionsDialog({
  itemId,
  design,
  onClose,
}: {
  itemId: string
  design: ContentDesign | null
  onClose: () => void
}) {
  const versions = useQuery({
    ...designVersionsQueryOptions(design?.id ?? ''),
    enabled: design !== null,
  })
  const restore = useRestoreDesignVersion(itemId)

  function restoreVersion(version: ContentDesignVersion) {
    if (!design) return
    restore.mutate(
      { designId: design.id, versionId: version.id },
      {
        onSuccess: (saved) =>
          toast.success(`Versão ${version.number} restaurada como versão ${saved.number}.`),
        onError: (error) => toast.error(errorMessage(error, 'Não foi possível restaurar a versão.')),
      },
    )
  }

  return (
    <Dialog open={design !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Versões de “{design?.name}”</DialogTitle>
          <DialogDescription>
            Cada salvamento é uma versão. Restaurar copia a versão escolhida como a mais recente; nada
            se perde.
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
                  current={version.id === design?.currentVersionId}
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
  version: ContentDesignVersion
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
        src={designPreviewUrl(version.designId, version.id)}
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
          <LocalDateTime value={version.createdAt} /> · {formatBytes(version.sourceSize)}
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

function RenameDesignDialog({
  itemId,
  design,
  onClose,
}: {
  itemId: string
  design: ContentDesign | null
  onClose: () => void
}) {
  const rename = useRenameContentDesign(itemId)
  // The parent keys this dialog by design, so it starts from the current name.
  const [name, setName] = useState(design?.name ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!design) return
    const parsed = designNameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Nome inválido.')
      return
    }
    try {
      await rename.mutateAsync({ designId: design.id, name: parsed.data })
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível renomear o design.'))
    }
  }

  return (
    <Dialog
      open={design !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <form noValidate className="grid gap-4" onSubmit={submitOnly(() => void submit())}>
          <DialogHeader>
            <DialogTitle>Renomear design</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="design-rename">Nome</Label>
            <Input
              id="design-rename"
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

function DeleteDesignDialog({
  itemId,
  design,
  onClose,
}: {
  itemId: string
  design: ContentDesign | null
  onClose: () => void
}) {
  const deleteDesign = useDeleteContentDesign(itemId)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!design) return
    try {
      await deleteDesign.mutateAsync(design.id)
      toast.success('Design excluído.')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível excluir o design.'))
    }
  }

  return (
    <Dialog
      open={design !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir este design?</DialogTitle>
          <DialogDescription>
            “{design?.name}” e todas as suas versões somem para toda a equipe. A mídia que já veio
            dele fica. Não dá para desfazer.
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
            disabled={deleteDesign.isPending}
            onClick={() => void confirm()}
          >
            {deleteDesign.isPending ? 'Excluindo…' : 'Excluir design'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
