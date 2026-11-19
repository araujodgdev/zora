import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import { ChannelBadge } from '@/components/content/channel-badge'
import { LocalDateTime } from '@/components/local-date-time'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel, ContentItem } from '@/lib/content'
import { contentAssetsQueryOptions } from '@/lib/content.queries'
import {
  LINKEDIN_VISIBILITIES,
  LINKEDIN_VISIBILITY_LABELS,
  SOCIAL_PUBLISH_STATUS_LABELS,
  TIKTOK_PRIVACY_LABELS,
  TIKTOK_PRIVACY_LEVELS,
  YOUTUBE_PRIVACY_LABELS,
  YOUTUBE_PRIVACY_STATUSES,
  isSocialChannel,
  splitXThread,
  validateItemForSocialPublish,
} from '@/lib/social'
import type {
  LinkedInVisibility,
  SocialPublishOptions,
  TikTokPrivacyLevel,
  TikTokPublishMode,
  YouTubePrivacyStatus,
} from '@/lib/social'
import {
  itemPublishJobsQueryOptions,
  socialConnectionsQueryOptions,
  usePollPublishJob,
  usePublishContentItem,
} from '@/lib/social.queries'

const JOB_POLL_INTERVAL_MS = 6000
const YOUTUBE_THUMB_MAX_BYTES = 2 * 1024 * 1024

const selectClassName =
  'border-input bg-input/30 hover:bg-input/50 h-9 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function submitOnly(handler: () => void) {
  return (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    handler()
  }
}

/**
 * Social publishing controls and live status for one content item, shown in
 * the inspector panel of `/content/$itemId`. Hidden for non-social channels
 * (`blog`).
 */
