import { useDraggable, useDroppable, DragDropProvider } from '@dnd-kit/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { addDays, format, isSameMonth, isToday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { PageHeader } from '@/components/app-shell'
import { CalendarAgenda } from '@/components/content/calendar-agenda'
import { ContentFilters } from '@/components/content/content-filters'
import { ContentItemCard } from '@/components/content/content-item-card'
import { ContentItemHoverCard } from '@/components/content/content-item-hover-card'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CALENDAR_VIEWS,
  calendarSearchSchema,
  defaultTimeOnDay,
  formatDay,
  getCalendarRange,
  groupItemsByDay,
  moveToDay,
  parseDay,
  resolveCalendarSearch,
  shiftAnchor,
} from '@/lib/calendar'
import type { CalendarRange, CalendarSearch, CalendarView } from '@/lib/calendar'
import type { ContentItem, TeamMember } from '@/lib/content'
import {
  contentFilterSearchSchema,
  toContentListFilters,
} from '@/lib/content-filters'
import type { ContentFilterValues } from '@/lib/content-filters'
import {
  contentListQueryOptions,
  teamMembersQueryOptions,
  useRescheduleContentItem,
} from '@/lib/content.queries'
import { contentDragSensors } from '@/lib/dnd'
import { loadQuery } from '@/lib/route-query'
import { cn } from '@/lib/utils'

/**
 * A month cell shows as many items as fit its height (measured), the last
 * slot becoming "+N outros" when some do not fit. Before the first
 * measurement it shows this many.
 */
const MONTH_CELL_LIMIT = 3
/** Height of a compact item chip and the gap between chips, in px (`gap-1`). */
const CHIP_HEIGHT = 24
const CHIP_GAP = 4

type CalendarPageSearch = ContentFilterValues & CalendarSearch

/** The days on screen and the list query for them, from the URL search. */
function calendarData(search: CalendarPageSearch) {
  const { view, anchor } = resolveCalendarSearch(search)
  const range = getCalendarRange(view, anchor)
  const listOptions = contentListQueryOptions({
    ...toContentListFilters(search),
    scheduledFrom: range.start,
    scheduledTo: range.end,
  })
  return { range, listOptions }
}

export const Route = createFileRoute('/_app/calendar')({
  validateSearch: contentFilterSearchSchema.extend(calendarSearchSchema.shape),
  // "Today" and the day boundaries depend on the browser's time zone, which
  // the server does not know: load and render in the browser only.
  ssr: false,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      loadQuery(context.queryClient, calendarData(deps).listOptions),
      loadQuery(context.queryClient, teamMembersQueryOptions()),
    ])
  },
  head: () => ({ meta: [{ title: 'Calendário · Zora' }] }),
  pendingComponent: CalendarSkeleton,
  component: CalendarPage,
})

function CalendarPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { range, listOptions } = calendarData(search)
  const { data: items } = useSuspenseQuery(listOptions)
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  const reschedule = useRescheduleContentItem()
  const itemsByDay = groupItemsByDay(items)
  const membersById = new Map(members.map((member) => [member.id, member]))
  const weeks = range.days.length / 7
  // Phones get a list of days; a 7-column grid does not fit.
  const isPhone = !useMediaQuery('(min-width: 768px)', true)

  function setFilters(next: ContentFilterValues) {
    void navigate({
      search: (prev) => ({
        ...prev,
        channels: next.channels,
        statuses: next.statuses,
        assigneeId: next.assigneeId,
      }),
      replace: true,
    })
  }

  function moveItem(itemId: string, dayKey: string) {
    const day = parseDay(dayKey)
    const item = items.find((candidate) => candidate.id === itemId)
    if (!day || !item?.scheduledAt) return
    if (formatDay(item.scheduledAt) === dayKey) return
    reschedule.mutate({
      id: item.id,
      scheduledAt: moveToDay(item.scheduledAt, day),
    })
  }

  return (
    // On md+ the page is exactly the usable height (`--page-h`, AppShell):
    // the grid takes what the header and toolbar leave, so the page never
    // scrolls. Small screens scroll, with a minimum grid height.
    <div className="flex flex-col md:h-(--page-h)">
      <div className="flex items-start justify-between gap-4">
        {/* No description: the hint to drag is in each item's preview card. */}
        <PageHeader title="Calendário" className="mb-4" />
        <Button asChild>
          <Link to="/content/new" search={{ from: 'calendar' }}>
            <Plus data-icon="inline-start" />
            Novo item
          </Link>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigation range={range} />
          <h2 className="font-display mr-auto text-2xl font-medium tracking-[-0.01em]">
            {periodTitle(range)}
          </h2>
          <ContentFilters value={search} onChange={setFilters} members={members} />
          <ViewToggle view={range.view} />
        </div>
        {isPhone ? (
          <CalendarAgenda range={range} itemsByDay={itemsByDay} membersById={membersById} />
        ) : (
          <DragDropProvider
            sensors={contentDragSensors}
            onDragEnd={(event) => {
              if (event.canceled) return
              const { source, target } = event.operation
              if (source && target) moveItem(String(source.id), String(target.id))
            }}
          >
            <div className="min-h-0 flex-1 overflow-x-auto">
              <div className="flex h-full min-h-[34rem] min-w-[48rem] flex-col">
                <div className="text-muted-foreground mx-px grid grid-cols-7 gap-px pb-1 text-xs font-medium">
                  {range.days.slice(0, 7).map((day) => (
                    <div key={formatDay(day)} className="px-1.5">
                      {capitalize(format(day, 'EEE', { locale: ptBR }))}
                    </div>
                  ))}
                </div>
                <div
                  role="grid"
                  aria-label={periodTitle(range)}
                  className="bg-foreground/[0.08] grid min-h-0 flex-1 grid-cols-7 gap-px overflow-hidden rounded-xl border"
                  style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
                >
                  {range.days.map((day) => (
                    <DayCell
                      key={formatDay(day)}
                      day={day}
                      range={range}
                      items={itemsByDay.get(formatDay(day)) ?? []}
                      membersById={membersById}
                    />
                  ))}
                </div>
              </div>
            </div>
          </DragDropProvider>
        )}
      </div>
    </div>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function periodTitle(range: CalendarRange): string {
  if (range.view === 'month') {
    return capitalize(format(range.anchor, "MMMM 'de' yyyy", { locale: ptBR }))
  }
  const first = range.days[0]!
  const last = addDays(range.end, -1)
  return `${format(first, "d 'de' MMM", { locale: ptBR })} – ${format(last, "d 'de' MMM 'de' yyyy", { locale: ptBR })}`
}

function PeriodNavigation({ range }: { range: CalendarRange }) {
  const unit = range.view
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" asChild>
        <Link
          to="/calendar"
          search={(prev) => ({
            ...prev,
            date: formatDay(shiftAnchor(unit, range.anchor, -1)),
          })}
          aria-label={unit === 'month' ? 'Mês anterior' : 'Semana anterior'}
        >
          <ChevronLeft />
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link to="/calendar" search={(prev) => ({ ...prev, date: undefined })}>
          Hoje
        </Link>
      </Button>
      <Button variant="outline" size="icon-sm" asChild>
        <Link
          to="/calendar"
          search={(prev) => ({
            ...prev,
            date: formatDay(shiftAnchor(unit, range.anchor, 1)),
          })}
          aria-label={unit === 'month' ? 'Próximo mês' : 'Próxima semana'}
        >
          <ChevronRight />
        </Link>
      </Button>
    </div>
  )
}

function ViewToggle({ view }: { view: CalendarView }) {
  const navigate = Route.useNavigate()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={view}
      aria-label="Visualização"
      onValueChange={(next) => {
        // Clicking the active item reports an empty value; keep the view.
        const nextView = CALENDAR_VIEWS.find((candidate) => candidate === next)
        if (nextView) {
          void navigate({ search: (prev) => ({ ...prev, view: nextView }) })
        }
      }}
    >
      <ToggleGroupItem value="month">Mês</ToggleGroupItem>
      <ToggleGroupItem value="week">Semana</ToggleGroupItem>
    </ToggleGroup>
  )
}

