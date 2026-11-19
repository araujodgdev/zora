/**
 * TanStack Query helpers for social connections and publish jobs.
 * UI components should use these hooks and query options rather than calling
 * server functions directly.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { contentKeys } from './content-cache'
import type {
  PublishContentItemInput,
  SelectSocialResourceInput,
  SocialChannel,
  StartSocialConnectionInput,
} from './social'
import {
  disconnectSocialConnection,
  listItemPublishJobs,
  listSocialConnections,
  listSocialResources,
  pollPublishJob,
  pollSocialConnection,
  publishContentItem,
  selectSocialResource,
  startSocialConnection,
  syncSocialConnections,
} from './social.functions'

export const socialKeys = {
  all: ['social'] as const,
  connections: () => [...socialKeys.all, 'connections'] as const,
  resources: (channel: SocialChannel) =>
    [...socialKeys.all, 'resources', channel] as const,
  publishJobs: (itemId: string) =>
    [...socialKeys.all, 'publish-jobs', itemId] as const,
}

export function socialConnectionsQueryOptions() {
  return queryOptions({
    queryKey: socialKeys.connections(),
    queryFn: () => listSocialConnections(),
  })
}

export function socialResourcesQueryOptions(channel: SocialChannel) {
  return queryOptions({
    queryKey: socialKeys.resources(channel),
    queryFn: () => listSocialResources({ data: { channel } }),
  })
}

export function itemPublishJobsQueryOptions(itemId: string) {
  return queryOptions({
    queryKey: socialKeys.publishJobs(itemId),
    queryFn: () => listItemPublishJobs({ data: { itemId } }),
  })
}

export function useStartSocialConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StartSocialConnectionInput) =>
      startSocialConnection({ data: input }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: socialKeys.connections() }),
  })
}

export function usePollSocialConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (channel: SocialChannel) =>
      pollSocialConnection({ data: { channel } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: socialKeys.connections() }),
  })
}

export function useSyncSocialConnections() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncSocialConnections(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: socialKeys.connections() }),
  })
}

export function useSelectSocialResource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SelectSocialResourceInput) =>
      selectSocialResource({ data: input }),
    onSuccess: (_conn, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: socialKeys.connections() }),
        queryClient.invalidateQueries({
          queryKey: socialKeys.resources(input.channel),
        }),
      ]),
  })
}

export function useDisconnectSocialConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (channel: SocialChannel) =>
      disconnectSocialConnection({ data: { channel } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: socialKeys.connections() }),
  })
}

export function usePublishContentItem(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (options?: PublishContentItemInput['options']) =>
      publishContentItem({ data: { itemId, options } }),
    onSuccess: (result) => {
      const invalidations: Array<Promise<unknown>> = [
        queryClient.invalidateQueries({ queryKey: socialKeys.publishJobs(itemId) }),
      ]
      if (result.item) {
        queryClient.setQueryData(contentKeys.detail(itemId), result.item)
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(itemId) }),
        )
      }
      return Promise.all(invalidations)
    },
  })
}

export function usePollPublishJob(itemId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => pollPublishJob({ data: { jobId } }),
    onSuccess: (result) => {
      const invalidations: Array<Promise<unknown>> = [
        queryClient.invalidateQueries({ queryKey: socialKeys.publishJobs(itemId) }),
      ]
      if (result.item) {
        queryClient.setQueryData(contentKeys.detail(itemId), result.item)
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: contentKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: contentKeys.detail(itemId) }),
        )
      }
      return Promise.all(invalidations)
    },
  })
}
