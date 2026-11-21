import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound, useBlocker } from '@tanstack/react-router'
import { ArrowLeft, MonitorSmartphone, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PAGE_PADDING, PageHeader } from '@/components/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMediaQuery } from '@/hooks/use-media-query'
import { contentKeys } from '@/lib/content-cache'
import { photoEditOriginalUrl, photoEditSettingsUrl } from '@/lib/content-photo-edits'
import { contentPhotoEditsQueryOptions } from '@/lib/content-photo-edits.queries'
import { savePhotoEditVersion } from '@/lib/content-photo-edits.upload'
import { editItemSearchSchema } from '@/lib/editor-search'
import {
  LIGHTCRAFT_DIRTY_POLL_MS,
  LIGHTCRAFT_EDITOR_URL,
  LightcraftBridge,
  openLightcraftPhoto,
  parseLightcraftMessage,
  pollLightcraftDirty,
  saveLightcraftPhoto,
} from '@/lib/lightcraft-bridge'
import type { LightcraftMessage, LightcraftTransport } from '@/lib/lightcraft-bridge'
import { loadQuery } from '@/lib/route-query'
import { LIGHTCRAFT_BUNDLE } from '@/lib/studio-hosting'
import { cn } from '@/lib/utils'

/**
 * The photo editor: LightCraft, embedded from `/lightcraft/` (served from
 * R2, same origin; see "LightCraft hosting" in AGENTS.md) below a thin Zora
 * header (Voltar, the edit's name, the save state, Salvar). The bridge is
 * parent-driven (`@/lib/lightcraft-bridge`, docs/LIGHTCRAFT-PLAN.md "Editor
 * page"): this page opens the edit's original in LightCraft's memory
 * library, merges the current version's settings, polls `develop.get` for
 * unsaved changes, and on Salvar exports a JPEG preview and posts a new
 * version (409 = someone saved meanwhile: a dialog). Phones get a message.
 */
