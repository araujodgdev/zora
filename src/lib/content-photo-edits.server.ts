/**
 * Data access for photo edits. Server-only, and independent of TanStack Start
 * and Cloudflare so it can be tested against D1 with an in-memory bucket. The
 * HTTP routes (`content-photo-edits.http.server.ts`), server functions and MCP
 * tools add the session check.
 *
 * Photo edits belong to an item, so they are scoped to the item's workspace:
 * every function takes the caller's `organizationId` and ignores other
 * workspaces.
 *
 * Creating an edit stores its own copy of the original (from an image of the
 * item's media, copied R2-to-R2, or uploaded), checked by extension and by
 * signature. A save is a new immutable version, written exactly like
 * `saveDesignVersion`: both files go to R2 first, then one D1 batch points
 * the edit at the new version (guarded by the `updated_at` that was read) and
 * inserts its row only if that UPDATE applied. A save based on a version that
 * is no longer current is refused (`PhotoEditConflictError`, HTTP 409).
 */
import { and, asc, desc, eq, max, sql } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentItem, contentPhotoEdit, contentPhotoEditVersion, user } from '../db/schema'
import type { ContentAsset } from './content-assets'
import { formatBytes } from './content-assets'
import { assetObjectKey, createContentAsset, getContentAsset } from './content-assets.server'
import type { MediaBucket } from './content-assets.server'
import { deleteObjectsQuietly } from './content-designs.server'
import {
  MAX_PHOTO_ORIGINAL_BYTES,
  MAX_PHOTO_PREVIEW_BYTES,
  MAX_PHOTO_SETTINGS_BYTES,
  PHOTO_ORIGINAL_EXTENSIONS,
  PHOTO_SIGNATURE_BYTES,
  PHOTO_SOURCE_MEDIA_TYPES,
  hasPhotoOriginalSignature,
  hasPhotoSettingsSignature,
  photoEditNameFromFilename,
  photoEditOriginalKey,
  photoEditPreviewKey,
  photoEditSettingsKey,
  photoOriginalExtension,
  photoOriginalUploadError,
  photoPreviewType,
} from './content-photo-edits'
import type {
  ContentPhotoEdit,
  ContentPhotoEditVersion,
  PhotoEditAuthorKind,
} from './content-photo-edits'

/** A save named a base version that is no longer the current one. */
export class PhotoEditConflictError extends Error {
  constructor(
    readonly currentVersionId: string | null,
    readonly currentVersionNumber: number | null,
  ) {
    super(
      'Outra pessoa salvou esta foto enquanto você editava. Abra a versão mais recente antes de salvar.',
    )
    this.name = 'PhotoEditConflictError'
  }
}

/**
 * A file or request that cannot be stored; the message is safe to show.
 * `status` is the HTTP status for it (413 too large, 422 otherwise).
 */
export class PhotoEditFileError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 422 = 422,
  ) {
    super(message)
    this.name = 'PhotoEditFileError'
  }
}

/** A rule refused the action (e.g. publishing an edit that was never saved). */
export class PhotoEditRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoEditRuleError'
  }
}

/** How often a write is retried when someone else changed the edit meanwhile. */
const MAX_WRITE_ATTEMPTS = 3

const RACE_MESSAGE =
  'Outra pessoa alterou esta edição de foto ao mesmo tempo. Recarregue e tente de novo.'

const currentVersion = contentPhotoEditVersion

const editColumns = {
  id: contentPhotoEdit.id,
  contentItemId: contentPhotoEdit.contentItemId,
  name: contentPhotoEdit.name,
  sourceAssetId: contentPhotoEdit.sourceAssetId,
  originalName: contentPhotoEdit.originalName,
  originalSize: contentPhotoEdit.originalSize,
  currentVersionId: contentPhotoEdit.currentVersionId,
  currentVersionNumber: currentVersion.number,
  createdById: contentPhotoEdit.createdById,
  createdAt: contentPhotoEdit.createdAt,
  updatedAt: contentPhotoEdit.updatedAt,
}

/** Edits joined to their item (for the workspace) and current version (for its number). */
function selectEdits(db: Database) {
  return db
    .select(editColumns)
    .from(contentPhotoEdit)
    .innerJoin(contentItem, eq(contentItem.id, contentPhotoEdit.contentItemId))
    .leftJoin(currentVersion, eq(currentVersion.id, contentPhotoEdit.currentVersionId))
}

