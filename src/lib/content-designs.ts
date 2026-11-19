/**
 * Designs of a content item: sizes, limits, types, schemas and URLs.
 * Client-safe, and the single place that lists the design presets and the
 * file rules of a saved version.
 *
 * A design is a Zora Studio document. Each save is an immutable version: the
 * editable source (Studio's native `.vectorcraft`, JSON or gzip) and a PNG
 * preview, both in the R2 bucket bound as `MEDIA`. The rows are
 * `content_design` and `content_design_version` (`src/db/content-schema.ts`).
 */
import { z } from 'zod'
import type { Channel } from './content'

/** Who saved a version: a person in Studio, or an agent through MCP. */
export const DESIGN_AUTHOR_KINDS = ['user', 'agent'] as const
export type DesignAuthorKind = (typeof DESIGN_AUTHOR_KINDS)[number]

/**
 * Artboard sizes offered for a new design. `name` is Studio's preset name
 * (stored in `content_design.preset`); `label` is what people read.
 */
export const DESIGN_PRESETS = [
  { name: 'Instagram Post 1080×1080', label: 'Post do Instagram', width: 1080, height: 1080 },
  { name: 'Instagram Portrait 1080×1350', label: 'Retrato do Instagram', width: 1080, height: 1350 },
  { name: 'Instagram Story 1080×1920', label: 'Story do Instagram', width: 1080, height: 1920 },
  { name: 'TikTok Cover 1080×1920', label: 'Capa do TikTok', width: 1080, height: 1920 },
  { name: 'YouTube Thumbnail 1280×720', label: 'Thumbnail do YouTube', width: 1280, height: 720 },
  { name: 'X Post 1600×900', label: 'Post do X', width: 1600, height: 900 },
  { name: 'LinkedIn Post 1200×627', label: 'Post do LinkedIn', width: 1200, height: 627 },
  { name: 'Blog Cover 1200×630', label: 'Capa do blog', width: 1200, height: 630 },
] as const

export type DesignPreset = (typeof DESIGN_PRESETS)[number]
export type DesignPresetName = DesignPreset['name']

export const DESIGN_PRESET_NAMES = DESIGN_PRESETS.map((preset) => preset.name) as [
  DesignPresetName,
  ...Array<DesignPresetName>,
]

/** The size a new design of an item starts with, by the item's channel. */
export const CHANNEL_DESIGN_PRESETS: Record<Channel, DesignPresetName> = {
  instagram: 'Instagram Post 1080×1080',
  tiktok: 'TikTok Cover 1080×1920',
  youtube: 'YouTube Thumbnail 1280×720',
  x: 'X Post 1600×900',
  linkedin: 'LinkedIn Post 1200×627',
  blog: 'Blog Cover 1200×630',
}

export function findDesignPreset(name: string | null | undefined): DesignPreset | null {
  return DESIGN_PRESETS.find((preset) => preset.name === name) ?? null
}

export function channelDesignPreset(channel: Channel): DesignPreset {
  return findDesignPreset(CHANNEL_DESIGN_PRESETS[channel])!
}

/** Largest artboard side, in pixels (also a CHECK in the database). */
export const MAX_DESIGN_SIDE = 16384
/** Largest editable source of one version. */
export const MAX_DESIGN_SOURCE_BYTES = 50 * 1024 * 1024
/** Largest PNG preview of one version. */
export const MAX_DESIGN_PREVIEW_BYTES = 20 * 1024 * 1024
export const MAX_DESIGN_NAME_LENGTH = 200

/** A design, as returned by the server. */
export type ContentDesign = {
  id: string
  contentItemId: string
  name: string
  widthPx: number
  heightPx: number
  /** Studio preset name, or null for a custom size. */
  preset: string | null
  /** Null until the first save. */
  currentVersionId: string | null
  currentVersionNumber: number | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}

