import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from './auth-middleware'
import type { TeamMember } from './content'
import { listTeamMembers as listTeamMembersFromDb } from './content.server'

/** The members of the current workspace (id, name, email), for assignee pickers. */
export const listTeamMembers = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(
    ({ context }): Promise<Array<TeamMember>> =>
      listTeamMembersFromDb(context.db, context.workspace.id),
  )
