import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Sparkles, TrendingUp } from 'lucide-react'
import type { AnalyticsInsight } from '@/lib/analytics'
import { cn } from '@/lib/utils'

/**
 * Plain-Portuguese highlights that explain "what matters right now" before
 * the user dives into charts and tables.
 */
export function AnalyticsInsights({ insights }: { insights: ReadonlyArray<AnalyticsInsight> }) {
  if (insights.length === 0) return null

  return (
    <section aria-label="Destaques do período" className="grid gap-3 md:grid-cols-2">
      {insights.map((insight) => {
        const Icon =
          insight.tone === 'positive'
            ? TrendingUp
            : insight.tone === 'attention'
              ? AlertTriangle
              : Sparkles

        return (
          <div
            key={insight.id}
            className="bg-card flex items-start gap-3.5 rounded-2xl p-4 transition-colors"
          >
            <div
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl',
                insight.tone === 'positive' && 'bg-lime/20 text-brand',
                insight.tone === 'attention' && 'bg-destructive/15 text-destructive',
                insight.tone === 'info' && 'bg-muted text-foreground',
              )}
            >
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{insight.title}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {insight.description}
              </p>
              {insight.action ? (
                <Link
                  to={insight.action.to}
                  search={insight.action.search as never}
                  className="text-brand mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  {insight.action.label}
                  <ArrowRight className="size-3" />
                </Link>
              ) : null}
            </div>
          </div>
        )
      })}
    </section>
  )
}
