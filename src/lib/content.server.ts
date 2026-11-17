/**
 * Content data access. Server-only, and independent of TanStack Start so it can
 * be tested directly against D1. The server functions in
 * `content.functions.ts` are thin wrappers that add the session check.
 *
 * Every function takes the workspace (`organizationId`) the caller acts in
 * and only sees and changes that workspace's items.
 *
 * Inputs are expected to be already parsed by the schemas in `./content`.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentItem, member, user } from '../db/schema'
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

async function assertAssigneeIsMember(
  db: Pick<Database, 'select'>,
  organizationId: string,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return
  const [found] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, assigneeId)))
    .limit(1)
  if (!found) throw new ContentRuleError('O responsável não faz parte da equipe.')
}

function inWorkspace(organizationId: string, id: string) {
  return and(eq(contentItem.organizationId, organizationId), eq(contentItem.id, id))
}

/**
 * Lists items matching all given filters. Ordered by `scheduledAt` (unscheduled
 * last), then newest first.
 */
export async function listContentItems(
  db: Database,
  organizationId: string,
  filters: ContentListFiltersData = {},
): Promise<Array<ContentItem>> {
  const conditions: Array<SQL> = [eq(contentItem.organizationId, organizationId)]
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
  organizationId: string,
  id: string,
): Promise<ContentItem | null> {
  const [item] = await db
    .select()
    .from(contentItem)
    .where(inWorkspace(organizationId, id))
    .limit(1)
  return item ?? null
}

export async function createContentItem(
  db: Database,
  organizationId: string,
  createdById: string,
  input: CreateContentItemData,
  now: Date = new Date(),
): Promise<ContentItem> {
  const values = assertScheduleState(input, now)
  await assertAssigneeIsMember(db, organizationId, values.assigneeId)
  const [item] = await db
    .insert(contentItem)
    .values({ ...values, organizationId, createdById })
    .returning()
  return item!
}

/** How often a change is retried when someone else edits the item meanwhile. */
const MAX_PATCH_ATTEMPTS = 3

/**
 * Applies a change to one item after checking the scheduling rules against
 * the merged result. Returns `null` when the item does not exist.
 *
 * D1 has no interactive transactions, so this is optimistic: the UPDATE only
 * applies while `updatedAt` still has the value that was read. If someone else
 * saved in between, it starts over from a fresh read, so the rules are always
 * checked against the state that gets overwritten.
 */
async function patchContentItem(
  db: Database,
  organizationId: string,
  id: string,
  patch: Partial<CreateContentItemData>,
  now: Date,
): Promise<ContentItem | null> {
  for (let attempt = 0; attempt < MAX_PATCH_ATTEMPTS; attempt += 1) {
    const [current] = await db
      .select()
      .from(contentItem)
      .where(inWorkspace(organizationId, id))
    if (!current) return null

    const merged = assertScheduleState({ ...current, ...patch }, now)
    if (patch.assigneeId !== undefined) {
      await assertAssigneeIsMember(db, organizationId, patch.assigneeId)
    }

    // Strictly after the value read, so every write changes `updatedAt` and a
    // concurrent writer can never match it by landing in the same millisecond.
    const updatedAt = new Date(
      Math.max(now.getTime(), current.updatedAt.getTime() + 1),
    )
    const [updated] = await db
      .update(contentItem)
      .set({
        ...patch,
        // normalizeScheduleState may fill publishedAt.
        publishedAt: merged.publishedAt,
        updatedAt,
      })
      .where(
        and(inWorkspace(organizationId, id), eq(contentItem.updatedAt, current.updatedAt)),
      )
      .returning()
    if (updated) return updated
  }
  throw new ContentRuleError(
    'Outra pessoa alterou este item ao mesmo tempo. Recarregue e tente de novo.',
  )
}

/** Partial update. Fields left `undefined` are not changed. */
export async function updateContentItem(
  db: Database,
  organizationId: string,
  input: UpdateContentItemData,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  const { id, ...fields } = input
  const patch = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<CreateContentItemData>
  return patchContentItem(db, organizationId, id, patch, now)
}

/** Sets or clears `scheduledAt` only. */
export async function rescheduleContentItem(
  db: Database,
  organizationId: string,
  id: string,
  scheduledAt: Date | null,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  return patchContentItem(db, organizationId, id, { scheduledAt }, now)
}

/** Changes `status` only (publishing fills `publishedAt` when missing). */
export async function changeContentItemStatus(
  db: Database,
  organizationId: string,
  id: string,
  status: ContentStatus,
  now: Date = new Date(),
): Promise<ContentItem | null> {
  return patchContentItem(db, organizationId, id, { status }, now)
}

/** Returns `false` when the item did not exist. */
export async function deleteContentItem(
  db: Database,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(contentItem)
    .where(inWorkspace(organizationId, id))
    .returning({ id: contentItem.id })
  return deleted.length > 0
}

/** The members of a workspace (the people an item can be assigned to). */
export async function listTeamMembers(
  db: Database,
  organizationId: string,
): Promise<Array<TeamMember>> {
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(user.name), asc(user.email))
}
