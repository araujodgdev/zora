import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  Clock,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { LocalDateTime } from '@/components/local-date-time'
import { Button } from '@/components/ui/button'
import {
  formatCompactNumber,
  formatLeadTime,
  formatPercent,
} from '@/lib/analytics'
import { formatWatchTimeSeconds } from '@/lib/analytics-signals'
import { itemAnalyticsQueryOptions, useSyncItemMetrics } from '@/lib/analytics.queries'
import { CHANNEL_LABELS } from '@/lib/content'
import type { ContentItem } from '@/lib/content'
import { useChangeContentItemStatus, useDeleteContentItem } from '@/lib/content.queries'
import { socialKeys } from '@/lib/social.queries'
import { cn } from '@/lib/utils'

/**
 * Compact analytics mini-card shown inside `/content/$itemId` once an item
 * has been published (or already has collected metrics). Keeps detail rich
 * without crowding the editor inspector.
 */
export function ItemAnalyticsCard({ item }: { item: ContentItem }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data } = useSuspenseQuery(itemAnalyticsQueryOptions(item.id))
  const sync = useSyncItemMetrics(item.id)
  const changeStatus = useChangeContentItemStatus()
  const deleteItem = useDeleteContentItem()

  if (item.status !== 'published' && !data.latest && !data.remoteDeletedAt) return null

  const latest = data.latest
  const channelAvg = data.editorial.channelAvgEngagementRate
  const aboveAvg =
    latest?.engagementRate != null && channelAvg != null && latest.engagementRate > channelAvg

  async function handleSync() {
    try {
      const result = await sync.mutateAsync()
      void queryClient.invalidateQueries({ queryKey: socialKeys.publishJobs(item.id) })
      if (result.snapshot) {
        toast.success('Métricas atualizadas!')
      } else if (result.warning) {
        toast.info(result.warning)
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível atualizar as métricas agora.',
      )
    }
  }

  async function handleBackToDraft() {
    try {
      await changeStatus.mutateAsync({ id: item.id, status: 'draft' })
      toast.success('Movido para rascunho.')
    } catch {
      // useChangeContentItemStatus already shows an error toast on failure.
    }
  }

  async function handleDeleteFromZora() {
    try {
      await deleteItem.mutateAsync({ id: item.id })
      toast.success('Item excluído do Zora.')
      await navigate({ to: '/content' })
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível excluir o item.',
      )
    }
  }

  return (
    <section
      aria-label="Desempenho do conteúdo"
      className="clay-panel bg-card space-y-3 rounded-xl p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="text-brand size-4" />
          <h3 className="text-sm font-semibold">Desempenho</h3>
        </div>
        {data.canSync ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={sync.isPending}
            onClick={() => void handleSync()}
          >
            {sync.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Atualizar
          </Button>
        ) : null}
      </div>

      {data.remoteDeletedAt ? (
        <div className="bg-destructive/10 space-y-2.5 rounded-lg p-3 text-xs">
          <div className="text-destructive flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Este post foi apagado no {CHANNEL_LABELS[item.channel]}. O Zora parou de buscar novas
              métricas dele.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {item.status === 'published' ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={changeStatus.isPending}
                onClick={() => void handleBackToDraft()}
              >
                Voltar para rascunho
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleteItem.isPending}
              onClick={() => void handleDeleteFromZora()}
            >
              <Trash2 className="size-3" />
              Excluir do Zora
            </Button>
          </div>
        </div>
      ) : null}

      {latest ? (
        <>
          {data.diagnosis ? (
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-xs',
                data.diagnosis.tone === 'positive' && 'bg-lime/15',
                data.diagnosis.tone === 'attention' && 'bg-destructive/12',
                data.diagnosis.tone === 'info' && 'bg-muted/55',
              )}
            >
              <p
                className={cn(
                  'font-semibold',
                  data.diagnosis.tone === 'positive' && 'text-brand',
                  data.diagnosis.tone === 'attention' && 'text-destructive',
                )}
              >
                {data.diagnosis.badge}
              </p>
              <p className="text-muted-foreground mt-0.5 leading-relaxed">
                {data.diagnosis.summary}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {latest.views != null ? (
              <StatTile
                icon={<Eye className="size-3.5" />}
                label="Visualizações"
                value={formatCompactNumber(latest.views)}
                delta={data.growth?.views}
              />
            ) : null}
            {latest.likes != null ? (
              <StatTile
                icon={<Heart className="size-3.5" />}
                label="Curtidas"
                value={formatCompactNumber(latest.likes)}
                delta={data.growth?.likes}
              />
            ) : null}
            {latest.comments != null ? (
              <StatTile
                icon={<MessageCircle className="size-3.5" />}
                label="Comentários"
                value={formatCompactNumber(latest.comments)}
                delta={data.growth?.comments}
              />
            ) : null}
            {latest.shares != null ? (
              <StatTile
                icon={<Share2 className="size-3.5" />}
                label="Compart."
                value={formatCompactNumber(latest.shares)}
                delta={data.growth?.shares}
              />
            ) : null}
            {latest.saves != null ? (
              <StatTile
                icon={<Bookmark className="size-3.5" />}
                label="Salvos"
                value={formatCompactNumber(latest.saves)}
              />
            ) : null}
            {latest.avgWatchTimeMs != null && latest.avgWatchTimeMs > 0 ? (
              <StatTile
                icon={<Clock className="size-3.5" />}
                label="Tempo médio"
                value={formatWatchTimeSeconds(latest.avgWatchTimeMs)}
              />
            ) : null}
          </div>

          {data.signals.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[11px] font-medium">
                Sinais principais no {CHANNEL_LABELS[item.channel]}
              </p>
              {data.signals.slice(0, 3).map((signal) => (
                <div
                  key={signal.id}
                  className="bg-muted/45 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">{signal.label}</span>
                    <span
                      className={cn(
                        'font-semibold',
                        signal.strength === 'strong' && 'text-brand',
                      )}
                    >
                      {signal.formattedValue}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    {signal.explanation}
                  </p>
                </div>
              ))}
            </div>
          ) : latest.engagementRate != null ? (
            <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2 text-xs">
              <span className="text-muted-foreground">Taxa de engajamento</span>
              <span className={cn('font-semibold', aboveAvg && 'text-brand')}>
                {formatPercent(latest.engagementRate)}
                {channelAvg != null ? (
                  <span className="text-muted-foreground ml-1 font-normal">
                    (média {CHANNEL_LABELS[item.channel]}: {formatPercent(channelAvg)})
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          <p className="text-muted-foreground text-[11px]">
            Última coleta: <LocalDateTime value={latest.collectedAt} />
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {data.canSync
            ? 'Ainda não há métricas coletadas. Clique em Atualizar ou aguarde a próxima coleta automática.'
            : 'Métricas de alcance e curtidas aparecem aqui para posts publicados por contas conectadas no Zora.'}
        </p>
      )}

      <div className="border-border/60 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px]">
        <span>
          Ciclo editorial: <strong className="text-foreground">{formatLeadTime(data.editorial.leadTimeHours)}</strong>
        </span>
        <Link
          to="/analytics"
          search={{ period: '30d', channel: item.channel }}
          className="text-brand font-medium hover:underline"
        >
          Ver no Analytics
        </Link>
      </div>
    </section>
  )
}

function StatTile({
  icon,
  label,
  value,
  delta,
}: {
  icon: React.ReactNode
  label: string
  value: string
  delta?: number | null
}) {
  return (
    <div className="bg-muted/45 rounded-lg px-2.5 py-2">
      <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold">{value}</span>
        {delta != null && delta > 0 ? (
          <span className="text-brand text-[10px] font-medium">
            +{formatCompactNumber(delta)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
