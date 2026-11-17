import { UserRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { TeamMember } from '@/lib/content'
import { cn } from '@/lib/utils'

/** "Ada Lovelace" -> "AL", "ada" -> "A"; falls back to the email. */
function initialsOf(member: TeamMember): string {
  const words = member.name.trim().split(/\s+/).filter(Boolean)
  const first = words[0] ?? member.email
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : ''
  return `${Array.from(first)[0] ?? '?'}${Array.from(last)[0] ?? ''}`.toUpperCase()
}

type AssigneeAvatarProps = {
  /** The assigned team member; `null` renders the "unassigned" state. */
  member: TeamMember | null
  size?: 'sm' | 'default'
  className?: string
}

/**
 * A team member's initials, with the full name in a tooltip, or a dashed
 * placeholder when nobody is assigned. Needs the `TooltipProvider` mounted in
 * the root route.
 */
export function AssigneeAvatar({
  member,
  size = 'default',
  className,
}: AssigneeAvatarProps) {
  const label = member ? member.name : 'Sem responsável'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar
          size={size}
          data-assigned={member ? 'true' : 'false'}
          className={cn(
            !member && 'after:border-dashed after:border-muted-foreground/60',
            className,
          )}
        >
          <AvatarFallback
            aria-hidden="true"
            className={cn(
              'font-medium',
              member ? 'bg-secondary text-secondary-foreground' : 'bg-transparent',
            )}
          >
            {member ? initialsOf(member) : <UserRound className="size-3.5" />}
          </AvatarFallback>
          <span className="sr-only">
            {member ? `Responsável: ${label}` : label}
          </span>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
