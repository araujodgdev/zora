import { useState } from 'react'
import { formatCompactNumber, formatInteger } from '@/lib/analytics'
import { cn } from '@/lib/utils'

export type DonutSlice = {
  id: string
  label: string
  value: number
  /** CSS color string, e.g. `var(--channel-instagram)` */
  color: string
  /** Optional extra context shown in the legend and center hover readout. */
  meta?: string
}

const SIZE = 216
const CENTER = SIZE / 2
const OUTER_R = 88
const INNER_R = 56

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  }
}

function describeRingArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle
  const largeArc = sweep > 180 ? 1 : 0
  const outerStart = polarToCartesian(cx, cy, outerR, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerR, endAngle)
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle)
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle)

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

function buildDonutArcs(slices: ReadonlyArray<DonutSlice>, total: number) {
  const gapDeg = slices.length > 1 ? 2.2 : 0
  let cursor = 0
  return slices.map((slice) => {
    const rawSweep = (slice.value / total) * 360
    const sharePct = Math.round((slice.value / total) * 100)
    const startAngle = cursor + gapDeg / 2
    const endAngle = cursor + Math.max(rawSweep - gapDeg / 2, 1.5)
    cursor += rawSweep
    return {
      slice,
      sharePct,
      startAngle,
      endAngle,
      isFullCircle: slices.length === 1,
    }
  })
}

/**
 * Interactive SVG donut/pie chart styled with Zora's studio tokens.
 * Hovering or focusing any slice or legend row syncs both and updates the
 * center readout with percentage and count.
 */
export function AnalyticsDonutChart({
  slices,
  totalLabel,
  valueUnit = 'count',
  selectedId,
  onSelect,
  emptyMessage,
}: {
  slices: ReadonlyArray<DonutSlice>
  totalLabel: string
  valueUnit?: 'count' | 'compact'
  selectedId?: string | null
  onSelect?: (id: string) => void
  emptyMessage: string
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const nonZero = slices.filter((s) => s.value > 0)
  const total = nonZero.reduce((acc, s) => acc + s.value, 0)

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-32 opacity-40" aria-hidden="true">
          <circle
            cx={CENTER}
            cy={CENTER}
            r={(OUTER_R + INNER_R) / 2}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={OUTER_R - INNER_R}
          />
        </svg>
        <p className="text-muted-foreground max-w-xs text-xs">{emptyMessage}</p>
      </div>
    )
  }

  const activeId = hoveredId ?? selectedId ?? null
  const activeSlice = activeId ? nonZero.find((s) => s.id === activeId) ?? null : null
  const formatVal = (v: number) =>
    valueUnit === 'compact' ? formatCompactNumber(v) : formatInteger(v)

  const arcs = buildDonutArcs(nonZero, total)

  return (
    <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      {/* SVG Donut */}
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="size-44 select-none sm:size-48"
          role="img"
          aria-label={`Distribuição: ${totalLabel}`}
        >
          {arcs.map(({ slice, sharePct, startAngle, endAngle, isFullCircle }) => {
            const isHighlighted = activeId === slice.id
            const isDimmed = activeId != null && activeId !== slice.id
            const outerR = isHighlighted ? OUTER_R + 5 : OUTER_R
            const innerR = isHighlighted ? INNER_R - 1 : INNER_R

            if (isFullCircle) {
              return (
                <circle
                  key={slice.id}
                  cx={CENTER}
                  cy={CENTER}
                  r={(outerR + innerR) / 2}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={outerR - innerR}
                  className={cn(
                    'transition-all duration-200',
                    onSelect && 'cursor-pointer',
                  )}
                  onMouseEnter={() => setHoveredId(slice.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onSelect?.(slice.id)}
                >
                  <title>{`${slice.label}: ${formatVal(slice.value)} (100%)`}</title>
                </circle>
              )
            }

            return (
              <path
                key={slice.id}
                d={describeRingArc(CENTER, CENTER, innerR, outerR, startAngle, endAngle)}
                fill={slice.color}
                className={cn(
                  'transition-all duration-200',
                  onSelect && 'cursor-pointer',
                  isDimmed && 'opacity-35',
                )}
                onMouseEnter={() => setHoveredId(slice.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelect?.(slice.id)}
              >
                <title>{`${slice.label}: ${formatVal(slice.value)} (${sharePct}%)`}</title>
              </path>
            )
          })}
        </svg>

        {/* Center live readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          {activeSlice ? (
            <>
              <span className="font-display text-2xl leading-none font-semibold tracking-[-0.02em]">
                {Math.round((activeSlice.value / total) * 100)}%
              </span>
              <span className="mt-1 max-w-24 truncate text-xs font-medium">
                {activeSlice.label}
              </span>
              <span className="text-muted-foreground mt-0.5 text-[11px]">
                {formatVal(activeSlice.value)}
              </span>
            </>
          ) : (
            <>
              <span className="font-display text-2xl leading-none font-semibold tracking-[-0.02em]">
                {formatVal(total)}
              </span>
              <span className="text-muted-foreground mt-1 text-[11px]">{totalLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Interactive legend */}
      <div className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
        {arcs.map(({ slice, sharePct }) => {
          const isHighlighted = activeId === slice.id
          const isSelected = selectedId === slice.id
          const RowTag = onSelect ? 'button' : 'div'
          return (
            <RowTag
              key={slice.id}
              {...(onSelect
                ? {
                    type: 'button' as const,
                    onClick: () => onSelect(slice.id),
                  }
                : {})}
              onMouseEnter={() => setHoveredId(slice.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                onSelect && 'cursor-pointer',
                isSelected
                  ? 'bg-muted ring-1 ring-lime/60'
                  : isHighlighted
                    ? 'bg-muted/80'
                    : 'bg-muted/25 hover:bg-muted/60',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate text-xs font-medium">{slice.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums">{formatVal(slice.value)}</span>
                <span className="text-muted-foreground w-9 text-right text-[11px] tabular-nums">
                  {sharePct}%
                </span>
              </div>
            </RowTag>
          )
        })}
      </div>
    </div>
  )
}
