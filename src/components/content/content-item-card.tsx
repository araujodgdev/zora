import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { LocalDateTime } from '@/components/local-date-time'
import type { ContentItem, TeamMember } from '@/lib/content'
import type { EditorOrigin } from '@/lib/editor-search'
import { cn } from '@/lib/utils'
import { AssigneeAvatar } from './assignee-avatar'
import { ChannelBadge } from './channel-badge'
import { StatusBadge } from './status-badge'

type ContentItemCardProps = Omit<ComponentProps<'a'>, 'href' | 'children'> & {
  item: ContentItem
  /**
   * `card` (default): title, channel, status, scheduled date and assignee,
   * for the board. `compact`: a one-line chip with channel, time and title,
   * for calendar cells.
   */
  variant?: 'card' | 'compact'
  /** The page showing the card; the editor returns there. */
  from: EditorOrigin
  /** The item's assignee (`card` variant only); `null` when unassigned. */
  assignee?: TeamMember | null
}

/**
 * One content item, linking to its editor (`/content/$itemId?from=...`).
 *
 * The root element is the link itself. `ref` and any other anchor props are
 * passed to it, so it can be a drag-and-drop element directly:
 *
 *   const { ref, isDragging } = useDraggable({ id: item.id })
 *   <ContentItemCard ref={ref} item={item} from="pipeline" />
 *
 * Times are rendered by `<LocalDateTime>`: in the browser's time zone, after
 * hydration.
 */
export function ContentItemCard({
  item,
  variant = 'card',
  from,
  assignee = null,
  className,
  ...props
}: ContentItemCardProps) {
  return (
    <Link
      to="/content/$itemId"
      params={{ itemId: item.id }}
      search={{ from }}
      // dnd-kit gives a draggable without a role `role="button"`; this is a link.
      role="link"
      data-slot="content-item-card"
      data-variant={variant}
      className={cn(
        'bg-card text-card-foreground hover:bg-muted/60 focus-visible:ring-ring/50 border outline-none transition-colors focus-visible:ring-3',
        variant === 'compact'
          ? 'flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs'
          : 'flex flex-col gap-2 rounded-lg p-3 text-sm shadow-xs',
        className,
      )}
      {...props}
    >
      {variant === 'compact' ? (
        <>
          <ChannelBadge channel={item.channel} compact />
          {item.scheduledAt ? (
            <span className="text-muted-foreground shrink-0 tabular-nums">
              <LocalDateTime value={item.scheduledAt} format="time" />
            </span>
          ) : null}
          <span className="truncate font-medium">{item.title}</span>
        </>
      ) : (
        <>
          <span className="line-clamp-2 font-medium">{item.title}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            <ChannelBadge channel={item.channel} />
            <StatusBadge status={item.status} />
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              <LocalDateTime value={item.scheduledAt} fallback="Unscheduled" />
            </span>
            <AssigneeAvatar member={assignee} size="sm" />
          </span>
        </>
      )}
    </Link>
  )
}