/** How many chip-sized rows fit in the element's height; `null` until measured. */
function useChipCapacity(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [capacity, setCapacity] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const measure = () =>
      setCapacity(
        Math.max(1, Math.floor((element.clientHeight + CHIP_GAP) / (CHIP_HEIGHT + CHIP_GAP))),
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled])
  return capacity
}

function DayCell({
  day,
  range,
  items,
  membersById,
}: {
  day: Date
  range: CalendarRange
  items: Array<ContentItem>
  membersById: ReadonlyMap<string, TeamMember>
}) {
  const navigate = Route.useNavigate()
  const dayKey = formatDay(day)
  const { ref, isDropTarget } = useDroppable({ id: dayKey })
  const monthView = range.view === 'month'
  const listRef = useRef<HTMLDivElement>(null)
  const capacity = useChipCapacity(listRef, monthView) ?? MONTH_CELL_LIMIT
  // When not everything fits, the last slot is the "+N outros" link.
  const visible =
    !monthView || items.length <= capacity ? items : items.slice(0, capacity - 1)
  const hidden = items.length - visible.length
  const newItemSearch = {
    from: 'calendar',
    scheduledAt: defaultTimeOnDay(day).toISOString(),
  } as const

  return (
    <div
      ref={ref}
      role="gridcell"
      aria-label={format(day, "EEEE, d 'de' MMMM", { locale: ptBR })}
      className={cn(
        'bg-card group flex min-h-0 flex-col gap-1 overflow-hidden p-1 transition-colors',
        monthView && !isSameMonth(day, range.anchor) && 'bg-background',
        isDropTarget && 'bg-lime/10 ring-lime/60 ring-1 ring-inset',
      )}
      // A click on the empty part of the cell starts a new item on this day.
      onClick={(event) => {
        if (event.target === event.currentTarget || event.target === listRef.current) {
          void navigate({ to: '/content/new', search: newItemSearch })
        }
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'text-muted-foreground flex size-5 items-center justify-center rounded-full text-[0.6875rem] tabular-nums',
            isToday(day) && 'bg-primary text-primary-foreground font-semibold',
          )}
        >
          {format(day, 'd')}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          asChild
          className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Link
            to="/content/new"
            search={newItemSearch}
            aria-label={`Novo item em ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
          >
            <Plus />
          </Link>
        </Button>
      </div>
      <div
        ref={listRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-1',
          // A week cell is tall; if it still overflows, it scrolls.
          !monthView && 'overflow-y-auto',
        )}
      >
        {visible.map((item) => (
          <DraggableItem
            key={item.id}
            item={item}
            assignee={item.assigneeId ? (membersById.get(item.assigneeId) ?? null) : null}
          />
        ))}
        {hidden > 0 ? (
          <Link
            to="/calendar"
            search={(prev) => ({ ...prev, view: 'week', date: dayKey })}
            className="text-muted-foreground hover:text-foreground flex h-6 shrink-0 items-center px-1.5 text-xs"
          >
            +{hidden} {hidden === 1 ? 'outro' : 'outros'}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

function DraggableItem({
  item,
  assignee,
}: {
  item: ContentItem
  assignee: TeamMember | null
}) {
  const { ref, isDragging } = useDraggable({ id: item.id })
  return (
    <ContentItemHoverCard item={item} assignee={assignee} disabled={isDragging}>
      <ContentItemCard
        ref={ref}
        item={item}
        from="calendar"
        variant="compact"
        className={cn('shrink-0', isDragging && 'opacity-60')}
      />
    </ContentItemHoverCard>
  )
}

function CalendarSkeleton() {
  return (
    <>
      <PageHeader title="Calendário" className="mb-5" />
      <Skeleton className="h-[32rem] w-full md:h-[calc(var(--page-h)-4rem)]" />
    </>
  )
}

