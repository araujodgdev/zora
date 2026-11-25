import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AnalyticsDonutChart } from '@/components/analytics/analytics-donut-chart'
import type { DonutSlice } from '@/components/analytics/analytics-donut-chart'
import { StatusBadge } from '@/components/content/status-badge'
import {
  formatCompactNumber,
  formatInteger,
  formatPercent,
} from '@/lib/analytics'
import type {
  ChannelMetric,
  FormatMetric,
  PipelineStageMetric,
} from '@/lib/analytics'
import { CHANNEL_LABELS, FORMAT_LABELS } from '@/lib/content'
import type { Channel, ContentFormat, ContentStatus } from '@/lib/content'
import { cn } from '@/lib/utils'

const CHANNEL_COLOR_VAR: Record<Channel, string> = {
  x: 'var(--channel-x)',
  linkedin: 'var(--channel-linkedin)',
  instagram: 'var(--channel-instagram)',
  tiktok: 'var(--channel-tiktok)',
  youtube: 'var(--channel-youtube)',
  blog: 'var(--channel-blog)',
}

const FORMAT_COLOR_VAR: Record<ContentFormat, string> = {
  reel: 'var(--lime)',
  short: 'var(--channel-tiktok)',
  video: 'var(--channel-youtube)',
  carousel: 'var(--channel-instagram)',
  post: 'var(--channel-linkedin)',
  story: 'var(--status-draft)',
  thread: 'var(--violet)',
  article: 'var(--channel-blog)',
}

const STATUS_BAR_BG: Record<ContentStatus, string> = {
  idea: 'bg-status-idea',
  draft: 'bg-status-draft',
  ready: 'bg-status-ready',
  scheduled: 'bg-status-scheduled',
  published: 'bg-status-published',
}

type ChannelDonutMode = 'posts' | 'views' | 'interactions'

const CHANNEL_MODES: ReadonlyArray<{ id: ChannelDonutMode; label: string }> = [
  { id: 'posts', label: 'Posts' },
  { id: 'views', label: 'Views' },
  { id: 'interactions', label: 'Interações' },
]

