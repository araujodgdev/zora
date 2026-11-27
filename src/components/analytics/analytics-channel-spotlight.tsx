import { HelpCircle } from 'lucide-react'
import { ChannelBadge } from '@/components/content/channel-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ChannelSpotlight } from '@/lib/analytics'
import { CHANNEL_LABELS } from '@/lib/content'
import { cn } from '@/lib/utils'

const STRENGTH_LABELS = {
  strong: 'Forte',
  good: 'Bom',
  baseline: 'Base',
} as const

/**
 * Compact platform-native metric strip shown only when a specific channel
 * has real collected signals. Explanations live behind subtle hover tooltips
 * instead of cluttering the dashboard with walls of text.
 */
export function AnalyticsChannelSpotlight({
  spotlight,
}: {
  spotlight: ChannelSpotlight | null
}) {
  if (!spotlight || spotlight.signals.length === 0) return null

  return (
    <section
      aria-label={`Sinais principais de ${CHANNEL_LABELS[spotlight.channel]}`}
      className="clay-panel bg-card rounded-2xl p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ChannelBadge channel={spotlight.channel} />
          <h2 className="text-sm font-medium">Sinais principais da rede</h2>
        </div>
        <span className="text-muted-foreground text-xs">
          Passe o mouse em <span className="text-foreground">?</span> para entender cada taxa
        </span>
      </div>

      <TooltipProvider>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {spotlight.signals.map((signal) => (
            <div
              key={signal.id}
              className="bg-muted/35 flex flex-col justify-between gap-2 rounded-xl p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground truncate text-xs font-medium">
                    {signal.label}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`O que é ${signal.label}`}
                        className="text-muted-foreground hover:text-foreground shrink-0 rounded-full focus:outline-none"
                      >
                        <HelpCircle className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{signal.explanation}</TooltipContent>
                  </Tooltip>
                </div>

                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
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
            </div>
          ))}
        </div>
      </TooltipProvider>
    </section>
  )
}
