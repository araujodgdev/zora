/**
 * Data access for designs. Server-only, and independent of TanStack Start and
 * Cloudflare so it can be tested against D1 with an in-memory bucket. The
 * HTTP routes (`content-designs.http.server.ts`), server functions and MCP
 * tools add the session check.
 *
 * Designs belong to an item, so they are scoped to the item's workspace:
 * every function takes the caller's `organizationId` and ignores other
 * workspaces.
 *
 * A save is a new immutable version: both files go to R2 first, then one
 * D1 batch points the design at the new version and inserts its row. D1 has
 * no interactive transactions, so the batch is guarded like
 * `patchContentItem`: the UPDATE matches the `updated_at` that was read, and
 * the INSERT only happens when that UPDATE did. A save based on a version
 * that is no longer current is refused (`DesignConflictError`, HTTP 409).
 */
import { and, asc, desc, eq, max, sql } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentDesign, contentDesignVersion, contentItem, user } from '../db/schema'
import type { ContentAsset } from './content-assets'
import { createContentAsset } from './content-assets.server'
import type { MediaBucket } from './content-assets.server'
import {
  MAX_DESIGN_PREVIEW_BYTES,
  MAX_DESIGN_SOURCE_BYTES,
  channelDesignPreset,
  designPreviewKey,
  designSourceKey,
  findDesignPreset,
  formatDesignSize,
  hasDesignSourceSignature,
  hasPngSignature,
} from './content-designs'
import type {
  ContentDesign,
  ContentDesignVersion,
  CreateContentDesignData,
  DesignAuthorKind,
} from './content-designs'
import { formatBytes } from './content-assets'

/** A save named a base version that is no longer the current one. */
export class DesignConflictError extends Error {
  constructor(
    readonly currentVersionId: string | null,
    readonly currentVersionNumber: number | null,
  ) {
    super(
      'Outra pessoa salvou este design enquanto você editava. Recarregue a versão mais recente antes de salvar.',
    )
    this.name = 'DesignConflictError'
  }
}

/**
 * A file or request that cannot be stored; the message is safe to show.
 * `status` is the HTTP status for it (413 too large, 422 otherwise).
 */
export class DesignFileError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 422 = 422,
  ) {
    super(message)
    this.name = 'DesignFileError'
  }
}

/** A rule refused the action (e.g. publishing a design that was never saved). */
export class DesignRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesignRuleError'
  }
}

/** How often a write is retried when someone else changed the design meanwhile. */
const MAX_WRITE_ATTEMPTS = 3

const currentVersion = contentDesignVersion

const designColumns = {
  id: contentDesign.id,
  contentItemId: contentDesign.contentItemId,
  name: contentDesign.name,
  widthPx: contentDesign.widthPx,
  heightPx: contentDesign.heightPx,
  preset: contentDesign.preset,
  currentVersionId: contentDesign.currentVersionId,
  currentVersionNumber: currentVersion.number,
  createdById: contentDesign.createdById,
  createdAt: contentDesign.createdAt,
  updatedAt: contentDesign.updatedAt,
}

/** Designs joined to their item (for the workspace) and current version (for its number). */
function selectDesigns(db: Database) {
  return db
    .select(designColumns)
    .from(contentDesign)
    .innerJoin(contentItem, eq(contentItem.id, contentDesign.contentItemId))
    .leftJoin(currentVersion, eq(currentVersion.id, contentDesign.currentVersionId))
}

