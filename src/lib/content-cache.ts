/**
 * Query keys and optimistic cache updates for content items. Client-safe and
 * free of React, so the cache logic can be tested with a bare `QueryClient`.
 *
 * UI code normally does not call these directly: the mutation hooks in
 * `./content.queries` do.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { normalizeScheduleState } from './content'
import type { ContentItem, ContentListFilters } from './content'

/**
 * Query key scheme. Invalidate a prefix to refresh everything below it, e.g.
 * `contentKeys.lists()` refreshes every filtered list.
 */
export const contentKeys = {
  all: ['content'] as const,
  lists: () => [...contentKeys.all, 'list'] as const,
  list: (filters: ContentListFilters) =>
    [...contentKeys.lists(), filters] as const,
  details: () => [...contentKeys.all, 'detail'] as const,
  detail: (id: string) => [...contentKeys.details(), id] as const,
  /** The uploaded media of one item. */
  assets: (id: string) => [...contentKeys.all, 'assets', id] as const,
  /** The designs of one item. */
  designs: (itemId: string) => [...contentKeys.all, 'designs', itemId] as const,
  /** The saved versions of one design. */
  designVersions: (designId: string) =>
    [...contentKeys.all, 'design-versions', designId] as const,
}

/** Fields a drag-and-drop move can change. */
export type ContentItemPatch = Partial<
  Pick<ContentItem, 'status' | 'scheduledAt'>
>

/** The cache entries an optimistic patch touched, as they were before it. */
export type ContentCacheSnapshot = {
  lists: Array<[QueryKey, Array<ContentItem> | undefined]>
  detail: { id: string; item: ContentItem | undefined }
}

/**
 * The item as the server will most likely return it: the patch applied, then
 * the derived values filled in (`published` gets a `publishedAt`).
 */
export function patchContentItem(
  item: ContentItem,
  patch: ContentItemPatch,
  now: Date = new Date(),
): ContentItem {
  return normalizeScheduleState({ ...item, ...patch }, now)
}

/**
 * Applies `patch` to the item in every cached content list and in its detail
 * entry, and returns a snapshot for `rollbackContentItemPatch`.
 *
 * Items stay where they are in each list: a list whose filters or order no
 * longer match is corrected by the refetch after the mutation settles.
 * Queries that have no data yet are left alone.
 */
export function applyContentItemPatch(
  queryClient: QueryClient,
  id: string,
  patch: ContentItemPatch,
  now: Date = new Date(),
): ContentCacheSnapshot {
  const snapshot: ContentCacheSnapshot = {
    lists: queryClient.getQueriesData<Array<ContentItem>>({
      queryKey: contentKeys.lists(),
    }),
    detail: {
      id,
      item: queryClient.getQueryData<ContentItem>(contentKeys.detail(id)),
    },
  }

  queryClient.setQueriesData<Array<ContentItem>>(
    { queryKey: contentKeys.lists() },
    (items) =>
      items?.map((item) =>
        item.id === id ? patchContentItem(item, patch, now) : item,
      ),
  )
  queryClient.setQueryData<ContentItem>(contentKeys.detail(id), (item) =>
    item ? patchContentItem(item, patch, now) : item,
  )

  return snapshot
}

/** Restores the cache entries captured by `applyContentItemPatch`. */
export function rollbackContentItemPatch(
  queryClient: QueryClient,
  snapshot: ContentCacheSnapshot,
): void {
  for (const [queryKey, items] of snapshot.lists) {
    queryClient.setQueryData(queryKey, items)
  }
  queryClient.setQueryData(
    contentKeys.detail(snapshot.detail.id),
    snapshot.detail.item,
  )
}
