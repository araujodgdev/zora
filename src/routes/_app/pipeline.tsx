import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { addDays } from 'date-fns'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/app-shell'
import { ContentFilters } from '@/components/content/content-filters'
import { ContentItemCard } from '@/components/content/content-item-card'
import { StatusBadge } from '@/components/content/status-badge'
import { FormField } from '@/components/form-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { STATUSES, STATUS_LABELS } from '@/lib/content'
import type { ContentItem, ContentStatus, TeamMember } from '@/lib/content'
import {
  contentFilterSearchSchema,
  toContentListFilters,
} from '@/lib/content-filters'
import type { ContentFilterValues } from '@/lib/content-filters'
import {
  contentListQueryOptions,
  teamMembersQueryOptions,
  useChangeContentItemStatus,
  useUpdateContentItem,
} from '@/lib/content.queries'
import { defaultTimeOnDay } from '@/lib/calendar'
import { contentDragSensors } from '@/lib/dnd'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/dates'
import { loadQuery } from '@/lib/route-query'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/pipeline')({
  validateSearch: contentFilterSearchSchema,
  loaderDeps: ({ search }) => ({ filters: toContentListFilters(search) }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      loadQuery(context.queryClient, contentListQueryOptions(deps.filters)),
      loadQuery(context.queryClient, teamMembersQueryOptions()),
    ])
  },
  head: () => ({ meta: [{ title: 'Pipeline · Zora' }] }),
  component: PipelinePage,
})

function PipelinePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: items } = useSuspenseQuery(
    contentListQueryOptions(toContentListFilters(search)),
  )
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  const changeStatus = useChangeContentItemStatus()
  // An unscheduled item dropped on "Scheduled" waits here for a date.
  const [schedulingItem, setSchedulingItem] = useState<ContentItem | null>(null)
  const membersById = new Map(members.map((member) => [member.id, member]))

  function setFilters(next: ContentFilterValues) {
    void navigate({ search: next, replace: true })
  }

  function moveItem(itemId: string, status: ContentStatus) {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || item.status === status) return
    if (status === 'scheduled' && !item.scheduledAt) {
      // The server rejects a scheduled item without a date: ask for one.
      setSchedulingItem(item)
      return
    }
    changeStatus.mutate({ id: item.id, status })
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Pipeline"
          description="Arraste um card para outra coluna para mudar o status."
        />
        <Button asChild>
          <Link to="/content/new" search={{ from: 'pipeline' }}>
            <Plus data-icon="inline-start" />
            Novo item
          </Link>
        </Button>
      </div>
      <div className="grid gap-4">
        <ContentFilters value={search} onChange={setFilters} members={members} />
        <DragDropProvider
          sensors={contentDragSensors}
          onDragEnd={(event) => {
            if (event.canceled) return
            const { source, target } = event.operation
            if (!source || !target) return
            const status = STATUSES.find((candidate) => candidate === target.id)
            if (status) moveItem(String(source.id), status)
          }}
        >
          {/* Below xl the columns scroll sideways and snap (about one column on
              phones, two on small tablets, three on iPads); xl and up show all
              five side by side. */}
          <div className="-mx-4 scroll-px-4 overflow-x-auto px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0">
            <div className="flex snap-x snap-mandatory gap-3 xl:grid xl:min-w-[62rem] xl:grid-cols-5">
              {STATUSES.map((status) => (
                <StatusColumn
                  key={status}
                  status={status}
                  items={items.filter((item) => item.status === status)}
                  membersById={membersById}
                />
              ))}
            </div>
          </div>
        </DragDropProvider>
      </div>
      <ScheduleDialog
        // Remount per item so the date field starts fresh.
        key={schedulingItem?.id}
        item={schedulingItem}
        onClose={() => setSchedulingItem(null)}
      />
    </>
  )
}

function StatusColumn({
  status,
  items,
  membersById,
}: {
  status: ContentStatus
  items: Array<ContentItem>
  membersById: ReadonlyMap<string, TeamMember>
}) {
  const { ref, isDropTarget } = useDroppable({ id: status })
  return (
    <section
      ref={ref}
      aria-label={STATUS_LABELS[status]}
      className={cn(
        'bg-card flex min-h-96 shrink-0 basis-[85%] snap-start flex-col gap-2 rounded-xl p-2 ring-1 ring-transparent transition-colors sm:basis-[46%] md:basis-[31%] xl:basis-auto',
        isDropTarget && 'bg-lime/10 ring-lime/60',
      )}
    >
      <header className="flex items-center justify-between px-1 py-0.5">
        <span className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-muted-foreground text-xs tabular-nums">
            {items.length}
          </span>
        </span>
        <Button variant="ghost" size="icon-xs" asChild>
          <Link
            to="/content/new"
            search={{ from: 'pipeline', status }}
            aria-label={`Novo item em ${STATUS_LABELS[status]}`}
          >
            <Plus />
          </Link>
        </Button>
      </header>
      {items.map((item) => (
        <DraggableCard
          key={item.id}
          item={item}
          assignee={
            item.assigneeId ? (membersById.get(item.assigneeId) ?? null) : null
          }
        />
      ))}
    </section>
  )
}

function DraggableCard({
  item,
  assignee,
}: {
  item: ContentItem
  assignee: TeamMember | null
}) {
  const { ref, isDragging } = useDraggable({ id: item.id })
  return (
    <ContentItemCard
      ref={ref}
      item={item}
      from="pipeline"
      assignee={assignee}
      className={cn(isDragging && 'opacity-60')}
    />
  )
}

/**
 * Asks for the date of an item dropped on "Scheduled" that has none, then
 * saves status and date together. Closing it leaves the item where it was.
 */
function ScheduleDialog({
  item,
  onClose,
}: {
  item: ContentItem | null
  onClose: () => void
}) {
  const updateItem = useUpdateContentItem()
  const [value, setValue] = useState(() =>
    toDateTimeLocalValue(defaultTimeOnDay(addDays(new Date(), 1))),
  )
  const [error, setError] = useState<string | null>(null)

  async function schedule() {
    if (!item) return
    const scheduledAt = fromDateTimeLocalValue(value)
    if (!scheduledAt) {
      setError('Escolha data e hora.')
      return
    }
    try {
      await updateItem.mutateAsync({ id: item.id, status: 'scheduled', scheduledAt })
      onClose()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'Não foi possível agendar o item.',
      )
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar este item</DialogTitle>
          <DialogDescription>
            “{item?.title}” ainda não tem data. Um item agendado precisa de uma.
          </DialogDescription>
        </DialogHeader>
        <FormField id="schedule-at" label="Agendado para">
          <Input
            id="schedule-at"
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={updateItem.isPending}
            onClick={() => void schedule()}
          >
            {updateItem.isPending ? 'Agendando…' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
