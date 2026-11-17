/**
 * Shared content module: the single source of truth for content item
 * channels, formats and statuses, their display labels, the validation
 * schemas, and the scheduling rules.
 *
 * Client-safe: imported by the database schema, the server functions and the
 * UI. Do not restate these lists anywhere else; import them from here.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Enumerations and labels
// ---------------------------------------------------------------------------

export const CHANNELS = ['x', 'linkedin', 'instagram', 'blog'] as const
export type Channel = (typeof CHANNELS)[number]
export const CHANNEL_LABELS: Record<Channel, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  blog: 'Blog',
}

export const FORMATS = [
  'post',
  'thread',
  'carousel',
  'reel',
  'story',
  'article',
] as const
export type ContentFormat = (typeof FORMATS)[number]
export const FORMAT_LABELS: Record<ContentFormat, string> = {
  post: 'Post',
  thread: 'Thread',
  carousel: 'Carrossel',
  reel: 'Reel',
  story: 'Story',
  article: 'Artigo',
}

/** Ordered as the content pipeline flows. */
export const STATUSES = [
  'idea',
  'draft',
  'ready',
  'scheduled',
  'published',
] as const
export type ContentStatus = (typeof STATUSES)[number]
export const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: 'Ideia',
  draft: 'Rascunho',
  ready: 'Pronto',
  scheduled: 'Agendado',
  published: 'Publicado',
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A content item as returned by the server functions. Dates are UTC instants. */
export type ContentItem = {
  id: string
  title: string
  body: string
  channel: Channel
  format: ContentFormat
  status: ContentStatus
  scheduledAt: Date | null
  publishedAt: Date | null
  publishedUrl: string | null
  notes: string
  assetLinks: Array<string>
  assigneeId: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}

/** A signed-up user, as shown in assignee pickers. */
export type TeamMember = {
  id: string
  name: string
  email: string
}

// ---------------------------------------------------------------------------
// Scheduling rules (enforced on the server; reusable in forms)
// ---------------------------------------------------------------------------

export type ScheduleState = {
  status: ContentStatus
  scheduledAt: Date | null
  publishedAt: Date | null
}

export const SCHEDULED_REQUIRES_DATE_MESSAGE =
  'Um item agendado precisa de data e hora de agendamento.'

/**
 * Fills derived values: a published item without `publishedAt` gets `now`.
 * Returns a new object; never mutates the input.
 */
export function normalizeScheduleState<T extends ScheduleState>(
  item: T,
  now: Date = new Date(),
): T {
  if (item.status === 'published' && item.publishedAt === null) {
    return { ...item, publishedAt: now }
  }
  return item
}

/** Returns the violated rule's message, or `null` when the state is valid. */
export function scheduleStateError(item: ScheduleState): string | null {
  if (item.status === 'scheduled' && item.scheduledAt === null) {
    return SCHEDULED_REQUIRES_DATE_MESSAGE
  }
  if (item.status === 'published' && item.publishedAt === null) {
    return 'Um item publicado precisa de data de publicação.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const httpUrlSchema = z
  .string()
  .trim()
  .refine(isHttpUrl, { message: 'Informe uma URL http ou https válida.' })

/**
 * Accepts a `Date` or an ISO 8601 string with an offset (e.g.
 * `2026-01-31T09:00:00Z`) and yields a `Date`.
 */
export const instantSchema = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .pipe(z.coerce.date())

/** An optional URL where an empty string means "no URL". */
const nullableUrlSchema = z
  .union([httpUrlSchema, z.literal(''), z.null()])
  .transform((value) => (value ? value : null))

const userIdSchema = z.string().trim().min(1)

/** Editable fields, without defaults. */
const contentFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: 'Informe um título.' })
    .max(300, { message: 'O título pode ter no máximo 300 caracteres.' }),
  body: z.string(),
  channel: z.enum(CHANNELS),
  format: z.enum(FORMATS),
  status: z.enum(STATUSES),
  scheduledAt: instantSchema.nullable(),
  publishedAt: instantSchema.nullable(),
  publishedUrl: nullableUrlSchema,
  notes: z.string(),
  assetLinks: z.array(httpUrlSchema),
  assigneeId: userIdSchema.nullable(),
})

export const contentItemIdSchema = z.object({ id: z.uuid() })
export type ContentItemIdInput = z.input<typeof contentItemIdSchema>

/** Input for creating an item. Only title, channel and format are required. */
export const createContentItemSchema = z
  .object({
    title: contentFieldsSchema.shape.title,
    body: contentFieldsSchema.shape.body.default(''),
    channel: contentFieldsSchema.shape.channel,
    format: contentFieldsSchema.shape.format,
    status: contentFieldsSchema.shape.status.default('idea'),
    scheduledAt: contentFieldsSchema.shape.scheduledAt.default(null),
    publishedAt: contentFieldsSchema.shape.publishedAt.default(null),
    publishedUrl: contentFieldsSchema.shape.publishedUrl.default(null),
    notes: contentFieldsSchema.shape.notes.default(''),
    assetLinks: contentFieldsSchema.shape.assetLinks.default([]),
    assigneeId: contentFieldsSchema.shape.assigneeId.default(null),
  })
  .superRefine((item, ctx) => {
    if (item.status === 'scheduled' && item.scheduledAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledAt'],
        message: SCHEDULED_REQUIRES_DATE_MESSAGE,
      })
    }
  })
export type CreateContentItemInput = z.input<typeof createContentItemSchema>
export type CreateContentItemData = z.output<typeof createContentItemSchema>

/**
 * Partial update: send only the fields that change. The scheduling rules are
 * checked on the server against the merged result.
 */
export const updateContentItemSchema = contentFieldsSchema
  .partial()
  .extend(contentItemIdSchema.shape)
export type UpdateContentItemInput = z.input<typeof updateContentItemSchema>
export type UpdateContentItemData = z.output<typeof updateContentItemSchema>

/** Sets or clears `scheduledAt` only. Used by calendar drag-and-drop. */
export const rescheduleContentItemSchema = contentItemIdSchema.extend({
  scheduledAt: instantSchema.nullable(),
})
export type RescheduleContentItemInput = z.input<
  typeof rescheduleContentItemSchema
>

/** Changes `status` only. */
export const changeContentItemStatusSchema = contentItemIdSchema.extend({
  status: z.enum(STATUSES),
})
export type ChangeContentItemStatusInput = z.input<
  typeof changeContentItemStatusSchema
>

/**
 * Filters for listing items. All are optional and combined with AND.
 * `scheduledFrom`/`scheduledTo` form a half-open range
 * (`scheduledFrom <= scheduledAt < scheduledTo`); when either is set, items
 * without a `scheduledAt` are excluded.
 */
export const contentListFiltersSchema = z
  .object({
    scheduledFrom: instantSchema.optional(),
    scheduledTo: instantSchema.optional(),
    channels: z.array(z.enum(CHANNELS)).optional(),
    statuses: z.array(z.enum(STATUSES)).optional(),
    assigneeId: userIdSchema.optional(),
  })
  .refine(
    (filters) =>
      !filters.scheduledFrom ||
      !filters.scheduledTo ||
      filters.scheduledFrom < filters.scheduledTo,
    {
      message: 'scheduledFrom deve ser anterior a scheduledTo.',
      path: ['scheduledTo'],
    },
  )
export type ContentListFilters = z.input<typeof contentListFiltersSchema>
export type ContentListFiltersData = z.output<typeof contentListFiltersSchema>
