/**
 * Photo edits of a content item: accepted originals, limits, types, schemas
 * and URLs. Client-safe, and the single place that lists which originals a
 * photo edit accepts and the file rules of a saved version.
 *
 * A photo edit is a LightCraft development of one original photo. The
 * original is copied once per edit into the R2 bucket bound as `MEDIA`
 * (`photo-edits/<editId>/original.<ext>`), also when it came from an image of
 * the item's media (then only recorded as `sourceAssetId`), so deleting or
 * replacing media never breaks an edit. Each save is an immutable version:
 * the develop settings JSON (what LightCraft's `develop.get` returns) and a
 * rendered preview. The rows are `content_photo_edit` and
 * `content_photo_edit_version` (`src/db/content-schema.ts`); the plan is
 * docs/LIGHTCRAFT-PLAN.md ("Contracts").
 */
import { z } from 'zod'
import { MAX_ASSET_BYTES, formatBytes } from './content-assets'

/** Who saved a version: a person in LightCraft, or an agent through MCP. */
export const PHOTO_EDIT_AUTHOR_KINDS = ['user', 'agent'] as const
export type PhotoEditAuthorKind = (typeof PHOTO_EDIT_AUTHOR_KINDS)[number]

/** Largest original: the Workers request body limit, as for media uploads. */
export const MAX_PHOTO_ORIGINAL_BYTES = MAX_ASSET_BYTES
/** Largest develop settings JSON of one version. */
export const MAX_PHOTO_SETTINGS_BYTES = 1024 * 1024
/** Largest rendered preview of one version. */
export const MAX_PHOTO_PREVIEW_BYTES = 20 * 1024 * 1024
export const MAX_PHOTO_EDIT_NAME_LENGTH = 200

/** How an original's first bytes are checked. */
export type PhotoOriginalKind = 'jpeg' | 'png' | 'webp' | 'avif' | 'raw'

/**
 * Accepted originals by lower-case extension. Browsers send an empty or a
 * vendor MIME type for raws, so originals are recognised by extension and
 * then checked by signature. The image types are those of `MEDIA_TYPES`
 * except GIF; the raws are those LightCraft imports
 * (`crates/engine/src/import/files.rs`) that carry a signature we can check,
 * plus TIFF. Raws never become item media: only an edit's preview does.
 */
export const PHOTO_ORIGINAL_EXTENSIONS = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  tif: 'raw',
  tiff: 'raw',
  dng: 'raw',
  cr2: 'raw',
  cr3: 'raw',
  crw: 'raw',
  nef: 'raw',
  nrw: 'raw',
  arw: 'raw',
  srf: 'raw',
  sr2: 'raw',
  raf: 'raw',
  orf: 'raw',
  rw2: 'raw',
  rwl: 'raw',
  pef: 'raw',
  srw: 'raw',
  mrw: 'raw',
  x3f: 'raw',
  '3fr': 'raw',
  fff: 'raw',
  iiq: 'raw',
  erf: 'raw',
  kdc: 'raw',
  mef: 'raw',
  mos: 'raw',
} as const satisfies Record<string, PhotoOriginalKind>

export type PhotoOriginalExtension = keyof typeof PHOTO_ORIGINAL_EXTENSIONS

/** Media types of the item an edit can start from, and the extension of their copy. */
export const PHOTO_SOURCE_MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const satisfies Record<string, PhotoOriginalExtension>

/** Value for `<input accept>`: every extension, in both cases (some browsers match case-sensitively). */
export const PHOTO_ORIGINAL_ACCEPT = Object.keys(PHOTO_ORIGINAL_EXTENSIONS)
  .flatMap((ext) => [`.${ext}`, `.${ext.toUpperCase()}`])
  .join(',')

/** How many first bytes the signature checks read. */
export const PHOTO_SIGNATURE_BYTES = 16

/** The lower-case extension of a file name, if it is an accepted original. */
export function photoOriginalExtension(filename: string): PhotoOriginalExtension | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim())
  const ext = match?.[1]?.toLowerCase()
  return ext && ext in PHOTO_ORIGINAL_EXTENSIONS ? (ext as PhotoOriginalExtension) : null
}

