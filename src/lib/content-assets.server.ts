/**
 * Data access for uploaded media. Server-only, and independent of TanStack
 * Start and Cloudflare so it can be tested against D1 with an in-memory
 * bucket. The route handlers and server functions add the session check.
 *
 * Files belong to an item, so they are scoped to the item's workspace: every
 * function takes the caller's `organizationId` and ignores other workspaces.
 *
 * Bytes live in the R2 bucket under `content/<contentItemId>/<assetId>`; the
 * `content_asset` row holds the metadata. Deleting an item removes its rows
 * through the foreign key; `deleteContentItemWithAssets` removes its objects,
 * and those of the item's designs (`designs/<designId>/...`).
 */
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentAsset, contentDesign, contentDesignVersion, contentItem } from '../db/schema'
import { assetUploadError } from './content-assets'
import type { AssetAttribution, ContentAsset } from './content-assets'
import { designPreviewKey, designSourceKey } from './content-designs'
import { deleteContentItem } from './content.server'

/** The part of an R2 bucket binding this app uses. */
export type MediaBucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(
    key: string,
    options?: { range?: Headers },
  ): Promise<MediaObject | null>
  delete(keys: string | Array<string>): Promise<void>
}

/** An object read from the bucket; `body` is absent when a precondition fails. */
export type MediaObject = {
  body?: ReadableStream
  size: number
  httpEtag: string
  range?: { offset?: number; length?: number; suffix?: number }
}

/** The upload was refused; the message is safe to show users. */
export class AssetUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetUploadError'
  }
}

export function assetObjectKey(contentItemId: string, assetId: string): string {
  return `content/${contentItemId}/${assetId}`
}

/** The asset columns, for queries that join the item to check its workspace. */
const assetColumns = {
  id: contentAsset.id,
  contentItemId: contentAsset.contentItemId,
  filename: contentAsset.filename,
  contentType: contentAsset.contentType,
  size: contentAsset.size,
  attribution: contentAsset.attribution,
  createdById: contentAsset.createdById,
  createdAt: contentAsset.createdAt,
}

