/**
 * Content server functions: the RPC contract used by the UI.
 *
 * Every function validates its input with the shared schemas from `./content`
 * and requires a session through `authMiddleware`. Safe to import from client
 * code; the build replaces the handlers with RPC stubs.
 *
 * Prefer the Query helpers in `./content.queries` from components.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import { authMiddleware } from './auth-middleware'
import {
  changeContentItemStatusSchema,
  contentItemIdSchema,
  contentListFiltersSchema,
  createContentItemSchema,
  rescheduleContentItemSchema,
  updateContentItemSchema,
} from './content'
import type { ContentItem } from './content'
import * as contentService from './content.server'
import { deleteContentItemWithAssets } from './content-assets.server'
import { getMediaBucket } from './media-bucket.server'

/** Maps service errors to HTTP statuses; rule violations become 422. */
async function withRuleErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof contentService.ContentRuleError) {
      setResponseStatus(422)
    }
    throw error
  }
}

function found<T>(item: T | null): T {
  if (item === null) throw notFound()
  return item
}

export const listContentItems = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentListFiltersSchema.default({}))
  .handler(
    ({ context, data }): Promise<Array<ContentItem>> =>
      contentService.listContentItems(context.db, data),
  )

export const getContentItem = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(
    async ({ context, data }): Promise<ContentItem> =>
      found(await contentService.getContentItem(context.db, data.id)),
  )

export const createContentItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(createContentItemSchema)
  .handler(
    ({ context, data }): Promise<ContentItem> =>
      withRuleErrors(() =>
        contentService.createContentItem(context.db, context.user.id, data),
      ),
  )

export const updateContentItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(updateContentItemSchema)
  .handler(
    async ({ context, data }): Promise<ContentItem> =>
      found(
        await withRuleErrors(() =>
          contentService.updateContentItem(context.db, data),
        ),
      ),
  )

export const rescheduleContentItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(rescheduleContentItemSchema)
  .handler(
    async ({ context, data }): Promise<ContentItem> =>
      found(
        await withRuleErrors(() =>
          contentService.rescheduleContentItem(
            context.db,
            data.id,
            data.scheduledAt,
          ),
        ),
      ),
  )

export const changeContentItemStatus = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(changeContentItemStatusSchema)
  .handler(
    async ({ context, data }): Promise<ContentItem> =>
      found(
        await withRuleErrors(() =>
          contentService.changeContentItemStatus(
            context.db,
            data.id,
            data.status,
          ),
        ),
      ),
  )

export const deleteContentItem = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const deleted = await deleteContentItemWithAssets(
      context.db,
      getMediaBucket(),
      data.id,
    )
    if (!deleted) throw notFound()
    return { id: data.id }
  })