/** Whether a media type is an image a photo edit can start from (GIF is not). */
export function isPhotoSourceMediaType(contentType: string): boolean {
  return contentType in PHOTO_SOURCE_MEDIA_TYPES
}

function startsWith(head: Uint8Array, bytes: ReadonlyArray<number> | string, at = 0): boolean {
  const expected = typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes
  return expected.every((byte, index) => head[at + index] === byte)
}

export function hasJpegSignature(head: Uint8Array): boolean {
  return startsWith(head, [0xff, 0xd8, 0xff])
}

export function hasPngSignature(head: Uint8Array): boolean {
  return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

/** An ISO BMFF `ftyp` box whose major brand is one of `brands`. */
function hasFtypBrand(head: Uint8Array, brands: ReadonlyArray<string>): boolean {
  return startsWith(head, 'ftyp', 4) && brands.some((brand) => startsWith(head, brand, 8))
}

/**
 * Camera raw and TIFF signatures, as LightCraft sniffs them
 * (`crates/codecs/src/sniff.rs`): TIFF and TIFF-based raws (`II*\0`,
 * `MM\0*`; DNG, CR2, NEF, ARW, PEF, IIQ, 3FR, ...), Olympus ORF (`IIRO`,
 * `IIRS`, `MMOR`), Panasonic RW2/RWL (`IIU\0`), Fujifilm RAF
 * (`FUJIFILMCCD-RAW`), Minolta MRW (`\0MRM`), Sigma X3F (`FOVb`), Canon CRW
 * (`II` + `HEAPCCDR`) and Canon CR3 (ISO BMFF, brand `crx `).
 */
export function hasRawSignature(head: Uint8Array): boolean {
  return (
    startsWith(head, 'II*\0') ||
    startsWith(head, 'MM\0*') ||
    startsWith(head, 'IIRO') ||
    startsWith(head, 'IIRS') ||
    startsWith(head, 'MMOR') ||
    startsWith(head, 'IIU\0') ||
    startsWith(head, 'FUJIFILMCCD-RAW') ||
    startsWith(head, '\0MRM') ||
    startsWith(head, 'FOVb') ||
    (startsWith(head, 'II') && startsWith(head, 'HEAPCCDR', 6)) ||
    hasFtypBrand(head, ['crx '])
  )
}

/** Whether the first bytes match what an original of this kind starts with. */
export function hasPhotoOriginalSignature(kind: PhotoOriginalKind, head: Uint8Array): boolean {
  switch (kind) {
    case 'jpeg':
      return hasJpegSignature(head)
    case 'png':
      return hasPngSignature(head)
    case 'webp':
      return startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8)
    case 'avif':
      return hasFtypBrand(head, ['avif', 'avis'])
    case 'raw':
      return hasRawSignature(head)
  }
}

/** A message for an original that may not be stored (before reading its bytes), or `null`. */
export function photoOriginalUploadError(file: { name: string; size: number }): string | null {
  if (!photoOriginalExtension(file.name)) {
    return `${file.name}: só é possível editar fotos JPEG, PNG, WebP, AVIF, TIFF ou arquivos raw de câmera (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG e outros).`
  }
  if (file.size === 0) return `${file.name}: o arquivo está vazio.`
  if (file.size > MAX_PHOTO_ORIGINAL_BYTES) {
    return `${file.name}: a foto original pode ter no máximo ${formatBytes(MAX_PHOTO_ORIGINAL_BYTES)}.`
  }
  return null
}

/** Whether the first bytes look like a settings JSON object (`{`, after optional whitespace). */
export function hasPhotoSettingsSignature(head: Uint8Array): boolean {
  for (const byte of head) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    return byte === 0x7b
  }
  return false
}

/** The preview's real type from its first bytes (JPEG or PNG), or `null`. */
export function photoPreviewType(head: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (hasJpegSignature(head)) return 'image/jpeg'
  if (hasPngSignature(head)) return 'image/png'
  return null
}

