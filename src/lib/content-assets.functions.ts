/**
 * Server functions for the media of a content item. Uploading and serving the
 * files themselves are HTTP routes (`src/routes/api/...`), because they carry
 * raw bytes. Every function requires a session through `authMiddleware`.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from './auth-middleware'
import { contentItemIdSchema } from './content'
import type { ContentAsset } from './content-assets'
import * as assets from './content-assets.server'
import { getMediaBucket } from './media-bucket.server'

export const listContentAssets = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(
    ({ context, data }): Promise<Array<ContentAsset>> =>
      assets.listContentAssets(context.db, data.id),
  )

export const deleteContentAsset = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentItemIdSchema)
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const deleted = await assets.deleteContentAsset(
      context.db,
      getMediaBucket(),
      data.id,
    )
    if (!deleted) throw notFound()
    return { id: data.id }
  })
