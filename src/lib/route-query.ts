import { noop } from '@tanstack/react-query'
import type {
  DefaultError,
  QueryClient,
  QueryExecuteOptions,
  QueryKey,
} from '@tanstack/react-query'

/**
 * Loads a query for a route `loader` or `beforeLoad` without making a
 * navigation wait on data the cache already has (stale-while-revalidate).
 *
 * - Cached, usable data resolves at once. When it is older than the query's
 *   `staleTime`, a refresh starts in the background; the page's
 *   `useSuspenseQuery` shows the new data when it arrives.
 * - With nothing cached, or after a mutation invalidated the entry, the
 *   loader waits for the fetch, so a saved change is never shown stale.
 *
 * Plain `queryClient.query(options)` waits for the network whenever the data
 * is stale, which made every visit after `staleTime` block on a round trip to
 * the Worker and D1.
 */
export function loadQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: QueryExecuteOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
): Promise<TData> {
  const state = queryClient.getQueryState(options.queryKey)
  if (state?.data === undefined || state.isInvalidated) {
    return queryClient.query(options)
  }
  // `query` fetches only when the data is stale by the query's `staleTime`.
  void queryClient.query(options).catch(noop)
  return queryClient.query({ ...options, staleTime: 'static' })
}
