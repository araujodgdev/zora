import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { CHANNELS, FORMATS, STATUSES } from '../lib/content'
import type { AssetAttribution } from '../lib/content-assets'
import { DESIGN_AUTHOR_KINDS } from '../lib/content-designs'
import {
  SOCIAL_CHANNELS,
  SOCIAL_CONNECTION_STATUSES,
  SOCIAL_PROVIDERS,
  SOCIAL_PUBLISH_STATUSES,
  SOCIAL_PUBLISH_TRIGGERS,
} from '../lib/social'
import type {
  SocialConnectionMeta,
  SocialPublishOptions,
  SocialPublishProviderState,
} from '../lib/social'
import { organization, user } from './auth-schema'

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
    // The workspace (Better Auth organization) the item belongs to. Every
    // query in content.server.ts is scoped by it. Workspace deletion is
    // disabled, so `restrict` never blocks a normal flow.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
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
    index('content_item_organization_id_idx').on(table.organizationId),
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
    // Credit and origin of a file Zora fetched from a provider (a stock photo,
    // a generated image); null for files people uploaded.
    attribution: text('attribution', { mode: 'json' }).$type<AssetAttribution>(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').notNull().default(now),
  },
  (table) => [index('content_asset_content_item_id_idx').on(table.contentItemId)],
)

/**
 * An editable design (a Zora Studio document) of a content item. Each save
 * is an immutable row in `content_design_version`; `currentVersionId` names
 * the latest one (null until the first save). Every write moves `updatedAt`
 * strictly forward, which is what concurrent saves are checked against (see
 * `src/lib/content-designs.server.ts`).
 */
