import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  ExternalLink,
  Link2,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Unlink,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { ChannelIconTile } from '@/components/content/channel-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { CHANNEL_LABELS } from '@/lib/content'
import { loadQuery } from '@/lib/route-query'
import {
  SOCIAL_CHANNELS,
  SOCIAL_CHANNEL_INFO,
  SOCIAL_CONNECTION_STATUS_LABELS,
} from '@/lib/social'
import type { SocialChannel, SocialConnection, SocialResourceOption } from '@/lib/social'
import {
  socialConnectionsQueryOptions,
  socialResourcesQueryOptions,
  useDisconnectSocialConnection,
  usePollSocialConnection,
  useSelectSocialResource,
  useStartSocialConnection,
  useSyncSocialConnections,
} from '@/lib/social.queries'

const OAUTH_POLL_INTERVAL_MS = 2500

export const Route = createFileRoute('/_app/connections')({
  loader: ({ context }) =>
    loadQuery(context.queryClient, socialConnectionsQueryOptions()),
  head: () => ({ meta: [{ title: 'Conexões · Zora' }] }),
  component: ConnectionsPage,
})

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ConnectionsPage() {
  const { workspace } = Route.useRouteContext()
  const { data } = useSuspenseQuery(socialConnectionsQueryOptions())
  const sync = useSyncSocialConnections()
  const byChannel = new Map(data.connections.map((conn) => [conn.channel, conn]))

  function refreshAll() {
    sync.mutate(undefined, {
      onSuccess: () => toast.success('Status das conexões atualizado.'),
      onError: (error) =>
        toast.error(errorMessage(error, 'Não foi possível atualizar as conexões.')),
    })
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Conexões"
          description={`Contas conectadas em ${workspace.name}. Uma conta por rede para publicação imediata e agendada.`}
          className="mb-6"
        />
        {data.configured && data.connections.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            disabled={sync.isPending}
            onClick={refreshAll}
          >
            <RefreshCw
              data-icon="inline-start"
              className={sync.isPending ? 'animate-spin' : undefined}
            />
            {sync.isPending ? 'Verificando…' : 'Atualizar status'}
          </Button>
        ) : null}
      </div>

      {!data.configured ? (
        <Alert className="mb-6">
          <AlertCircle className="size-4" />
          <AlertDescription>
            A publicação em redes sociais ainda não está ativa neste servidor. Avise o administrador
            do Zora para habilitar a integração.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {SOCIAL_CHANNELS.map((channel) => (
          <ChannelConnectionCard
            key={channel}
            channel={channel}
            configured={data.configured}
            connection={byChannel.get(channel) ?? null}
          />
        ))}
      </div>
    </div>
  )
}

function ChannelConnectionCard({
  channel,
  configured,
  connection,
}: {
  channel: SocialChannel
  configured: boolean
  connection: SocialConnection | null
}) {
  const info = SOCIAL_CHANNEL_INFO[channel]
  const start = useStartSocialConnection()
  const poll = usePollSocialConnection()
  const disconnect = useDisconnectSocialConnection()
  const selectResource = useSelectSocialResource()

  const popupRef = useRef<Window | null>(null)
  const [consentUrl, setConsentUrl] = useState<string | null>(null)
  const [pickingResource, setPickingResource] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [initialResources, setInitialResources] = useState<Array<SocialResourceOption> | null>(null)

  const isConnected = connection?.status === 'connected'
  const isPending = connection?.status === 'pending'
  const isError = connection?.status === 'error'
  const needsResource = connection?.status === 'needs_resource'
  const showPicker = needsResource || pickingResource

  const resourcesQuery = useQuery({
    ...socialResourcesQueryOptions(channel),
    enabled: showPicker && connection?.externalSecretId != null && initialResources === null,
  })
  const resources = initialResources ?? resourcesQuery.data ?? []

  // Poll treg while an OAuth flow is waiting for the user's consent in the popup.
  useEffect(() => {
    if (!isPending || !configured) return
    let cancelled = false
    let inFlight = false

    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const result = await poll.mutateAsync(channel)
        if (cancelled) return
        if (result.done) {
          popupRef.current?.close()
          popupRef.current = null
          setConsentUrl(null)
          if (result.connection.status === 'connected') {
            toast.success(`${CHANNEL_LABELS[channel]} conectado com sucesso.`)
          } else if (result.connection.status === 'needs_resource') {
            if (result.resources) setInitialResources(result.resources)
            toast.info(`Escolha o canal de ${CHANNEL_LABELS[channel]} para finalizar.`)
          } else if (result.connection.status === 'error') {
            toast.error(
              result.connection.accountMeta.lastError ??
                `Não foi possível concluir a conexão com ${CHANNEL_LABELS[channel]}.`,
            )
          }
        }
      } catch {
        // Keep polling on transient network hiccups; user can also cancel.
      } finally {
        inFlight = false
      }
    }

    const timer = window.setInterval(() => void tick(), OAUTH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, configured, channel])

  function openPopup(url: string) {
    const width = 620
    const height = 740
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(
      url,
      `zora-oauth-${channel}`,
      `width=${width},height=${height},left=${left},top=${top},noopener=no`,
    )
    popupRef.current = popup
    if (!popup) {
      toast.info('O navegador bloqueou o popup. Use o botão “Reabrir” no card.')
    }
  }

  async function handleConnect() {
    setInitialResources(null)
    setPickingResource(false)
    try {
      const started = await start.mutateAsync({ channel })
      setConsentUrl(started.consentUrl)
      openPopup(started.consentUrl)
    } catch (error) {
      toast.error(
        errorMessage(error, `Não foi possível iniciar a conexão com ${CHANNEL_LABELS[channel]}.`),
      )
    }
  }

  async function handleSelectResource(option: SocialResourceOption) {
    try {
      await selectResource.mutateAsync({
        channel,
        resourceRef: option.id,
        resourceName: option.name,
      })
      setInitialResources(null)
      setPickingResource(false)
      toast.success(`Canal “${option.name}” selecionado.`)
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível selecionar o canal.'))
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync(channel)
      popupRef.current?.close()
      popupRef.current = null
      setConsentUrl(null)
      setPickingResource(false)
      setConfirmDisconnect(false)
      toast.success(`${CHANNEL_LABELS[channel]} desconectado.`)
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível desconectar a conta.'))
    }
  }

  const accountLabel = connection?.accountName ?? connection?.accountId

  return (
    <Card size="sm" className="gap-3 p-4">
      <div className="flex items-start gap-3">
        <ChannelIconTile channel={channel} />

        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{CHANNEL_LABELS[channel]}</h2>
          </div>

          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            {isConnected ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-status-published size-1.5 shrink-0 rounded-full"
                />
                <span className="text-foreground truncate font-medium">
                  {accountLabel ?? SOCIAL_CONNECTION_STATUS_LABELS.connected}
                </span>
              </>
            ) : isPending ? (
              <>
                <Loader2 className="size-3 shrink-0 animate-spin" />
                <span className="truncate">{SOCIAL_CONNECTION_STATUS_LABELS.pending}</span>
              </>
            ) : isError ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-destructive size-1.5 shrink-0 rounded-full"
                />
                <span className="text-destructive truncate">
                  {SOCIAL_CONNECTION_STATUS_LABELS.error}
                </span>
              </>
            ) : needsResource ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-status-draft size-1.5 shrink-0 rounded-full"
                />
                <span className="truncate">{SOCIAL_CONNECTION_STATUS_LABELS.needs_resource}</span>
              </>
            ) : (
              <span>Não conectado</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isConnected ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Ações de ${CHANNEL_LABELS[channel]}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {info.supportsResourcePicker ? (
                  <DropdownMenuItem
                    disabled={!configured}
                    onSelect={() => {
                      setInitialResources(null)
                      setPickingResource((open) => !open)
                    }}
                  >
                    <SlidersHorizontal />
                    Trocar canal
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={!configured || start.isPending}
                  onSelect={() => void handleConnect()}
                >
                  <RefreshCw />
                  Reconectar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={disconnect.isPending}
                  onSelect={() => setConfirmDisconnect(true)}
                >
                  <Unlink />
                  Desconectar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : isPending ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disconnect.isPending}
              onClick={() => void handleDisconnect()}
            >
              Cancelar
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={isError ? 'secondary' : 'outline'}
              disabled={!configured || start.isPending}
              onClick={() => void handleConnect()}
            >
              <Link2 data-icon="inline-start" />
              {start.isPending ? 'Abrindo…' : isError ? 'Reconectar' : 'Conectar'}
            </Button>
          )}
        </div>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">{info.summary}</p>

      {isPending ? (
        <div className="bg-muted flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Conclua o login na janela aberta para ativar.
          </span>
          {consentUrl ? (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => openPopup(consentUrl)}
            >
              <ExternalLink data-icon="inline-start" />
              Reabrir
            </Button>
          ) : null}
        </div>
      ) : null}

      {connection?.accountMeta.lastError ? (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-xs">{connection.accountMeta.lastError}</AlertDescription>
        </Alert>
      ) : null}

      {connection?.accountMeta.reviewNote ? (
        <Alert className="py-2">
          <AlertDescription className="text-xs">{connection.accountMeta.reviewNote}</AlertDescription>
        </Alert>
      ) : null}

      {showPicker ? (
        <div className="bg-muted grid gap-2 rounded-lg p-2.5">
          <p className="text-xs font-medium">
            Escolha o canal de {CHANNEL_LABELS[channel]}:
          </p>
          {resourcesQuery.isPending ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Carregando canais…
            </p>
          ) : resourcesQuery.isError ? (
            <p className="text-destructive text-xs">
              {errorMessage(resourcesQuery.error, 'Não foi possível listar os canais.')}
            </p>
          ) : resources.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nenhum canal encontrado nesta conta.
            </p>
          ) : (
            <ul className="grid gap-1">
              {resources.map((option) => (
                <li key={option.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs">{option.name}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant={option.id === connection?.accountId ? 'secondary' : 'outline'}
                    disabled={selectResource.isPending}
                    onClick={() => void handleSelectResource(option)}
                  >
                    {option.id === connection?.accountId ? 'Ativo' : 'Usar'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <p className="text-muted-foreground/75 border-border/60 mt-auto border-t pt-2.5 text-[0.6875rem] leading-snug">
        {info.caveat}
      </p>

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar {CHANNEL_LABELS[channel]}?</DialogTitle>
            <DialogDescription>
              A conta {accountLabel ? `“${accountLabel}”` : ''} será removida deste workspace.
              Itens agendados nesse canal deixarão de ser publicados automaticamente até outra conta
              ser conectada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(false)}>
              Manter
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={() => void handleDisconnect()}
            >
              {disconnect.isPending ? 'Desconectando…' : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
