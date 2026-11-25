import { useState } from 'react'
import { formatCompactNumber, formatInteger } from '@/lib/analytics'
import type { CadenceBucket } from '@/lib/analytics'
import { cn } from '@/lib/utils'

type ChartMetric = 'published' | 'views' | 'interactions'

const METRIC_OPTIONS: ReadonlyArray<{ id: ChartMetric; label: string }> = [
  { id: 'published', label: 'Publicações' },
  { id: 'views', label: 'Visualizações' },
  { id: 'interactions', label: 'Interações' },
]

/**
 * Interactive cadence & traction chart styled with Zora's studio palette.
 * Lets the user switch between editorial cadence and social performance
 * without cluttering the screen with multiple stacked charts.
 */
export function AnalyticsCadenceChart({
  buckets,
  hasSocialData,
}: {
  buckets: ReadonlyArray<CadenceBucket>
  hasSocialData: boolean
}) {
  const [metric, setMetric] = useState<ChartMetric>('published')
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const activeMetric: ChartMetric = !hasSocialData && metric !== 'published' ? 'published' : metric
  const values = buckets.map((bucket) => bucket[activeMetric])
  const maxValue = Math.max(...values, 1)
  const totalValue = values.reduce((acc, v) => acc + v, 0)

  const hovered = hoveredKey ? buckets.find((b) => b.key === hoveredKey) ?? null : null
  const labelStep = buckets.length > 16 ? Math.ceil(buckets.length / 8) : buckets.length > 10 ? 2 : 1

  return (
    <section aria-label="Ritmo e evolução" className="bg-card rounded-2xl p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
            Ritmo no período
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {hovered ? (
              <>
                <span className="text-foreground font-medium">{hovered.label}</span>
                {' · '}
                {formatInteger(hovered.published)}{' '}
                {hovered.published === 1 ? 'publicação' : 'publicações'}
                {hovered.scheduled > 0
                  ? ` · ${formatInteger(hovered.scheduled)} agendados`
                  : ''}
                {hasSocialData && hovered.views > 0
                  ? ` · ${formatCompactNumber(hovered.views)} views`
                  : ''}
                {hasSocialData && hovered.interactions > 0
                  ? ` · ${formatCompactNumber(hovered.interactions)} interações`
                  : ''}
              </>
            ) : activeMetric === 'published' ? (
              `${formatInteger(totalValue)} ${totalValue === 1 ? 'conteúdo publicado' : 'conteúdos publicados'} no recorte · passe o mouse nas barras para detalhar`
            ) : activeMetric === 'views' ? (
              `${formatCompactNumber(totalValue)} visualizações atribuídas às datas de publicação`
            ) : (
              `${formatCompactNumber(totalValue)} interações atribuídas às datas de publicação`
            )}
          </p>
        </div>

        <div className="bg-muted inline-flex rounded-xl p-1" role="tablist" aria-label="Métrica do gráfico">
          {METRIC_OPTIONS.map((option) => {
            const disabled = !hasSocialData && option.id !== 'published'
            const active = activeMetric === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setMetric(option.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-45',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="text-muted-foreground flex h-44 items-center justify-center text-sm">
          Sem dados neste período ainda.
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex h-44 items-end gap-1.5 sm:gap-2">
            {buckets.map((bucket) => {
              const value = bucket[activeMetric]
              const heightPct = value > 0 ? Math.max((value / maxValue) * 100, 8) : 3
              const isHovered = hoveredKey === bucket.key
              const hasScheduledOnly = activeMetric === 'published' && value === 0 && bucket.scheduled > 0

              return (
                <button
                  key={bucket.key}
                  type="button"
                  onMouseEnter={() => setHoveredKey(bucket.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(bucket.key)}
                  onBlur={() => setHoveredKey(null)}
                  aria-label={`${bucket.label}: ${formatCompactNumber(value)}`}
                  className="group relative flex h-full flex-1 flex-col items-center justify-end focus:outline-none"
                >
                  <div
                    className={cn(
                      'w-full max-w-8 rounded-t-md transition-all duration-150',
                      value > 0
                        ? isHovered
                          ? 'bg-lime'
                          : 'bg-lime/75 group-hover:bg-lime'
                        : hasScheduledOnly
                          ? 'bg-status-scheduled/55'
                          : 'bg-muted',
                    )}
                    style={{ height: `${heightPct}%` }}
                  />
                </button>
              )
            })}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 sm:gap-2">
            {buckets.map((bucket, idx) => {
              const showLabel = idx % labelStep === 0 || idx === buckets.length - 1
              return (
                <div
                  key={bucket.key}
                  className="text-muted-foreground flex-1 truncate text-center text-[11px]"
                >
                  {showLabel ? bucket.label : ''}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
