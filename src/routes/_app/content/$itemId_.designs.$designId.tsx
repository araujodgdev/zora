import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound, useBlocker } from '@tanstack/react-router'
import { ArrowLeft, MonitorSmartphone, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { editItemSearchSchema } from '@/lib/editor-search'
import { loadQuery } from '@/lib/route-query'
import { STUDIO_BUNDLE, parseStudioMessage, studioEditorUrl } from '@/lib/studio-hosting'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * The design editor: Zora Studio, embedded from `/studio/` (served from R2,
 * same origin; see `@/lib/studio-hosting`), filling the whole area right of
 * the sidebar with no Zora header (`staticData.fullBleed`, see AppShell).
 * Studio shows the design's name and save state, saves versions itself
 * (`POST /api/designs/<id>/versions`) and posts
 * `zora-studio:ready|dirty|saved|back` to this page, which refreshes the
 * design queries on a save, returns to the item on `back`, and warns before
 * leaving with unsaved changes. Phones get a message instead: the editor
 * needs a larger screen.
 */
export const Route = createFileRoute('/_app/content/$itemId_/designs/$designId')({
  // `from` is the item editor's origin, kept for the way back.
  validateSearch: editItemSearchSchema,
  // Whether this is a phone is only known in the browser.
  ssr: 'data-only',
  // No shell padding: Studio fills the page.
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

/** Whether Studio answers at `/studio/` (it is published to R2 separately). */
type StudioAvailability = 'checking' | 'available' | 'missing' | 'signed-out' | 'error'

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

function DesignEditorPage() {
  const { itemId, designId } = Route.useParams()
  const { data: designs } = useSuspenseQuery(contentDesignsQueryOptions(itemId))
  const design = designs.find((entry) => entry.id === designId)
  // iPad portrait (820 px) and up; phones get a message.
  const largeEnough = useMediaQuery('(min-width: 768px)', true)

  if (!design) return <DesignNotFound />
  if (!largeEnough) {
    return (
      <div className={PAGE_PADDING}>
        <BackToItem className="mb-6" />
        <PageHeader title={design.name} description={formatDesignSize(design.widthPx, design.heightPx)} />
        <Alert>
          <MonitorSmartphone />
          <AlertTitle>O editor precisa de uma tela maior</AlertTitle>
          <AlertDescription>
            Abra este design num tablet ou computador para editá-lo. Daqui você ainda vê as
            prévias e as versões na página do item.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  return <DesignEditor key={design.id} name={design.name} />
}

function DesignEditor({ name }: { name: string }) {
  const { itemId, designId } = Route.useParams()
  const { from } = Route.useSearch()
  const navigate = Route.useNavigate()
  const initialTheme = Route.useRouteContext({ select: (context) => context.theme })
  const theme = useTheme(initialTheme)
  // The theme Studio opens with; a later switch must not reload the editor
  // (and lose unsaved work), so the URL is fixed for this page's life.
  const [src] = useState(() => studioEditorUrl(designId, theme))
  const [availability, setAvailability] = useState<StudioAvailability>('checking')
  // Whether Studio last reported unsaved changes (it shows the state itself).
  const [dirty, setDirty] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const queryClient = useQueryClient()

  // Probe Studio before loading it, so a missing build shows an explanation
  // instead of a 404 page inside the frame.
  useEffect(() => {
    const controller = new AbortController()
    fetch(STUDIO_BUNDLE.urlPrefix, {
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

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only Studio, in this page's frame, on Zora's own origin.
      if (event.origin !== window.location.origin) return
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const message = parseStudioMessage(event.data, designId)
      if (!message) return
      switch (message.type) {
        case 'zora-studio:ready':
          setDirty(false)
          break
        case 'zora-studio:dirty':
          setDirty(message.dirty)
          break
        case 'zora-studio:saved':
          setDirty(false)
          void queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) })
          void queryClient.invalidateQueries({ queryKey: contentKeys.designVersions(designId) })
          break
        case 'zora-studio:back':
          // The blocker below asks first when Studio reported unsaved changes.
          void navigate({ to: '/content/$itemId', params: { itemId }, search: { from } })
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [designId, itemId, from, navigate, queryClient])

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  return (
    // Full bleed (`staticData.fullBleed`): Studio fills the area right of the
    // sidebar (below the top bar under `lg`), exactly `--page-h` high.
    <div className="bg-background h-(--page-h) w-full overflow-hidden">
      {availability === 'available' ? (
        <iframe
          ref={frameRef}
          src={src}
          title={`Zora Studio: ${name}`}
          // Same origin on purpose (session, saves); Studio disables its
          // plug-ins and scripts when embedded.
          allow="clipboard-read; clipboard-write; fullscreen"
          className="block size-full border-0"
        />
      ) : (
        <StudioUnavailable availability={availability} />
      )}

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

function StudioUnavailable({ availability }: { availability: StudioAvailability }) {
  if (availability === 'checking') {
    return (
      <p className="text-muted-foreground flex size-full items-center justify-center text-sm">
        Procurando o Zora Studio…
      </p>
    )
  }
  // Studio (with its own "Voltar ao item") is not there, so the page keeps a link.
  const [title, description] =
    availability === 'missing'
      ? [
          'O Zora Studio ainda não foi publicado aqui',
          <>
            Os arquivos do editor não estão no armazenamento deste ambiente. Quem cuida do Zora
            precisa publicá-los com <code className="font-mono">pnpm studio:publish</code> (veja o
            AGENTS.md) e depois recarregar esta página.
          </>,
        ]
      : availability === 'signed-out'
        ? ['Sua sessão terminou', 'Entre de novo no Zora e abra o design outra vez.']
        : ['Não foi possível abrir o Zora Studio', 'Verifique a conexão e recarregue a página.']
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
