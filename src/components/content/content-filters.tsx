import { ChevronDown, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CHANNELS,
  CHANNEL_LABELS,
  STATUSES,
  STATUS_LABELS,
} from '@/lib/content'
import type { TeamMember } from '@/lib/content'
import { hasContentFilters } from '@/lib/content-filters'
import type { ContentFilterValues } from '@/lib/content-filters'
import { cn } from '@/lib/utils'

// Radix Select items cannot have an empty value.
const ANY_ASSIGNEE = '__any__'

type ContentFiltersProps = {
  value: ContentFilterValues
  onChange: (value: ContentFilterValues) => void
  /** Options of the assignee filter (`teamMembersQueryOptions()`). */
  members: ReadonlyArray<TeamMember>
  className?: string
}

/**
 * Filter bar for channels, statuses and assignee. Controlled: the page owns
 * the state, normally in the URL through `contentFilterSearchSchema`. Cleared
 * filters are reported as `undefined`, so they vanish from the URL.
 */
export function ContentFilters({
  value,
  onChange,
  members,
  className,
}: ContentFiltersProps) {
  return (
    <div
      role="group"
      aria-label="Filtros"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <MultiSelectFilter
        label="Canal"
        options={CHANNELS}
        labels={CHANNEL_LABELS}
        selected={value.channels ?? []}
        onChange={(channels) => onChange({ ...value, channels })}
      />
      <MultiSelectFilter
        label="Status"
        options={STATUSES}
        labels={STATUS_LABELS}
        selected={value.statuses ?? []}
        onChange={(statuses) => onChange({ ...value, statuses })}
      />
      <Select
        value={value.assigneeId ?? ANY_ASSIGNEE}
        onValueChange={(assigneeId) =>
          onChange({
            ...value,
            assigneeId: assigneeId === ANY_ASSIGNEE ? undefined : assigneeId,
          })
        }
      >
        <SelectTrigger size="sm" aria-label="Responsável" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY_ASSIGNEE}>Qualquer responsável</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {hasContentFilters(value) ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <X data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

function MultiSelectFilter<T extends string>({
  label,
  options,
  labels,
  selected,
  onChange,
}: {
  label: string
  options: ReadonlyArray<T>
  labels: Record<T, string>
  selected: ReadonlyArray<T>
  /** Receives the selection in `options` order, or `undefined` when empty. */
  onChange: (selected: Array<T> | undefined) => void
}) {
  function toggle(option: T, checked: boolean) {
    const next = options.filter((candidate) =>
      candidate === option ? checked : selected.includes(candidate),
    )
    onChange(next.length > 0 ? next : undefined)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
          {selected.length > 0 ? (
            <Badge variant="secondary" className="h-4 px-1.5">
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selected.includes(option)}
              onCheckedChange={(checked) => toggle(option, checked)}
              // Keep the menu open while ticking several options.
              onSelect={(event) => event.preventDefault()}
            >
              {labels[option]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
