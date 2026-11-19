/**
 * Server functions for the designs of a content item. Saving and reading the
 * files themselves are HTTP routes (`src/routes/api/designs/...`), because
 * they carry raw bytes. Every function requires a session through
 * `authMiddleware` and acts in `context.workspace`.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import { authMiddleware } from './auth-middleware'
import type { ContentAsset } from './content-assets'
import {
  contentDesignIdSchema,
  createContentDesignSchema,
  designVersionRefSchema,
  listContentDesignsSchema,
  renameContentDesignSchema,
} from './content-designs'
import type { ContentDesign, ContentDesignVersion } from './content-designs'
import * as designs from './content-designs.server'
import type { SavedDesignVersion } from './content-designs.server'
import { AssetUploadError } from './content-assets.server'
import { getMediaBucket } from './media-bucket.server'

function found<T>(value: T | null): T {
  if (value === null) throw notFound()
  return value
}

/** Rule violations become 422, a stale base 409; the message reaches the UI. */
async function withDesignErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof designs.DesignConflictError) setResponseStatus(409)
    if (
      error instanceof designs.DesignRuleError ||
      error instanceof designs.DesignFileError ||
      error instanceof AssetUploadError
    ) {
      setResponseStatus(422)
    }
    throw error
  }
}

export const listContentDesigns = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(listContentDesignsSchema)
  .handler(
    ({ context, data }): Promise<Array<ContentDesign>> =>
      designs.listContentDesigns(context.db, context.workspace.id, data.itemId),
  )

export const createContentDesign = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(createContentDesignSchema)
  .handler(
    async ({ context, data }): Promise<ContentDesign> =>
      found(
        await designs.createContentDesign(context.db, context.workspace.id, context.user.id, data),
      ),
  )

export const renameContentDesign = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(renameContentDesignSchema)
  .handler(
    async ({ context, data }): Promise<ContentDesign> =>
      found(
        await withDesignErrors(() =>
          designs.renameContentDesign(context.db, context.workspace.id, data.designId, data.name),
        ),
      ),
  )

export const deleteContentDesign = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentDesignIdSchema)
  .handler(async ({ context, data }): Promise<{ designId: string }> => {
    const deleted = await designs.deleteContentDesign(
      context.db,
      getMediaBucket(),
      context.workspace.id,
      data.designId,
    )
    if (!deleted) throw notFound()
    return { designId: data.designId }
  })

export const listDesignVersions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentDesignIdSchema)
  .handler(
    async ({ context, data }): Promise<Array<ContentDesignVersion>> =>
      found(await designs.listDesignVersions(context.db, context.workspace.id, data.designId)),
  )

/** Copies an old version's files into a new current version. */
export const restoreDesignVersion = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(designVersionRefSchema)
  .handler(
    async ({ context, data }): Promise<SavedDesignVersion> =>
      found(
        await withDesignErrors(() =>
          designs.restoreDesignVersion(context.db, getMediaBucket(), {
            organizationId: context.workspace.id,
            designId: data.designId,
            versionId: data.versionId,
            createdById: context.user.id,
            authorKind: 'user',
          }),
        ),
      ),
  )

/** Copies the current PNG into the item's media (`<name>.png`). */
export const publishDesignPreview = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentDesignIdSchema)
  .handler(
    async ({ context, data }): Promise<ContentAsset> =>
      found(
        await withDesignErrors(() =>
          designs.publishDesignPreview(
            context.db,
            getMediaBucket(),
            context.workspace.id,
            context.user.id,
            data.designId,
          ),
        ),
      ),
  )
