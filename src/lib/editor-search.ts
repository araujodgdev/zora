/**
 * Search params of the content editor routes (`/content/new` and
 * `/content/$itemId`): the contract between the editor and the pages that
 * link to it. Client-safe.
 *
 * Malformed values are dropped instead of raising an error.
 */
import { z } from 'zod'
import { CHANNELS, STATUSES } from './content'

/** Pages that open the editor; the editor returns there after save or cancel. */
export const EDITOR_ORIGINS = ['calendar', 'pipeline', 'content'] as const
export type EditorOrigin = (typeof EDITOR_ORIGINS)[number]

/** Where each origin lives. */
export const EDITOR_ORIGIN_PATHS = {
  calendar: '/calendar',
  pipeline: '/pipeline',
  content: '/content',
} as const satisfies Record<EditorOrigin, string>

/** The page to return to from the editor; the content list when unknown. */
export function editorReturnPath(from: EditorOrigin | undefined) {
  return EDITOR_ORIGIN_PATHS[from ?? 'content']
}

const fromSchema = z.enum(EDITOR_ORIGINS).optional().catch(undefined)

/** Search of `/content/$itemId`. */
export const editItemSearchSchema = z.object({
  from: fromSchema,
})
export type EditItemSearch = z.output<typeof editItemSearchSchema>

/**
 * Search of `/content/new`: optional presets for the new item.
 * `scheduledAt` is an ISO 8601 instant with an offset, kept as a string in the
 * URL (e.g. `date.toISOString()`); read it with `new Date(search.scheduledAt)`.
 */
export const newItemSearchSchema = z.object({
  from: fromSchema,
  scheduledAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  channel: z.enum(CHANNELS).optional().catch(undefined),
})
export type NewItemSearch = z.output<typeof newItemSearchSchema>
