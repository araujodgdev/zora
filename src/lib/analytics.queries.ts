/**
 * TanStack Query helpers and mutation hooks for analytics and social metrics.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AnalyticsFilters } from './analytics'
import {
  getItemAnalyticsFn,
  getWorkspaceAnalyticsFn,
  syncItemMetricsFn,
  syncWorkspaceMetricsFn,
} from './analytics.functions'

export const analyticsKeys = {
  all: ['analytics'] as const,
  workspaces: () => [...analyticsKeys.all, 'workspace'] as const,
  workspace: (filters: AnalyticsFilters) => [...analyticsKeys.workspaces(), filters] as const,
  items: () => [...analyticsKeys.all, 'item'] as const,
  item: (itemId: string) => [...analyticsKeys.items(), itemId] as const,
}

export function workspaceAnalyticsQueryOptions(filters: AnalyticsFilters) {
  return queryOptions({
    queryKey: analyticsKeys.workspace(filters),
    queryFn: () => getWorkspaceAnalyticsFn({ data: filters }),
    staleTime: 30_000,
  })
}

export function itemAnalyticsQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: analyticsKeys.item(itemId),
    queryFn: () => getItemAnalyticsFn({ data: { id: itemId } }),
    staleTime: 30_000,
  })
}

export function useSyncWorkspaceMetrics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncWorkspaceMetricsFn(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.all })
    },
  })
}

export function useSyncItemMetrics(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncItemMetricsFn({ data: { id: itemId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.item(itemId) })
      void queryClient.invalidateQueries({ queryKey: analyticsKeys.workspaces() })
    },
  })
}
