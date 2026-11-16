/**
 * TanStack Query helpers for content and team data. UI code should use these
 * instead of calling server functions or writing query keys by hand.
 *
 * Reads:   useQuery / useSuspenseQuery(contentListQueryOptions(filters))
 *          route loaders: context.queryClient.query(contentListQueryOptions(filters))
 * Writes:  const create = useCreateContentItem(); create.mutate(input)
 *
 * Every mutation invalidates all content lists and refreshes the affected
 * item's detail entry, so views stay consistent without extra code.
 *
 * `useRescheduleContentItem` and `useChangeContentItemStatus` (the drag
 * mutations) are optimistic: the cache changes at once, and a failure rolls
 * it back and shows an error toast. The other hooks leave errors to the
 * calling form.
 */
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { isNotFound } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  applyContentItemPatch,
  contentKeys,
  rollbackContentItemPatch,
} from './content-cache'
import type { ContentItemPatch } from './content-cache'
import type {
  ChangeContentItemStatusInput,
  ContentItem,
  ContentListFilters,
  CreateContentItemInput,
  RescheduleContentItemInput,
  UpdateContentItemInput,
} from './content'
import {
  changeContentItemStatus,
  createContentItem,
  deleteContentItem,
  getContentItem,
  listContentItems,
  rescheduleContentItem,
  updateContentItem,
} from './content.functions'
import { listTeamMembers } from './team.functions'

// The key scheme lives next to the cache-update logic; import it from here.
export { contentKeys }

export const teamKeys = {
  all: ['team'] as const,
  members: () => [...teamKeys.all, 'members'] as const,
}

export function contentListQueryOptions(filters: ContentListFilters = {}) {
  return queryOptions({
    queryKey: contentKeys.list(filters),
    queryFn: () => listContentItems({ data: filters }),
  })
}

export function contentItemQueryOptions(id: string) {
  return queryOptions({
    queryKey: contentKeys.detail(id),
    queryFn: () => getContentItem({ data: { id } }),
  })
}

export function teamMembersQueryOptions() {
  return queryOptions({
    queryKey: teamKeys.members(),
    queryFn: () => listTeamMembers(),
    staleTime: 5 * 60_000,
  })
}

/** Cache update shared by every mutation that returns the saved item. */
function onItemSaved(queryClient: QueryClient, item: ContentItem) {
  queryClient.setQueryData(contentKeys.detail(item.id), item)
  return queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
}

export function useCreateContentItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateContentItemInput) =>
      createContentItem({ data: input }),
    onSuccess: (item) => onItemSaved(queryClient, item),
  })
}

export function useUpdateContentItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateContentItemInput) =>
      updateContentItem({ data: input }),
    onSuccess: (item) => onItemSaved(queryClient, item),
  })
}

/** Shared by the optimistic mutations, to count the ones still in flight. */
const optimisticItemMutationKey = [...contentKeys.all, 'optimistic'] as const

function mutationErrorMessage(error: unknown): string {
  if (isNotFound(error)) return 'This item no longer exists.'
  if (error instanceof Error && error.message) return error.message
  return 'Could not save the change.'
}

/**
 * A mutation that shows its result before the server confirms it, following
 * the "via the cache" recipe of the TanStack Query optimistic updates guide:
 * cancel refetches, snapshot, patch the cache, roll back on error, refetch
 * once settled.
 */
function useOptimisticItemMutation<TInput extends { id: string }>(
  mutationFn: (input: TInput) => Promise<ContentItem>,
  toPatch: (input: TInput) => ContentItemPatch,
) {
  return useMutation({
    mutationKey: optimisticItemMutationKey,
    mutationFn,
    onMutate: async (input, context) => {
      // A refetch landing now would overwrite the optimistic state.
      await context.client.cancelQueries({ queryKey: contentKeys.all })
      return applyContentItemPatch(context.client, input.id, toPatch(input))
    },
    onError: (error, _input, snapshot, context) => {
      if (snapshot) rollbackContentItemPatch(context.client, snapshot)
      toast.error(mutationErrorMessage(error))
    },
    onSettled: (_item, _error, input, _snapshot, context) => {
      // With several moves in flight, only the last one refetches; an earlier
      // refetch would briefly undo the optimistic state of the later ones.
      if (
        context.client.isMutating({ mutationKey: optimisticItemMutationKey }) > 1
      ) {
        return
      }
      return Promise.all([
        context.client.invalidateQueries({ queryKey: contentKeys.lists() }),
        context.client.invalidateQueries({
          queryKey: contentKeys.detail(input.id),
        }),
      ])
    },
  })
}

/**
 * Sets or clears `scheduledAt` only. Intended for calendar drag-and-drop.
 * Optimistic; shows an error toast and rolls back on failure.
 */
export function useRescheduleContentItem() {
  return useOptimisticItemMutation(
    (input: RescheduleContentItemInput) =>
      rescheduleContentItem({ data: input }),
    (input) => ({
      scheduledAt:
        input.scheduledAt === null ? null : new Date(input.scheduledAt),
    }),
  )
}

/**
 * Changes `status` only. Intended for pipeline board moves.
 * Optimistic; shows an error toast and rolls back on failure.
 */
export function useChangeContentItemStatus() {
  return useOptimisticItemMutation(
    (input: ChangeContentItemStatusInput) =>
      changeContentItemStatus({ data: input }),
    (input) => ({ status: input.status }),
  )
}

export function useDeleteContentItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteContentItem({ data: { id } }),
    onSuccess: ({ id }) => {
      queryClient.removeQueries({ queryKey: contentKeys.detail(id) })
      return queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
    },
  })
}