export function ContentPublish({
  item,
  currentChannel,
  isDirty,
  onPublished,
}: {
  item: ContentItem
  /** The channel currently selected in the form (may differ from saved `item.channel`). */
  currentChannel: Channel
  isDirty: boolean
  onPublished: (updated: ContentItem) => void
}) {
  const { data: connState } = useSuspenseQuery(socialConnectionsQueryOptions())
  const { data: jobs } = useSuspenseQuery(itemPublishJobsQueryOptions(item.id))
  const { data: assets } = useSuspenseQuery(contentAssetsQueryOptions(item.id))
  const publish = usePublishContentItem(item.id)
  const pollJob = usePollPublishJob(item.id)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Channel-specific publish options in the confirmation dialog.
  const [tiktokMode, setTiktokMode] = useState<TikTokPublishMode>('direct')
  const [tiktokPrivacy, setTiktokPrivacy] = useState<TikTokPrivacyLevel>('PUBLIC_TO_EVERYONE')
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false)
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false)
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false)
  const [tiktokIsAigc, setTiktokIsAigc] = useState(false)

  const [youtubePrivacy, setYoutubePrivacy] = useState<YouTubePrivacyStatus>('public')
  const [youtubeKids, setYoutubeKids] = useState(false)
  const [youtubeNotify, setYoutubeNotify] = useState(true)
  const [youtubeThumb, setYoutubeThumb] = useState<string>('auto')

  const [linkedinVisibility, setLinkedinVisibility] = useState<LinkedInVisibility>('PUBLIC')

  const latestJob = jobs[0] ?? null
  const processingJob = jobs.find((job) => job.status === 'processing') ?? null

  // Poll the active async job while the page stays open.
  useEffect(() => {
    if (!processingJob) return
    let cancelled = false
    let inFlight = false

    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const result = await pollJob.mutateAsync(processingJob.id)
        if (cancelled) return
        if (result.job.status === 'published') {
          if (result.item) onPublished(result.item)
          toast.success(
            result.job.providerState.note ??
              `Publicado no ${CHANNEL_LABELS[result.job.channel]}!`,
          )
        } else if (result.job.status === 'failed') {
          toast.error(result.job.errorMessage ?? 'A publicação falhou na rede social.')
        }
      } catch {
        // Retry on the next interval; the Cron Trigger also polls in the background.
      } finally {
        inFlight = false
      }
    }

    const timer = window.setInterval(() => void tick(), JOB_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingJob?.id])

  if (!isSocialChannel(currentChannel)) return null

  const connection =
    connState.connections.find((entry) => entry.channel === item.channel) ?? null
  const connected = connection?.status === 'connected'
  const preflight = validateItemForSocialPublish(item, assets)
  const eligibleThumbs = assets.filter(
    (asset) =>
      (asset.contentType === 'image/jpeg' || asset.contentType === 'image/png') &&
      asset.size <= YOUTUBE_THUMB_MAX_BYTES,
  )

  function buildOptions(): SocialPublishOptions {
    if (item.channel === 'tiktok') {
      return {
        tiktok: {
          mode: tiktokMode,
          privacyLevel: tiktokMode === 'direct' ? tiktokPrivacy : undefined,
          disableComment: tiktokDisableComment,
          disableDuet: tiktokDisableDuet,
          disableStitch: tiktokDisableStitch,
          isAigc: tiktokIsAigc,
        },
      }
    }
    if (item.channel === 'youtube') {
      return {
        youtube: {
          privacyStatus: youtubePrivacy,
          selfDeclaredMadeForKids: youtubeKids,
          notifySubscribers: youtubeNotify,
          thumbnailAssetId:
            youtubeThumb === 'auto'
              ? undefined
              : youtubeThumb === 'none'
                ? null
                : youtubeThumb,
        },
      }
    }
    if (item.channel === 'linkedin') {
      return { linkedin: { visibility: linkedinVisibility } }
    }
    return {}
  }

  async function confirmPublish() {
    setSubmitError(null)
    try {
      const result = await publish.mutateAsync(buildOptions())
      setDialogOpen(false)
      if (result.job.status === 'published') {
        if (result.item) onPublished(result.item)
        toast.success(
          result.job.providerState.note ?? `Publicado no ${CHANNEL_LABELS[item.channel]}!`,
        )
      } else if (result.job.status === 'processing') {
        toast.info('Envio iniciado! Acompanhando o processamento na rede social…')
      } else if (result.job.status === 'failed') {
        toast.error(result.job.errorMessage ?? 'A publicação falhou.')
      }
    } catch (error) {
      setSubmitError(errorMessage(error, 'Não foi possível iniciar a publicação.'))
    }
  }

  async function checkNow() {
    if (!processingJob) return
    try {
      const result = await pollJob.mutateAsync(processingJob.id)
      if (result.job.status === 'published') {
        if (result.item) onPublished(result.item)
        toast.success(
          result.job.providerState.note ?? `Publicado no ${CHANNEL_LABELS[result.job.channel]}!`,
        )
      } else if (result.job.status === 'failed') {
        toast.error(result.job.errorMessage ?? 'A publicação falhou.')
      } else {
        toast.info(result.job.stage)
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível verificar o status agora.'))
    }
  }

  const channelChangedUnsaved = currentChannel !== item.channel

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Publicação</span>
        {connected ? (
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span aria-hidden="true" className="bg-status-published size-1.5 shrink-0 rounded-full" />
            <span className="truncate">{connection.accountName ?? 'Conectado'}</span>
          </span>
        ) : null}
      </div>

      {!connState.configured ? (
        <p className="text-muted-foreground text-xs">
          Publicação automática desativada.{' '}
          <Link to="/connections" className="text-foreground underline underline-offset-4">
            Ver conexões
          </Link>
        </p>
      ) : !connected ? (
        <Button type="button" variant="outline" size="sm" asChild className="justify-start">
          <Link to="/connections">
            <Link2 data-icon="inline-start" />
            Conectar {CHANNEL_LABELS[currentChannel]}
          </Link>
        </Button>
      ) : processingJob ? (
        <div className="bg-muted grid gap-2 rounded-lg p-3 text-xs">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            {processingJob.stage}
          </p>
          <p className="text-muted-foreground">
            Você pode sair desta página: o Zora finaliza automaticamente em segundo plano.
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pollJob.isPending}
            onClick={() => void checkNow()}
          >
            <RefreshCw data-icon="inline-start" />
            Verificar agora
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={publish.isPending}
          onClick={() => {
            setSubmitError(null)
            setDialogOpen(true)
          }}
        >
          <Send data-icon="inline-start" />
          {latestJob?.status === 'failed'
            ? 'Tentar publicar novamente'
            : item.status === 'published'
              ? 'Publicar novamente'
              : `Publicar no ${CHANNEL_LABELS[item.channel]}`}
        </Button>
      )}

      {latestJob && latestJob.status === 'failed' && !processingJob ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            {latestJob.errorMessage ?? 'A última tentativa de publicação falhou.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {latestJob && latestJob.status === 'published' ? (
        <div className="bg-muted grid gap-1 rounded-lg px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="text-brand size-3.5 shrink-0" />
            {SOCIAL_PUBLISH_STATUS_LABELS[latestJob.status]}
            {latestJob.finishedAt ? (
              <span className="text-muted-foreground font-normal">
                · <LocalDateTime value={latestJob.finishedAt} />
              </span>
            ) : null}
          </p>
          {latestJob.providerState.note ? (
            <p className="text-muted-foreground">{latestJob.providerState.note}</p>
          ) : null}
          {latestJob.publishedUrl ? (
            <a
              href={latestJob.publishedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand inline-flex items-center gap-1 underline underline-offset-4"
            >
              Abrir publicação
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      {item.status === 'scheduled' && connected ? (
        <p className="text-muted-foreground text-xs">
          Este item será publicado automaticamente no horário agendado.
        </p>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form noValidate className="grid gap-4" onSubmit={submitOnly(() => void confirmPublish())}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Publicar agora
                <ChannelBadge channel={item.channel} />
              </DialogTitle>
              <DialogDescription>
                Será enviado para{' '}
                <strong>{connection?.accountName ?? CHANNEL_LABELS[item.channel]}</strong> usando o
                conteúdo salvo do item.
              </DialogDescription>
            </DialogHeader>

            {isDirty || channelChangedUnsaved ? (
              <Alert>
                <AlertDescription className="text-xs">
                  Você tem alterações não salvas no editor. Salve antes se quiser publicar o texto
                  ou canal atualizado.
                </AlertDescription>
              </Alert>
            ) : null}

            {preflight.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription className="grid gap-1 text-xs">
                  {preflight.errors.map((err) => (
                    <span key={err}>{err}</span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {preflight.warnings.length > 0 ? (
              <Alert>
                <AlertDescription className="grid gap-1 text-xs">
                  {preflight.warnings.map((warn) => (
                    <span key={warn}>{warn}</span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {item.channel === 'x' && item.format === 'thread' && preflight.errors.length === 0 ? (
              <p className="bg-muted rounded-lg px-3 py-2 text-xs">
                Thread detectada: <strong>{splitXThread(item.body).length} tweets</strong> serão
                publicados em sequência (separados por <code>---</code>).
              </p>
            ) : null}

            {item.channel === 'tiktok' ? (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="publish-tiktok-mode">Modo de envio</Label>
                  <select
                    id="publish-tiktok-mode"
                    className={selectClassName}
                    value={tiktokMode}
                    onChange={(event) => setTiktokMode(event.target.value as TikTokPublishMode)}
                  >
                    <option value="direct">Publicar direto no perfil</option>
                    <option value="inbox">Enviar rascunho para o Inbox do TikTok</option>
                  </select>
                </div>
                {tiktokMode === 'direct' ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="publish-tiktok-privacy">Privacidade</Label>
                      <select
                        id="publish-tiktok-privacy"
                        className={selectClassName}
                        value={tiktokPrivacy}
                        onChange={(event) =>
                          setTiktokPrivacy(event.target.value as TikTokPrivacyLevel)
                        }
                      >
                        {TIKTOK_PRIVACY_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {TIKTOK_PRIVACY_LABELS[level]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2 text-xs">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={tiktokDisableComment}
                          onCheckedChange={(checked) => setTiktokDisableComment(checked === true)}
                        />
                        Desativar comentários
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={tiktokDisableDuet}
                          onCheckedChange={(checked) => setTiktokDisableDuet(checked === true)}
                        />
                        Desativar Dueto
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={tiktokDisableStitch}
                          onCheckedChange={(checked) => setTiktokDisableStitch(checked === true)}
                        />
                        Desativar Costura (Stitch)
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={tiktokIsAigc}
                          onCheckedChange={(checked) => setTiktokIsAigc(checked === true)}
                        />
                        Conteúdo gerado por IA (AIGC)
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    O vídeo chega no Inbox do app do TikTok para você revisar legenda/música e
                    publicar manualmente em até 24 horas.
                  </p>
                )}
              </div>
            ) : null}

            {item.channel === 'youtube' ? (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="publish-yt-privacy">Visibilidade</Label>
                  <select
                    id="publish-yt-privacy"
                    className={selectClassName}
                    value={youtubePrivacy}
                    onChange={(event) =>
                      setYoutubePrivacy(event.target.value as YouTubePrivacyStatus)
                    }
                  >
                    {YOUTUBE_PRIVACY_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {YOUTUBE_PRIVACY_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
                {eligibleThumbs.length > 0 ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="publish-yt-thumb">Thumbnail (até 2 MB)</Label>
                    <select
                      id="publish-yt-thumb"
                      className={selectClassName}
                      value={youtubeThumb}
                      onChange={(event) => setYoutubeThumb(event.target.value)}
                    >
                      <option value="auto">Automática ({eligibleThumbs[0]!.filename})</option>
                      {eligibleThumbs.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                        </option>
                      ))}
                      <option value="none">Não enviar thumbnail</option>
                    </select>
                  </div>
                ) : null}
                <div className="grid gap-2 text-xs">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={youtubeKids}
                      onCheckedChange={(checked) => setYoutubeKids(checked === true)}
                    />
                    Conteúdo feito para crianças
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={youtubeNotify}
                      onCheckedChange={(checked) => setYoutubeNotify(checked === true)}
                    />
                    Notificar inscritos do canal
                  </label>
                </div>
              </div>
            ) : null}

            {item.channel === 'linkedin' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="publish-li-visibility">Visibilidade</Label>
                <select
                  id="publish-li-visibility"
                  className={selectClassName}
                  value={linkedinVisibility}
                  onChange={(event) =>
                    setLinkedinVisibility(event.target.value as LinkedInVisibility)
                  }
                >
                  {LINKEDIN_VISIBILITIES.map((vis) => (
                    <option key={vis} value={vis}>
                      {LINKEDIN_VISIBILITY_LABELS[vis]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {submitError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="text-xs">{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={publish.isPending || preflight.errors.length > 0 || channelChangedUnsaved}
              >
                {publish.isPending ? (
                  <>
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                    Publicando…
                  </>
                ) : (
                  <>
                    <Send data-icon="inline-start" />
                    Publicar agora
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
