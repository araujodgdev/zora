/**
 * Server functions for workspace analytics, per-item analytics, and on-demand
 * social metrics synchronization. Scoped to `context.workspace.id` through
 * `authMiddleware`.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { analyticsFiltersSchema } from './analytics'
import type {
  ItemAnalytics,
  SyncItemMetricsResult,
  SyncWorkspaceMetricsResult,
  WorkspaceAnalytics,
} from './analytics'
import * as analyticsServer from './analytics.server'
import { authMiddleware } from './auth-middleware'
import { contentItemIdSchema } from './content'
import { getServerEnv } from './env.server'
import * as socialMetrics from './social-metrics.server'
import { createTregClient } from './treg.server'

function getTregClient() {
  const env = getServerEnv()
  return createTregClient({
    token: env.TREG_TOKEN,
    baseUrl: env.TREG_BASE_URL,
  })
}

export const getWorkspaceAnalyticsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator((input: unknown) => analyticsFiltersSchema.parse(input ?? {}))
  .handler(
    ({ context, data }): Promise<WorkspaceAnalytics> =>
      analyticsServer.getWorkspaceAnalytics(context.db, context.workspace.id, data),
  )

export const getItemAnalyticsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(async ({ context, data }): Promise<ItemAnalytics> => {
    const result = await analyticsServer.getItemAnalytics(
      context.db,
      context.workspace.id,
      data.id,
    )
    if (!result) throw notFound()
    return result
  })

export const syncWorkspaceMetricsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(
    ({ context }): Promise<SyncWorkspaceMetricsResult> =>
      socialMetrics.syncWorkspaceSocialMetrics(
        { db: context.db, treg: getTregClient() },
        { organizationId: context.workspace.id },
      ),
  )

export const syncItemMetricsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(
    ({ context, data }): Promise<SyncItemMetricsResult> =>
      socialMetrics.syncItemSocialMetrics(
        { db: context.db, treg: getTregClient() },
        { organizationId: context.workspace.id, itemId: data.id },
      ),
  )
