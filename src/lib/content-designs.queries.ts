/**
 * TanStack Query helpers for the designs of a content item. UI code should
 * use these instead of calling the server functions directly.
 *
 * Reads:  useSuspenseQuery(contentDesignsQueryOptions(itemId)),
 *         useQuery(designVersionsQueryOptions(designId))
 * Writes: the hooks below; each refreshes the item's designs (and versions or
 *         media where they change). None is optimistic or shows a toast: the
 *         caller shows the error.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { contentKeys } from './content-cache'
import type { CreateContentDesignInput } from './content-designs'
import {
  createContentDesign,
  deleteContentDesign,
  listContentDesigns,
  listDesignVersions,
  publishDesignPreview,
  renameContentDesign,
  restoreDesignVersion,
} from './content-designs.functions'

export function contentDesignsQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: contentKeys.designs(itemId),
    queryFn: () => listContentDesigns({ data: { itemId } }),
  })
}

export function designVersionsQueryOptions(designId: string) {
  return queryOptions({
    queryKey: contentKeys.designVersions(designId),
    queryFn: () => listDesignVersions({ data: { designId } }),
  })
}

export function useCreateContentDesign(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<CreateContentDesignInput, 'itemId'>) =>
      createContentDesign({ data: { ...input, itemId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) }),
  })
}

export function useRenameContentDesign(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { designId: string; name: string }) =>
      renameContentDesign({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) }),
  })
}

export function useDeleteContentDesign(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (designId: string) => deleteContentDesign({ data: { designId } }),
    onSuccess: ({ designId }) => {
      queryClient.removeQueries({ queryKey: contentKeys.designVersions(designId) })
      return queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) })
    },
  })
}

export function useRestoreDesignVersion(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { designId: string; versionId: string }) =>
      restoreDesignVersion({ data: input }),
    onSuccess: (_saved, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: contentKeys.designs(itemId) }),
        queryClient.invalidateQueries({ queryKey: contentKeys.designVersions(input.designId) }),
      ]),
  })
}

/** Copies the design's current PNG into the item's media. */
export function usePublishDesignPreview(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (designId: string) => publishDesignPreview({ data: { designId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.assets(itemId) }),
  })
}
