/**
 * Social publishing orchestration: immediate publishing ("Publicar agora" and
 * MCP), async job polling (Reels, TikTok, LinkedIn video/PDF) and scheduled
 * auto-publishing for the Cloudflare Worker Cron Trigger.
 *
 * Server-only and independent of TanStack Start so it can be tested directly
 * against in-memory D1 with a mock `MediaBucket` and mock `TregClient`.
 */
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { contentItem, member, socialConnection, socialPublishJob, user } from '../db/schema'
import type { ContentItem } from './content'
import { assetObjectKey, listContentAssets } from './content-assets.server'
import type { MediaBucket } from './content-assets.server'
import { getContentItem, updateContentItem } from './content.server'
import { canManageMembers, parseRoles } from './workspace'
import {
  isSocialChannel,
  validateItemForSocialPublish,
} from './social'
import type {
  SocialChannel,
  SocialConnection,
  SocialPublishJob,
  SocialPublishOptions,
  SocialPublishTrigger,
} from './social'
import { getWorkspaceConnection } from './social-connections.server'
import { SOCIAL_PUBLISHERS } from './social-publishers.server'
import type { PublishContext, PublishStepResult, SocialPublisher } from './social-publishers.server'
import { SocialPublishingError, TregApiError, requireTregClient } from './treg.server'
import type { TregClient } from './treg.server'

const MAX_POLL_ATTEMPTS = 40
const MAX_PROCESSING_AGE_MS = 20 * 60 * 1000
const CRON_BATCH_LIMIT = 15

export type SocialPublishDeps = {
  db: Database
  bucket: MediaBucket
  treg: TregClient | null
  rawFetch?: typeof fetch
  publishers?: Record<SocialChannel, SocialPublisher>
}

type JobRow = typeof socialPublishJob.$inferSelect

function toPublishJob(row: JobRow): SocialPublishJob {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contentItemId: row.contentItemId,
    connectionId: row.connectionId,
    channel: row.channel,
    trigger: row.trigger,
    triggeredById: row.triggeredById,
    status: row.status,
    stage: row.stage,
    options: row.options,
    providerState: row.providerState,
    remotePostId: row.remotePostId,
    publishedUrl: row.publishedUrl,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    nextPollAt: row.nextPollAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  }
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'Ocorreu um erro inesperado ao publicar na rede social.'
}

function isUniqueConstraintError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error)
  return /UNIQUE constraint failed/i.test(text)
}

async function readAssetFromBucket(
  bucket: MediaBucket,
  contentItemId: string,
  assetId: string,
): Promise<Uint8Array> {
  const object = await bucket.get(assetObjectKey(contentItemId, assetId))
  if (!object?.body) {
    throw new SocialPublishingError('Um dos arquivos de mídia do item não foi encontrado no armazenamento.')
  }
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

/** Lists publication attempts for an item, newest first. */
export async function listItemPublishJobs(
  db: Database,
  organizationId: string,
  contentItemId: string,
): Promise<Array<SocialPublishJob>> {
  const rows = await db
    .select()
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, organizationId),
        eq(socialPublishJob.contentItemId, contentItemId),
      ),
    )
    .orderBy(desc(socialPublishJob.createdAt), desc(socialPublishJob.id))
    .limit(20)
  return rows.map(toPublishJob)
}

async function markJobResult(
  db: Database,
  job: JobRow,
  result: PublishStepResult,
  now: Date,
): Promise<{ job: SocialPublishJob; item: ContentItem | null }> {
  if (result.status === 'published') {
    const [updatedJob] = await db
      .update(socialPublishJob)
      .set({
        status: 'published',
        stage: 'Publicado',
        providerState: result.providerState,
        remotePostId: result.remotePostId,
        publishedUrl: result.publishedUrl,
        errorMessage: null,
        nextPollAt: null,
        updatedAt: now,
        finishedAt: now,
      })
      .where(eq(socialPublishJob.id, job.id))
      .returning()

    const updatedItem = await updateContentItem(
      db,
      job.organizationId,
      {
        id: job.contentItemId,
        status: 'published',
        publishedAt: now,
        ...(result.publishedUrl ? { publishedUrl: result.publishedUrl } : {}),
      },
      now,
    )

    return { job: toPublishJob(updatedJob!), item: updatedItem }
  }

  const [processingJob] = await db
    .update(socialPublishJob)
    .set({
      status: 'processing',
      stage: result.stage,
      providerState: result.providerState,
      nextPollAt: new Date(now.getTime() + result.nextPollDelayMs),
      updatedAt: now,
    })
    .where(eq(socialPublishJob.id, job.id))
    .returning()

  return { job: toPublishJob(processingJob!), item: null }
}

