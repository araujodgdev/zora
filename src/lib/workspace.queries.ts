/**
 * TanStack Query helpers for workspaces, members and invitations.
 *
 * Reads and inviting are server functions (`@/lib/workspace.functions`). The
 * other writes go through Better Auth's organization endpoints
 * (`authClient.organization`), which enforce the roles. Errors are thrown as
 * `Error`s with a Portuguese message, ready for a toast or an alert.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { authClient } from './auth-client'
import { authErrorMessage } from './auth-errors'
import { teamKeys } from './content.queries'
import {
  inviteWorkspaceMember,
  listMyWorkspaces,
  listWorkspaceInvitations,
  listWorkspaceMembers,
} from './workspace.functions'

export const workspaceKeys = {
  all: ['workspace'] as const,
  mine: () => [...workspaceKeys.all, 'mine'] as const,
  members: () => [...workspaceKeys.all, 'members'] as const,
  invitations: () => [...workspaceKeys.all, 'invitations'] as const,
}

export const myWorkspacesQueryOptions = () =>
  queryOptions({ queryKey: workspaceKeys.mine(), queryFn: () => listMyWorkspaces() })

export const workspaceMembersQueryOptions = () =>
  queryOptions({ queryKey: workspaceKeys.members(), queryFn: () => listWorkspaceMembers() })

export const workspaceInvitationsQueryOptions = () =>
  queryOptions({
    queryKey: workspaceKeys.invitations(),
    queryFn: () => listWorkspaceInvitations(),
  })

type AuthResult<T> = {
  data: T | null
  error: { code?: string; message?: string; status?: number } | null
}

/** Returns the data of a Better Auth client call, or throws a readable error. */
export async function unwrapAuth<T>(call: Promise<AuthResult<T>>, fallback: string): Promise<T> {
  const { data, error } = await call
  if (error) throw new Error(authErrorMessage(error, fallback))
  return data as T
}

/**
 * Invites (or, with `resend`, re-sends the invitation to) an email as a member
 * of the current workspace. Resolves with `emailSent: false` when the
 * invitation was created but its email could not be sent.
 */
export function useInviteMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ email, resend }: { email: string; resend?: boolean }) =>
      inviteWorkspaceMember({ data: { email: email.trim(), resend } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations() }),
  })
}

export function useCancelInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      unwrapAuth(
        authClient.organization.cancelInvitation({ invitationId }),
        'Não foi possível cancelar o convite.',
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations() }),
  })
}

export function useRemoveMember(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) =>
      unwrapAuth(
        authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId }),
        'Não foi possível remover o membro.',
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.members() })
      await queryClient.invalidateQueries({ queryKey: teamKeys.all })
    },
  })
}
