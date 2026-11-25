import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound, useBlocker } from '@tanstack/react-router'
import {
  AppWindow,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Monitor,
  MonitorSmartphone,
  RotateCw,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
import { formatDesignSize } from '@/lib/content-designs'
import { contentDesignsQueryOptions } from '@/lib/content-designs.queries'
import {
  ZORA_DESKTOP_DOWNLOAD_URL,
  focusNativeEditor,
  getDesktopInfo,
  isDesktopClosedPayload,
  isZoraDesktop,
  openNativeDesignEditor,
  subscribeDesktopEditorEvents,
} from '@/lib/desktop-bridge'
import { editItemSearchSchema } from '@/lib/editor-search'
import { loadQuery } from '@/lib/route-query'
import { parseStudioMessage } from '@/lib/studio-hosting'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * The design editor page. Native-first: Zora Studio runs as a native
 * Rust/wgpu window launched by Zora Desktop (Tauri v2, see
 * docs/DESKTOP-PLAN.md), which bundles the editor executable in its single
 * installer. Inside Zora Desktop this page launches the editor through the
 * desktop bridge and mirrors its lifecycle events
 * (`zora-studio:ready|dirty|saved|back`, `zora-desktop:closed`): it refreshes
 * the design queries on a save, returns to the item on `back`, and warns
 * before leaving with unsaved changes. In a regular web browser the page
 * explains that editing happens in Zora Desktop (the web/WASM editor is no
 * longer embedded). Phones get a message: the editor needs a larger screen.
 */
export const Route = createFileRoute('/_app/content/$itemId_/designs/$designId')({
  // `from` is the item editor's origin, kept for the way back.
  validateSearch: editItemSearchSchema,
  // Whether this is a phone (or Zora Desktop) is only known in the browser.
  ssr: 'data-only',
  // No shell padding: the page manages its own full-height layout.
  staticData: { fullBleed: true },
  loader: async ({ context, params }) => {
    const designs = await loadQuery(
      context.queryClient,
      contentDesignsQueryOptions(params.itemId),
    ).catch(() => [])
    const design = designs.find((entry) => entry.id === params.designId)
    if (!design) throw notFound()
    return { name: design.name }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? 'Design'} · Zora` }],
  }),
  component: DesignEditorPage,
  notFoundComponent: DesignNotFound,
})

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

/** "Voltar ao item" as an outline button, for action rows. */
function BackToItemButton() {
  const { itemId } = Route.useParams()
  const { from } = Route.useSearch()
  return (
    <Button asChild variant="outline">
      <Link to="/content/$itemId" params={{ itemId }} search={{ from }}>
        <ArrowLeft className="size-4" />
        Voltar ao item
      </Link>
    </Button>
  )
}

function DesignEditorPage() {
  const { itemId, designId } = Route.useParams()
  const { data: designs } = useSuspenseQuery(contentDesignsQueryOptions(itemId))
  const design = designs.find((entry) => entry.id === designId)
  // iPad portrait (820 px) and up; phones get a message.
  const largeEnough = useMediaQuery('(min-width: 768px)', true)

  if (!design) return <DesignNotFound />
  const sizeLabel = formatDesignSize(design.widthPx, design.heightPx)
  if (!largeEnough) {
    return (
      <div className={PAGE_PADDING}>
        <BackToItem className="mb-6" />
        <PageHeader title={design.name} description={sizeLabel} />
        <Alert>
          <MonitorSmartphone />
          <AlertTitle>Edição disponível no Zora Desktop</AlertTitle>
          <AlertDescription>
            Abra este item no Zora Desktop (Windows) para editar manualmente, ou peça ao seu{' '}
            <Link to="/connect" className="text-foreground underline underline-offset-4">
              agente conectado via MCP
            </Link>
            . Daqui você continua vendo as prévias, as versões e pode usá-lo como mídia.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!isZoraDesktop()) {
    return <DesktopRequired name={design.name} sizeLabel={sizeLabel} />
  }
  return <NativeDesignEditor key={design.id} name={design.name} sizeLabel={sizeLabel} />
}

/** Shown in a regular web browser: editing is native-only (Zora Desktop). */
function DesktopRequired({ name, sizeLabel }: { name: string; sizeLabel: string }) {
  return (
    <div className="bg-background h-(--page-h) w-full overflow-auto">
      <div className={cn('flex min-h-full flex-col', PAGE_PADDING)}>
        <BackToItem className="mb-6 self-start" />
        <PageHeader title={name} description={sizeLabel} />
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="bg-card w-full max-w-lg rounded-xl p-6 sm:p-8">
            <div className="flex items-start gap-3.5">
              <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                <Monitor className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-foreground text-xl font-semibold">
                  Edição disponível no Zora Desktop
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  O Zora Studio roda de forma nativa com aceleração de GPU no aplicativo Zora
                  Desktop. Abra este item no Zora Desktop para editar manualmente, ou peça ao seu{' '}
                  <Link to="/connect" className="text-foreground underline underline-offset-4">
                    agente conectado via MCP
                  </Link>
                  ; por aqui você continua vendo as prévias, o histórico de versões e pode usá-lo
                  como mídia.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button asChild>
                <a href={ZORA_DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                  <Download className="size-4" />
                  Baixar Zora Desktop (Windows)
                </a>
              </Button>
              <BackToItemButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type NativeEditorState =
  | { status: 'opening' }
  | { status: 'running' }
  | { status: 'closed' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

function NativeDesignEditor({ name, sizeLabel }: { name: string; sizeLabel: string }) {
  const { itemId, designId } = Route.useParams()
  const { from } = Route.useSearch()
  const navigate = Route.useNavigate()
  const initialTheme = Route.useRouteContext({ select: (context) => context.theme })
  const theme = useTheme(initialTheme)
  // Fix the theme the native editor opens with so theme switches do not relaunch it.
  const [initialEditorTheme] = useState(() => theme)
  const [state, setState] = useState<NativeEditorState>({ status: 'opening' })
  const [dirty, setDirty] = useState(false)
  const [lastSavedNumber, setLastSavedNumber] = useState<number | null>(null)
  const [launchAttempt, setLaunchAttempt] = useState(0)
  const queryClient = useQueryClient()

  const requestLaunch = useCallback(() => {
    setState({ status: 'opening' })
    setLaunchAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    getDesktopInfo()
      .then((info) => {
        if (cancelled) return
        if (!info.studioAvailable) {
          setState({ status: 'unavailable' })
          return
        }
        return openNativeDesignEditor({
          designId,
          itemId,
          name,
          theme: initialEditorTheme,
        }).then(() => {
          if (!cancelled) setState({ status: 'running' })
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível iniciar o Zora Studio nativo.'
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [designId, itemId, name, initialEditorTheme, launchAttempt])

  useEffect(() => {
    return subscribeDesktopEditorEvents((event) => {
      if (event.editor !== 'studio' || event.id !== designId) return
      if (isDesktopClosedPayload(event.payload)) {
        setDirty(false)
        setState({ status: 'closed' })
        return
      }
      const message = parseStudioMessage(event.payload, designId)
      if (!message) return
      switch (message.type) {
        case 'zora-studio:ready':
          setDirty(false)
          setState({ status: 'running' })
          break
        case 'zora-studio:dirty':
          setDirty(message.dirty)
          setState({ status: 'running' })
          break
        case 'zora-studio:saved':
          setDirty(false)
          setLastSavedNumber(message.number)
          setState({ status: 'running' })
          void queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) })
          void queryClient.invalidateQueries({ queryKey: contentKeys.designVersions(designId) })
          break
        case 'zora-studio:back':
          void navigate({ to: '/content/$itemId', params: { itemId }, search: { from } })
          break
      }
    })
  }, [designId, itemId, from, navigate, queryClient])

  const handleFocus = useCallback(async () => {
    try {
      const result = await focusNativeEditor({ editor: 'studio', id: designId })
      if (!result.focused) {
        requestLaunch()
      }
    } catch {
      requestLaunch()
    }
  }, [designId, requestLaunch])

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  const statusText =
    state.status === 'opening'
      ? 'Abrindo editor nativo…'
      : state.status === 'closed'
        ? 'Janela fechada'
        : dirty
          ? 'Alterações não salvas na janela nativa'
          : lastSavedNumber !== null
            ? `Salvo (versão ${lastSavedNumber})`
            : 'Em edição na janela nativa'

  return (
    <div className="bg-background h-(--page-h) w-full overflow-auto">
      <div className={cn('flex min-h-full flex-col', PAGE_PADDING)}>
        <BackToItem className="self-start" />
        <div className="flex flex-1 items-center justify-center py-8">
          {state.status === 'unavailable' || state.status === 'error' ? (
            <div className="w-full max-w-lg space-y-4">
              <Alert>
                <TriangleAlert />
                <AlertTitle>
                  {state.status === 'unavailable'
                    ? 'Zora Studio nativo não encontrado'
                    : 'Não foi possível abrir o Zora Studio nativo'}
                </AlertTitle>
                <AlertDescription>
                  {state.status === 'unavailable'
                    ? 'O executável do Zora Studio que acompanha o Zora Desktop não foi encontrado nesta instalação. Reinstale o Zora Desktop com o instalador completo (ou, em desenvolvimento, compile o editor) e tente novamente.'
                    : `${state.message} Tente novamente em instantes.`}
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" onClick={requestLaunch}>
                  <RotateCw className="size-4" />
                  {state.status === 'unavailable' ? 'Tentar novamente' : 'Abrir editor nativo'}
                </Button>
                <BackToItemButton />
              </div>
            </div>
          ) : (
            <div className="bg-card w-full max-w-lg rounded-xl p-6 sm:p-8">
              <div className="flex items-start gap-3.5">
                <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                  {state.status === 'opening' ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <AppWindow className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Zora Studio (Nativo)
                  </p>
                  <h1 className="font-display text-foreground mt-0.5 truncate text-xl font-semibold">
                    {name}
                  </h1>
                  <p className="text-muted-foreground mt-0.5 text-xs">{sizeLabel}</p>
                </div>
              </div>

              <div className="bg-muted text-foreground mt-5 flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm">
                {state.status === 'opening' ? (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                ) : state.status === 'running' && !dirty && lastSavedNumber !== null ? (
                  <CheckCircle2 className="text-brand size-4 shrink-0" />
                ) : (
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      state.status === 'closed'
                        ? 'bg-muted-foreground/50'
                        : dirty
                          ? 'bg-amber-500'
                          : 'bg-primary',
                    )}
                  />
                )}
                <span>{statusText}</span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {state.status === 'closed' ? (
                  <Button type="button" onClick={requestLaunch}>
                    <RotateCw className="size-4" />
                    Abrir novamente
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={state.status === 'opening'}
                    onClick={() => void handleFocus()}
                  >
                    <ExternalLink className="size-4" />
                    Trazer janela para frente
                  </Button>
                )}
                <BackToItemButton />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sair sem salvar?</DialogTitle>
            <DialogDescription>
              O design tem alterações que ainda não foram salvas no Zora. Se sair agora, elas se
              perdem.
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

function DesignNotFound() {
  return (
    <div className={PAGE_PADDING}>
      <BackToItem className="mb-6" />
      <PageHeader
        title="Design não encontrado"
        description="Ele pode ter sido excluído, ou o link está errado."
      />
    </div>
  )
}