/** One saved state of a design. */
export type ContentDesignVersion = {
  id: string
  designId: string
  number: number
  authorKind: DesignAuthorKind
  createdById: string
  /** The saver's name, or null when the user no longer exists. */
  createdByName: string | null
  sourceSize: number
  previewSize: number
  createdAt: Date
}

// --- schemas ------------------------------------------------------------------

const uuid = z.uuid()
export const designNameSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome ao design.')
  .max(MAX_DESIGN_NAME_LENGTH, `O nome pode ter no máximo ${MAX_DESIGN_NAME_LENGTH} caracteres.`)
const designSide = z
  .number()
  .int('Use um número inteiro de pixels.')
  .min(1, 'O tamanho mínimo é 1 px.')
  .max(MAX_DESIGN_SIDE, `O tamanho máximo é ${MAX_DESIGN_SIDE} px.`)

export const contentDesignIdSchema = z.object({ designId: uuid })
export const listContentDesignsSchema = z.object({ itemId: uuid })

/**
 * A new design: a preset, or an explicit width and height. With neither, the
 * item's channel picks the preset; without a name, the preset's label (or
 * "Design") is used.
 */
export const createContentDesignSchema = z
  .object({
    itemId: uuid,
    name: designNameSchema.optional(),
    preset: z.enum(DESIGN_PRESET_NAMES).optional(),
    width: designSide.optional(),
    height: designSide.optional(),
  })
  .refine((input) => (input.width === undefined) === (input.height === undefined), {
    message: 'Informe a largura e a altura.',
    path: ['height'],
  })
  .refine((input) => input.preset === undefined || input.width === undefined, {
    message: 'Escolha um tamanho pronto ou um tamanho personalizado, não os dois.',
    path: ['preset'],
  })
export type CreateContentDesignInput = z.input<typeof createContentDesignSchema>
export type CreateContentDesignData = z.output<typeof createContentDesignSchema>

export const renameContentDesignSchema = contentDesignIdSchema.extend({
  name: designNameSchema,
})
export type RenameContentDesignInput = z.input<typeof renameContentDesignSchema>

export const designVersionRefSchema = contentDesignIdSchema.extend({ versionId: uuid })
export type DesignVersionRefInput = z.input<typeof designVersionRefSchema>

// --- files ---------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Whether the first bytes are a PNG signature. */
export function hasPngSignature(head: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => head[index] === byte)
}

/** Whether the first bytes look like a Studio source: gzip, or JSON (`{`). */
export function hasDesignSourceSignature(head: Uint8Array): boolean {
  return (head[0] === 0x1f && head[1] === 0x8b) || head[0] === 0x7b
}

/** e.g. "1080 × 1080 px". */
export function formatDesignSize(width: number, height: number): string {
  return `${width} × ${height} px`
}

// --- URLs and storage keys --------------------------------------------------------

function withVersion(path: string, versionId?: string | null): string {
  return versionId ? `${path}?version=${encodeURIComponent(versionId)}` : path
}

/** Metadata (`GET`). */
export function designApiUrl(designId: string): string {
  return `/api/designs/${designId}`
}

/** The editable source (`GET`, download only); the current version by default. */
export function designSourceUrl(designId: string, versionId?: string | null): string {
  return withVersion(`/api/designs/${designId}/source`, versionId)
}

/** The PNG preview (`GET`, inline); the current version by default. */
export function designPreviewUrl(designId: string, versionId?: string | null): string {
  return withVersion(`/api/designs/${designId}/preview`, versionId)
}

/** Where Studio saves a new version (`POST`, multipart). */
export function designVersionsUrl(designId: string): string {
  return `/api/designs/${designId}/versions`
}

/** R2 key of a version's source. */
export function designSourceKey(designId: string, versionId: string): string {
  return `designs/${designId}/${versionId}/source.vectorcraft`
}

/** R2 key of a version's preview. */
export function designPreviewKey(designId: string, versionId: string): string {
  return `designs/${designId}/${versionId}/preview.png`
}
