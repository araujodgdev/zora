import { Link } from '@tanstack/react-router'
import { format, isSameMonth, isToday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { defaultTimeOnDay, formatDay } from '@/lib/calendar'
import type { CalendarRange } from '@/lib/calendar'
import type { ContentItem, TeamMember } from '@/lib/content'
import { cn } from '@/lib/utils'
import { ContentItemCard } from './content-item-card'

/** "sexta-feira" -> "Sexta-feira" (CSS `capitalize` would give "Sexta-Feira"). */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The calendar on phones: a list of days instead of a 7-column grid.
 *
 * - Week: all seven days, empty ones with a "Nada agendado" line.
 * - Month: only the days of the month that have items, plus today.
 *
 * Items are full cards (title, channel, status, time, assignee) that open the
 * editor; rescheduling is done there (no drag and drop on a phone list).
 */
export function CalendarAgenda({
  range,
  itemsByDay,
  membersById,
}: {
  range: CalendarRange
  itemsByDay: ReadonlyMap<string, Array<ContentItem>>
  membersById: ReadonlyMap<string, TeamMember>
}) {
  const days =
    range.view === 'week'
      ? range.days
      : range.days.filter(
          (day) =>
            isSameMonth(day, range.anchor) &&
            ((itemsByDay.get(formatDay(day))?.length ?? 0) > 0 || isToday(day)),
        )

  if (days.length === 0) {
    return (
      <div className="bg-card text-muted-foreground grid justify-items-center gap-3 rounded-xl px-6 py-10 text-center text-sm">
        Nada agendado em {format(range.anchor, 'MMMM', { locale: ptBR })}.
        <Button asChild size="sm">
          <Link to="/content/new" search={{ from: 'calendar' }}>
            <Plus data-icon="inline-start" />
            Novo item
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <ol className="grid gap-4" aria-label="Agenda">
      {days.map((day) => {
        const items = itemsByDay.get(formatDay(day)) ?? []
        const today = isToday(day)
        return (
          <li key={formatDay(day)} className="grid gap-2">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'font-display flex size-10 shrink-0 items-center justify-center rounded-full text-xl font-semibold tabular-nums',
                  today ? 'bg-primary text-primary-foreground' : 'bg-card',
                )}
              >
                {format(day, 'd')}
              </span>
              <span className="grid leading-tight">
                <span className="text-sm font-medium">
                  {today ? 'Hoje' : capitalize(format(day, 'EEEE', { locale: ptBR }))}
                </span>
                <span className="text-muted-foreground text-xs">
                  {format(day, "d 'de' MMMM", { locale: ptBR })}
                </span>
              </span>
              <Button variant="ghost" size="icon" asChild className="ml-auto">
                <Link
                  to="/content/new"
                  search={{ from: 'calendar', scheduledAt: defaultTimeOnDay(day).toISOString() }}
                  aria-label={`Novo item em ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                >
                  <Plus />
                </Link>
              </Button>
            </div>
            {items.length > 0 ? (
              <div className="bg-card grid gap-2 rounded-xl p-2">
                {items.map((item) => (
                  <ContentItemCard
                    key={item.id}
                    item={item}
                    from="calendar"
                    assignee={
                      item.assigneeId ? (membersById.get(item.assigneeId) ?? null) : null
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground pl-13 text-sm">Nada agendado.</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