async function markJobFailed(
  db: Database,
  jobId: string,
  message: string,
  now: Date,
): Promise<SocialPublishJob> {
  const [failed] = await db
    .update(socialPublishJob)
    .set({
      status: 'failed',
      stage: 'Falhou',
      errorMessage: message,
      nextPollAt: null,
      updatedAt: now,
      finishedAt: now,
    })
    .where(eq(socialPublishJob.id, jobId))
    .returning()
  return toPublishJob(failed!)
}

async function executeJobStart(
  deps: SocialPublishDeps,
  job: JobRow,
  item: ContentItem,
  connection: SocialConnection,
  now: Date,
): Promise<{ job: SocialPublishJob; item: ContentItem | null }> {
  const treg = requireTregClient(deps.treg)
  const assets = await listContentAssets(deps.db, job.organizationId, item.id)
  const publisher = (deps.publishers ?? SOCIAL_PUBLISHERS)[job.channel]

  const ctx: PublishContext = {
    organizationId: job.organizationId,
    jobId: job.id,
    item,
    assets,
    connection,
    options: job.options,
    readAssetBytes: (asset) => readAssetFromBucket(deps.bucket, item.id, asset.id),
    treg,
    rawFetch: deps.rawFetch ?? globalThis.fetch,
    now,
  }

  try {
    const result = await publisher.start(ctx)
    return await markJobResult(deps.db, job, result, now)
  } catch (error) {
    const failed = await markJobFailed(deps.db, job.id, readableError(error), now)
    return { job: failed, item: null }
  }
}

export type PublishNowResult = {
  job: SocialPublishJob
  item: ContentItem | null
}

/**
 * Publishes an existing content item immediately (manual UI button or MCP).
 * Returns `null` when the item does not exist in the workspace. Throws
 * `SocialPublishingError` for pre-flight errors (not configured, no connected
 * account, invalid media/body, or already publishing). Upstream failures are
 * persisted on the returned job (`status: 'failed'`).
 */
export async function publishContentItemNow(
  deps: SocialPublishDeps,
  input: {
    organizationId: string
    itemId: string
    userId: string
    trigger: Extract<SocialPublishTrigger, 'manual' | 'mcp'>
    options?: SocialPublishOptions
  },
  now: Date = new Date(),
): Promise<PublishNowResult | null> {
  requireTregClient(deps.treg)

  const item = await getContentItem(deps.db, input.organizationId, input.itemId)
  if (!item) return null

  if (!isSocialChannel(item.channel)) {
    throw new SocialPublishingError('O canal Blog não suporta publicação direta em redes sociais.')
  }

  const connection = await getWorkspaceConnection(deps.db, input.organizationId, item.channel)
  if (!connection || connection.status !== 'connected') {
    throw new SocialPublishingError(
      'Nenhuma conta conectada para este canal neste workspace. Conecte uma conta em Conexões primeiro.',
    )
  }

  const [inFlight] = await deps.db
    .select({ id: socialPublishJob.id })
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, input.organizationId),
        eq(socialPublishJob.contentItemId, item.id),
        inArray(socialPublishJob.status, ['pending', 'processing']),
      ),
    )
    .limit(1)
  if (inFlight) {
    throw new SocialPublishingError(
      'Este item já possui uma publicação em andamento. Aguarde a conclusão.',
    )
  }

  const assets = await listContentAssets(deps.db, input.organizationId, item.id)
  const preflight = validateItemForSocialPublish(item, assets)
  if (preflight.errors.length > 0) {
    throw new SocialPublishingError(preflight.errors[0]!)
  }

  const [job] = await deps.db
    .insert(socialPublishJob)
    .values({
      organizationId: input.organizationId,
      contentItemId: item.id,
      connectionId: connection.id,
      channel: item.channel,
      trigger: input.trigger,
      triggeredById: input.userId,
      scheduleKey: null,
      status: 'pending',
      stage: 'Iniciando publicação…',
      options: input.options ?? {},
      providerState: {},
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return executeJobStart(deps, job!, item, connection, now)
}

/**
 * Advances one `processing` publish job by polling the upstream network.
 * Returns `null` when the job does not belong to the workspace.
 */
export async function pollPublishJob(
  deps: SocialPublishDeps,
  organizationId: string,
  jobId: string,
  now: Date = new Date(),
): Promise<PublishNowResult | null> {
  const [job] = await deps.db
    .select()
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, organizationId),
        eq(socialPublishJob.id, jobId),
      ),
    )
    .limit(1)
  if (!job) return null
  if (job.status !== 'processing') {
    return { job: toPublishJob(job), item: null }
  }
  return advanceProcessingJob(deps, job, now)
}

