/**
 * The HTTP API of photo edits (`/api/photo-edits/...` and the original upload
 * `/api/content/<itemId>/photo-edits`), used by the LightCraft editor page.
 * The route files check the session and pass the workspace in; these
 * functions do the rest, so they can be tested without a running app.
 *
 * Safety: an original and the develop settings are never served as something
 * a browser renders (`application/octet-stream`, `attachment`, `nosniff`);
 * only previews are inline, and only after their signature was checked on
 * upload.
 */
import { z } from 'zod'
import type { Database } from '../db/client.server'
import type { MediaBucket } from './content-assets.server'
import {
  MAX_PHOTO_ORIGINAL_BYTES,
  MAX_PHOTO_PREVIEW_BYTES,
  MAX_PHOTO_SETTINGS_BYTES,
  PHOTO_SIGNATURE_BYTES,
  photoEditNameSchema,
  photoEditPreviewKey,
  photoEditSettingsKey,
} from './content-photo-edits'
import {
  PhotoEditConflictError,
  PhotoEditFileError,
  PhotoEditRuleError,
  createPhotoEditFromUpload,
  getContentPhotoEdit,
  getPhotoEditOriginalKey,
  getPhotoEditVersion,
  savePhotoEditVersion,
} from './content-photo-edits.server'
import type { PhotoEditFile } from './content-photo-edits.server'

/** Room for both files plus the multipart framing and the base version field. */
const MAX_VERSION_REQUEST_BYTES =
  MAX_PHOTO_SETTINGS_BYTES + MAX_PHOTO_PREVIEW_BYTES + 1024 * 1024

const NOT_FOUND = 'Edição de foto não encontrada.'
const ITEM_NOT_FOUND = 'Item de conteúdo não encontrado.'

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

function problem(status: number, error: string): Response {
  return json({ error }, status)
}

function parseUuid(value: string | null | undefined): string | null {
  const parsed = z.uuid().safeParse(value)
  return parsed.success ? parsed.data : null
}

