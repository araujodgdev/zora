import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Eye,
  Heart,
  Send,
} from 'lucide-react'
import {
  formatCompactNumber,
  formatDeltaPct,
  formatInteger,
  formatLeadTime,
  formatPercent,
} from '@/lib/analytics'
import type { AnalyticsKpis } from '@/lib/analytics'
import { cn } from '@/lib/utils'

/**
 * Layer 1 KPI strip: 4 calm, high-contrast studio cards with Fraunces
 * numerals, period comparison pills, and plain-Portuguese subtitles.
 */
export function AnalyticsKpiStrip({ kpis }: { kpis: AnalyticsKpis }) {
  const publishedDelta = formatDeltaPct(kpis.publishedDeltaPct)
  const deltaPositive = (kpis.publishedDeltaPct ?? 0) > 0
  const deltaNegative = (kpis.publishedDeltaPct ?? 0) < 0
  const hasSocialData = kpis.trackedPostsCount > 0

  return (
    <section aria-label="Resumo do período" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={<Send className="size-4" />}
        label="Publicados"
        value={formatInteger(kpis.publishedCount)}
        badge={
          publishedDelta ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
                deltaPositive && 'bg-lime/20 text-brand',
                deltaNegative && 'bg-destructive/15 text-destructive',
                !deltaPositive && !deltaNegative && 'bg-muted text-muted-foreground',
              )}
            >
              {deltaPositive ? <ArrowUpRight className="size-3" /> : null}
              {deltaNegative ? <ArrowDownRight className="size-3" /> : null}
              {publishedDelta}
            </span>
          ) : null
        }
        subtitle={
          kpis.previousPublishedCount != null
            ? `vs. ${formatInteger(kpis.previousPublishedCount)} no período anterior`
            : `${formatInteger(kpis.scheduledUpcoming7d)} agendados nos próximos 7 dias`
        }
      />

      <KpiCard
        icon={<Eye className="size-4" />}
        label={kpis.totalReach > 0 ? 'Visualizações' : 'Visualizações'}
        value={hasSocialData ? formatCompactNumber(kpis.totalViews) : '—'}
        subtitle={
          hasSocialData
            ? kpis.totalReach > 0
              ? `${formatCompactNumber(kpis.totalReach)} de alcance · ${kpis.trackedPostsCount} ${kpis.trackedPostsCount === 1 ? 'post' : 'posts'}`
              : `em ${kpis.trackedPostsCount} ${kpis.trackedPostsCount === 1 ? 'post monitorado' : 'posts monitorados'}`
            : 'Conecte uma rede e atualize para ver alcance'
        }
      />

      <KpiCard
        icon={<Heart className="size-4" />}
        label="Interações"
        value={hasSocialData ? formatCompactNumber(kpis.totalInteractions) : '—'}
        badge={
          kpis.avgEngagementRate != null ? (
            <span className="bg-lime/20 text-brand inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
              {formatPercent(kpis.avgEngagementRate)} engaj.
            </span>
          ) : null
        }
        subtitle={
          hasSocialData
            ? kpis.avgEngagementRate != null
              ? 'Curtidas, comentários, compartilhamentos e salvos'
              : 'Filtre um canal específico para comparar taxas sem misturar redes'
            : `${formatInteger(kpis.inProgressCount)} conteúdos em produção no pipeline`
        }
      />

      <KpiCard
        icon={
          kpis.publishSuccessRate != null ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <CalendarClock className="size-4" />
          )
        }
        label={kpis.publishSuccessRate != null ? 'Publicação automática' : 'Tempo até publicar'}
        value={
          kpis.publishSuccessRate != null
            ? formatPercent(kpis.publishSuccessRate)
            : formatLeadTime(kpis.avgLeadTimeHours)
        }
        badge={
          kpis.publishFailedCount > 0 ? (
            <span className="bg-destructive/15 text-destructive inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
              {kpis.publishFailedCount} {kpis.publishFailedCount === 1 ? 'falha' : 'falhas'}
            </span>
          ) : null
        }
        subtitle={
          kpis.publishSuccessRate != null
            ? `Tempo médio da ideia ao ar: ${formatLeadTime(kpis.avgLeadTimeHours)}`
            : `${formatInteger(kpis.scheduledUpcoming7d)} agendados para os próximos 7 dias`
        }
      />
    </section>
  )
}

function KpiCard({
  icon,
  label,
  value,
  badge,
  subtitle,
}: {
  icon: React.ReactNode
  label: string
  value: string
  badge?: React.ReactNode
  subtitle: string
}) {
  return (
    <div className="clay-panel bg-card flex flex-col justify-between gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
          {icon}
          {label}
        </span>
        {badge}
      </div>
      <div>
        <div className="font-display text-3xl leading-none font-semibold tracking-[-0.02em] md:text-4xl">
          {value}
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{subtitle}</p>
      </div>
    </div>
  )
}
