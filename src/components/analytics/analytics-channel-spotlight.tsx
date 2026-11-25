import { BookOpen, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ChannelBadge } from '@/components/content/channel-badge'
import { CHANNEL_METRIC_GUIDES } from '@/lib/analytics-signals'
import type { ChannelSpotlight } from '@/lib/analytics'
import { CHANNELS, CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import { cn } from '@/lib/utils'

const STRENGTH_LABELS = {
  strong: 'Forte',
  good: 'Bom',
  baseline: 'Base',
} as const

/**
 * Beginner-friendly platform spotlight:
 * - When a specific channel is active (or is the sole tracked channel), shows
 *   that network's native signals (e.g. sends/reach, saves/reach, watch time on
 *   Instagram) with plain-Portuguese explanations of why each metric matters.
 * - When viewing "Todos os canais", provides a calm collapsible guide so new
 *   creators can learn what matters most on each network without cluttering the page.
 */
export function AnalyticsChannelSpotlight({
  spotlight,
  onSelectChannel,
}: {
  spotlight: ChannelSpotlight | null
  onSelectChannel: (channel: Channel) => void
}) {
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideChannel, setGuideChannel] = useState<Channel>('instagram')

  if (spotlight) {
    const { guide, signals } = spotlight
    return (
      <section
        aria-label={`Sinais principais de ${CHANNEL_LABELS[spotlight.channel]}`}
        className="bg-card rounded-2xl p-5 md:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <ChannelBadge channel={spotlight.channel} />
              <span className="text-muted-foreground text-xs font-medium">
                O que realmente importa aqui
              </span>
            </div>
            <h2 className="font-display mt-2 text-xl font-semibold tracking-[-0.01em] md:text-2xl">
              {guide.headline}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed md:text-sm">
              {guide.summary}
            </p>
          </div>
        </div>

        {signals.length > 0 ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {signals.map((signal) => (
              <div
                key={signal.id}
                className="bg-muted/40 flex flex-col justify-between gap-2.5 rounded-xl p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{signal.label}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      signal.strength === 'strong' && 'bg-lime/20 text-brand',
                      signal.strength === 'good' && 'bg-secondary/15 text-foreground',
                      signal.strength === 'baseline' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {STRENGTH_LABELS[signal.strength]}
                  </span>
                </div>
                <div className="font-display text-2xl leading-none font-semibold tracking-[-0.02em]">
                  {signal.formattedValue}
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {signal.explanation}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guide.keySignals.map((item) => (
              <div key={item.label} className="bg-muted/35 rounded-xl p-4">
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
                  {item.whyItMatters}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  const activeGuide = CHANNEL_METRIC_GUIDES[guideChannel]

  return (
    <section
      aria-label="Como ler as métricas de cada rede"
      className="bg-card rounded-2xl p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-lime/15 text-brand flex size-8 shrink-0 items-center justify-center rounded-xl">
            <BookOpen className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">
              Cada rede mede sucesso de um jeito diferente
            </p>
            <p className="text-muted-foreground text-xs">
              Selecione um canal acima para ver seus sinais nativos ou abra o guia rápido.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setGuideOpen((prev) => !prev)}
          aria-expanded={guideOpen}
          className="bg-muted hover:bg-muted/80 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <Sparkles className="size-3.5" />
          {guideOpen ? 'Fechar guia' : 'Entender cada rede'}
        </button>
      </div>

      {guideOpen ? (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setGuideChannel(ch)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  guideChannel === ch
                    ? 'bg-lime text-ink font-semibold'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {CHANNEL_LABELS[ch]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <p className="font-display text-lg font-semibold">{activeGuide.headline}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {activeGuide.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectChannel(guideChannel)}
              className="text-brand text-xs font-medium hover:underline"
            >
              Filtrar por {CHANNEL_LABELS[guideChannel]}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeGuide.keySignals.map((item) => (
              <div key={item.label} className="bg-muted/35 rounded-xl p-3.5">
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                  {item.whyItMatters}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