/** A photo edit, as returned by the server. */
export type ContentPhotoEdit = {
  id: string
  contentItemId: string
  name: string
  /** The image media the original was copied from; null for an upload, or once that media is deleted. */
  sourceAssetId: string | null
  /** File name of the original, with its extension (LightCraft reads the format from it). */
  originalName: string
  originalSize: number
  /** Null until the first save. */
  currentVersionId: string | null
  currentVersionNumber: number | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}

/** One saved state of a photo edit. */
export type ContentPhotoEditVersion = {
  id: string
  editId: string
  number: number
  authorKind: PhotoEditAuthorKind
  createdById: string
  /** The saver's name, or null when the user no longer exists. */
  createdByName: string | null
  settingsSize: number
  previewSize: number
  createdAt: Date
}

// --- schemas ------------------------------------------------------------------

const uuid = z.uuid()
export const photoEditNameSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome à edição de foto.')
  .max(
    MAX_PHOTO_EDIT_NAME_LENGTH,
    `O nome pode ter no máximo ${MAX_PHOTO_EDIT_NAME_LENGTH} caracteres.`,
  )

export const contentPhotoEditIdSchema = z.object({ editId: uuid })
export const listContentPhotoEditsSchema = z.object({ itemId: uuid })

/** A new photo edit from an image of the item's media (uploads are an HTTP route). */
export const createContentPhotoEditSchema = z.object({
  itemId: uuid,
  assetId: uuid,
  name: photoEditNameSchema.optional(),
})
export type CreateContentPhotoEditInput = z.input<typeof createContentPhotoEditSchema>

export const renameContentPhotoEditSchema = contentPhotoEditIdSchema.extend({
  name: photoEditNameSchema,
})
export type RenameContentPhotoEditInput = z.input<typeof renameContentPhotoEditSchema>

export const photoEditVersionRefSchema = contentPhotoEditIdSchema.extend({ versionId: uuid })
export type PhotoEditVersionRefInput = z.input<typeof photoEditVersionRefSchema>

/** A default edit name from a file name: without the extension. */
export function photoEditNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]+$/, '').trim().slice(0, MAX_PHOTO_EDIT_NAME_LENGTH)
  return base || 'Foto'
}

// --- URLs and storage keys --------------------------------------------------------

function withVersion(path: string, versionId?: string | null): string {
  return versionId ? `${path}?version=${encodeURIComponent(versionId)}` : path
}

/** Metadata (`GET`). */
export function photoEditApiUrl(editId: string): string {
  return `/api/photo-edits/${editId}`
}

/** The edit's own copy of the original (`GET`, download only). */
export function photoEditOriginalUrl(editId: string): string {
  return `/api/photo-edits/${editId}/original`
}

/** The develop settings (`GET`, download only); the current version by default. */
export function photoEditSettingsUrl(editId: string, versionId?: string | null): string {
  return withVersion(`/api/photo-edits/${editId}/settings`, versionId)
}

/** The rendered preview (`GET`, inline); the current version by default. */
export function photoEditPreviewUrl(editId: string, versionId?: string | null): string {
  return withVersion(`/api/photo-edits/${editId}/preview`, versionId)
}

/** Where the editor saves a new version (`POST`, multipart). */
export function photoEditVersionsUrl(editId: string): string {
  return `/api/photo-edits/${editId}/versions`
}

/** Where the browser uploads an original to start a new edit of an item (`POST`, raw body). */
export function photoEditUploadUrl(itemId: string, filename: string, name?: string): string {
  const params = new URLSearchParams({ filename })
  if (name) params.set('name', name)
  return `/api/content/${itemId}/photo-edits?${params.toString()}`
}

/** R2 key of an edit's own copy of its original. */
export function photoEditOriginalKey(editId: string, extension: string): string {
  return `photo-edits/${editId}/original.${extension}`
}

/** R2 key of a version's develop settings. */
export function photoEditSettingsKey(editId: string, versionId: string): string {
  return `photo-edits/${editId}/${versionId}/settings.json`
}

/** R2 key of a version's preview (`preview.jpg`, even when the bytes are a PNG). */
export function photoEditPreviewKey(editId: string, versionId: string): string {
  return `photo-edits/${editId}/${versionId}/preview.jpg`
}
