/**
 * The HTTP API of designs (`/api/designs/...`), used by Zora Studio in the
 * iframe. The route files check the session and pass the workspace in; these
 * functions do the rest, so they can be tested without a running app.
 *
 * Safety: a design source is never served as something a browser renders
 * (`application/octet-stream`, `attachment`, `nosniff`); only PNG previews
 * are inline, and only after their signature was checked on upload.
 */
import { z } from 'zod'
import type { Database } from '../db/client.server'
import type { MediaBucket } from './content-assets.server'
import {
  MAX_DESIGN_PREVIEW_BYTES,
  MAX_DESIGN_SOURCE_BYTES,
  designPreviewKey,
  designSourceKey,
} from './content-designs'
import {
  DesignConflictError,
  DesignFileError,
  DesignRuleError,
  getContentDesign,
  getDesignVersion,
  saveDesignVersion,
} from './content-designs.server'
import type { DesignFile } from './content-designs.server'

/** Room for both files plus the multipart framing and the base version field. */
const MAX_VERSION_REQUEST_BYTES = MAX_DESIGN_SOURCE_BYTES + MAX_DESIGN_PREVIEW_BYTES + 1024 * 1024

const NOT_FOUND = 'Design não encontrado.'

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

/** `GET /api/designs/<designId>`: the metadata Studio opens a design with. */
export async function designMetadataResponse(
  db: Database,
  organizationId: string | null,
  designIdParam: string,
): Promise<Response> {
  const designId = parseUuid(designIdParam)
  const design =
    designId && organizationId ? await getContentDesign(db, organizationId, designId) : null
  if (!design) return problem(404, NOT_FOUND)
  return json({
    id: design.id,
    itemId: design.contentItemId,
    name: design.name,
    width: design.widthPx,
    height: design.heightPx,
    preset: design.preset,
    currentVersionId: design.currentVersionId,
    currentVersionNumber: design.currentVersionNumber,
    updatedAt: design.updatedAt.toISOString(),
  })
}

/**
 * `GET /api/designs/<designId>/source|preview[?version=<versionId>]`: a file
 * of the given version, or of the current one. 404 without a version.
 */
export async function designFileResponse(
  db: Database,
  bucket: MediaBucket,
  organizationId: string | null,
  designIdParam: string,
  kind: 'source' | 'preview',
  url: URL,
): Promise<Response> {
  const designId = parseUuid(designIdParam)
  const design =
    designId && organizationId ? await getContentDesign(db, organizationId, designId) : null
  if (!design) return problem(404, NOT_FOUND)

  const requested = url.searchParams.get('version')
  let versionId = design.currentVersionId
  if (requested !== null) {
    const id = parseUuid(requested)
    const version = id ? await getDesignVersion(db, organizationId!, design.id, id) : null
    versionId = version?.id ?? null
  }
  if (!versionId) return problem(404, 'Este design ainda não tem uma versão salva.')

  const key =
    kind === 'source' ? designSourceKey(design.id, versionId) : designPreviewKey(design.id, versionId)
  const object = await bucket.get(key)
  if (!object?.body) return problem(404, 'O arquivo desta versão não foi encontrado.')

  const headers = new Headers({
    'Content-Length': String(object.size),
    ETag: object.httpEtag,
    'X-Design-Version': versionId,
    // Never let a browser guess a type, and never run anything from here.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  if (kind === 'source') {
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('Content-Disposition', contentDisposition('attachment', `${design.name}.vectorcraft`))
    headers.set('Cache-Control', 'private, no-store')
  } else {
    headers.set('Content-Type', 'image/png')
    headers.set('Content-Disposition', contentDisposition('inline', `${design.name}.png`))
    // A version never changes; "the current one" does.
    headers.set(
      'Cache-Control',
      requested !== null ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    )
  }
  return new Response(object.body, { status: 200, headers })
}

async function filePart(value: FormDataEntryValue | null): Promise<DesignFile | null> {
  if (value === null || typeof value === 'string') return null
  const head = new Uint8Array(await value.slice(0, 8).arrayBuffer())
  return { body: value, size: value.size, head }
}

/**
 * `POST /api/designs/<designId>/versions`, `multipart/form-data` with
 * `source`, `preview` and `baseVersionId` (empty for the first save).
 * `201 {versionId, number}`; `409 {error, currentVersionId, currentVersionNumber}`
 * when the base is not the current version; `413`/`422` for bad files.
 */
export async function designVersionUploadResponse(
  db: Database,
  bucket: MediaBucket,
  actor: { organizationId: string | null; userId: string },
  designIdParam: string,
  request: Request,
): Promise<Response> {
  const designId = parseUuid(designIdParam)
  if (!designId || !actor.organizationId) return problem(404, NOT_FOUND)

  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('multipart/form-data')) {
    return problem(415, 'Envie o design como multipart/form-data.')
  }
  const length = Number(request.headers.get('content-length'))
  if (!request.headers.has('content-length') || !Number.isInteger(length)) {
    return problem(411, 'Envie o tamanho da requisição (Content-Length).')
  }
  if (length > MAX_VERSION_REQUEST_BYTES) return problem(413, 'Os arquivos do design são grandes demais.')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(422, 'Não foi possível ler os arquivos enviados.')
  }
  const source = await filePart(form.get('source'))
  const preview = await filePart(form.get('preview'))
  if (!source) return problem(422, 'Envie o arquivo do design no campo "source".')
  if (!preview) return problem(422, 'Envie a prévia PNG no campo "preview".')

  const base = form.get('baseVersionId')
  if (base !== null && typeof base !== 'string') return problem(422, 'baseVersionId inválido.')
  const baseVersionId = base?.trim() ? parseUuid(base.trim()) : null
  if (base?.trim() && !baseVersionId) return problem(422, 'baseVersionId inválido.')

  try {
    const saved = await saveDesignVersion(db, bucket, {
      organizationId: actor.organizationId,
      designId,
      createdById: actor.userId,
      authorKind: 'user',
      baseVersionId,
      source,
      preview,
    })
    if (!saved) return problem(404, NOT_FOUND)
    return json(saved, 201)
  } catch (error) {
    if (error instanceof DesignConflictError) {
      return json(
        {
          error: error.message,
          currentVersionId: error.currentVersionId,
          currentVersionNumber: error.currentVersionNumber,
        },
        409,
      )
    }
    if (error instanceof DesignFileError) return problem(error.status, error.message)
    if (error instanceof DesignRuleError) return problem(422, error.message)
    throw error
  }
}
