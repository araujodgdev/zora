import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { AnalyticsBreakdown } from '@/components/analytics/analytics-breakdown'
import { AnalyticsCadenceChart } from '@/components/analytics/analytics-cadence-chart'
import { AnalyticsChannelSpotlight } from '@/components/analytics/analytics-channel-spotlight'
import { AnalyticsInsights } from '@/components/analytics/analytics-insights'
import { AnalyticsKpiStrip } from '@/components/analytics/analytics-kpis'
import { AnalyticsOperations } from '@/components/analytics/analytics-operations'
import { AnalyticsTopContent } from '@/components/analytics/analytics-top-content'
import { LocalDateTime } from '@/components/local-date-time'
import { Button } from '@/components/ui/button'
import {
  ANALYTICS_PERIODS,
  ANALYTICS_PERIOD_LABELS,
  analyticsSearchSchema,
} from '@/lib/analytics'
import type { AnalyticsPeriod } from '@/lib/analytics'
import {
  useSyncWorkspaceMetrics,
  workspaceAnalyticsQueryOptions,
} from '@/lib/analytics.queries'
import { CHANNELS, CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import { loadQuery } from '@/lib/route-query'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/analytics')({
  validateSearch: analyticsSearchSchema,
  loaderDeps: ({ search }) => ({
    period: search.period,
    channel: search.channel,
  }),
  loader: ({ context, deps }) =>
    loadQuery(
      context.queryClient,
      workspaceAnalyticsQueryOptions({
        period: deps.period,
        channel: deps.channel,
      }),
    ),
  head: () => ({ meta: [{ title: 'Analytics · Zora' }] }),
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/analytics' })
  const filters = { period: search.period, channel: search.channel }
  const { data } = useSuspenseQuery(workspaceAnalyticsQueryOptions(filters))
  const sync = useSyncWorkspaceMetrics()

  function setPeriod(period: AnalyticsPeriod) {
    void navigate({
      search: (prev) => ({ ...prev, period }),
      replace: true,
    })
  }

  function setChannel(channel: Channel | undefined) {
    void navigate({
      search: (prev) => ({ ...prev, channel }),
      replace: true,
    })
  }

  async function handleSync() {
    try {
      const result = await sync.mutateAsync()
      if (result.imported > 0 && result.updated > 0) {
        toast.success(
          `${result.imported === 1 ? '1 post recente importado' : `${result.imported} posts recentes importados`} e métricas atualizadas.`,
        )
      } else if (result.imported > 0) {
        toast.success(
          result.imported === 1
            ? '1 post recente importado da sua conta conectada.'
            : `${result.imported} posts recentes importados das suas contas conectadas.`,
        )
      } else if (result.updated > 0) {
        toast.success(
          result.updated === 1
            ? 'Métricas de 1 publicação atualizadas.'
            : `Métricas de ${result.updated} publicações atualizadas.`,
        )
      } else if (result.warnings.length > 0) {
        toast.info(result.warnings[0])
      } else {
        toast.info('Nenhuma publicação elegível encontrada para atualizar agora.')
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível atualizar as métricas agora.',
      )
    }
  }

  const hasSocialConnections = data.connectedSocialChannels.length > 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <PageHeader
          title="Analytics"
          description="Veja como seu conteúdo está indo nas redes e no calendário."
          className="mb-0"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="bg-card inline-flex rounded-xl p-1"
            role="tablist"
            aria-label="Período"
          >
            {ANALYTICS_PERIODS.map((period) => {
              const active = search.period === period
              return (
                <button
                  key={period}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPeriod(period)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-lime text-ink font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ANALYTICS_PERIOD_LABELS[period]}
                </button>
              )
            })}
          </div>

          {hasSocialConnections ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sync.isPending}
              onClick={() => void handleSync()}
            >
              {sync.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Atualizar métricas
            </Button>
          ) : null}
        </div>
      </div>

      {/* Quick channel filter pills + last sync timestamp */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={!search.channel}
            onClick={() => setChannel(undefined)}
            label="Todos os canais"
          />
          {CHANNELS.map((ch) => (
            <FilterChip
              key={ch}
              active={search.channel === ch}
              onClick={() => setChannel(search.channel === ch ? undefined : ch)}
              label={CHANNEL_LABELS[ch]}
            />
          ))}
        </div>

        {data.kpis.lastSyncedAt ? (
          <span className="text-muted-foreground text-xs">
            Última coleta social: <LocalDateTime value={data.kpis.lastSyncedAt} />
          </span>
        ) : null}
      </div>

      {/* Layer 1: Hero KPIs + Compact notices + Platform-native signals (when a channel has data) */}
      <AnalyticsKpiStrip kpis={data.kpis} />
      <AnalyticsInsights insights={data.insights} />
      <AnalyticsChannelSpotlight spotlight={data.channelSpotlight} />

      {/* Layer 2: Interactive cadence & traction chart + Channel/Pipeline/Format breakdown */}
      <AnalyticsCadenceChart
        buckets={data.cadence}
        hasSocialData={data.kpis.trackedPostsCount > 0}
      />
      <AnalyticsBreakdown
        channels={data.channels}
        formats={data.formats}
        pipeline={data.pipeline}
        selectedChannel={data.channel}
        onSelectChannel={setChannel}
      />

      {/* Layer 3: Detailed top content + Progressive-disclosure operational details */}
      <AnalyticsTopContent items={data.topContent} />
      <AnalyticsOperations
        weekdayRhythm={data.weekdayRhythm}
        team={data.team}
        collaboration={data.collaboration}
        recentFailures={data.recentFailures}
      />
    </div>
  )
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'clay-chip-on bg-secondary text-secondary-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
