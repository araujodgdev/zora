/**
 * Content data access. Server-only, and independent of TanStack Start so it can
 * be tested directly against Postgres. The server functions in
 * `content.functions.ts` are thin wrappers that add the session check.
 *
 * Inputs are expected to be already parsed by the schemas in `./content`.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentItem, user } from '../db/schema'
import { normalizeScheduleState, scheduleStateError } from './content'
import type {
  ContentItem,
  ContentListFiltersData,
  ContentStatus,
  CreateContentItemData,
  ScheduleState,
  TeamMember,
  UpdateContentItemData,
} from './content'

/** A business rule rejected the change. The message is safe to show users. */
export class ContentRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentRuleError'
  }
}

function assertScheduleState<T extends ScheduleState>(item: T, now: Date): T {
  const normalized = normalizeScheduleState(item, now)
  const error = scheduleStateError(normalized)
  if (error) throw new ContentRuleError(error)
  return normalized
}

async function assertAssigneeExists(
  db: Pick<Database, 'select'>,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return
  const [found] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, assigneeId))
    .limit(1)
  if (!found) throw new ContentRuleError('The assignee is not a team member.')
}

/**
 * Lists items matching all given filters. Ordered by `scheduledAt` (unscheduled
 * last), then newest first.
 */
export async function listContentItems(
  db: Database,
  filters: ContentListFiltersData = {},
): Promise<Array<ContentItem>> {
  const conditions: Array<SQL> = []
  if (filters.scheduledFrom || filters.scheduledTo) {
    conditions.push(isNotNull(contentItem.scheduledAt))
  }
  if (filters.scheduledFrom) {
    conditions.push(gte(contentItem.scheduledAt, filters.scheduledFrom))
  }
  if (filters.scheduledTo) {
    conditions.push(lt(contentItem.scheduledAt, filters.scheduledTo))
  }
  if (filters.channels) {
    conditions.push(inArray(contentItem.channel, filters.channels))
  }
  if (filters.statuses) {
    conditions.push(inArray(contentItem.status, filters.statuses))
  }
  if (filters.assigneeId) {
    conditions.push(eq(contentItem.assigneeId, filters.assigneeId))
  }

  return db
    .select()
    .from(contentItem)
    .where(and(...conditions))
    .orderBy(
      sql`${contentItem.scheduledAt} asc nulls last`,
      desc(contentItem.createdAt),
      asc(contentItem.id),
    )
}

export async function getContentItem(
  db: Database,
  id: string,
): Promise<ContentItem | null> {
  const [item] = await db
    .select()
    .from(contentItem)
    .where(eq(contentItem.id, id))
    .limit(1)
  return item ?? null
}

export async function createContentItem(
  db: Database,
  createdById: string,
  input: CreateContentItemData,
  now: Date = new Date(),
): Promise<ContentItem> {
  const values = assertScheduleState(input, now)
  await assertAssigneeExists(db, values.assigneeId)
  const [item] = await db
    .insert(contentItem)
    .values({ ...values, createdById })
    .returning()
  return item!
}

/**
 * Applies a change to one item after checking the scheduling rules against
 * the merged result. Returns `null` when the item does not exist.
 */
async function patchContentItem(
  db: Database,
  id: string,
  patch: Partial<CreateContentItemData>,
  now: Date,
): Promise<ContentItem | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(contentItem)
      .where(eq(contentItem.id, id))
      .for('update')
    if (!current) return null

    const merged = assertScheduleState({ ...current, ...patch }, now)
    if (patch.assigneeId !== undefined) {
      await assertAssigneeExists(tx, patch.assigneeId)
    }

    const [updated] = await tx
      .update(contentItem)
      .set({
        ...patch,
        // normalizeScheduleState may fill publishedAt.
        publishedAt: merged.publishedAt,
        updatedAt: now,
      })
      .where(eq(contentItem.id, id))
      .returning()
    return updated ?? null
  })
}

/** Partial update. Fields left `undefined` are not changed. */
export async function updateContentItem(
  db: Database,
  input: UpdateContentItemData,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  const { id, ...fields } = input
  const patch = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<CreateContentItemData>
  return patchContentItem(db, id, patch, now)
}

/** Sets or clears `scheduledAt` only. */
export async function rescheduleContentItem(
  db: Database,
  id: string,
  scheduledAt: Date | null,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  return patchContentItem(db, id, { scheduledAt }, now)
}

/** Changes `status` only (publishing fills `publishedAt` when missing). */
export async function changeContentItemStatus(
  db: Database,
  id: string,
  status: ContentStatus,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  return patchContentItem(db, id, { status }, now)
}

/** Returns `false` when the item did not exist. */
export async function deleteContentItem(
  db: Database,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(contentItem)
    .where(eq(contentItem.id, id))
    .returning({ id: contentItem.id })
  return deleted.length > 0
}

/** Everyone who has signed up; all users share one workspace. */
export async function listTeamMembers(
  db: Database,
): Promise<Array<TeamMember>> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .orderBy(asc(user.name), asc(user.email))
}
