import { Link } from '@tanstack/react-router'
import { AlertCircle, ArrowRight, Calendar, Clock, Link2, TrendingUp } from 'lucide-react'
import type { AnalyticsInsight } from '@/lib/analytics'
import { cn } from '@/lib/utils'

function getInsightIcon(insight: AnalyticsInsight) {
  if (insight.tone === 'attention') return AlertCircle
  if (insight.id === 'calendar-gap') return Calendar
  if (insight.id === 'connect-social') return Link2
  if (insight.id === 'stale-ready') return Clock
  return TrendingUp
}

/**
 * Compact, actionable status notices shown at the top of `/analytics`.
 */
export function AnalyticsInsights({ insights }: { insights: ReadonlyArray<AnalyticsInsight> }) {
  if (insights.length === 0) return null

  return (
    <section aria-label="Avisos rápidos" className="grid gap-2.5 md:grid-cols-2">
      {insights.map((insight) => {
        const Icon = getInsightIcon(insight)

        return (
          <div
            key={insight.id}
            className="bg-card flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                  insight.tone === 'positive' && 'bg-lime/15 text-brand',
                  insight.tone === 'attention' && 'bg-destructive/15 text-destructive',
                  insight.tone === 'info' && 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{insight.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {insight.description}
                </p>
              </div>
            </div>

            {insight.action ? (
              <Link
                to={insight.action.to}
                search={insight.action.search as never}
                className="text-brand inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
              >
                {insight.action.label}
                <ArrowRight className="size-3" />
              </Link>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
