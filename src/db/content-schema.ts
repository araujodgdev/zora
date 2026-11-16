import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { CHANNELS, FORMATS, STATUSES } from '../lib/content'
import { user } from './auth-schema'

export const contentChannel = pgEnum('content_channel', CHANNELS)
export const contentFormat = pgEnum('content_format', FORMATS)
export const contentStatus = pgEnum('content_status', STATUSES)

export const contentItem = pgTable(
  'content_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    channel: contentChannel('channel').notNull(),
    format: contentFormat('format').notNull(),
    status: contentStatus('status').notNull().default('idea'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedUrl: text('published_url'),
    notes: text('notes').notNull().default(''),
    assetLinks: jsonb('asset_links')
      .$type<Array<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    assigneeId: text('assignee_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('content_item_scheduled_at_idx').on(table.scheduledAt),
    index('content_item_status_idx').on(table.status),
    index('content_item_assignee_id_idx').on(table.assigneeId),
    // Backstops for the rules in src/lib/content.ts (the server checks first
    // and returns a friendly message).
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
