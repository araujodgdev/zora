import { Link } from '@tanstack/react-router'
import { AlertCircle, Bot, ChevronDown, User } from 'lucide-react'
import { useState } from 'react'
import { ChannelBadge } from '@/components/content/channel-badge'
import { LocalDateTime } from '@/components/local-date-time'
import { formatCompactNumber, formatInteger } from '@/lib/analytics'
import type {
  HumanVsAgentMetric,
  RecentPublishFailure,
  TeamMemberMetric,
  WeekdayRhythm,
} from '@/lib/analytics'
import { cn } from '@/lib/utils'

/**
 * Progressive-disclosure operational details:
 * - Weekday publishing rhythm
 * - Team production & Human vs. AI Agent collaboration
 * - Recent automatic publishing failures (always expanded when failures exist)
 */
export function AnalyticsOperations({
  weekdayRhythm,
  team,
  collaboration,
  recentFailures,
}: {
  weekdayRhythm: ReadonlyArray<WeekdayRhythm>
  team: ReadonlyArray<TeamMemberMetric>
  collaboration: HumanVsAgentMetric
  recentFailures: ReadonlyArray<RecentPublishFailure>
}) {
  const [expanded, setExpanded] = useState(recentFailures.length > 0)
  const [hoveredWeekday, setHoveredWeekday] = useState<number | null>(null)

  const maxWeekday = Math.max(...weekdayRhythm.map((d) => d.published), 1)
  const activeDay =
    hoveredWeekday != null
      ? weekdayRhythm.find((d) => d.weekday === hoveredWeekday) ?? null
      : null
  const totalCreativeHuman = collaboration.designVersionsHuman + collaboration.photoVersionsHuman
  const totalCreativeAgent = collaboration.designVersionsAgent + collaboration.photoVersionsAgent
  const totalCreative = totalCreativeHuman + totalCreativeAgent
  const totalPublishes =
    collaboration.publishesManual + collaboration.publishesScheduled + collaboration.publishesMcp

  return (
    <section aria-label="Detalhes operacionais e equipe" className="clay-panel bg-card rounded-2xl p-5 md:p-6">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">
            Melhores dias, equipe e agentes
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Dias da semana em que você mais posta, colaboração com agentes e status de publicação.
          </p>
        </div>
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium">
          {expanded ? 'Recolher' : 'Ver detalhes'}
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>

      {expanded ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Weekday rhythm */}
          <div className="bg-muted/30 rounded-xl p-4">
            <h3 className="text-sm font-medium">Dias em que você mais posta</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {activeDay ? (
                <>
                  <span className="text-foreground font-medium">{activeDay.label}</span>
                  {' · '}
                  {formatInteger(activeDay.published)}{' '}
                  {activeDay.published === 1 ? 'post' : 'posts'}
                  {activeDay.avgInteractions != null
                    ? ` · média de ${formatCompactNumber(activeDay.avgInteractions)} interações`
                    : ''}
                </>
              ) : (
                'Passe o mouse em um dia para ver detalhes.'
              )}
            </p>
            <div
              className="mt-4 grid grid-cols-7 gap-2"
              onMouseLeave={() => setHoveredWeekday(null)}
            >
              {weekdayRhythm.map((day) => {
                const pct = day.published > 0 ? Math.max((day.published / maxWeekday) * 100, 14) : 6
                const active = hoveredWeekday === day.weekday
                return (
                  <button
                    key={day.weekday}
                    type="button"
                    onMouseEnter={() => setHoveredWeekday(day.weekday)}
                    onFocus={() => setHoveredWeekday(day.weekday)}
                    className="group flex flex-col items-center gap-1.5 focus:outline-none"
                  >
                    <div className="flex h-20 w-full items-end justify-center">
                      <div
                        className={cn(
                          'w-full max-w-7 rounded-t-md transition-all',
                          day.published > 0
                            ? active
                              ? 'bg-lime'
                              : 'bg-lime/75 group-hover:bg-lime'
                            : 'bg-muted',
                        )}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {day.shortLabel}
                    </span>
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {formatInteger(day.published)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Human vs Agent collaboration */}
          <div className="bg-muted/30 flex flex-col justify-between gap-4 rounded-xl p-4">
            <div>
              <h3 className="text-sm font-medium">Colaboração: Equipe vs. Agentes</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Versões criativas (Studio e LightCraft) e acionamentos de publicação.
              </p>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <User className="size-3.5" /> Equipe ({formatInteger(totalCreativeHuman)})
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Bot className="size-3.5" /> Agente MCP ({formatInteger(totalCreativeAgent)})
                    </span>
                  </div>
                  <div className="bg-muted mt-1.5 flex h-2 w-full overflow-hidden rounded-full">
                    {totalCreative > 0 ? (
                      <>
                        <div
                          className="bg-lime h-full"
                          style={{ width: `${(totalCreativeHuman / totalCreative) * 100}%` }}
                        />
                        <div
                          className="bg-violet h-full"
                          style={{ width: `${(totalCreativeAgent / totalCreative) * 100}%` }}
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <MiniStat label="Manual" value={formatInteger(collaboration.publishesManual)} />
                  <MiniStat label="Agendado" value={formatInteger(collaboration.publishesScheduled)} />
                  <MiniStat label="Via MCP" value={formatInteger(collaboration.publishesMcp)} />
                </div>
                {totalPublishes === 0 && totalCreative === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Ainda não há versões salvas ou publicações diretas neste recorte.
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Team production */}
          {team.length > 0 ? (
            <div className="bg-muted/30 rounded-xl p-4 lg:col-span-2">
              <h3 className="text-sm font-medium">Produção por pessoa</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {team.map((member) => (
                  <div
                    key={member.memberId}
                    className="bg-card/80 flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatInteger(member.inProgress)} em andamento ·{' '}
                        {formatInteger(member.designsCreated + member.photoEditsCreated)} criações
                      </p>
                    </div>
                    <span className="bg-lime/20 text-brand shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                      {formatInteger(member.published)} pub.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Recent publish failures */}
          {recentFailures.length > 0 ? (
            <div className="bg-destructive/10 rounded-xl p-4 lg:col-span-2">
              <h3 className="text-destructive flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="size-4" />
                Falhas recentes de publicação
              </h3>
              <div className="mt-3 space-y-2.5">
                {recentFailures.map((failure) => (
                  <div
                    key={failure.jobId}
                    className="bg-card flex flex-col gap-1.5 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChannelBadge channel={failure.channel} />
                        <Link
                          to="/content/$itemId"
                          params={{ itemId: failure.contentItemId }}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {failure.itemTitle}
                        </Link>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">{failure.errorMessage}</p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      <LocalDateTime value={failure.failedAt} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card/80 rounded-lg px-2 py-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-muted-foreground text-[11px]">{label}</div>
    </div>
  )
}