export async function listContentPhotoEdits(
  db: Database,
  organizationId: string,
  contentItemId: string,
): Promise<Array<ContentPhotoEdit>> {
  return selectEdits(db)
    .where(
      and(
        eq(contentPhotoEdit.contentItemId, contentItemId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
    .orderBy(asc(contentPhotoEdit.createdAt), asc(contentPhotoEdit.id))
}

export async function getContentPhotoEdit(
  db: Database,
  organizationId: string,
  id: string,
): Promise<ContentPhotoEdit | null> {
  const [edit] = await selectEdits(db)
    .where(and(eq(contentPhotoEdit.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return edit ?? null
}

/** The R2 key of an edit's original (not part of `ContentPhotoEdit`: clients never need it). */
export async function getPhotoEditOriginalKey(
  db: Database,
  organizationId: string,
  id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ key: contentPhotoEdit.originalKey })
    .from(contentPhotoEdit)
    .innerJoin(contentItem, eq(contentItem.id, contentPhotoEdit.contentItemId))
    .where(and(eq(contentPhotoEdit.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return row?.key ?? null
}

async function itemExists(db: Database, organizationId: string, id: string): Promise<boolean> {
  const [item] = await db
    .select({ id: contentItem.id })
    .from(contentItem)
    .where(and(eq(contentItem.id, id), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  return item !== undefined
}

/** The first bytes of a stored object (a ranged read), or an empty array. */
async function readHead(bucket: MediaBucket, key: string): Promise<Uint8Array> {
  const object = await bucket.get(key, {
    range: new Headers({ Range: `bytes=0-${PHOTO_SIGNATURE_BYTES - 1}` }),
  })
  if (!object?.body) return new Uint8Array()
  const reader = object.body.getReader()
  const head = new Uint8Array(PHOTO_SIGNATURE_BYTES)
  let filled = 0
  try {
    while (filled < head.length) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, head.length - filled)
      head.set(value.subarray(0, take), filled)
      filled += take
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return head.subarray(0, filled)
}

type FixedLengthStreamConstructor = new (length: number) => {
  readable: ReadableStream
  writable: WritableStream
}

/**
 * A stream R2 accepts in `put`: its length must be known. Workers mark the
 * body of a request with `Content-Length` as known, not an R2 `get` body, so
 * that one goes through a `FixedLengthStream` (a Workers global; elsewhere,
 * e.g. in tests, the stream is passed on as it is).
 */
function withKnownLength(body: ReadableStream, size: number): ReadableStream {
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamConstructor })
    .FixedLengthStream
  if (!Fixed) return body
  const { readable, writable } = new Fixed(size)
  body.pipeTo(writable).catch(() => {})
  return readable
}

async function insertEdit(
  db: Database,
  bucket: MediaBucket,
  values: {
    id: string
    organizationId: string
    contentItemId: string
    name: string
    sourceAssetId: string | null
    originalKey: string
    originalName: string
    originalSize: number
    createdById: string
  },
  now: Date,
): Promise<ContentPhotoEdit | null> {
  try {
    await db.insert(contentPhotoEdit).values({
      id: values.id,
      contentItemId: values.contentItemId,
      name: values.name,
      sourceAssetId: values.sourceAssetId,
      originalKey: values.originalKey,
      originalName: values.originalName,
      originalSize: values.originalSize,
      createdById: values.createdById,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    // Do not leave the original behind. If the item (or source media) was
    // deleted meanwhile, the foreign key refused the row: that is a "not found".
    await deleteObjectsQuietly(bucket, [values.originalKey], `unsaved photo edit ${values.id}`)
    if (!(await itemExists(db, values.organizationId, values.contentItemId))) return null
    throw error
  }
  return getContentPhotoEdit(db, values.organizationId, values.id)
}

/** Stores an original under a new edit's key and checks its signature there. */
async function storeOriginal(
  bucket: MediaBucket,
  key: string,
  body: ReadableStream | ArrayBuffer | Blob,
  extension: keyof typeof PHOTO_ORIGINAL_EXTENSIONS,
  filename: string,
): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' } })
  const head = await readHead(bucket, key)
  if (!hasPhotoOriginalSignature(PHOTO_ORIGINAL_EXTENSIONS[extension], head)) {
    await deleteObjectsQuietly(bucket, [key], `refused original ${key}`)
    throw new PhotoEditFileError(
      `${filename}: o conteúdo do arquivo não é uma foto ${extension.toUpperCase()} válida.`,
    )
  }
}

/**
 * Starts an edit from an image of the item's media: the file is copied into
 * the edit (the media stays independent of it). Returns `null` when the item
 * does not exist; throws `PhotoEditRuleError` when the media is not an image
 * of this item that can be edited (GIF is not).
 */
export async function createPhotoEditFromAsset(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    contentItemId: string
    assetId: string
    createdById: string
    name?: string
  },
  now: Date = new Date(),
): Promise<ContentPhotoEdit | null> {
  if (!(await itemExists(db, input.organizationId, input.contentItemId))) return null
  const asset = await getContentAsset(db, input.organizationId, input.assetId)
  if (!asset || asset.contentItemId !== input.contentItemId) {
    throw new PhotoEditRuleError('Escolha uma imagem da mídia deste item.')
  }
  const extension = (PHOTO_SOURCE_MEDIA_TYPES as Record<string, keyof typeof PHOTO_ORIGINAL_EXTENSIONS>)[
    asset.contentType
  ]
  if (!extension) {
    throw new PhotoEditRuleError(
      `${asset.filename}: só dá para editar imagens JPEG, PNG, WebP ou AVIF da mídia.`,
    )
  }
  const source = await bucket.get(assetObjectKey(asset.contentItemId, asset.id))
  if (!source?.body) throw new PhotoEditRuleError('O arquivo desta mídia não foi encontrado.')

  const id = crypto.randomUUID()
  const key = photoEditOriginalKey(id, extension)
  const originalName = photoOriginalExtension(asset.filename)
    ? asset.filename
    : `${asset.filename}.${extension}`
  await storeOriginal(bucket, key, withKnownLength(source.body, source.size), extension, asset.filename)
  return insertEdit(
    db,
    bucket,
    {
      id,
      organizationId: input.organizationId,
      contentItemId: input.contentItemId,
      name: input.name ?? photoEditNameFromFilename(asset.filename),
      sourceAssetId: asset.id,
      originalKey: key,
      originalName,
      originalSize: source.size,
      createdById: input.createdById,
    },
    now,
  )
}

/**
 * Starts an edit from an uploaded original (`body`: exactly `file.size` bytes,
 * as R2 needs the length up front). Returns `null` when the item does not
 * exist; throws `PhotoEditFileError` for a file that may not be stored.
 */
export async function createPhotoEditFromUpload(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    contentItemId: string
    createdById: string
    file: { name: string; size: number }
    body: ReadableStream | ArrayBuffer | Blob
    name?: string
  },
  now: Date = new Date(),
): Promise<ContentPhotoEdit | null> {
  const problem = photoOriginalUploadError(input.file)
  if (problem) {
    const tooLarge =
      photoOriginalExtension(input.file.name) !== null &&
      input.file.size > MAX_PHOTO_ORIGINAL_BYTES
    throw new PhotoEditFileError(problem, tooLarge ? 413 : 422)
  }
  if (!(await itemExists(db, input.organizationId, input.contentItemId))) return null

  const extension = photoOriginalExtension(input.file.name)!
  const id = crypto.randomUUID()
  const key = photoEditOriginalKey(id, extension)
  await storeOriginal(bucket, key, input.body, extension, input.file.name)
  return insertEdit(
    db,
    bucket,
    {
      id,
      organizationId: input.organizationId,
      contentItemId: input.contentItemId,
      name: input.name ?? photoEditNameFromFilename(input.file.name),
      sourceAssetId: null,
      originalKey: key,
      originalName: input.file.name,
      originalSize: input.file.size,
      createdById: input.createdById,
    },
    now,
  )
}

/** Strictly after `previous`, so every write changes `updated_at`. */
function nextUpdatedAt(previous: Date, now: Date): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1))
}

/** Renames an edit. Returns `null` when it does not exist. */
export async function renameContentPhotoEdit(
  db: Database,
  organizationId: string,
  id: string,
  name: string,
  now: Date = new Date(),
): Promise<ContentPhotoEdit | null> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const edit = await getContentPhotoEdit(db, organizationId, id)
    if (!edit) return null
    const [updated] = await db
      .update(contentPhotoEdit)
      .set({ name, updatedAt: nextUpdatedAt(edit.updatedAt, now) })
      .where(and(eq(contentPhotoEdit.id, id), eq(contentPhotoEdit.updatedAt, edit.updatedAt)))
      .returning({ id: contentPhotoEdit.id })
    if (updated) return getContentPhotoEdit(db, organizationId, id)
  }
  throw new PhotoEditRuleError(RACE_MESSAGE)
}

/** Every R2 key of the given versions of an edit. */
function versionObjectKeys(editId: string, versionIds: Array<string>): Array<string> {
  return versionIds.flatMap((versionId) => [
    photoEditSettingsKey(editId, versionId),
    photoEditPreviewKey(editId, versionId),
  ])
}

/**
 * Deletes an edit, its versions (foreign key) and then its files (original
 * and versions). A failure to delete the files leaves unreachable objects
 * behind, not a broken edit. `false` when it does not exist.
 */
export async function deleteContentPhotoEdit(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  id: string,
): Promise<boolean> {
  // SQLite's DELETE cannot join; check the workspace first. The id is a
  // random UUID, so the row cannot move to another workspace in between.
  const originalKey = await getPhotoEditOriginalKey(db, organizationId, id)
  if (!originalKey) return false
  const versions = await db
    .select({ id: contentPhotoEditVersion.id })
    .from(contentPhotoEditVersion)
    .where(eq(contentPhotoEditVersion.editId, id))
  const deleted = await db
    .delete(contentPhotoEdit)
    .where(eq(contentPhotoEdit.id, id))
    .returning({ id: contentPhotoEdit.id })
  if (deleted.length === 0) return false
  await deleteObjectsQuietly(
    bucket,
    [originalKey, ...versionObjectKeys(id, versions.map((version) => version.id))],
    `photo edit ${id}`,
  )
  return true
}

const versionColumns = {
  id: contentPhotoEditVersion.id,
  editId: contentPhotoEditVersion.editId,
  number: contentPhotoEditVersion.number,
  authorKind: contentPhotoEditVersion.authorKind,
  createdById: contentPhotoEditVersion.createdById,
  createdByName: user.name,
  settingsSize: contentPhotoEditVersion.settingsSize,
  previewSize: contentPhotoEditVersion.previewSize,
  createdAt: contentPhotoEditVersion.createdAt,
}

/** The versions of an edit, newest first; `null` when the edit does not exist. */
export async function listPhotoEditVersions(
  db: Database,
  organizationId: string,
  editId: string,
): Promise<Array<ContentPhotoEditVersion> | null> {
  if (!(await getContentPhotoEdit(db, organizationId, editId))) return null
  return db
    .select(versionColumns)
    .from(contentPhotoEditVersion)
    .leftJoin(user, eq(user.id, contentPhotoEditVersion.createdById))
    .where(eq(contentPhotoEditVersion.editId, editId))
    .orderBy(desc(contentPhotoEditVersion.number))
}

/** One version of an edit of the workspace, or `null`. */
export async function getPhotoEditVersion(
  db: Database,
  organizationId: string,
  editId: string,
  versionId: string,
): Promise<ContentPhotoEditVersion | null> {
  const [version] = await db
    .select(versionColumns)
    .from(contentPhotoEditVersion)
    .innerJoin(contentPhotoEdit, eq(contentPhotoEdit.id, contentPhotoEditVersion.editId))
    .innerJoin(contentItem, eq(contentItem.id, contentPhotoEdit.contentItemId))
    .leftJoin(user, eq(user.id, contentPhotoEditVersion.createdById))
    .where(
      and(
        eq(contentPhotoEditVersion.id, versionId),
        eq(contentPhotoEditVersion.editId, editId),
        eq(contentItem.organizationId, organizationId),
      ),
    )
    .limit(1)
  return version ?? null
}

/** A file of a new version: its bytes and their exact length (R2 needs it up front). */
export type PhotoEditFile = {
  body: ReadableStream | ArrayBuffer | Blob
  size: number
  /** The first bytes, for the signature check. */
  head: Uint8Array
}

/** The message for settings that may not be stored, or `null`. */
export function photoSettingsError(
  file: Pick<PhotoEditFile, 'size' | 'head'>,
): PhotoEditFileError | null {
  if (file.size === 0) return new PhotoEditFileError('As configurações da foto estão vazias.')
  if (file.size > MAX_PHOTO_SETTINGS_BYTES) {
    return new PhotoEditFileError(
      `As configurações da foto podem ter no máximo ${formatBytes(MAX_PHOTO_SETTINGS_BYTES)}.`,
      413,
    )
  }
  if (!hasPhotoSettingsSignature(file.head)) {
    return new PhotoEditFileError('As configurações da foto precisam ser um objeto JSON.')
  }
  return null
}

/** The message for a preview that may not be stored, or `null`. */
export function photoPreviewError(
  file: Pick<PhotoEditFile, 'size' | 'head'>,
): PhotoEditFileError | null {
  if (file.size === 0) return new PhotoEditFileError('A prévia da foto está vazia.')
  if (file.size > MAX_PHOTO_PREVIEW_BYTES) {
    return new PhotoEditFileError(
      `A prévia pode ter no máximo ${formatBytes(MAX_PHOTO_PREVIEW_BYTES)}.`,
      413,
    )
  }
  if (!photoPreviewType(file.head)) {
    return new PhotoEditFileError('A prévia da foto precisa ser uma imagem JPEG ou PNG.')
  }
  return null
}

export type SavedPhotoEditVersion = { versionId: string; number: number }

/**
 * Stores a new version of an edit and makes it the current one. Returns
 * `null` when the edit does not exist; throws `PhotoEditFileError` for a bad
 * file and `PhotoEditConflictError` when `baseVersionId` (null for the first
 * save) is not the current version.
 */
export async function savePhotoEditVersion(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    editId: string
    createdById: string
    authorKind: PhotoEditAuthorKind
    baseVersionId: string | null
    settings: PhotoEditFile
    preview: PhotoEditFile
  },
  now: Date = new Date(),
): Promise<SavedPhotoEditVersion | null> {
  const problem = photoSettingsError(input.settings) ?? photoPreviewError(input.preview)
  if (problem) throw problem

  const { editId } = input
  const first = await getContentPhotoEdit(db, input.organizationId, editId)
  if (!first) return null
  if (first.currentVersionId !== input.baseVersionId) {
    throw new PhotoEditConflictError(first.currentVersionId, first.currentVersionNumber)
  }

  const versionId = crypto.randomUUID()
  const keys = versionObjectKeys(editId, [versionId])
  await bucket.put(keys[0]!, input.settings.body, {
    httpMetadata: { contentType: 'application/json' },
  })
  await bucket.put(keys[1]!, input.preview.body, {
    httpMetadata: { contentType: photoPreviewType(input.preview.head)! },
  })

  try {
    let edit: ContentPhotoEdit | null = first
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      if (!edit) return null
      if (edit.currentVersionId !== input.baseVersionId) {
        throw new PhotoEditConflictError(edit.currentVersionId, edit.currentVersionNumber)
      }
      const [highest] = await db
        .select({ number: max(contentPhotoEditVersion.number) })
        .from(contentPhotoEditVersion)
        .where(eq(contentPhotoEditVersion.editId, editId))
      const number = (highest?.number ?? 0) + 1

      // One batch (atomic on D1): point the edit at the new version only if
      // nobody wrote it since it was read, then insert the version row only if
      // that happened (its SELECT finds the edit only with the new pointer).
      const [moved] = await db.batch([
        db
          .update(contentPhotoEdit)
          .set({ currentVersionId: versionId, updatedAt: nextUpdatedAt(edit.updatedAt, now) })
          .where(
            and(eq(contentPhotoEdit.id, editId), eq(contentPhotoEdit.updatedAt, edit.updatedAt)),
          )
          .returning({ id: contentPhotoEdit.id }),
        db.insert(contentPhotoEditVersion).select(
          db
            .select({
              id: sql<string>`${versionId}`.as('id'),
              editId: contentPhotoEdit.id,
              number: sql<number>`${number}`.as('number'),
              authorKind: sql<PhotoEditAuthorKind>`${input.authorKind}`.as('author_kind'),
              createdById: sql<string>`${input.createdById}`.as('created_by_id'),
              settingsSize: sql<number>`${input.settings.size}`.as('settings_size'),
              previewSize: sql<number>`${input.preview.size}`.as('preview_size'),
              createdAt: sql<Date>`${now.getTime()}`.as('created_at'),
            })
            .from(contentPhotoEdit)
            .where(
              and(
                eq(contentPhotoEdit.id, editId),
                eq(contentPhotoEdit.currentVersionId, versionId),
              ),
            ),
        ),
      ])
      if (moved.length > 0) return { versionId, number }
      edit = await getContentPhotoEdit(db, input.organizationId, editId)
    }
    throw new PhotoEditRuleError(RACE_MESSAGE)
  } catch (error) {
    // Nothing points at the files: do not leave them behind.
    await deleteObjectsQuietly(bucket, keys, `unsaved photo edit version ${versionId}`)
    throw error
  }
}

