/**
 * Data access for uploaded media. Server-only, and independent of TanStack
 * Start and Cloudflare so it can be tested against Postgres with an in-memory
 * bucket. The route handlers and server functions add the session check.
 *
 * Bytes live in the R2 bucket under `content/<contentItemId>/<assetId>`; the
 * `content_asset` row holds the metadata. Deleting an item removes its rows
 * through the foreign key; `deleteContentItemWithAssets` removes its objects.
 */
import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentAsset, contentItem } from '../db/schema'
import { assetUploadError } from './content-assets'
import type { ContentAsset } from './content-assets'
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

export async function listContentAssets(
  db: Database,
  contentItemId: string,
): Promise<Array<ContentAsset>> {
  return db
    .select()
    .from(contentAsset)
    .where(eq(contentAsset.contentItemId, contentItemId))
    .orderBy(asc(contentAsset.createdAt), asc(contentAsset.id))
}

export async function getContentAsset(
  db: Database,
  id: string,
): Promise<ContentAsset | null> {
  const [asset] = await db
    .select()
    .from(contentAsset)
    .where(eq(contentAsset.id, id))
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
    contentItemId: string
    createdById: string
    file: { name: string; type: string; size: number }
    body: ReadableStream | ArrayBuffer | Blob
  },
): Promise<ContentAsset | null> {
  const { file } = input
  const problem = assetUploadError(file)
  if (problem) throw new AssetUploadError(problem)

  const [item] = await db
    .select({ id: contentItem.id })
    .from(contentItem)
    .where(eq(contentItem.id, input.contentItemId))
    .limit(1)
  if (!item) return null

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
        createdById: input.createdById,
      })
      .returning()
    return asset!
  } catch (error) {
    // The item may have been deleted meanwhile: do not leave the bytes behind.
    await bucket.delete(key).catch(() => {})
    if (isForeignKeyViolation(error)) return null
    throw error
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause
  return (error as { code?: string } | null)?.code === '23503' || cause?.code === '23503'
}

/** Deletes the row and then the object. `false` when the asset does not exist. */
export async function deleteContentAsset(
  db: Database,
  bucket: MediaBucket,
  id: string,
): Promise<boolean> {
  const [deleted] = await db
    .delete(contentAsset)
    .where(eq(contentAsset.id, id))
    .returning({ contentItemId: contentAsset.contentItemId })
  if (!deleted) return false
  await bucket.delete(assetObjectKey(deleted.contentItemId, id))
  return true
}

/**
 * Deletes an item and, once that succeeded, its files. A failure to delete
 * the files leaves unreachable objects behind, not a broken item.
 */
export async function deleteContentItemWithAssets(
  db: Database,
  bucket: MediaBucket,
  id: string,
): Promise<boolean> {
  const assets = await listContentAssets(db, id)
  const deleted = await deleteContentItem(db, id)
  if (deleted && assets.length > 0) {
    await bucket
      .delete(assets.map((asset) => assetObjectKey(id, asset.id)))
      .catch((error: unknown) => {
        console.error('Could not delete the media of item', id, error)
      })
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
