/**
 * TanStack Query helpers for the photo edits of a content item. UI code
 * should use these instead of calling the server functions directly.
 *
 * Reads:  useSuspenseQuery(contentPhotoEditsQueryOptions(itemId)),
 *         useQuery(photoEditVersionsQueryOptions(editId))
 * Writes: the hooks below; each refreshes the item's photo edits (and
 *         versions or media where they change). None is optimistic or shows a
 *         toast: the caller shows the error.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { contentKeys } from './content-cache'
import type { CreateContentPhotoEditInput } from './content-photo-edits'
import {
  createContentPhotoEdit,
  deleteContentPhotoEdit,
  listContentPhotoEdits,
  listPhotoEditVersions,
  publishPhotoEditPreview,
  renameContentPhotoEdit,
  restorePhotoEditVersion,
} from './content-photo-edits.functions'
import { uploadPhotoEditOriginal } from './content-photo-edits.upload'

export function contentPhotoEditsQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: contentKeys.photoEdits(itemId),
    queryFn: () => listContentPhotoEdits({ data: { itemId } }),
  })
}

export function photoEditVersionsQueryOptions(editId: string) {
  return queryOptions({
    queryKey: contentKeys.photoEditVersions(editId),
    queryFn: () => listPhotoEditVersions({ data: { editId } }),
  })
}

/** Starts an edit from an image of the item's media. */
export function useCreateContentPhotoEdit(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<CreateContentPhotoEditInput, 'itemId'>) =>
      createContentPhotoEdit({ data: { ...input, itemId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) }),
  })
}

/** Starts an edit from an uploaded original; `onProgress` gets 0..1. */
export function useUploadPhotoEditOriginal(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { file: File; name?: string; onProgress?: (fraction: number) => void }) =>
      uploadPhotoEditOriginal(itemId, input.file, input.name, input.onProgress),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) }),
  })
}

export function useRenameContentPhotoEdit(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { editId: string; name: string }) =>
      renameContentPhotoEdit({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) }),
  })
}

export function useDeleteContentPhotoEdit(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (editId: string) => deleteContentPhotoEdit({ data: { editId } }),
    onSuccess: ({ editId }) => {
      queryClient.removeQueries({ queryKey: contentKeys.photoEditVersions(editId) })
      return queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) })
    },
  })
}

export function useRestorePhotoEditVersion(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { editId: string; versionId: string }) =>
      restorePhotoEditVersion({ data: input }),
    onSuccess: (_saved, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: contentKeys.photoEdits(itemId) }),
        queryClient.invalidateQueries({ queryKey: contentKeys.photoEditVersions(input.editId) }),
      ]),
  })
}

/** Copies the edit's current preview into the item's media. */
export function usePublishPhotoEditPreview(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (editId: string) => publishPhotoEditPreview({ data: { editId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.assets(itemId) }),
  })
}