/** Reads a whole object into memory, or `null` when it is missing. */
async function readObject(bucket: MediaBucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key)
  if (!object?.body) return null
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

function asPhotoEditFile(bytes: Uint8Array): PhotoEditFile {
  return {
    body: bytes.slice().buffer,
    size: bytes.length,
    head: bytes.subarray(0, PHOTO_SIGNATURE_BYTES),
  }
}

/**
 * Copies an old version's files into a new current version (history is never
 * rewritten). Returns `null` when the edit or version does not exist.
 */
export async function restorePhotoEditVersion(
  db: Database,
  bucket: MediaBucket,
  input: {
    organizationId: string
    editId: string
    versionId: string
    createdById: string
    authorKind: PhotoEditAuthorKind
  },
  now: Date = new Date(),
): Promise<SavedPhotoEditVersion | null> {
  const edit = await getContentPhotoEdit(db, input.organizationId, input.editId)
  const version = await getPhotoEditVersion(db, input.organizationId, input.editId, input.versionId)
  if (!edit || !version) return null
  if (edit.currentVersionId === version.id) {
    throw new PhotoEditRuleError('Esta já é a versão atual da foto.')
  }
  const settings = await readObject(bucket, photoEditSettingsKey(edit.id, version.id))
  const preview = await readObject(bucket, photoEditPreviewKey(edit.id, version.id))
  if (!settings || !preview) {
    throw new PhotoEditRuleError('Os arquivos desta versão não foram encontrados.')
  }
  return savePhotoEditVersion(
    db,
    bucket,
    {
      organizationId: input.organizationId,
      editId: edit.id,
      createdById: input.createdById,
      authorKind: input.authorKind,
      baseVersionId: edit.currentVersionId,
      settings: asPhotoEditFile(settings),
      preview: asPhotoEditFile(preview),
    },
    now,
  )
}