export const contentDesign = sqliteTable(
  'content_design',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentItemId: text('content_item_id')
      .notNull()
      .references(() => contentItem.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    widthPx: integer('width_px').notNull(),
    heightPx: integer('height_px').notNull(),
    preset: text('preset'),
    // No foreign key: the version row references the design, and the two are
    // written together in one batch (a cycle of foreign keys would not help).
    currentVersionId: text('current_version_id'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').notNull().default(now),
    updatedAt: instant('updated_at').notNull().default(now),
  },
  (table) => [
    index('content_design_content_item_id_idx').on(table.contentItemId),
    check(
      'content_design_size_valid',
      sql`${table.widthPx} BETWEEN 1 AND 16384 AND ${table.heightPx} BETWEEN 1 AND 16384`,
    ),
    check('content_design_name_valid', sql`length(${table.name}) BETWEEN 1 AND 200`),
  ],
)

/**
 * One saved state of a design. The bytes are in the R2 bucket under
 * `designs/<designId>/<id>/source.vectorcraft` and `.../preview.png`.
 */
export const contentDesignVersion = sqliteTable(
  'content_design_version',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    designId: text('design_id')
      .notNull()
      .references(() => contentDesign.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    authorKind: text('author_kind', { enum: DESIGN_AUTHOR_KINDS }).notNull(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    sourceSize: integer('source_size').notNull(),
    previewSize: integer('preview_size').notNull(),
    createdAt: instant('created_at').notNull().default(now),
  },
  (table) => [
    uniqueIndex('content_design_version_design_number_idx').on(
      table.designId,
      table.number,
    ),
    check(
      'content_design_version_author_kind_valid',
      oneOf(table.authorKind, DESIGN_AUTHOR_KINDS),
    ),
    check('content_design_version_number_valid', sql`${table.number} >= 1`),
    check(
      'content_design_version_sizes_valid',
      sql`${table.sourceSize} > 0 AND ${table.previewSize} > 0`,
    ),
  ],
)

/**
 * A workspace's connected social media account (at most one per channel per
 * workspace). Holds only metadata and references to the upstream connection
 * (e.g. treg secret id and tool name) — OAuth tokens never land in Zora's DB.
 */
export const socialConnection = sqliteTable(
  'social_connection',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    channel: text('channel', { enum: SOCIAL_CHANNELS }).notNull(),
    provider: text('provider', { enum: SOCIAL_PROVIDERS }).notNull().default('treg'),
    externalSecretId: integer('external_secret_id'),
    externalToolName: text('external_tool_name').notNull(),
    status: text('status', { enum: SOCIAL_CONNECTION_STATUSES })
      .notNull()
      .default('pending'),
    pendingState: text('pending_state'),
    accountId: text('account_id'),
    accountName: text('account_name'),
    accountMeta: text('account_meta', { mode: 'json' })
      .$type<SocialConnectionMeta>()
      .notNull()
      .default({}),
    connectedById: text('connected_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').notNull().default(now),
    updatedAt: instant('updated_at').notNull().default(now),
  },
  (table) => [
    uniqueIndex('social_connection_org_channel_idx').on(
      table.organizationId,
      table.channel,
    ),
    index('social_connection_status_idx').on(table.status),
    check('social_connection_channel_valid', oneOf(table.channel, SOCIAL_CHANNELS)),
    check('social_connection_provider_valid', oneOf(table.provider, SOCIAL_PROVIDERS)),
    check(
      'social_connection_status_valid',
      oneOf(table.status, SOCIAL_CONNECTION_STATUSES),
    ),
  ],
)

/**
 * One publication attempt for a content item (manual, scheduled by the Cron
 * Trigger, or triggered via MCP). Long-running video publishes persist their
 * remote handle in `providerState` with `status = 'processing'` and finish on
 * a subsequent poll or Cron tick.
 */
export const socialPublishJob = sqliteTable(
  'social_publish_job',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    contentItemId: text('content_item_id')
      .notNull()
      .references(() => contentItem.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => socialConnection.id, {
      onDelete: 'set null',
    }),
    channel: text('channel', { enum: SOCIAL_CHANNELS }).notNull(),
    trigger: text('trigger', { enum: SOCIAL_PUBLISH_TRIGGERS }).notNull(),
    triggeredById: text('triggered_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Unique claim key for scheduled runs (`<itemId>:<scheduledAtMs>`),
    // preventing two overlapping Cron ticks from double-posting.
    scheduleKey: text('schedule_key'),
    status: text('status', { enum: SOCIAL_PUBLISH_STATUSES })
      .notNull()
      .default('pending'),
    stage: text('stage').notNull().default('preparing'),
    options: text('options', { mode: 'json' })
      .$type<SocialPublishOptions>()
      .notNull()
      .default({}),
    providerState: text('provider_state', { mode: 'json' })
      .$type<SocialPublishProviderState>()
      .notNull()
      .default({}),
    remotePostId: text('remote_post_id'),
    publishedUrl: text('published_url'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    nextPollAt: instant('next_poll_at'),
    createdAt: instant('created_at').notNull().default(now),
    updatedAt: instant('updated_at').notNull().default(now),
    finishedAt: instant('finished_at'),
  },
  (table) => [
    index('social_publish_job_item_idx').on(table.contentItemId),
    index('social_publish_job_org_idx').on(table.organizationId),
    index('social_publish_job_status_poll_idx').on(table.status, table.nextPollAt),
    uniqueIndex('social_publish_job_schedule_key_idx').on(table.scheduleKey),
    check('social_publish_job_channel_valid', oneOf(table.channel, SOCIAL_CHANNELS)),
    check('social_publish_job_trigger_valid', oneOf(table.trigger, SOCIAL_PUBLISH_TRIGGERS)),
    check('social_publish_job_status_valid', oneOf(table.status, SOCIAL_PUBLISH_STATUSES)),
  ],
)

/**
 * Remembers which workspace an authenticated user selected through MCP
 * (`switch_workspace` / `create_workspace`), because MCP requests are
 * stateless and carry a user-scoped OAuth token rather than a browser session.
 */
export const mcpWorkspaceState = sqliteTable(
  'mcp_workspace_state',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    updatedAt: instant('updated_at').notNull().default(now),
  },
  (table) => [index('mcp_workspace_state_org_idx').on(table.organizationId)],
)
