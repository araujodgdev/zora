/**
 * Server functions for social-account connections and social publishing.
 * Every function requires a workspace session through `authMiddleware` and
 * strictly scopes its reads and writes to `context.workspace.id`.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import { authMiddleware } from './auth-middleware'
import { getServerEnv } from './env.server'
import { getMediaBucket } from './media-bucket.server'
import {
  disconnectSocialConnectionSchema,
  listItemPublishJobsSchema,
  pollPublishJobSchema,
  pollSocialConnectionSchema,
  publishContentItemSchema,
  selectSocialResourceSchema,
  startSocialConnectionSchema,
} from './social'
import type {
  SocialConnection,
  SocialPublishJob,
  SocialResourceOption,
} from './social'
import * as connections from './social-connections.server'
import type {
  PolledChannelConnection,
  StartedChannelConnection,
} from './social-connections.server'
import * as publishing from './social-publish.server'
import type { PublishNowResult } from './social-publish.server'
import {
  SocialPublishingError,
  TregNotConfiguredError,
  createTregClient,
} from './treg.server'

function getTregClient() {
  const env = getServerEnv()
  return createTregClient({
    token: env.TREG_TOKEN,
    baseUrl: env.TREG_BASE_URL,
  })
}

async function withSocialErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TregNotConfiguredError) {
      setResponseStatus(503)
    } else if (error instanceof SocialPublishingError) {
      setResponseStatus(422)
    }
    throw error
  }
}

export type WorkspaceConnectionsState = {
  configured: boolean
  connections: Array<SocialConnection>
}

export const listSocialConnections = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WorkspaceConnectionsState> => {
    const treg = getTregClient()
    const rows = await connections.listWorkspaceConnections(
      context.db,
      context.workspace.id,
    )
    return { configured: treg !== null, connections: rows }
  })

export const syncSocialConnections = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(
    ({ context }): Promise<Array<SocialConnection>> =>
      withSocialErrors(() =>
        connections.syncWorkspaceConnections(
          context.db,
          getTregClient(),
          context.workspace.id,
        ),
      ),
  )

export const startSocialConnection = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(startSocialConnectionSchema)
  .handler(
    ({ context, data }): Promise<StartedChannelConnection> =>
      withSocialErrors(() =>
        connections.startChannelConnection(context.db, getTregClient(), {
          organizationId: context.workspace.id,
          userId: context.user.id,
          channel: data.channel,
          capability: data.capability,
        }),
      ),
  )

export const pollSocialConnection = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pollSocialConnectionSchema)
  .handler(async ({ context, data }): Promise<PolledChannelConnection> => {
    const result = await withSocialErrors(() =>
      connections.pollChannelConnection(
        context.db,
        getTregClient(),
        context.workspace.id,
        data.channel,
      ),
    )
    if (!result) throw notFound()
    return result
  })

export const listSocialResources = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(pollSocialConnectionSchema)
  .handler(
    ({ context, data }): Promise<Array<SocialResourceOption>> =>
      withSocialErrors(() =>
        connections.listChannelResources(
          context.db,
          getTregClient(),
          context.workspace.id,
          data.channel,
        ),
      ),
  )

export const selectSocialResource = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(selectSocialResourceSchema)
  .handler(
    ({ context, data }): Promise<SocialConnection> =>
      withSocialErrors(() =>
        connections.selectChannelResource(context.db, getTregClient(), {
          organizationId: context.workspace.id,
          channel: data.channel,
          resourceRef: data.resourceRef,
          resourceName: data.resourceName,
        }),
      ),
  )

export const disconnectSocialConnection = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(disconnectSocialConnectionSchema)
  .handler(async ({ context, data }): Promise<{ disconnected: boolean }> => {
    const disconnected = await withSocialErrors(() =>
      connections.disconnectChannel(
        context.db,
        getTregClient(),
        context.workspace.id,
        data.channel,
      ),
    )
    return { disconnected }
  })

export const listItemPublishJobs = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(listItemPublishJobsSchema)
  .handler(
    ({ context, data }): Promise<Array<SocialPublishJob>> =>
      publishing.listItemPublishJobs(context.db, context.workspace.id, data.itemId),
  )

export const publishContentItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(publishContentItemSchema)
  .handler(async ({ context, data }): Promise<PublishNowResult> => {
    const result = await withSocialErrors(() =>
      publishing.publishContentItemNow(
        {
          db: context.db,
          bucket: getMediaBucket(),
          treg: getTregClient(),
        },
        {
          organizationId: context.workspace.id,
          itemId: data.itemId,
          userId: context.user.id,
          trigger: 'manual',
          options: data.options,
        },
      ),
    )
    if (!result) throw notFound()
    return result
  })

export const pollPublishJob = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(pollPublishJobSchema)
  .handler(async ({ context, data }): Promise<PublishNowResult> => {
    const result = await withSocialErrors(() =>
      publishing.pollPublishJob(
        {
          db: context.db,
          bucket: getMediaBucket(),
          treg: getTregClient(),
        },
        context.workspace.id,
        data.jobId,
      ),
    )
    if (!result) throw notFound()
    return result
  })
