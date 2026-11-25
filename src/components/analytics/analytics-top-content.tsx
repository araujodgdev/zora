import { Link } from '@tanstack/react-router'
import { ExternalLink, Eye, Heart, MessageCircle, Share2 } from 'lucide-react'
import { useState } from 'react'
import { ChannelBadge } from '@/components/content/channel-badge'
import { LocalDateTime } from '@/components/local-date-time'
import {
  formatCompactNumber,
  formatPercent,
} from '@/lib/analytics'
import type { TopContentEntry } from '@/lib/analytics'
import { FORMAT_LABELS } from '@/lib/content'
import { cn } from '@/lib/utils'

type SortKey = 'interactions' | 'views' | 'engagement' | 'recent'

const SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'interactions', label: 'Interações' },
  { id: 'views', label: 'Visualizações' },
  { id: 'engagement', label: 'Engajamento' },
  { id: 'recent', label: 'Mais recentes' },
]

/**
 * Layer 3 detail table/list: top published content with sortable metrics and
 * direct click-through to the item page or live post URL.
 */
export function AnalyticsTopContent({ items }: { items: ReadonlyArray<TopContentEntry> }) {
  const [sortBy, setSortBy] = useState<SortKey>('interactions')
  const hasAnyMetrics = items.some((i) => i.hasMetrics)
  const activeSort: SortKey = !hasAnyMetrics ? 'recent' : sortBy

  const sorted = [...items].sort((a, b) => {
    if (activeSort === 'recent') {
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
    }
    if (activeSort === 'views') {
      return (b.views ?? -1) - (a.views ?? -1)
    }
    if (activeSort === 'engagement') {
      return (b.engagementRate ?? -1) - (a.engagementRate ?? -1)
    }
    return b.interactions - a.interactions || (b.views ?? 0) - (a.views ?? 0)
  })

  return (
    <section aria-label="Conteúdos em destaque" className="bg-card rounded-2xl p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
            Conteúdos publicados
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {hasAnyMetrics
              ? 'Ordenado por resultado nas redes · clique em qualquer item para abrir os detalhes.'
              : 'Publicações do período · conecte uma rede social e atualize para ver o desempenho.'}
          </p>
        </div>

        {hasAnyMetrics ? (
          <div className="bg-muted inline-flex flex-wrap rounded-xl p-1" role="tablist" aria-label="Ordenar conteúdos">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={activeSort === option.id}
                onClick={() => setSortBy(option.id)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  activeSort === option.id
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">
          Nenhum conteúdo publicado neste período ainda.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border/60">
          {sorted.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-col gap-3 py-3.5 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <ChannelBadge channel={entry.channel} />
                  <span className="text-muted-foreground text-xs">
                    {FORMAT_LABELS[entry.format]}
                  </span>
                  {entry.publishedAt ? (
                    <span className="text-muted-foreground text-xs">
                      · <LocalDateTime value={entry.publishedAt} />
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Link
                    to="/content/$itemId"
                    params={{ itemId: entry.id }}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {entry.title}
                  </Link>
                  {entry.publishedUrl ? (
                    <a
                      href={entry.publishedUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir publicação externa: ${entry.title}`}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                {entry.diagnosis ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        entry.diagnosis.tone === 'positive' && 'bg-lime/20 text-brand',
                        entry.diagnosis.tone === 'attention' && 'bg-destructive/15 text-destructive',
                        entry.diagnosis.tone === 'info' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {entry.diagnosis.badge}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {entry.diagnosis.summary}
                    </span>
                  </div>
                ) : null}
              </div>

              {entry.hasMetrics ? (
                <div className="flex flex-wrap items-center gap-3 text-xs sm:justify-end">
                  {entry.views != null ? (
                    <MetricPill icon={<Eye className="size-3.5" />} label="Visualizações" value={formatCompactNumber(entry.views)} />
                  ) : null}
                  {entry.likes != null ? (
                    <MetricPill icon={<Heart className="size-3.5" />} label="Curtidas" value={formatCompactNumber(entry.likes)} />
                  ) : null}
                  {entry.comments != null ? (
                    <MetricPill icon={<MessageCircle className="size-3.5" />} label="Comentários" value={formatCompactNumber(entry.comments)} />
                  ) : null}
                  {entry.shares != null ? (
                    <MetricPill icon={<Share2 className="size-3.5" />} label="Compartilhamentos" value={formatCompactNumber(entry.shares)} />
                  ) : null}
                  {entry.engagementRate != null ? (
                    <span className="bg-lime/20 text-brand rounded-full px-2.5 py-0.5 font-medium">
                      {formatPercent(entry.engagementRate)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">Sem métricas coletadas</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MetricPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <span
      title={label}
      className="bg-muted/60 text-foreground inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium"
    >
      <span className="text-muted-foreground">{icon}</span>
      {value}
    </span>
  )
}
