import { CalendarClock } from 'lucide-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { LocalDateTime } from '@/components/local-date-time'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { FORMAT_LABELS } from '@/lib/content'
import type { ContentItem, TeamMember } from '@/lib/content'
import { isMarkdownChannel, stripMarkdown } from '@/lib/post-text'
import { AssigneeAvatar } from './assignee-avatar'
import { ChannelBadge } from './channel-badge'
import { StatusBadge } from './status-badge'

/** Characters of the text shown in the preview. */
const EXCERPT_LENGTH = 280

function excerpt(item: ContentItem): string {
  const text = isMarkdownChannel(item.channel) ? stripMarkdown(item.body) : item.body
  const trimmed = text.trim()
  return trimmed.length > EXCERPT_LENGTH
    ? `${trimmed.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : trimmed
}

/**
 * A floating overview of an item, shown while the pointer rests on (or the
 * keyboard focuses) `children`: channel, status, format, title, date,
 * assignee and the start of the text. `children` must be a single element
 * that takes a ref (e.g. `ContentItemCard`); it stays the clickable link.
 * Closed while `disabled` (during a drag).
 */
export function ContentItemHoverCard({
  item,
  assignee,
  disabled = false,
  children,
}: {
  item: ContentItem
  assignee: TeamMember | null
  disabled?: boolean
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const text = excerpt(item)

  return (
    <HoverCard
      openDelay={350}
      closeDelay={100}
      open={open && !disabled}
      onOpenChange={setOpen}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="grid w-80 gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChannelBadge channel={item.channel} />
          <StatusBadge status={item.status} />
          <span className="text-muted-foreground text-xs">
            {FORMAT_LABELS[item.format]}
          </span>
        </div>
        <p className="font-display text-lg leading-snug font-semibold">
          {item.title}
        </p>
        <div className="text-muted-foreground grid gap-1.5 text-xs">
          <span className="flex items-center gap-2">
            <CalendarClock className="size-3.5 shrink-0" />
            <LocalDateTime value={item.scheduledAt} fallback="Sem data" />
          </span>
          <span className="flex items-center gap-2">
            <AssigneeAvatar member={assignee} size="sm" />
            {assignee?.name ?? 'Sem responsável'}
          </span>
        </div>
        {text ? (
          <p className="text-foreground/85 line-clamp-6 text-sm leading-relaxed whitespace-pre-line">
            {text}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Sem texto ainda.</p>
        )}
        <p className="text-muted-foreground border-t pt-2 text-xs">
          Clique para abrir. Arraste para outro dia para reagendar.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
