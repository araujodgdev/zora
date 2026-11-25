import { Link } from '@tanstack/react-router'
import { ChannelBadge } from '@/components/content/channel-badge'
import { StatusBadge } from '@/components/content/status-badge'
import {
  formatCompactNumber,
  formatInteger,
  formatLeadTime,
  formatPercent,
} from '@/lib/analytics'
import type {
  ChannelMetric,
  FormatMetric,
  PipelineStageMetric,
} from '@/lib/analytics'
import { FORMAT_LABELS } from '@/lib/content'
import type { Channel, ContentStatus } from '@/lib/content'
import { cn } from '@/lib/utils'

const CHANNEL_BAR_BG: Record<Channel, string> = {
  x: 'bg-channel-x',
  linkedin: 'bg-channel-linkedin',
  instagram: 'bg-channel-instagram',
  tiktok: 'bg-channel-tiktok',
  youtube: 'bg-channel-youtube',
  blog: 'bg-channel-blog',
}

const STATUS_BAR_BG: Record<ContentStatus, string> = {
  idea: 'bg-status-idea',
  draft: 'bg-status-draft',
  ready: 'bg-status-ready',
  scheduled: 'bg-status-scheduled',
  published: 'bg-status-published',
}

/**
 * Layer 2 side-by-side breakdown:
 * - Left: Channels (clickable to filter the entire analytics page by channel)
 * - Right: Pipeline funnel + Formats
 */
export function AnalyticsBreakdown({
  channels,
  formats,
  pipeline,
  selectedChannel,
  onSelectChannel,
}: {
  channels: ReadonlyArray<ChannelMetric>
  formats: ReadonlyArray<FormatMetric>
  pipeline: ReadonlyArray<PipelineStageMetric>
  selectedChannel: Channel | null
  onSelectChannel: (channel: Channel | undefined) => void
}) {
  const maxChannelVolume = Math.max(
    ...channels.map((c) => c.published + c.scheduled + c.inProgress),
    1,
  )
  const totalPipeline = pipeline.reduce((acc, s) => acc + s.count, 0)
  const maxFormatPublished = Math.max(...formats.map((f) => f.published), 1)

  return (
    <section aria-label="Canais, pipeline e formatos" className="grid gap-4 lg:grid-cols-2">
      {/* Channels */}
      <div className="bg-card flex flex-col rounded-2xl p-5 md:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
              Por canal
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Clique em um canal para focar todos os indicadores nele.
            </p>
          </div>
          {selectedChannel ? (
            <button
              type="button"
              onClick={() => onSelectChannel(undefined)}
              className="text-brand text-xs font-medium hover:underline"
            >
              Ver todos
            </button>
          ) : null}
        </div>

        {channels.length === 0 ? (
          <p className="text-muted-foreground mt-6 text-sm">
            Nenhum conteúdo criado ainda neste workspace.
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-2.5">
            {channels.map((row) => {
              const total = row.published + row.scheduled + row.inProgress
              const pct = Math.max((total / maxChannelVolume) * 100, 6)
              const active = selectedChannel === row.channel
              return (
                <button
                  key={row.channel}
                  type="button"
                  onClick={() => onSelectChannel(active ? undefined : row.channel)}
                  className={cn(
                    'hover:bg-muted/70 flex flex-col gap-2 rounded-xl p-3 text-left transition-colors',
                    active ? 'bg-muted ring-1 ring-lime/60' : 'bg-muted/35',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ChannelBadge channel={row.channel} />
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-medium">
                        {formatInteger(row.published)} pub.
                      </span>
                      {row.scheduled > 0 ? (
                        <span className="text-muted-foreground">
                          {formatInteger(row.scheduled)} agend.
                        </span>
                      ) : null}
                      {row.primarySignal ? (
                        <span
                          className="text-brand font-medium"
                          title={row.primarySignal.explanation}
                        >
                          {row.primarySignal.shortLabel}: {row.primarySignal.formattedValue}
                        </span>
                      ) : row.avgEngagementRate != null ? (
                        <span className="text-brand font-medium">
                          {formatPercent(row.avgEngagementRate)} engaj.
                        </span>
                      ) : row.avgLeadTimeHours != null ? (
                        <span className="text-muted-foreground">
                          {formatLeadTime(row.avgLeadTimeHours)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="bg-background/70 h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className={cn('h-full rounded-full transition-all', CHANNEL_BAR_BG[row.channel])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {row.trackedPosts > 0 ? (
                    <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
                      <span>{formatCompactNumber(row.views)} views</span>
                      <span>·</span>
                      <span>{formatCompactNumber(row.interactions)} interações</span>
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pipeline + Formats */}
      <div className="flex flex-col gap-4">
        <div className="bg-card rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
                Pipeline atual
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Distribuição ao vivo · clique no status para abrir a lista filtrada.
              </p>
            </div>
            <span className="text-muted-foreground text-xs font-medium">
              {formatInteger(totalPipeline)} {totalPipeline === 1 ? 'item' : 'itens'}
            </span>
          </div>

          {totalPipeline > 0 ? (
            <>
              <div className="bg-muted mt-4 flex h-2.5 w-full overflow-hidden rounded-full">
                {pipeline
                  .filter((stage) => stage.count > 0)
                  .map((stage) => (
                    <div
                      key={stage.status}
                      className={cn('h-full transition-all', STATUS_BAR_BG[stage.status])}
                      style={{ width: `${(stage.count / totalPipeline) * 100}%` }}
                    />
                  ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {pipeline.map((stage) => (
                  <Link
                    key={stage.status}
                    to="/content"
                    search={{ statuses: [stage.status] } as never}
                    className="bg-muted/35 hover:bg-muted flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors"
                  >
                    <StatusBadge status={stage.status} />
                    <div className="text-right">
                      <span className="text-sm font-semibold">{formatInteger(stage.count)}</span>
                      {stage.staleCount > 0 ? (
                        <span
                          className="text-destructive ml-1 text-[10px] font-medium"
                          title="Parados há mais de 7 dias"
                        >
                          ({stage.staleCount} par.)
                        </span>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground mt-4 text-sm">
              Nenhum conteúdo no pipeline ainda.
            </p>
          )}
        </div>

        <div className="bg-card rounded-2xl p-5 md:p-6">
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
            Formatos publicados
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Quais formatos mais foram ao ar e como performaram.
          </p>

          {formats.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              Publique conteúdos para comparar formatos aqui.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {formats.map((row) => {
                const pct = Math.max((row.published / maxFormatPublished) * 100, 8)
                return (
                  <div key={row.format} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{FORMAT_LABELS[row.format]}</span>
                      <div className="flex items-center gap-2.5">
                        <span className="text-muted-foreground">
                          {formatInteger(row.published)}{' '}
                          {row.published === 1 ? 'pub.' : 'pubs.'}
                        </span>
                        {row.avgEngagementRate != null ? (
                          <span className="text-brand font-medium">
                            {formatPercent(row.avgEngagementRate)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-lime/80 h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