export const Route = createFileRoute('/_app/content/$itemId_/photos/$editId')({
  // `from` is the item editor's origin, kept for the way back.
  validateSearch: editItemSearchSchema,
  // Whether this is a phone is only known in the browser.
  ssr: 'data-only',
  // No shell padding: the header and LightCraft fill the page.
  staticData: { fullBleed: true },
  loader: async ({ context, params }) => {
    const edits = await loadQuery(
      context.queryClient,
      contentPhotoEditsQueryOptions(params.itemId),
    ).catch(() => [])
    const edit = edits.find((entry) => entry.id === params.editId)
    if (!edit) throw notFound()
    return { name: edit.name }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? 'Foto'} · Zora` }],
  }),
  component: PhotoEditorPage,
  notFoundComponent: PhotoEditNotFound,
})

/** Whether LightCraft answers at `/lightcraft/` (it is published to R2 separately). */
type Availability = 'checking' | 'available' | 'missing' | 'signed-out' | 'error'

/** The editor's state, as the header shows it. */
type EditorPhase =
  | { kind: 'opening' }
  | { kind: 'open-failed'; message: string }
  | { kind: 'ready' }
  | { kind: 'saving' }

/** The version the open photo is based on (null before the first save). */
type BaseVersion = { id: string; number: number } | null

/** A 409 answer: the newer version someone else saved. */
type Conflict = { message: string; versionId: string | null; number: number | null }

/** Longest wait for the fresh dirty poll before a navigation. */
const NAVIGATION_POLL_TIMEOUT_MS = 2000

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function BackToItem({ className }: { className?: string }) {
  const { itemId } = Route.useParams()
  const { from } = Route.useSearch()
  return (
    <Link
      to="/content/$itemId"
      params={{ itemId }}
      search={{ from }}
      className={cn(
        'text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm',
        className,
      )}
    >
      <ArrowLeft className="size-4" />
      Voltar ao item
    </Link>
  )
}

function PhotoEditorPage() {
  const { itemId, editId } = Route.useParams()
  const { data: edits } = useSuspenseQuery(contentPhotoEditsQueryOptions(itemId))
  const edit = edits.find((entry) => entry.id === editId)
  // iPad portrait (820 px) and up; phones get a message.
  const largeEnough = useMediaQuery('(min-width: 768px)', true)

  if (!edit) return <PhotoEditNotFound />
  if (!largeEnough) {
    return (
      <div className={PAGE_PADDING}>
        <BackToItem className="mb-6" />
        <PageHeader title={edit.name} description={edit.originalName} />
        <Alert>
          <MonitorSmartphone />
          <AlertTitle>O editor precisa de uma tela maior</AlertTitle>
          <AlertDescription>
            Abra esta foto num tablet ou computador para editá-la. Daqui você ainda vê as prévias e
            as versões na página do item.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  return <PhotoEditor key={edit.id} name={edit.name} />
}

/** Fetches a file of the edit with the session; readable errors. */
async function fetchEditFile(url: string, what: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    throw new Error(`Não foi possível baixar ${what}: verifique sua conexão.`)
  }
  if (response.status === 401) throw new Error('Sua sessão terminou. Entre de novo no Zora.')
  if (!response.ok) throw new Error(`Não foi possível baixar ${what} (${response.status}).`)
  return response
}

function PhotoEditor({ name }: { name: string }) {
  const { itemId, editId } = Route.useParams()
  const { from } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()

  const [availability, setAvailability] = useState<Availability>('checking')
  // A new key gives a fresh iframe (and a fresh open): "Abrir a versão mais recente".
  const [frameKey, setFrameKey] = useState(0)
  const [phase, setPhase] = useState<EditorPhase>({ kind: 'opening' })
  const [base, setBase] = useState<BaseVersion>(null)
  const [dirty, setDirty] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // After "Continuar editando": the newer version the next save replaces (after asking).
  const [replaceTarget, setReplaceTarget] = useState<{ id: string; number: number | null } | null>(
    null,
  )
  const [confirmReplace, setConfirmReplace] = useState(false)

  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<LightcraftBridge | null>(null)
  const baselineRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  // For the blocker's callback, which outlives a render.
  const phaseRef = useRef<EditorPhase>(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const updateDirty = useCallback((next: boolean) => {
    dirtyRef.current = next
    setDirty(next)
  }, [])

  // Probe LightCraft before loading it, so a missing build shows an
  // explanation instead of a 404 page inside the frame.
  useEffect(() => {
    const controller = new AbortController()
    fetch(LIGHTCRAFT_BUNDLE.urlPrefix, {
      method: 'HEAD',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        setAvailability(
          response.ok
            ? 'available'
            : response.status === 404
              ? 'missing'
              : response.status === 401
                ? 'signed-out'
                : 'error',
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability('error')
      })
    return () => controller.abort()
  }, [])

  // One bridge and one open flow per iframe.
  useEffect(() => {
    if (availability !== 'available') return
    const frame = frameRef.current
    if (!frame) return
    const frameWindow = () => frame.contentWindow
    const transport: LightcraftTransport = {
      post: (message, transfer) =>
        frameWindow()?.postMessage(message, window.location.origin, transfer ?? []),
      subscribe: (listener: (message: LightcraftMessage) => void) => {
        function onMessage(event: MessageEvent) {
          // Only LightCraft, in this page's frame, on Zora's own origin.
          if (event.origin !== window.location.origin) return
          if (!event.source || event.source !== frameWindow()) return
          const message = parseLightcraftMessage(event.data)
          if (message) listener(message)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      },
    }
    const bridge = new LightcraftBridge(transport)
    bridgeRef.current = bridge
    baselineRef.current = null
    let cancelled = false
    setPhase({ kind: 'opening' })
    updateDirty(false)
    setSaveFailed(false)

    void (async () => {
      // The newest metadata: after a 409 the reopen must find the newest version.
      const edits = await queryClient.fetchQuery({
        ...contentPhotoEditsQueryOptions(itemId),
        staleTime: 0,
      })
      const edit = edits.find((entry) => entry.id === editId)
      if (!edit) throw new Error('Esta edição de foto não existe mais.')
      const versionId = edit.currentVersionId
      const [original, settings] = await Promise.all([
        fetchEditFile(photoEditOriginalUrl(editId), 'a foto original').then((r) =>
          r.arrayBuffer(),
        ),
        versionId
          ? fetchEditFile(photoEditSettingsUrl(editId, versionId), 'a versão salva')
              .then((r) => r.text())
              .then((text) => JSON.parse(text) as unknown)
          : Promise.resolve(undefined),
      ])
      await bridge.whenReady()
      const baseline = await openLightcraftPhoto(bridge, {
        name: edit.originalName,
        bytes: original,
        settings,
        label:
          edit.currentVersionNumber !== null ? `Versão ${edit.currentVersionNumber}` : undefined,
      })
      if (cancelled) return
      baselineRef.current = baseline
      setBase(
        versionId && edit.currentVersionNumber !== null
          ? { id: versionId, number: edit.currentVersionNumber }
          : null,
      )
      setPhase({ kind: 'ready' })
    })().catch((error: unknown) => {
      if (cancelled) return
      setPhase({
        kind: 'open-failed',
        message: errorMessage(error, 'Não foi possível abrir a foto.'),
      })
    })

    return () => {
      cancelled = true
      bridge.dispose()
      if (bridgeRef.current === bridge) bridgeRef.current = null
    }
  }, [availability, frameKey, itemId, editId, queryClient, updateDirty])

  /** One dirty poll; `force` runs it even while the queue is busy. */
  const pollDirty = useCallback(
    async (force = false) => {
      const bridge = bridgeRef.current
      const baseline = baselineRef.current
      if (!bridge || baseline === null) return dirtyRef.current
      const result = await pollLightcraftDirty(bridge, baseline, { force })
      // A save may have moved the baseline meanwhile: only trust the same one.
      if (result !== null && baselineRef.current === baseline) updateDirty(result)
      return dirtyRef.current
    },
    [updateDirty],
  )

  // Edits in LightCraft send nothing: poll while the tab is visible.
  useEffect(() => {
    if (phase.kind !== 'ready') return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void pollDirty()
    }, LIGHTCRAFT_DIRTY_POLL_MS)
    return () => window.clearInterval(timer)
  }, [phase.kind, pollDirty])

  async function runSave(baseVersionId: string | null) {
    const bridge = bridgeRef.current
    if (!bridge || savingRef.current) return
    savingRef.current = true
    setPhase({ kind: 'saving' })
    try {
      const { settingsText, preview } = await saveLightcraftPhoto(bridge)
      const outcome = await savePhotoEditVersion(editId, {
        settingsText,
        preview,
        baseVersionId,
      })
      if (outcome.kind === 'conflict') {
        setConflict({
          message: outcome.error,
          versionId: outcome.currentVersionId,
          number: outcome.currentVersionNumber,
        })
        return
      }
      baselineRef.current = settingsText
      setBase({ id: outcome.versionId, number: outcome.number })
      setReplaceTarget(null)
      setSaveFailed(false)
      updateDirty(false)
      void queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) })
      void queryClient.invalidateQueries({ queryKey: contentKeys.photoEditVersions(editId) })
      // Changes made while the save ran are still unsaved.
      void pollDirty(true)
    } catch (error) {
      setSaveFailed(true)
      toast.error(errorMessage(error, 'Não foi possível salvar a foto.'))
    } finally {
      savingRef.current = false
      // A reloaded frame runs its own open flow; leave its state alone.
      if (bridgeRef.current === bridge) {
        setPhase(
          bridge.isDisposed
            ? { kind: 'open-failed', message: 'O LightCraft parou de responder. Tente de novo.' }
            : { kind: 'ready' },
        )
      }
    }
  }

  function save() {
    // A second click while saving (or before the photo is open) is ignored.
    if (savingRef.current || phase.kind !== 'ready') return
    if (replaceTarget) {
      setConfirmReplace(true)
      return
    }
    void runSave(base?.id ?? null)
  }

  function openNewest() {
    setConflict(null)
    setConfirmDiscard(false)
    setReplaceTarget(null)
    updateDirty(false)
    setFrameKey((key) => key + 1)
  }

  function keepEditing() {
    if (conflict?.versionId) {
      setReplaceTarget({ id: conflict.versionId, number: conflict.number })
    }
    setConflict(null)
    setConfirmDiscard(false)
  }

  const blocker = useBlocker({
    // One fresh poll first: the last tick may be up to 1.5 s old.
    shouldBlockFn: async () => {
      if (savingRef.current) return true
      if (phaseRef.current.kind !== 'ready') return false
      await Promise.race([
        pollDirty(true),
        new Promise((resolve) => setTimeout(resolve, NAVIGATION_POLL_TIMEOUT_MS)),
      ])
      return dirtyRef.current
    },
    // Must answer synchronously: the last poll result.
    enableBeforeUnload: () => dirtyRef.current || savingRef.current,
    withResolver: true,
  })

  const state = useMemo(() => {
    switch (phase.kind) {
      case 'opening':
        return { text: 'Abrindo…', tone: 'muted' as const }
      case 'open-failed':
        return { text: phase.message, tone: 'error' as const }
      case 'saving':
        return { text: 'Salvando…', tone: 'muted' as const }
      case 'ready':
        if (dirty && saveFailed) return { text: 'Não salvo: o salvamento falhou', tone: 'error' as const }
        if (dirty) return { text: 'Alterações não salvas', tone: 'muted' as const }
        return base
          ? { text: `Salvo (versão ${base.number})`, tone: 'muted' as const }
          : { text: 'Nenhuma versão salva ainda', tone: 'muted' as const }
    }
  }, [phase, dirty, saveFailed, base])

  if (availability !== 'available') {
    return (
      <div className="bg-background h-(--page-h) w-full overflow-hidden">
        <LightcraftUnavailable availability={availability} />
      </div>
    )
  }

  return (
    // Full bleed (`staticData.fullBleed`): the header and LightCraft fill
    // the area right of the sidebar (below the top bar under `lg`).
    <div className="bg-background flex h-(--page-h) w-full flex-col overflow-hidden">
      <header className="bg-card flex h-12 shrink-0 items-center gap-3 px-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigate({ to: '/content/$itemId', params: { itemId }, search: { from } })
          }
        >
          <ArrowLeft data-icon="inline-start" />
          Voltar
        </Button>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-sm font-medium">{name}</h1>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'truncate text-xs',
              state.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {state.text}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={phase.kind !== 'ready'}
          aria-busy={phase.kind === 'saving'}
          onClick={save}
        >
          {phase.kind === 'saving' ? 'Salvando…' : 'Salvar'}
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <iframe
          key={frameKey}
          ref={frameRef}
          src={LIGHTCRAFT_EDITOR_URL}
          title={`LightCraft: ${name}`}
          // Same origin on purpose: the bridge only answers its same-origin parent.
          allow="clipboard-read; clipboard-write; fullscreen"
          className="block size-full border-0"
        />
        {phase.kind === 'opening' || phase.kind === 'open-failed' ? (
          // Covers the demo library LightCraft starts with until the photo is open.
          <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-6">
            {phase.kind === 'opening' ? (
              <p className="text-muted-foreground text-sm">Abrindo a foto no LightCraft…</p>
            ) : (
              <Alert variant="destructive" className="max-w-lg">
                <TriangleAlert />
                <AlertTitle>Não foi possível abrir a foto</AlertTitle>
                <AlertDescription>
                  <p>{phase.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setFrameKey((key) => key + 1)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Tentar de novo
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}
      </div>

      <Dialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) keepEditing()
        }}
      >
        <DialogContent>
          {confirmDiscard ? (
            <>
              <DialogHeader>
                <DialogTitle>Descartar suas alterações?</DialogTitle>
                <DialogDescription>
                  Abrir a versão mais recente recarrega o LightCraft, e o que você mudou desde o
                  último salvamento se perde.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Voltar
                </Button>
                <Button type="button" variant="destructive" onClick={openNewest}>
                  Descartar e abrir
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Há uma versão mais nova desta foto</DialogTitle>
                <DialogDescription>
                  {conflict?.number
                    ? `Alguém (uma pessoa ou um agente) salvou a versão ${conflict.number} enquanto você editava. `
                    : 'Alguém salvou uma versão mais nova enquanto você editava. '}
                  Nada foi salvo agora. Abra a versão mais recente, ou continue editando e salve
                  por cima dela depois.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={keepEditing}>
                  Continuar editando
                </Button>
                <Button
                  type="button"
                  onClick={() => (dirtyRef.current ? setConfirmDiscard(true) : openNewest())}
                >
                  Abrir a versão mais recente
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {replaceTarget?.number
                ? `Salvar por cima da versão ${replaceTarget.number}?`
                : 'Salvar por cima da versão mais nova?'}
            </DialogTitle>
            <DialogDescription>
              Sua edição vira a versão mais recente e substitui o que foi salvo nela. A versão{' '}
              {replaceTarget?.number ?? 'mais nova'} continua no histórico e pode ser restaurada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmReplace(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmReplace(false)
                const target = replaceTarget
                if (target && !savingRef.current) void runSave(target.id)
              }}
            >
              Salvar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sair sem salvar?</DialogTitle>
            <DialogDescription>
              {phase.kind === 'saving'
                ? 'A foto ainda está sendo salva. Se sair agora, o salvamento pode se perder.'
                : 'A foto tem alterações que ainda não foram salvas no Zora. Se sair agora, elas se perdem.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => blocker.reset?.()}>
              Continuar editando
            </Button>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              Sair sem salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LightcraftUnavailable({ availability }: { availability: Availability }) {
  if (availability === 'checking') {
    return (
      <p className="text-muted-foreground flex size-full items-center justify-center text-sm">
        Procurando o LightCraft…
      </p>
    )
  }
  const [title, description] =
    availability === 'missing'
      ? [
          'O LightCraft ainda não foi publicado aqui',
          <>
            Os arquivos do editor de fotos não estão no armazenamento deste ambiente. Quem cuida do
            Zora precisa publicá-los com <code className="font-mono">pnpm lightcraft:publish</code>{' '}
            (veja o AGENTS.md) e depois recarregar esta página.
          </>,
        ]
      : availability === 'signed-out'
        ? ['Sua sessão terminou', 'Entre de novo no Zora e abra a foto outra vez.']
        : ['Não foi possível abrir o LightCraft', 'Verifique a conexão e recarregue a página.']
  return (
    <div className={cn('flex size-full flex-col', PAGE_PADDING)}>
      <BackToItem className="self-start" />
      <div className="flex flex-1 items-center justify-center">
        <Alert className="max-w-lg">
          <TriangleAlert />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
      </div>
    </div>
  )
}

function PhotoEditNotFound() {
  return (
    <div className={PAGE_PADDING}>
      <BackToItem className="mb-6" />
      <PageHeader
        title="Edição de foto não encontrada"
        description="Ela pode ter sido excluída, ou o link está errado."
      />
    </div>
  )
}