async function advanceProcessingJob(
  deps: SocialPublishDeps,
  job: JobRow,
  now: Date,
): Promise<PublishNowResult> {
  const treg = requireTregClient(deps.treg)
  const ageMs = now.getTime() - job.createdAt.getTime()
  if (job.attempts >= MAX_POLL_ATTEMPTS || ageMs > MAX_PROCESSING_AGE_MS) {
    const failed = await markJobFailed(
      deps.db,
      job.id,
      'Tempo limite excedido aguardando o processamento na rede social. Confira na rede antes de tentar novamente.',
      now,
    )
    return { job: failed, item: null }
  }

  const publisher = (deps.publishers ?? SOCIAL_PUBLISHERS)[job.channel]
  if (!publisher.poll) {
    const failed = await markJobFailed(
      deps.db,
      job.id,
      'Este canal não possui etapa de acompanhamento assíncrono.',
      now,
    )
    return { job: failed, item: null }
  }

  const item = await getContentItem(deps.db, job.organizationId, job.contentItemId)
  if (!item) {
    const failed = await markJobFailed(deps.db, job.id, 'O item de conteúdo foi excluído.', now)
    return { job: failed, item: null }
  }

  const connection = await getWorkspaceConnection(deps.db, job.organizationId, job.channel)
  if (!connection || connection.status !== 'connected') {
    const failed = await markJobFailed(
      deps.db,
      job.id,
      'A conta da rede social foi desconectada durante o processamento.',
      now,
    )
    return { job: failed, item: null }
  }

  // Increment attempt count optimistically (guard on updatedAt so two polls never race).
  const nextUpdatedAt = new Date(Math.max(now.getTime(), job.updatedAt.getTime() + 1))
  const [claimed] = await deps.db
    .update(socialPublishJob)
    .set({ attempts: job.attempts + 1, updatedAt: nextUpdatedAt })
    .where(and(eq(socialPublishJob.id, job.id), eq(socialPublishJob.updatedAt, job.updatedAt)))
    .returning()
  if (!claimed) {
    return { job: toPublishJob(job), item: null }
  }

  const assets = await listContentAssets(deps.db, job.organizationId, item.id)
  const ctx: PublishContext = {
    organizationId: job.organizationId,
    jobId: job.id,
    item,
    assets,
    connection,
    options: job.options,
    readAssetBytes: (asset) => readAssetFromBucket(deps.bucket, item.id, asset.id),
    treg,
    rawFetch: deps.rawFetch ?? globalThis.fetch,
    now,
  }

  try {
    const result = await publisher.poll(ctx, claimed.providerState)
    return await markJobResult(deps.db, claimed, result, now)
  } catch (error) {
    const failed = await markJobFailed(deps.db, claimed.id, readableError(error), now)
    return { job: failed, item: null }
  }
}

export type ScheduledPublishFailure = {
  jobId: string
  organizationId: string
  contentItemId: string
  itemTitle: string
  assigneeId: string | null
  channel: SocialChannel
  stage: 'preflight' | 'dispatch' | 'poll'
  errorMessage: string
}

/**
 * Resolves who should be emailed when a scheduled publication fails:
 * the item's assignee (if still in the workspace), otherwise the workspace
 * owner(s) (or admins if none), merged and deduplicated with any extra ops
 * recipients (`OPS_ALERT_EMAIL`).
 */
export async function resolvePublishFailureRecipients(
  db: Database,
  organizationId: string,
  assigneeId: string | null,
  extraRecipients: ReadonlyArray<string> = [],
): Promise<Array<string>> {
  const members = await db
    .select({
      userId: member.userId,
      role: member.role,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))

  const chosen: Array<string> = []
  const assignee = assigneeId ? members.find((m) => m.userId === assigneeId) : undefined
  if (assignee?.email) {
    chosen.push(assignee.email)
  } else {
    const owners = members.filter((m) => parseRoles(m.role).includes('owner'))
    const fallback = owners.length > 0 ? owners : members.filter((m) => canManageMembers(m.role))
    for (const m of fallback) {
      if (m.email) chosen.push(m.email)
    }
  }

  const seen = new Set<string>()
  const result: Array<string> = []
  for (const raw of [...chosen, ...extraRecipients]) {
    const email = raw.trim()
    if (!email) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(email)
  }
  return result
}

