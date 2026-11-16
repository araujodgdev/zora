import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { CHANNELS, FORMATS, STATUSES } from '../lib/content'
import { user } from './auth-schema'

// SQLite has no enums: the columns are text, typed by `enum` in TypeScript and
// guarded by a CHECK constraint built from the same lists. DDL cannot take bound
// parameters, so the values are written as literals; they are our own constants.
function oneOf(column: SQLiteColumn, values: ReadonlyArray<string>) {
  const literals = values.map((value) => `'${value}'`).join(', ')
  return sql`${column} IN (${sql.raw(literals)})`
}

/** A UTC instant in milliseconds, as a `Date`; defaults to the insert time. */
const instant = (name: string) => integer(name, { mode: 'timestamp_ms' })
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

export const contentItem = sqliteTable(
  'content_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    channel: text('channel', { enum: CHANNELS }).notNull(),
    format: text('format', { enum: FORMATS }).notNull(),
    status: text('status', { enum: STATUSES }).notNull().default('idea'),
    scheduledAt: instant('scheduled_at'),
    publishedAt: instant('published_at'),
    publishedUrl: text('published_url'),
    notes: text('notes').notNull().default(''),
    assetLinks: text('asset_links', { mode: 'json' })
      .$type<Array<string>>()
      .notNull()
      .default([]),
    assigneeId: text('assignee_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').notNull().default(now),
    updatedAt: instant('updated_at')
      .notNull()
      .default(now)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('content_item_scheduled_at_idx').on(table.scheduledAt),
    index('content_item_status_idx').on(table.status),
    index('content_item_assignee_id_idx').on(table.assigneeId),
    // Backstops for the rules in src/lib/content.ts (the server checks first
    // and returns a friendly message).
    check('content_item_channel_valid', oneOf(table.channel, CHANNELS)),
    check('content_item_format_valid', oneOf(table.format, FORMATS)),
    check('content_item_status_valid', oneOf(table.status, STATUSES)),
    check(
      'content_item_scheduled_has_date',
      sql`${table.status} <> 'scheduled' OR ${table.scheduledAt} IS NOT NULL`,
    ),
    check(
      'content_item_published_has_date',
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
  ],
)

/**
 * A file uploaded to a content item. The bytes are in the R2 bucket under
 * `content/<contentItemId>/<id>` (see `src/lib/content-assets.server.ts`).
 */
export const contentAsset = sqliteTable(
  'content_asset',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentItemId: text('content_item_id')
      .notNull()
      .references(() => contentItem.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').notNull().default(now),
  },
  (table) => [index('content_asset_content_item_id_idx').on(table.contentItemId)],
)
