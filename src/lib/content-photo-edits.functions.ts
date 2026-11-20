/**
 * Server functions for the photo edits of a content item. Uploading an
 * original, saving a version and reading the files are HTTP routes
 * (`src/routes/api/...`), because they carry raw bytes. Every function
 * requires a session through `authMiddleware` and acts in `context.workspace`.
 */
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import { authMiddleware } from './auth-middleware'
import type { ContentAsset } from './content-assets'
import { AssetUploadError } from './content-assets.server'
import {
  contentPhotoEditIdSchema,
  createContentPhotoEditSchema,
  listContentPhotoEditsSchema,
  photoEditVersionRefSchema,
  renameContentPhotoEditSchema,
} from './content-photo-edits'
import type { ContentPhotoEdit, ContentPhotoEditVersion } from './content-photo-edits'
import * as photoEdits from './content-photo-edits.server'
import type { SavedPhotoEditVersion } from './content-photo-edits.server'
import { getMediaBucket } from './media-bucket.server'

function found<T>(value: T | null): T {
  if (value === null) throw notFound()
  return value
}

/** Rule violations become 422, a stale base 409; the message reaches the UI. */
async function withPhotoEditErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof photoEdits.PhotoEditConflictError) setResponseStatus(409)
    if (
      error instanceof photoEdits.PhotoEditRuleError ||
      error instanceof photoEdits.PhotoEditFileError ||
      error instanceof AssetUploadError
    ) {
      setResponseStatus(422)
    }
    throw error
  }
}

export const listContentPhotoEdits = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(listContentPhotoEditsSchema)
  .handler(
    ({ context, data }): Promise<Array<ContentPhotoEdit>> =>
      photoEdits.listContentPhotoEdits(context.db, context.workspace.id, data.itemId),
  )

/** Starts an edit from an image of the item's media (copied into the edit). */
export const createContentPhotoEdit = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(createContentPhotoEditSchema)
  .handler(
    async ({ context, data }): Promise<ContentPhotoEdit> =>
      found(
        await withPhotoEditErrors(() =>
          photoEdits.createPhotoEditFromAsset(context.db, getMediaBucket(), {
            organizationId: context.workspace.id,
            contentItemId: data.itemId,
            assetId: data.assetId,
            createdById: context.user.id,
            name: data.name,
          }),
        ),
      ),
  )

export const renameContentPhotoEdit = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(renameContentPhotoEditSchema)
  .handler(
    async ({ context, data }): Promise<ContentPhotoEdit> =>
      found(
        await withPhotoEditErrors(() =>
          photoEdits.renameContentPhotoEdit(
            context.db,
            context.workspace.id,
            data.editId,
            data.name,
          ),
        ),
      ),
  )

export const deleteContentPhotoEdit = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentPhotoEditIdSchema)
  .handler(async ({ context, data }): Promise<{ editId: string }> => {
    const deleted = await photoEdits.deleteContentPhotoEdit(
      context.db,
      getMediaBucket(),
      context.workspace.id,
      data.editId,
    )
    if (!deleted) throw notFound()
    return { editId: data.editId }
  })

export const listPhotoEditVersions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(contentPhotoEditIdSchema)
  .handler(
    async ({ context, data }): Promise<Array<ContentPhotoEditVersion>> =>
      found(
        await photoEdits.listPhotoEditVersions(context.db, context.workspace.id, data.editId),
      ),
  )

/** Copies an old version's files into a new current version. */
export const restorePhotoEditVersion = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(photoEditVersionRefSchema)
  .handler(
    async ({ context, data }): Promise<SavedPhotoEditVersion> =>
      found(
        await withPhotoEditErrors(() =>
          photoEdits.restorePhotoEditVersion(context.db, getMediaBucket(), {
            organizationId: context.workspace.id,
            editId: data.editId,
            versionId: data.versionId,
            createdById: context.user.id,
            authorKind: 'user',
          }),
        ),
      ),
  )

/** Copies the current preview into the item's media (`<name>.jpg`). */
export const publishPhotoEditPreview = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(contentPhotoEditIdSchema)
  .handler(
    async ({ context, data }): Promise<ContentAsset> =>
      found(
        await withPhotoEditErrors(() =>
          photoEdits.publishPhotoEditPreview(
            context.db,
            getMediaBucket(),
            context.workspace.id,
            context.user.id,
            data.editId,
          ),
        ),
      ),
  )
