import { BarChart2, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { formatCompactNumber, formatInteger } from '@/lib/analytics'
import type { CadenceBucket } from '@/lib/analytics'
import { cn } from '@/lib/utils'

type ChartMetric = 'published' | 'views' | 'interactions'
type ChartStyle = 'bars' | 'area'

const METRIC_OPTIONS: ReadonlyArray<{ id: ChartMetric; label: string }> = [
  { id: 'published', label: 'Posts' },
  { id: 'views', label: 'Views' },
  { id: 'interactions', label: 'Interações' },
]

/**
 * Interactive cadence & evolution chart with switchable Bar / Area views
 * and a floating hover tooltip showing exact metrics for each date bucket.
 */
export function AnalyticsCadenceChart({
  buckets,
  hasSocialData,
}: {
  buckets: ReadonlyArray<CadenceBucket>
  hasSocialData: boolean
}) {
  const [metric, setMetric] = useState<ChartMetric>('published')
  const [style, setStyle] = useState<ChartStyle>('area')
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const activeMetric: ChartMetric = !hasSocialData && metric !== 'published' ? 'published' : metric
  const values = buckets.map((bucket) => bucket[activeMetric])
  const maxValue = Math.max(...values, 1)
  const totalValue = values.reduce((acc, v) => acc + v, 0)

  const hovered = hoveredIdx != null ? buckets[hoveredIdx] ?? null : null
  const labelStep = buckets.length > 16 ? Math.ceil(buckets.length / 7) : buckets.length > 10 ? 2 : 1

  // SVG area chart coordinate space
  const svgW = 720
  const svgH = 176
  const padTop = 14
  const padBottom = 8
  const plotH = svgH - padTop - padBottom

  const points = buckets.map((bucket, idx) => {
    const x =
      buckets.length <= 1 ? svgW / 2 : (idx / (buckets.length - 1)) * svgW
    const y = padTop + plotH - (bucket[activeMetric] / maxValue) * plotH
    return { x, y, bucket }
  })

  const linePath =
    points.length > 0
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      : ''

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : ''

  const tooltipLeftPct =
    hoveredIdx != null && buckets.length > 1
      ? Math.min(Math.max((hoveredIdx / (buckets.length - 1)) * 100, 12), 88)
      : 50

  return (
    <section aria-label="Evolução no período" className="clay-panel bg-card rounded-2xl p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
            Evolução no período
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {activeMetric === 'published'
              ? `${formatInteger(totalValue)} ${totalValue === 1 ? 'post publicado' : 'posts publicados'} no recorte`
              : activeMetric === 'views'
                ? `${formatCompactNumber(totalValue)} visualizações no recorte`
                : `${formatCompactNumber(totalValue)} interações no recorte`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
                    'rounded-lg px-3 py-1 text-xs font-medium transition-colors',
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

          <div className="bg-muted inline-flex rounded-xl p-1" role="group" aria-label="Tipo de gráfico">
            <button
              type="button"
              onClick={() => setStyle('area')}
              aria-pressed={style === 'area'}
              title="Gráfico de linha"
              className={cn(
                'rounded-lg p-1.5 transition-colors',
                style === 'area'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <TrendingUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setStyle('bars')}
              aria-pressed={style === 'bars'}
              title="Gráfico de barras"
              className={cn(
                'rounded-lg p-1.5 transition-colors',
                style === 'bars'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <BarChart2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="text-muted-foreground flex h-44 items-center justify-center text-sm">
          Sem dados neste período ainda.
        </div>
      ) : (
        <div
          className="relative mt-6"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Floating hover tooltip */}
          {hovered ? (
            <div
              className="bg-popover text-popover-foreground pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full rounded-xl border border-border px-3 py-2 text-xs shadow-md transition-all duration-100"
              style={{ left: `${tooltipLeftPct}%` }}
            >
              <p className="font-semibold">{hovered.label}</p>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 whitespace-nowrap">
                <span>
                  <strong className="text-foreground">{formatInteger(hovered.published)}</strong>{' '}
                  {hovered.published === 1 ? 'post' : 'posts'}
                </span>
                {hovered.scheduled > 0 ? (
                  <span>
                    <strong className="text-foreground">{formatInteger(hovered.scheduled)}</strong>{' '}
                    agend.
                  </span>
                ) : null}
                {hasSocialData && hovered.views > 0 ? (
                  <span>
                    <strong className="text-foreground">{formatCompactNumber(hovered.views)}</strong>{' '}
                    views
                  </span>
                ) : null}
                {hasSocialData && hovered.interactions > 0 ? (
                  <span>
                    <strong className="text-foreground">
                      {formatCompactNumber(hovered.interactions)}
                    </strong>{' '}
                    interações
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {style === 'area' ? (
            <div className="relative h-44 w-full">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                preserveAspectRatio="none"
                className="h-full w-full overflow-visible"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="zora-cadence-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="var(--lime)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Subtle horizontal guides */}
                {[0, 0.5, 1].map((ratio) => {
                  const y = padTop + plotH * ratio
                  return (
                    <line
                      key={ratio}
                      x1={0}
                      x2={svgW}
                      y1={y}
                      y2={y}
                      stroke="var(--border)"
                      strokeDasharray={ratio === 1 ? undefined : '3 4'}
                      strokeWidth={1}
                    />
                  )
                })}

                <path d={areaPath} fill="url(#zora-cadence-fill)" />
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--lime)"
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Active crosshair & point */}
                {hoveredIdx != null && points[hoveredIdx] ? (
                  <>
                    <line
                      x1={points[hoveredIdx]!.x}
                      x2={points[hoveredIdx]!.x}
                      y1={padTop}
                      y2={padTop + plotH}
                      stroke="var(--foreground)"
                      strokeOpacity={0.22}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={points[hoveredIdx]!.x}
                      cy={points[hoveredIdx]!.y}
                      r={4.5}
                      fill="var(--lime)"
                      stroke="var(--card)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}
              </svg>

              {/* Invisible interactive hit columns */}
              <div className="absolute inset-0 flex">
                {buckets.map((bucket, idx) => (
                  <button
                    key={bucket.key}
                    type="button"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onFocus={() => setHoveredIdx(idx)}
                    onBlur={() => setHoveredIdx(null)}
                    aria-label={`${bucket.label}: ${formatCompactNumber(bucket[activeMetric])}`}
                    className="h-full flex-1 cursor-crosshair focus:outline-none"
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-44 items-end gap-1.5 sm:gap-2">
              {buckets.map((bucket, idx) => {
                const value = bucket[activeMetric]
                const heightPct = value > 0 ? Math.max((value / maxValue) * 100, 8) : 3
                const isHovered = hoveredIdx === idx
                const hasScheduledOnly =
                  activeMetric === 'published' && value === 0 && bucket.scheduled > 0

                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onFocus={() => setHoveredIdx(idx)}
                    onBlur={() => setHoveredIdx(null)}
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
                        // Fun mode paints filled bars as clay (clay.css).
                        value > 0 && 'clay-bar',
                      )}
                      style={{ height: `${heightPct}%` }}
                    />
                  </button>
                )
              })}
            </div>
          )}

          {/* X-axis labels */}
          <div className="mt-2.5 flex items-center gap-1.5 sm:gap-2">
            {buckets.map((bucket, idx) => {
              const showLabel = idx % labelStep === 0 || idx === buckets.length - 1
              return (
                <div
                  key={bucket.key}
                  className={cn(
                    'flex-1 truncate text-center text-[11px] transition-colors',
                    hoveredIdx === idx ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
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
