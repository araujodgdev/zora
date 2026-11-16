/**
 * Content filter state as URL search params. Client-safe.
 *
 * Use `contentFilterSearchSchema` as (part of) a route's `validateSearch` and
 * `toContentListFilters` to turn the validated search into the filters the
 * data layer expects. `<ContentFilters>` edits the same value shape.
 */
import { z } from 'zod'
import { CHANNELS, STATUSES } from './content'
import type { Channel, ContentListFilters, ContentStatus } from './content'

/**
 * A multi-select search param. Values outside `values` are dropped one by one,
 * duplicates are removed and the result follows the order of `values`, so the
 * same selection always yields the same query key. Anything that is not an
 * array, or has no valid value left, becomes `undefined`.
 */
function enumListSearchParam<T extends string>(values: readonly [T, ...Array<T>]) {
  return z
    .array(z.enum(values).optional().catch(undefined))
    .transform((list) => {
      const kept = values.filter((value) => list.includes(value))
      return kept.length > 0 ? kept : undefined
    })
    .optional()
    .catch(undefined)
}

/**
 * Search params for the channel, status and assignee filters. Unknown or
 * malformed values are dropped instead of raising an error, so a stale or
 * hand-edited URL still renders.
 */
export const contentFilterSearchSchema = z.object({
  channels: enumListSearchParam(CHANNELS),
  statuses: enumListSearchParam(STATUSES),
  assigneeId: z.string().trim().min(1).optional().catch(undefined),
})

/** The validated filter state; also the `value` of `<ContentFilters>`. */
export type ContentFilterValues = {
  channels?: Array<Channel>
  statuses?: Array<ContentStatus>
  assigneeId?: string
}

/**
 * Converts validated filter search values into data-layer list filters.
 * Unset filters are omitted, so "no filters" is `{}` and shares the cache
 * entry of `contentListQueryOptions()`. Spread a date range next to it when a
 * view needs one: `{ ...toContentListFilters(search), scheduledFrom, scheduledTo }`.
 */
export function toContentListFilters(
  search: ContentFilterValues,
): ContentListFilters {
  const filters: ContentListFilters = {}
  if (search.channels?.length) filters.channels = search.channels
  if (search.statuses?.length) filters.statuses = search.statuses
  if (search.assigneeId) filters.assigneeId = search.assigneeId
  return filters
}

/** Whether any filter is set (e.g. to show a "Clear" control). */
export function hasContentFilters(search: ContentFilterValues): boolean {
  return Object.keys(toContentListFilters(search)).length > 0
}