/**
 * Layer 2 visual charts for creators:
 * - Interactive Donut chart by Channel (click any slice to filter the page)
 * - Interactive Donut chart by Format (Reels, Carrossel, Post, Story...)
 * - Interactive Pipeline bar with synced hover highlights
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
  const [channelMode, setChannelMode] = useState<ChannelDonutMode>('posts')
  const [hoveredStage, setHoveredStage] = useState<ContentStatus | null>(null)

  const hasSocialChannelData = channels.some((c) => c.views > 0 || c.interactions > 0)
  const activeChannelMode: ChannelDonutMode =
    !hasSocialChannelData && channelMode !== 'posts' ? 'posts' : channelMode

  const channelSlices: Array<DonutSlice> = channels.map((row) => {
    const value =
      activeChannelMode === 'views'
        ? row.views
        : activeChannelMode === 'interactions'
          ? row.interactions
          : row.published + row.scheduled + row.inProgress

    return {
      id: row.channel,
      label: CHANNEL_LABELS[row.channel],
      value,
      color: CHANNEL_COLOR_VAR[row.channel],
      meta:
        row.primarySignal != null
          ? `${row.primarySignal.shortLabel}: ${row.primarySignal.formattedValue}`
          : row.views > 0
            ? `${formatCompactNumber(row.views)} views`
            : undefined,
    }
  })

  const formatSlices: Array<DonutSlice> = formats.map((row) => ({
    id: row.format,
    label: FORMAT_LABELS[row.format],
    value: row.published,
    color: FORMAT_COLOR_VAR[row.format],
    meta:
      row.avgEngagementRate != null
        ? `${formatPercent(row.avgEngagementRate)} engaj.`
        : undefined,
  }))

  const totalPipeline = pipeline.reduce((acc, s) => acc + s.count, 0)

  return (
    <section aria-label="Distribuição por rede, formato e pipeline" className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Donut 1: Channels */}
        <div className="bg-card flex flex-col justify-between rounded-2xl p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
                Por rede
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Clique em uma fatia para filtrar a tela por rede.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {hasSocialChannelData ? (
                <div className="bg-muted inline-flex rounded-lg p-0.5" role="tablist" aria-label="Métrica por rede">
                  {CHANNEL_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={activeChannelMode === mode.id}
                      onClick={() => setChannelMode(mode.id)}
                      className={cn(
                        'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                        activeChannelMode === mode.id
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedChannel ? (
                <button
                  type="button"
                  onClick={() => onSelectChannel(undefined)}
                  className="text-brand text-xs font-medium hover:underline"
                >
                  Limpar
                </button>
              ) : null}
            </div>
          </div>

          <AnalyticsDonutChart
            slices={channelSlices}
            totalLabel={
              activeChannelMode === 'views'
                ? 'views'
                : activeChannelMode === 'interactions'
                  ? 'interações'
                  : 'conteúdos'
            }
            valueUnit={activeChannelMode === 'posts' ? 'count' : 'compact'}
            selectedId={selectedChannel}
            onSelect={(id) => {
              const ch = id as Channel
              onSelectChannel(selectedChannel === ch ? undefined : ch)
            }}
            emptyMessage="Crie conteúdos nas suas redes para ver a distribuição aqui."
          />
        </div>

        {/* Donut 2: Formats */}
        <div className="bg-card flex flex-col justify-between rounded-2xl p-5 md:p-6">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
              Mix de formatos
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Proporção de Reels, carrosséis, posts e outros formatos publicados.
            </p>
          </div>

          <AnalyticsDonutChart
            slices={formatSlices}
            totalLabel="publicados"
            valueUnit="count"
            emptyMessage="Publique conteúdos para ver seu mix de formatos aqui."
          />
        </div>
      </div>

      {/* Interactive Pipeline bar */}
      <div className="bg-card rounded-2xl p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
              Pipeline agora
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Passe o mouse para destacar ou clique em uma etapa para abrir os itens.
            </p>
          </div>
          <span className="text-muted-foreground text-xs font-medium">
            {formatInteger(totalPipeline)} {totalPipeline === 1 ? 'item no total' : 'itens no total'}
          </span>
        </div>

        {totalPipeline > 0 ? (
          <>
            <div className="bg-muted mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
              {pipeline
                .filter((stage) => stage.count > 0)
                .map((stage) => {
                  const pct = (stage.count / totalPipeline) * 100
                  const dimmed = hoveredStage != null && hoveredStage !== stage.status
                  return (
                    <Link
                      key={stage.status}
                      to="/content"
                      search={{ statuses: [stage.status] } as never}
                      onMouseEnter={() => setHoveredStage(stage.status)}
                      onMouseLeave={() => setHoveredStage(null)}
                      aria-label={`${stage.status}: ${stage.count} (${Math.round(pct)}%)`}
                      className={cn(
                        'h-full transition-opacity duration-150 first:rounded-l-full last:rounded-r-full',
                        STATUS_BAR_BG[stage.status],
                        dimmed && 'opacity-30',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  )
                })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {pipeline.map((stage) => {
                const sharePct = totalPipeline > 0 ? Math.round((stage.count / totalPipeline) * 100) : 0
                const highlighted = hoveredStage === stage.status
                return (
                  <Link
                    key={stage.status}
                    to="/content"
                    search={{ statuses: [stage.status] } as never}
                    onMouseEnter={() => setHoveredStage(stage.status)}
                    onMouseLeave={() => setHoveredStage(null)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors',
                      highlighted ? 'bg-muted' : 'bg-muted/30 hover:bg-muted/70',
                    )}
                  >
                    <StatusBadge status={stage.status} />
                    <div className="text-right">
                      <span className="text-sm font-semibold tabular-nums">
                        {formatInteger(stage.count)}
                      </span>
                      <span className="text-muted-foreground ml-1 text-[11px] tabular-nums">
                        {sharePct}%
                      </span>
                      {stage.staleCount > 0 ? (
                        <div
                          className="text-destructive text-[10px] font-medium"
                          title="Parados há mais de 7 dias"
                        >
                          {stage.staleCount} par.
                        </div>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">
            Nenhum conteúdo no pipeline ainda.
          </p>
        )}
      </div>
    </section>
  )
}