export type ScheduledRunSummary = {
  polled: number
  dispatched: number
  published: number
  processing: number
  failed: number
  failures: Array<ScheduledPublishFailure>
}

/**
 * Cron Trigger entrypoint (`* * * * *`):
 * 1. Polls due in-flight `processing` jobs (video/carousel transcoding).
 * 2. Finds due `scheduled` items whose workspace has a connected account for
 *    their channel, claims each with a unique `scheduleKey`, and publishes.
 *
 * Items whose channel has no connected account are skipped silently so manual
 * editorial scheduling continues to work as before.
 */
export async function runScheduledPublishes(
  deps: SocialPublishDeps,
  now: Date = new Date(),
): Promise<ScheduledRunSummary> {
  const summary: ScheduledRunSummary = {
    polled: 0,
    dispatched: 0,
    published: 0,
    processing: 0,
    failed: 0,
    failures: [],
  }
  if (!deps.treg) return summary

  // 1. Advance in-flight async jobs whose poll time has arrived.
  const duePolls = await deps.db
    .select()
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.status, 'processing'),
        or(isNull(socialPublishJob.nextPollAt), lte(socialPublishJob.nextPollAt, now)),
      ),
    )
    .limit(CRON_BATCH_LIMIT)

  for (const job of duePolls) {
    summary.polled += 1
    const outcome = await advanceProcessingJob(deps, job, now)
    if (outcome.job.status === 'published') summary.published += 1
    else if (outcome.job.status === 'processing') summary.processing += 1
    else if (outcome.job.status === 'failed') {
      summary.failed += 1
      const failedItem = await getContentItem(deps.db, job.organizationId, job.contentItemId)
      summary.failures.push({
        jobId: outcome.job.id,
        organizationId: job.organizationId,
        contentItemId: job.contentItemId,
        itemTitle: failedItem?.title ?? 'Item de conteúdo',
        assigneeId: failedItem?.assigneeId ?? null,
        channel: job.channel,
        stage: 'poll',
        errorMessage: outcome.job.errorMessage ?? 'Falha ao processar publicação na rede social.',
      })
    }
  }

  // 2. Dispatch scheduled items due at or before `now` with a connected account.
  const dueItems = await deps.db
    .select({
      item: contentItem,
      connection: socialConnection,
    })
    .from(contentItem)
    .innerJoin(
      socialConnection,
      and(
        eq(socialConnection.organizationId, contentItem.organizationId),
        eq(socialConnection.channel, contentItem.channel),
        eq(socialConnection.status, 'connected'),
      ),
    )
    .where(and(eq(contentItem.status, 'scheduled'), lte(contentItem.scheduledAt, now)))
    .limit(CRON_BATCH_LIMIT)

  for (const row of dueItems) {
    const item = row.item
    if (!item.scheduledAt || !isSocialChannel(item.channel)) continue

    // Unique claim key prevents two overlapping Cron ticks from double-posting,
    // while rescheduling an item to a new timestamp produces a new key.
    const scheduleKey = `${item.id}:${item.scheduledAt.getTime()}`

    // Skip if any job for this item is currently running.
    const [active] = await deps.db
      .select({ id: socialPublishJob.id })
      .from(socialPublishJob)
      .where(
        and(
          eq(socialPublishJob.contentItemId, item.id),
          inArray(socialPublishJob.status, ['pending', 'processing']),
        ),
      )
      .limit(1)
    if (active) continue

    let claimed: JobRow | undefined
    try {
      const [inserted] = await deps.db
        .insert(socialPublishJob)
        .values({
          organizationId: item.organizationId,
          contentItemId: item.id,
          connectionId: row.connection.id,
          channel: item.channel,
          trigger: 'scheduled',
          triggeredById: null,
          scheduleKey,
          status: 'pending',
          stage: 'Publicando agendamento…',
          options: {},
          providerState: {},
          attempts: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      claimed = inserted
    } catch (error) {
      if (isUniqueConstraintError(error)) continue
      throw error
    }
    if (!claimed) continue

    summary.dispatched += 1
    const assets = await listContentAssets(deps.db, item.organizationId, item.id)
    const preflight = validateItemForSocialPublish(item, assets)
    if (preflight.errors.length > 0) {
      const errorMessage = preflight.errors[0]!
      await markJobFailed(deps.db, claimed.id, errorMessage, now)
      summary.failed += 1
      summary.failures.push({
        jobId: claimed.id,
        organizationId: item.organizationId,
        contentItemId: item.id,
        itemTitle: item.title,
        assigneeId: item.assigneeId,
        channel: item.channel,
        stage: 'preflight',
        errorMessage,
      })
      continue
    }

    const connection: SocialConnection = {
      id: row.connection.id,
      organizationId: row.connection.organizationId,
      channel: row.connection.channel,
      provider: row.connection.provider,
      externalSecretId: row.connection.externalSecretId,
      externalToolName: row.connection.externalToolName,
      status: row.connection.status,
      accountId: row.connection.accountId,
      accountName: row.connection.accountName,
      accountMeta: row.connection.accountMeta,
      connectedById: row.connection.connectedById,
      createdAt: row.connection.createdAt,
      updatedAt: row.connection.updatedAt,
    }

    const outcome = await executeJobStart(deps, claimed, item, connection, now)
    if (outcome.job.status === 'published') summary.published += 1
    else if (outcome.job.status === 'processing') summary.processing += 1
    else if (outcome.job.status === 'failed') {
      summary.failed += 1
      summary.failures.push({
        jobId: outcome.job.id,
        organizationId: item.organizationId,
        contentItemId: item.id,
        itemTitle: item.title,
        assigneeId: item.assigneeId,
        channel: item.channel,
        stage: 'dispatch',
        errorMessage: outcome.job.errorMessage ?? 'Falha ao publicar na rede social.',
      })
    }
  }

  return summary
}

export type DeleteRemotePostResult = {
  deleted: boolean
  alreadyDeleted: boolean
  deletedIds: Array<string>
}

/**
 * Deletes a published post on the upstream social network (currently X via
 * `DELETE /2/tweets/:id`, supporting both single tweets and threads).
 * Treats upstream 404 as already deleted and records `remoteDeletedAt` on
 * the publish job so metrics polling never hits it again.
 */
export async function deleteRemoteSocialPost(
  deps: { db: Database; treg: TregClient | null },
  input: { organizationId: string; itemId: string },
  now: Date = new Date(),
): Promise<DeleteRemotePostResult> {
  const [job] = await deps.db
    .select()
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, input.organizationId),
        eq(socialPublishJob.contentItemId, input.itemId),
        eq(socialPublishJob.status, 'published'),
      ),
    )
    .orderBy(desc(socialPublishJob.finishedAt), desc(socialPublishJob.createdAt))
    .limit(1)

  if (!job?.remotePostId) {
    return { deleted: false, alreadyDeleted: false, deletedIds: [] }
  }
  if (job.providerState.remoteDeletedAt) {
    return { deleted: false, alreadyDeleted: true, deletedIds: [] }
  }
  if (job.channel !== 'x') {
    throw new SocialPublishingError(
      'Esta rede social não permite apagar publicações automaticamente pelo Zora.',
    )
  }

  const treg = requireTregClient(deps.treg)
  const connection = await getWorkspaceConnection(deps.db, input.organizationId, job.channel)
  if (!connection || connection.status !== 'connected') {
    throw new SocialPublishingError(
      'Conecte sua conta do X em Conexões para apagar a publicação na rede.',
    )
  }

  const tweetIds =
    job.providerState.remoteTweetIds && job.providerState.remoteTweetIds.length > 0
      ? [...job.providerState.remoteTweetIds].reverse()
      : [job.remotePostId]

  const deletedIds: Array<string> = []
  let alreadyDeleted = true

  for (const tweetId of tweetIds) {
    try {
      await treg.callTool({
        organizationId: input.organizationId,
        toolName: connection.externalToolName,
        path: `/2/tweets/${encodeURIComponent(tweetId)}`,
        method: 'DELETE',
      })
      deletedIds.push(tweetId)
      alreadyDeleted = false
    } catch (error) {
      if (error instanceof TregApiError && error.status === 404) {
        continue
      }
      throw error
    }
  }

  await deps.db
    .update(socialPublishJob)
    .set({
      providerState: {
        ...job.providerState,
        remoteDeletedAt: now.toISOString(),
      },
      updatedAt: now,
    })
    .where(eq(socialPublishJob.id, job.id))

  return {
    deleted: deletedIds.length > 0,
    alreadyDeleted: deletedIds.length === 0 && alreadyDeleted,
    deletedIds,
  }
}