export async function listContentAssets(
  db: Database,
  organizationId: string,
  contentItemId: string,
): Promise<Array<ContentAsset>> {
  return db
    .select(assetColumns)
    .from(contentAsset)
    .innerJoin(contentItem, eq(contentItem.id, contentAsset.contentItemId))
    .where(
      and(
        eq(contentAsset.contentItemId, contentItemId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
    .orderBy(asc(contentAsset.createdAt), asc(contentAsset.id))
}

export async function getContentAsset(
  db: Database,
  organizationId: string,
  id: string,
): Promise<ContentAsset | null> {
  const [asset] = await db
    .select(assetColumns)
    .from(contentAsset)
    .innerJoin(contentItem, eq(contentItem.id, contentAsset.contentItemId))
    .where(and(eq(contentAsset.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return asset ?? null
}

/**
 * Stores `body` (exactly `file.size` bytes: R2 needs the length up front) and
 * records it. Returns `null` when the item does not exist; throws
 * `AssetUploadError` for a file that may not be uploaded.
 */
export async function createContentAsset(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    contentItemId: string
    createdById: string
    file: { name: string; type: string; size: number }
    body: ReadableStream | ArrayBuffer | Blob
    /** Credit of a file fetched from a provider (stock photo, generated image). */
    attribution?: AssetAttribution | null
  },
): Promise<ContentAsset | null> {
  const { file } = input
  const problem = assetUploadError(file)
  if (problem) throw new AssetUploadError(problem)

  if (!(await itemExists(db, input.organizationId, input.contentItemId))) return null

  const id = crypto.randomUUID()
  const key = assetObjectKey(input.contentItemId, id)
  await bucket.put(key, input.body, { httpMetadata: { contentType: file.type } })
  try {
    const [asset] = await db
      .insert(contentAsset)
      .values({
        id,
        contentItemId: input.contentItemId,
        filename: file.name,
        contentType: file.type,
        size: file.size,
        attribution: input.attribution ?? null,
        createdById: input.createdById,
      })
      .returning()
    return asset!
  } catch (error) {
    // Do not leave the bytes behind. If the item was deleted meanwhile (the
    // foreign key refuses the row), that is a "not found", not a failure.
    await bucket.delete(key).catch(() => {})
    if (!(await itemExists(db, input.organizationId, input.contentItemId))) return null
    throw error
  }
}

async function itemExists(
  db: Database,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const [item] = await db
    .select({ id: contentItem.id })
    .from(contentItem)
    .where(and(eq(contentItem.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return item !== undefined
}

/** Deletes the row and then the object. `false` when the asset does not exist. */
export async function deleteContentAsset(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  id: string,
): Promise<boolean> {
  // SQLite's DELETE cannot join; check the workspace first. The id is a
  // random UUID, so the row cannot move to another workspace in between.
  const asset = await getContentAsset(db, organizationId, id)
  if (!asset) return false
  const [deleted] = await db
    .delete(contentAsset)
    .where(eq(contentAsset.id, id))
    .returning({ contentItemId: contentAsset.contentItemId })
  if (!deleted) return false
  await bucket.delete(assetObjectKey(deleted.contentItemId, id))
  return true
}

/** R2 keys of every version of every design of an item. */
async function listItemDesignObjectKeys(
  db: Database,
  organizationId: string,
  contentItemId: string,
): Promise<Array<string>> {
  const rows = await db
    .select({ designId: contentDesignVersion.designId, versionId: contentDesignVersion.id })
    .from(contentDesignVersion)
    .innerJoin(contentDesign, eq(contentDesign.id, contentDesignVersion.designId))
    .innerJoin(contentItem, eq(contentItem.id, contentDesign.contentItemId))
    .where(
      and(
        eq(contentDesign.contentItemId, contentItemId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
  return rows.flatMap(({ designId, versionId }) => [
    designSourceKey(designId, versionId),
    designPreviewKey(designId, versionId),
  ])
}

/**
 * Deletes an item and, once that succeeded, its files and the files of its
 * designs (the rows go with the item through the foreign keys). A failure to
 * delete the files leaves unreachable objects behind, not a broken item.
 */
export async function deleteContentItemWithAssets(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const assets = await listContentAssets(db, organizationId, id)
  const designKeys = await listItemDesignObjectKeys(db, organizationId, id)
  const deleted = await deleteContentItem(db, organizationId, id)
  const keys = [...assets.map((asset) => assetObjectKey(id, asset.id)), ...designKeys]
  if (deleted && keys.length > 0) {
    // R2 deletes up to 1000 keys per call.
    for (let start = 0; start < keys.length; start += 1000) {
      await bucket.delete(keys.slice(start, start + 1000)).catch((error: unknown) => {
        console.error('Could not delete the media of item', id, error)
      })
    }
  }
  return deleted
}

/**
 * The HTTP response for a stored file: inline, with byte-range support (a
 * browser needs ranges to seek in a video). `ranged` is whether the request
 * carried a `Range` header that the bucket honoured.
 */
export function buildAssetResponse(
  asset: Pick<ContentAsset, 'filename' | 'contentType'>,
  object: MediaObject,
  ranged: boolean,
): Response {
  const headers = new Headers({
    'Content-Type': asset.contentType,
    // A file is never rewritten under the same id.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
    // Never let a browser guess a different type than the one we validated.
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
  })

  const range = ranged ? object.range : undefined
  if (!range) {
    headers.set('Content-Length', String(object.size))
    return new Response(object.body, { status: 200, headers })
  }
  const offset = range.offset ?? object.size - (range.suffix ?? object.size)
  const length = range.length ?? object.size - offset
  headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
  headers.set('Content-Length', String(length))
  return new Response(object.body, { status: 206, headers })
}