export async function listContentDesigns(
  db: Database,
  organizationId: string,
  contentItemId: string,
): Promise<Array<ContentDesign>> {
  return selectDesigns(db)
    .where(
      and(
        eq(contentDesign.contentItemId, contentItemId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
    .orderBy(asc(contentDesign.createdAt), asc(contentDesign.id))
}

export async function getContentDesign(
  db: Database,
  organizationId: string,
  id: string,
): Promise<ContentDesign | null> {
  const [design] = await selectDesigns(db)
    .where(and(eq(contentDesign.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return design ?? null
}

/**
 * Creates an empty design (no version yet). The size comes from the preset,
 * from `width`/`height`, or else from the item's channel. Returns `null` when
 * the item does not exist.
 */
export async function createContentDesign(
  db: Database,
  organizationId: string,
  createdById: string,
  input: CreateContentDesignData,
  now: Date = new Date(),
): Promise<ContentDesign | null> {
  const [item] = await db
    .select({ id: contentItem.id, channel: contentItem.channel })
    .from(contentItem)
    .where(and(eq(contentItem.id, input.itemId), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  if (!item) return null

  const preset =
    input.width !== undefined && input.height !== undefined
      ? null
      : (findDesignPreset(input.preset) ?? channelDesignPreset(item.channel))
  const width = preset ? preset.width : input.width!
  const height = preset ? preset.height : input.height!
  const name = input.name ?? preset?.label ?? `Design ${formatDesignSize(width, height)}`

  const [created] = await db
    .insert(contentDesign)
    .values({
      contentItemId: item.id,
      name,
      widthPx: width,
      heightPx: height,
      preset: preset?.name ?? null,
      createdById,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: contentDesign.id })
  return getContentDesign(db, organizationId, created!.id)
}

/** Strictly after `previous`, so every write changes `updated_at`. */
function nextUpdatedAt(previous: Date, now: Date): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1))
}

/** Renames a design. Returns `null` when it does not exist. */
export async function renameContentDesign(
  db: Database,
  organizationId: string,
  id: string,
  name: string,
  now: Date = new Date(),
): Promise<ContentDesign | null> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const design = await getContentDesign(db, organizationId, id)
    if (!design) return null
    const [updated] = await db
      .update(contentDesign)
      .set({ name, updatedAt: nextUpdatedAt(design.updatedAt, now) })
      .where(and(eq(contentDesign.id, id), eq(contentDesign.updatedAt, design.updatedAt)))
      .returning({ id: contentDesign.id })
    if (updated) return getContentDesign(db, organizationId, id)
  }
  throw new DesignRuleError(
    'Outra pessoa alterou este design ao mesmo tempo. Recarregue e tente de novo.',
  )
}

/** Every R2 key of the given versions of a design. */
function versionObjectKeys(designId: string, versionIds: Array<string>): Array<string> {
  return versionIds.flatMap((versionId) => [
    designSourceKey(designId, versionId),
    designPreviewKey(designId, versionId),
  ])
}

/** Deletes a bucket's keys in chunks, logging (not throwing) failures. */
export async function deleteObjectsQuietly(
  bucket: MediaBucket,
  keys: Array<string>,
  what: string,
): Promise<void> {
  // R2 deletes up to 1000 keys per call.
  for (let start = 0; start < keys.length; start += 1000) {
    await bucket.delete(keys.slice(start, start + 1000)).catch((error: unknown) => {
      console.error('Could not delete the files of', what, error)
    })
  }
}

/**
 * Deletes a design, its versions (foreign key) and then their files. A
 * failure to delete the files leaves unreachable objects behind, not a
 * broken design. `false` when it does not exist.
 */
export async function deleteContentDesign(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  id: string,
): Promise<boolean> {
  // SQLite's DELETE cannot join; check the workspace first. The id is a
  // random UUID, so the row cannot move to another workspace in between.
  const design = await getContentDesign(db, organizationId, id)
  if (!design) return false
  const versions = await db
    .select({ id: contentDesignVersion.id })
    .from(contentDesignVersion)
    .where(eq(contentDesignVersion.designId, id))
  const deleted = await db
    .delete(contentDesign)
    .where(eq(contentDesign.id, id))
    .returning({ id: contentDesign.id })
  if (deleted.length === 0) return false
  await deleteObjectsQuietly(
    bucket,
    versionObjectKeys(id, versions.map((version) => version.id)),
    `design ${id}`,
  )
  return true
}

const versionColumns = {
  id: contentDesignVersion.id,
  designId: contentDesignVersion.designId,
  number: contentDesignVersion.number,
  authorKind: contentDesignVersion.authorKind,
  createdById: contentDesignVersion.createdById,
  createdByName: user.name,
  sourceSize: contentDesignVersion.sourceSize,
  previewSize: contentDesignVersion.previewSize,
  createdAt: contentDesignVersion.createdAt,
}

/** The versions of a design, newest first; `null` when the design does not exist. */
export async function listDesignVersions(
  db: Database,
  organizationId: string,
  designId: string,
): Promise<Array<ContentDesignVersion> | null> {
  if (!(await getContentDesign(db, organizationId, designId))) return null
  return db
    .select(versionColumns)
    .from(contentDesignVersion)
    .leftJoin(user, eq(user.id, contentDesignVersion.createdById))
    .where(eq(contentDesignVersion.designId, designId))
    .orderBy(desc(contentDesignVersion.number))
}

/** One version of a design of the workspace, or `null`. */
export async function getDesignVersion(
  db: Database,
  organizationId: string,
  designId: string,
  versionId: string,
): Promise<ContentDesignVersion | null> {
  const [version] = await db
    .select(versionColumns)
    .from(contentDesignVersion)
    .innerJoin(contentDesign, eq(contentDesign.id, contentDesignVersion.designId))
    .innerJoin(contentItem, eq(contentItem.id, contentDesign.contentItemId))
    .leftJoin(user, eq(user.id, contentDesignVersion.createdById))
    .where(
      and(
        eq(contentDesignVersion.id, versionId),
        eq(contentDesignVersion.designId, designId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
    .limit(1)
  return version ?? null
}

/** A file of a new version: its bytes and their exact length (R2 needs it up front). */
export type DesignFile = {
  body: ReadableStream | ArrayBuffer | Blob
  size: number
  /** The first bytes, for the signature check. */
  head: Uint8Array
}

/** The message for a source that may not be stored, or `null`. */
export function designSourceError(file: Pick<DesignFile, 'size' | 'head'>): DesignFileError | null {
  if (file.size === 0) return new DesignFileError('O arquivo do design está vazio.')
  if (file.size > MAX_DESIGN_SOURCE_BYTES) {
    return new DesignFileError(
      `O arquivo do design pode ter no máximo ${formatBytes(MAX_DESIGN_SOURCE_BYTES)}.`,
      413,
    )
  }
  if (!hasDesignSourceSignature(file.head)) {
    return new DesignFileError('O arquivo do design não é um documento do Zora Studio.')
  }
  return null
}

/** The message for a preview that may not be stored, or `null`. */
export function designPreviewError(file: Pick<DesignFile, 'size' | 'head'>): DesignFileError | null {
  if (file.size === 0) return new DesignFileError('A prévia do design está vazia.')
  if (file.size > MAX_DESIGN_PREVIEW_BYTES) {
    return new DesignFileError(
      `A prévia pode ter no máximo ${formatBytes(MAX_DESIGN_PREVIEW_BYTES)}.`,
      413,
    )
  }
  if (!hasPngSignature(file.head)) {
    return new DesignFileError('A prévia do design precisa ser uma imagem PNG.')
  }
  return null
}

export type SavedDesignVersion = { versionId: string; number: number }

/**
 * Stores a new version of a design and makes it the current one. Returns
 * `null` when the design does not exist; throws `DesignFileError` for a bad
 * file and `DesignConflictError` when `baseVersionId` (null for the first
 * save) is not the current version.
 */
export async function saveDesignVersion(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    designId: string
    createdById: string
    authorKind: DesignAuthorKind
    baseVersionId: string | null
    source: DesignFile
    preview: DesignFile
  },
  now: Date = new Date(),
): Promise<SavedDesignVersion | null> {
  const problem = designSourceError(input.source) ?? designPreviewError(input.preview)
  if (problem) throw problem

  const { designId } = input
  const first = await getContentDesign(db, input.organizationId, designId)
  if (!first) return null
  if (first.currentVersionId !== input.baseVersionId) {
    throw new DesignConflictError(first.currentVersionId, first.currentVersionNumber)
  }

  const versionId = crypto.randomUUID()
  const keys = versionObjectKeys(designId, [versionId])
  await bucket.put(keys[0]!, input.source.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  })
  await bucket.put(keys[1]!, input.preview.body, { httpMetadata: { contentType: 'image/png' } })

  try {
    let design: ContentDesign | null = first
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      if (!design) return null
      if (design.currentVersionId !== input.baseVersionId) {
        throw new DesignConflictError(design.currentVersionId, design.currentVersionNumber)
      }
      const [highest] = await db
        .select({ number: max(contentDesignVersion.number) })
        .from(contentDesignVersion)
        .where(eq(contentDesignVersion.designId, designId))
      const number = (highest?.number ?? 0) + 1

      // One batch (atomic on D1): point the design at the new version only if
      // nobody wrote it since it was read, then insert the version row only if
      // that happened (its SELECT finds the design only with the new pointer).
      const [moved] = await db.batch([
        db
          .update(contentDesign)
          .set({ currentVersionId: versionId, updatedAt: nextUpdatedAt(design.updatedAt, now) })
          .where(
            and(eq(contentDesign.id, designId), eq(contentDesign.updatedAt, design.updatedAt)),
          )
          .returning({ id: contentDesign.id }),
        db.insert(contentDesignVersion).select(
          db
            .select({
              id: sql<string>`${versionId}`.as('id'),
              designId: contentDesign.id,
              number: sql<number>`${number}`.as('number'),
              authorKind: sql<DesignAuthorKind>`${input.authorKind}`.as('author_kind'),
              createdById: sql<string>`${input.createdById}`.as('created_by_id'),
              sourceSize: sql<number>`${input.source.size}`.as('source_size'),
              previewSize: sql<number>`${input.preview.size}`.as('preview_size'),
              createdAt: sql<Date>`${now.getTime()}`.as('created_at'),
            })
            .from(contentDesign)
            .where(
              and(eq(contentDesign.id, designId), eq(contentDesign.currentVersionId, versionId)),
            ),
        ),
      ])
      if (moved.length > 0) return { versionId, number }
      design = await getContentDesign(db, input.organizationId, designId)
    }
    throw new DesignRuleError(
      'Outra pessoa alterou este design ao mesmo tempo. Recarregue e tente de novo.',
    )
  } catch (error) {
    // Nothing points at the files: do not leave them behind.
    await deleteObjectsQuietly(bucket, keys, `unsaved version ${versionId}`)
    throw error
  }
}

/** Reads a whole object into memory, or `null` when it is missing. */
async function readObject(bucket: MediaBucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key)
  if (!object?.body) return null
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

function asDesignFile(bytes: Uint8Array): DesignFile {
  return { body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 8) }
}

/**
 * Copies an old version's files into a new current version (history is never
 * rewritten). Returns `null` when the design or version does not exist.
 */
export async function restoreDesignVersion(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    designId: string
    versionId: string
    createdById: string
    authorKind: DesignAuthorKind
  },
  now: Date = new Date(),
): Promise<SavedDesignVersion | null> {
  const design = await getContentDesign(db, input.organizationId, input.designId)
  const version = await getDesignVersion(
    db,
    input.organizationId,
    input.designId,
    input.versionId,
  )
  if (!design || !version) return null
  if (design.currentVersionId === version.id) {
    throw new DesignRuleError('Esta já é a versão atual do design.')
  }
  const source = await readObject(bucket, designSourceKey(design.id, version.id))
  const preview = await readObject(bucket, designPreviewKey(design.id, version.id))
  if (!source || !preview) {
    throw new DesignRuleError('Os arquivos desta versão não foram encontrados.')
  }
  return saveDesignVersion(
    db,
    bucket,
    {
      organizationId: input.organizationId,
      designId: design.id,
      createdById: input.createdById,
      authorKind: input.authorKind,
      baseVersionId: design.currentVersionId,
      source: asDesignFile(source),
      preview: asDesignFile(preview),
    },
    now,
  )
}

/** `<name>.png`, without characters a file name cannot hold. */
export function designPngFilename(name: string): string {
  const base = name.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${base || 'design'}.png`
}

/**
 * Copies the current version's PNG into the item's media (a `content_asset`
 * named `<design name>.png`). Returns `null` when the design does not exist;
 * throws `DesignRuleError` when it has no version yet.
 */
export async function publishDesignPreview(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  createdById: string,
  designId: string,
): Promise<ContentAsset | null> {
  const design = await getContentDesign(db, organizationId, designId)
  if (!design) return null
  if (!design.currentVersionId) {
    throw new DesignRuleError('Salve o design no Studio antes de usá-lo como mídia.')
  }
  const png = await readObject(bucket, designPreviewKey(design.id, design.currentVersionId))
  if (!png) throw new DesignRuleError('A prévia da versão atual não foi encontrada.')
  return createContentAsset(db, bucket, {
    organizationId,
    contentItemId: design.contentItemId,
    createdById,
    file: { name: designPngFilename(design.name), type: 'image/png', size: png.length },
    body: png.slice().buffer,
  })
}