function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  return `${kind}; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** `GET /api/photo-edits/<editId>`: the metadata the editor opens an edit with. */
export async function photoEditMetadataResponse(
  db: Database,
  organizationId: string | null,
  editIdParam: string,
): Promise<Response> {
  const editId = parseUuid(editIdParam)
  const edit = editId && organizationId ? await getContentPhotoEdit(db, organizationId, editId) : null
  if (!edit) return problem(404, NOT_FOUND)
  return json({
    id: edit.id,
    itemId: edit.contentItemId,
    name: edit.name,
    originalName: edit.originalName,
    currentVersionId: edit.currentVersionId,
    currentVersionNumber: edit.currentVersionNumber,
    updatedAt: edit.updatedAt.toISOString(),
  })
}

/** Headers no browser renders or runs anything from. */
function safeHeaders(size: number, etag: string): Headers {
  return new Headers({
    'Content-Length': String(size),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
}

/** `GET /api/photo-edits/<editId>/original`: the edit's own copy of the original. */
export async function photoEditOriginalResponse(
  db: Database,
  bucket: MediaBucket,
  organizationId: string | null,
  editIdParam: string,
): Promise<Response> {
  const editId = parseUuid(editIdParam)
  const edit = editId && organizationId ? await getContentPhotoEdit(db, organizationId, editId) : null
  const key = edit ? await getPhotoEditOriginalKey(db, organizationId!, edit.id) : null
  if (!edit || !key) return problem(404, NOT_FOUND)
  const object = await bucket.get(key)
  if (!object?.body) return problem(404, 'A foto original não foi encontrada.')
  const headers = safeHeaders(object.size, object.httpEtag)
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Content-Disposition', contentDisposition('attachment', edit.originalName))
  headers.set('Cache-Control', 'private, no-store')
  if (edit.currentVersionId) headers.set('X-Photo-Edit-Version', edit.currentVersionId)
  return new Response(object.body, { status: 200, headers })
}

/**
 * `GET /api/photo-edits/<editId>/settings|preview[?version=<versionId>]`: a
 * file of the given version, or of the current one. 404 without a version.
 */
export async function photoEditFileResponse(
  db: Database,
  bucket: MediaBucket,
  organizationId: string | null,
  editIdParam: string,
  kind: 'settings' | 'preview',
  url: URL,
): Promise<Response> {
  const editId = parseUuid(editIdParam)
  const edit = editId && organizationId ? await getContentPhotoEdit(db, organizationId, editId) : null
  if (!edit) return problem(404, NOT_FOUND)

  const requested = url.searchParams.get('version')
  let versionId = edit.currentVersionId
  if (requested !== null) {
    const id = parseUuid(requested)
    const version = id ? await getPhotoEditVersion(db, organizationId!, edit.id, id) : null
    versionId = version?.id ?? null
  }
  if (!versionId) return problem(404, 'Esta edição de foto ainda não tem uma versão salva.')

  const key =
    kind === 'settings'
      ? photoEditSettingsKey(edit.id, versionId)
      : photoEditPreviewKey(edit.id, versionId)
  const object = await bucket.get(key)
  if (!object?.body) return problem(404, 'O arquivo desta versão não foi encontrado.')

  const headers = safeHeaders(object.size, object.httpEtag)
  headers.set('X-Photo-Edit-Version', versionId)
  if (kind === 'settings') {
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('Content-Disposition', contentDisposition('attachment', `${edit.name}.json`))
    headers.set('Cache-Control', 'private, no-store')
  } else {
    // Stored with the type its signature showed on upload: JPEG, or PNG.
    const type = object.httpMetadata?.contentType === 'image/png' ? 'image/png' : 'image/jpeg'
    headers.set('Content-Type', type)
    headers.set(
      'Content-Disposition',
      contentDisposition('inline', `${edit.name}.${type === 'image/png' ? 'png' : 'jpg'}`),
    )
    // A version never changes; "the current one" does.
    headers.set(
      'Cache-Control',
      requested !== null ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    )
  }
  return new Response(object.body, { status: 200, headers })
}

async function filePart(value: FormDataEntryValue | null): Promise<PhotoEditFile | null> {
  if (value === null || typeof value === 'string') return null
  const head = new Uint8Array(await value.slice(0, PHOTO_SIGNATURE_BYTES).arrayBuffer())
  return { body: value, size: value.size, head }
}

function fileErrorResponse(error: unknown): Response {
  if (error instanceof PhotoEditFileError) return problem(error.status, error.message)
  if (error instanceof PhotoEditRuleError) return problem(422, error.message)
  throw error
}

/**
 * `POST /api/photo-edits/<editId>/versions`, `multipart/form-data` with
 * `settings`, `preview` and `baseVersionId` (empty for the first save).
 * `201 {versionId, number}`; `409 {error, currentVersionId, currentVersionNumber}`
 * when the base is not the current version; `413`/`422` for bad files.
 */
export async function photoEditVersionUploadResponse(
  db: Database,
  bucket: MediaBucket,
  actor: { organizationId: string | null; userId: string },
  editIdParam: string,
  request: Request,
): Promise<Response> {
  const editId = parseUuid(editIdParam)
  if (!editId || !actor.organizationId) return problem(404, NOT_FOUND)

  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('multipart/form-data')) {
    return problem(415, 'Envie a foto como multipart/form-data.')
  }
  const length = Number(request.headers.get('content-length'))
  if (!request.headers.has('content-length') || !Number.isInteger(length)) {
    return problem(411, 'Envie o tamanho da requisição (Content-Length).')
  }
  if (length > MAX_VERSION_REQUEST_BYTES) {
    return problem(413, 'Os arquivos da edição de foto são grandes demais.')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(422, 'Não foi possível ler os arquivos enviados.')
  }
  const settings = await filePart(form.get('settings'))
  const preview = await filePart(form.get('preview'))
  if (!settings) return problem(422, 'Envie as configurações da foto no campo "settings".')
  if (!preview) return problem(422, 'Envie a prévia JPEG no campo "preview".')

  const base = form.get('baseVersionId')
  if (base !== null && typeof base !== 'string') return problem(422, 'baseVersionId inválido.')
  const baseVersionId = base?.trim() ? parseUuid(base.trim()) : null
  if (base?.trim() && !baseVersionId) return problem(422, 'baseVersionId inválido.')

  try {
    const saved = await savePhotoEditVersion(db, bucket, {
      organizationId: actor.organizationId,
      editId,
      createdById: actor.userId,
      authorKind: 'user',
      baseVersionId,
      settings,
      preview,
    })
    if (!saved) return problem(404, NOT_FOUND)
    return json(saved, 201)
  } catch (error) {
    if (error instanceof PhotoEditConflictError) {
      return json(
        {
          error: error.message,
          currentVersionId: error.currentVersionId,
          currentVersionNumber: error.currentVersionNumber,
        },
        409,
      )
    }
    return fileErrorResponse(error)
  }
}

/** The file name from `?filename=`, without any directory part. */
function uploadedFilename(url: URL): string {
  const raw = url.searchParams.get('filename') ?? ''
  return raw.split(/[/\\]/).pop()!.trim().slice(0, 255)
}

/**
 * `POST /api/content/<itemId>/photo-edits?filename=<name.ext>[&name=<edit name>]`
 * with the original as the raw body (streamed into R2; `Content-Length`
 * required, at most 100 MB). `201 {edit}` with the new photo edit.
 */
export async function photoEditOriginalUploadResponse(
  db: Database,
  bucket: MediaBucket,
  actor: { organizationId: string | null; userId: string },
  itemIdParam: string,
  request: Request,
): Promise<Response> {
  const itemId = parseUuid(itemIdParam)
  if (!itemId || !actor.organizationId) return problem(404, ITEM_NOT_FOUND)

  const size = Number(request.headers.get('content-length'))
  if (!request.body || !request.headers.has('content-length') || !Number.isInteger(size)) {
    return problem(411, 'Envie a foto no corpo da requisição, com Content-Length.')
  }
  if (size > MAX_PHOTO_ORIGINAL_BYTES) return problem(413, 'A foto original é grande demais.')

  const url = new URL(request.url)
  const filename = uploadedFilename(url)
  if (!filename) return problem(422, 'Informe o nome do arquivo (?filename=).')
  const rawName = url.searchParams.get('name')
  let name: string | undefined
  if (rawName !== null && rawName.trim() !== '') {
    const parsed = photoEditNameSchema.safeParse(rawName)
    if (!parsed.success) return problem(422, parsed.error.issues[0]?.message ?? 'Nome inválido.')
    name = parsed.data
  }

  try {
    const edit = await createPhotoEditFromUpload(db, bucket, {
      organizationId: actor.organizationId,
      contentItemId: itemId,
      createdById: actor.userId,
      file: { name: filename, size },
      body: request.body,
      name,
    })
    if (!edit) return problem(404, ITEM_NOT_FOUND)
    return json({ edit }, 201)
  } catch (error) {
    return fileErrorResponse(error)
  }
}