/** `<name>.<ext>`, without characters a file name cannot hold. */
export function photoEditFilename(name: string, extension: 'jpg' | 'png'): string {
  const base = name.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${base || 'foto'}.${extension}`
}

/**
 * Copies the current version's preview into the item's media (a
 * `content_asset` named `<edit name>.jpg`, or `.png` when the preview is a
 * PNG). Returns `null` when the edit does not exist; throws
 * `PhotoEditRuleError` when it has no version yet.
 */
export async function publishPhotoEditPreview(
  db: Database,
  bucket: MediaBucket,
  organizationId: string,
  createdById: string,
  editId: string,
): Promise<ContentAsset | null> {
  const edit = await getContentPhotoEdit(db, organizationId, editId)
  if (!edit) return null
  if (!edit.currentVersionId) {
    throw new PhotoEditRuleError('Salve a edição da foto antes de usá-la como mídia.')
  }
  const bytes = await readObject(bucket, photoEditPreviewKey(edit.id, edit.currentVersionId))
  if (!bytes) throw new PhotoEditRuleError('A prévia da versão atual não foi encontrada.')
  const type = photoPreviewType(bytes.subarray(0, PHOTO_SIGNATURE_BYTES))
  if (!type) throw new PhotoEditRuleError('A prévia da versão atual não é uma imagem válida.')
  return createContentAsset(db, bucket, {
    organizationId,
    contentItemId: edit.contentItemId,
    createdById,
    file: {
      name: photoEditFilename(edit.name, type === 'image/png' ? 'png' : 'jpg'),
      type,
      size: bytes.length,
    },
    body: bytes.slice().buffer,
  })
}
