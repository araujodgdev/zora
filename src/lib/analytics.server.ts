/**
 * Workspace and item analytics aggregation over D1.
 * Combines editorial/operational data (`content_item`, `social_publish_job`,
 * `content_design_version`, `content_photo_edit_version`) with collected
 * social engagement snapshots (`social_metric_snapshot`) and synthesizes
 * human-friendly pt-BR insights.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import {
  contentDesign,
  contentDesignVersion,
  contentItem,
  contentPhotoEdit,
  contentPhotoEditVersion,
  member,
  socialConnection,
  socialMetricSnapshot,
  socialPublishJob,
  user,
} from '../db/schema'
import {
  ANALYTICS_PERIOD_DAYS,
  bpsToPercent,
  formatCompactNumber,
  formatPercent,
  sumInteractions,
} from './analytics'
import {
  CHANNEL_METRIC_GUIDES,
  aggregateChannelSignals,
  computeChannelSignalsFromTotals,
  diagnosePost,
} from './analytics-signals'
import type {
  AnalyticsFilters,
  AnalyticsInsight,
  CadenceBucket,
  ChannelMetric,
  ChannelSpotlight,
  FormatMetric,
  ItemAnalytics,
  PipelineStageMetric,
  RecentPublishFailure,
  SocialMetricSnapshot,
  TeamMemberMetric,
  TopContentEntry,
  WeekdayRhythm,
  WorkspaceAnalytics,
} from './analytics'
import { CHANNELS, CHANNEL_LABELS, FORMATS, FORMAT_LABELS, STATUSES } from './content'
import type { Channel } from './content'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const STALE_ITEM_DAYS = 7

const WEEKDAYS: ReadonlyArray<{ weekday: number; label: string; shortLabel: string }> = [
  { weekday: 1, label: 'Segunda', shortLabel: 'Seg' },
  { weekday: 2, label: 'Terça', shortLabel: 'Ter' },
  { weekday: 3, label: 'Quarta', shortLabel: 'Qua' },
  { weekday: 4, label: 'Quinta', shortLabel: 'Qui' },
  { weekday: 5, label: 'Sexta', shortLabel: 'Sex' },
  { weekday: 6, label: 'Sábado', shortLabel: 'Sáb' },
  { weekday: 0, label: 'Domingo', shortLabel: 'Dom' },
]

const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function isoDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatBucketLabel(date: Date): string {
  return shortDateFormatter.format(date).replace(/\.$/, '')
}

function toSnapshot(row: typeof socialMetricSnapshot.$inferSelect): SocialMetricSnapshot {
  return {
    id: row.id,
    contentItemId: row.contentItemId,
    publishJobId: row.publishJobId,
    channel: row.channel,
    remotePostId: row.remotePostId,
    views: row.views,
    reach: row.reach,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    clicks: row.clicks,
    avgWatchTimeMs: row.avgWatchTimeMs,
    engagementRate: bpsToPercent(row.engagementRateBps),
    collectedAt: row.collectedAt,
  }
}

function avg(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

function leadTimeHoursOf(item: { createdAt: Date; publishedAt: Date | null }): number | null {
  if (!item.publishedAt) return null
  const diff = item.publishedAt.getTime() - item.createdAt.getTime()
  if (diff < 0) return null
  return diff / HOUR_MS
}

// ---------------------------------------------------------------------------
// Workspace analytics
// ---------------------------------------------------------------------------

export async function getWorkspaceAnalytics(
  db: Database,
  organizationId: string,
  filters: AnalyticsFilters,
  now: Date = new Date(),
): Promise<WorkspaceAnalytics> {
  const { period, channel: channelFilter } = filters
  const days = period === 'all' ? null : ANALYTICS_PERIOD_DAYS[period]
  const rangeEnd = now
  const rangeStart = days != null ? new Date(now.getTime() - days * DAY_MS) : null
  const previousStart =
    days != null && rangeStart != null ? new Date(rangeStart.getTime() - days * DAY_MS) : null

  const [
    allItems,
    allJobs,
    allSnapshots,
    allConnections,
    teamRows,
    designRows,
    designVersionRows,
    photoRows,
    photoVersionRows,
  ] = await Promise.all([
    db
      .select()
      .from(contentItem)
      .where(eq(contentItem.organizationId, organizationId)),
    db
      .select()
      .from(socialPublishJob)
      .where(eq(socialPublishJob.organizationId, organizationId))
      .orderBy(desc(socialPublishJob.createdAt)),
    db
      .select()
      .from(socialMetricSnapshot)
      .where(eq(socialMetricSnapshot.organizationId, organizationId))
      .orderBy(desc(socialMetricSnapshot.collectedAt)),
    db
      .select({
        channel: socialConnection.channel,
        status: socialConnection.status,
      })
      .from(socialConnection)
      .where(eq(socialConnection.organizationId, organizationId)),
    db
      .select({
        memberId: user.id,
        name: user.name,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId)),
    db
      .select({
        id: contentDesign.id,
        contentItemId: contentDesign.contentItemId,
        createdById: contentDesign.createdById,
      })
      .from(contentDesign)
      .innerJoin(contentItem, eq(contentItem.id, contentDesign.contentItemId))
      .where(eq(contentItem.organizationId, organizationId)),
    db
      .select({
        authorKind: contentDesignVersion.authorKind,
        createdAt: contentDesignVersion.createdAt,
        contentItemId: contentDesign.contentItemId,
      })
      .from(contentDesignVersion)
      .innerJoin(contentDesign, eq(contentDesign.id, contentDesignVersion.designId))
      .innerJoin(contentItem, eq(contentItem.id, contentDesign.contentItemId))
      .where(eq(contentItem.organizationId, organizationId)),
    db
      .select({
        id: contentPhotoEdit.id,
        contentItemId: contentPhotoEdit.contentItemId,
        createdById: contentPhotoEdit.createdById,
      })
      .from(contentPhotoEdit)
      .innerJoin(contentItem, eq(contentItem.id, contentPhotoEdit.contentItemId))
      .where(eq(contentItem.organizationId, organizationId)),
    db
      .select({
        authorKind: contentPhotoEditVersion.authorKind,
        createdAt: contentPhotoEditVersion.createdAt,
        contentItemId: contentPhotoEdit.contentItemId,
      })
      .from(contentPhotoEditVersion)
      .innerJoin(contentPhotoEdit, eq(contentPhotoEdit.id, contentPhotoEditVersion.editId))
      .innerJoin(contentItem, eq(contentItem.id, contentPhotoEdit.contentItemId))
      .where(eq(contentItem.organizationId, organizationId)),
  ])

  const items = channelFilter
    ? allItems.filter((item) => item.channel === channelFilter)
    : allItems
  const itemIdSet = new Set(items.map((item) => item.id))
  const itemById = new Map(allItems.map((item) => [item.id, item]))

  // Latest snapshot per content item.
  const latestSnapshotByItem = new Map<string, SocialMetricSnapshot>()
  let lastSyncedAt: Date | null = null
  for (const row of allSnapshots) {
    if (!itemIdSet.has(row.contentItemId)) continue
    if (!lastSyncedAt || row.collectedAt.getTime() > lastSyncedAt.getTime()) {
      lastSyncedAt = row.collectedAt
    }
    if (!latestSnapshotByItem.has(row.contentItemId)) {
      latestSnapshotByItem.set(row.contentItemId, toSnapshot(row))
    }
  }

  const inRange = (date: Date | null) => {
    if (!date) return false
    if (!rangeStart) return true
    return date.getTime() >= rangeStart.getTime() && date.getTime() <= rangeEnd.getTime()
  }
  const inPreviousRange = (date: Date | null) => {
    if (!date || !previousStart || !rangeStart) return false
    return date.getTime() >= previousStart.getTime() && date.getTime() < rangeStart.getTime()
  }

  const publishedItems = items.filter(
    (item) => item.status === 'published' && inRange(item.publishedAt),
  )
  const previousPublishedItems =
    previousStart != null
      ? items.filter((item) => item.status === 'published' && inPreviousRange(item.publishedAt))
      : null

  const next7dEnd = now.getTime() + 7 * DAY_MS
  const scheduledUpcoming7d = items.filter(
    (item) =>
      item.status === 'scheduled' &&
      item.scheduledAt != null &&
      item.scheduledAt.getTime() >= now.getTime() &&
      item.scheduledAt.getTime() <= next7dEnd,
  ).length

  const inProgressCount = items.filter(
    (item) => item.status === 'idea' || item.status === 'draft' || item.status === 'ready',
  ).length

  // Identify items imported from external accounts (stage === 'imported') so
  // they do not skew editorial lead time or Zora publish-success metrics.
  const jobsByItem = new Map<string, Array<typeof socialPublishJob.$inferSelect>>()
  for (const job of allJobs) {
    const list = jobsByItem.get(job.contentItemId)
    if (list) list.push(job)
    else jobsByItem.set(job.contentItemId, [job])
  }
  const importedOnlyItemIds = new Set<string>()
  for (const [id, itemJobs] of jobsByItem) {
    if (itemJobs.length > 0 && itemJobs.every((j) => j.stage === 'imported')) {
      importedOnlyItemIds.add(id)
    }
  }

  const currentLeadTimes = publishedItems
    .filter((item) => !importedOnlyItemIds.has(item.id))
    .map(leadTimeHoursOf)
    .filter((v): v is number => v != null)
  const previousLeadTimes = previousPublishedItems
    ? previousPublishedItems
        .filter((item) => !importedOnlyItemIds.has(item.id))
        .map(leadTimeHoursOf)
        .filter((v): v is number => v != null)
    : []

  // Jobs in range (filtered by channel when active, excluding historical imports).
  const jobsInRange = allJobs.filter((job) => {
    if (job.stage === 'imported') return false
    if (channelFilter && job.channel !== channelFilter) return false
    return inRange(job.createdAt)
  })
  const publishSuccessCount = jobsInRange.filter((job) => job.status === 'published').length
  const publishFailedCount = jobsInRange.filter((job) => job.status === 'failed').length
  const finishedJobsTotal = publishSuccessCount + publishFailedCount
  const publishSuccessRate =
    finishedJobsTotal > 0 ? Number(((publishSuccessCount / finishedJobsTotal) * 100).toFixed(1)) : null

  // Social aggregates over published items in the selected period.
  // Never average engagement rates across different networks (e.g. TikTok vs X);
  // only compute an overall rate when all tracked posts share one channel.
  let totalViews = 0
  let totalReach = 0
  let totalInteractions = 0
  let trackedPostsCount = 0
  const engagementRates: Array<number> = []
  const trackedChannels = new Set<Channel>()

  for (const item of publishedItems) {
    const snap = latestSnapshotByItem.get(item.id)
    if (!snap) continue
    trackedPostsCount += 1
    trackedChannels.add(item.channel)
    totalViews += snap.views ?? 0
    totalReach += snap.reach ?? 0
    totalInteractions += sumInteractions(snap)
    if (snap.engagementRate != null) engagementRates.push(snap.engagementRate)
  }

  const singleTrackedChannel =
    channelFilter ?? (trackedChannels.size === 1 ? Array.from(trackedChannels)[0]! : null)
  const avgEngagementRate =
    singleTrackedChannel != null && engagementRates.length > 0
      ? Number((avg(engagementRates) ?? 0).toFixed(2))
      : null

  // Cadence series (daily for 7d/30d, weekly for 90d/all).
  const cadence = buildCadenceSeries(items, latestSnapshotByItem, period, rangeStart, rangeEnd)

  // Pipeline funnel (current workspace state, always reflects live queue).
  const staleCutoff = now.getTime() - STALE_ITEM_DAYS * DAY_MS
  const pipeline: Array<PipelineStageMetric> = STATUSES.map((status) => {
    const matching = items.filter((item) => item.status === status)
    const staleCount =
      status === 'draft' || status === 'ready'
        ? matching.filter((item) => item.updatedAt.getTime() < staleCutoff).length
        : 0
    return { status, count: matching.length, staleCount }
  })

  // Channel breakdown (computed across all channels so the filter bar stays informative).
  const channelSnapshotsMap = new Map<Channel, Array<SocialMetricSnapshot>>()
  const channels: Array<ChannelMetric> = CHANNELS.map((ch) => {
    const chItems = allItems.filter((item) => item.channel === ch)
    const chPublished = chItems.filter((item) => item.status === 'published' && inRange(item.publishedAt))
    const chScheduled = chItems.filter((item) => item.status === 'scheduled').length
    const chInProgress = chItems.filter(
      (item) => item.status === 'idea' || item.status === 'draft' || item.status === 'ready',
    ).length
    const chLeadTimes = chPublished
      .filter((item) => !importedOnlyItemIds.has(item.id))
      .map(leadTimeHoursOf)
      .filter((v): v is number => v != null)
    let views = 0
    let interactions = 0
    let tracked = 0
    const rates: Array<number> = []
    const chSnaps: Array<SocialMetricSnapshot> = []
    for (const item of chPublished) {
      const rawSnap = allSnapshots.find((s) => s.contentItemId === item.id)
      if (!rawSnap) continue
      const snap = toSnapshot(rawSnap)
      chSnaps.push(snap)
      tracked += 1
      views += snap.views ?? 0
      interactions += sumInteractions(snap)
      if (snap.engagementRate != null) rates.push(snap.engagementRate)
    }
    channelSnapshotsMap.set(ch, chSnaps)
    const chSignals = aggregateChannelSignals(ch, chSnaps)
    return {
      channel: ch,
      published: chPublished.length,
      scheduled: chScheduled,
      inProgress: chInProgress,
      views,
      interactions,
      avgEngagementRate: rates.length > 0 ? Number((avg(rates) ?? 0).toFixed(2)) : null,
      avgLeadTimeHours: avg(chLeadTimes),
      trackedPosts: tracked,
      primarySignal: chSignals[0] ?? null,
    }
  }).filter((row) => row.published > 0 || row.scheduled > 0 || row.inProgress > 0)

  const channelAvgRateMap = new Map<Channel, number | null>(
    channels.map((c) => [c.channel, c.avgEngagementRate]),
  )

  // Spotlight for the selected channel (or the sole active tracked channel).
  const spotlightChannel = channelFilter ?? singleTrackedChannel
  const channelSpotlight: ChannelSpotlight | null = spotlightChannel
    ? {
        channel: spotlightChannel,
        guide: CHANNEL_METRIC_GUIDES[spotlightChannel],
        signals: aggregateChannelSignals(
          spotlightChannel,
          channelSnapshotsMap.get(spotlightChannel) ?? [],
        ),
        trackedPosts: (channelSnapshotsMap.get(spotlightChannel) ?? []).length,
      }
    : null

  // Format breakdown.
  const formats: Array<FormatMetric> = FORMATS.map((fmt) => {
    const fmtPublished = publishedItems.filter((item) => item.format === fmt)
    let views = 0
    let interactions = 0
    const rates: Array<number> = []
    for (const item of fmtPublished) {
      const snap = latestSnapshotByItem.get(item.id)
      if (!snap) continue
      views += snap.views ?? 0
      interactions += sumInteractions(snap)
      if (snap.engagementRate != null) rates.push(snap.engagementRate)
    }
    return {
      format: fmt,
      published: fmtPublished.length,
      views,
      interactions,
      avgEngagementRate: rates.length > 0 ? Number((avg(rates) ?? 0).toFixed(2)) : null,
    }
  })
    .filter((row) => row.published > 0)
    .sort((a, b) => b.published - a.published)

  // Weekday rhythm (Monday -> Sunday).
  const weekdayRhythm: Array<WeekdayRhythm> = WEEKDAYS.map((day) => {
    const matching = publishedItems.filter(
      (item) => item.publishedAt != null && item.publishedAt.getUTCDay() === day.weekday,
    )
    const inters: Array<number> = []
    for (const item of matching) {
      const snap = latestSnapshotByItem.get(item.id)
      if (snap) inters.push(sumInteractions(snap))
    }
    return {
      weekday: day.weekday,
      label: day.label,
      shortLabel: day.shortLabel,
      published: matching.length,
      avgInteractions: inters.length > 0 ? Math.round(avg(inters) ?? 0) : null,
    }
  })

  // Team production & human vs agent collaboration.
  const team: Array<TeamMemberMetric> = teamRows
    .map((m) => {
      const published = publishedItems.filter((i) => i.assigneeId === m.memberId).length
      const inProgress = items.filter(
        (i) =>
          i.assigneeId === m.memberId &&
          (i.status === 'idea' || i.status === 'draft' || i.status === 'ready' || i.status === 'scheduled'),
      ).length
      const designsCreated = designRows.filter(
        (d) => d.createdById === m.memberId && itemIdSet.has(d.contentItemId),
      ).length
      const photoEditsCreated = photoRows.filter(
        (p) => p.createdById === m.memberId && itemIdSet.has(p.contentItemId),
      ).length
      return {
        memberId: m.memberId,
        name: m.name,
        published,
        inProgress,
        designsCreated,
        photoEditsCreated,
      }
    })
    .sort((a, b) => b.published - a.published || b.inProgress - a.inProgress)

  const filteredDesignVersions = designVersionRows.filter(
    (v) => itemIdSet.has(v.contentItemId) && inRange(v.createdAt),
  )
  const filteredPhotoVersions = photoVersionRows.filter(
    (v) => itemIdSet.has(v.contentItemId) && inRange(v.createdAt),
  )

  const collaboration = {
    designVersionsHuman: filteredDesignVersions.filter((v) => v.authorKind === 'user').length,
    designVersionsAgent: filteredDesignVersions.filter((v) => v.authorKind === 'agent').length,
    photoVersionsHuman: filteredPhotoVersions.filter((v) => v.authorKind === 'user').length,
    photoVersionsAgent: filteredPhotoVersions.filter((v) => v.authorKind === 'agent').length,
    publishesManual: jobsInRange.filter((j) => j.trigger === 'manual').length,
    publishesScheduled: jobsInRange.filter((j) => j.trigger === 'scheduled').length,
    publishesMcp: jobsInRange.filter((j) => j.trigger === 'mcp').length,
  }

  // Top published content (ranked by interactions, then views, then recency).
  const topContent: Array<TopContentEntry> = publishedItems
    .map((item) => {
      const snap = latestSnapshotByItem.get(item.id)
      const interactions = snap ? sumInteractions(snap) : 0
      const signals = snap ? computeChannelSignalsFromTotals(item.channel, snap, 1) : []
      const diagnosis = snap
        ? diagnosePost(
            item.channel,
            snap,
            signals,
            channelAvgRateMap.get(item.channel) ?? null,
          )
        : null
      return {
        id: item.id,
        title: item.title,
        channel: item.channel,
        format: item.format,
        publishedAt: item.publishedAt,
        publishedUrl: item.publishedUrl,
        views: snap?.views ?? null,
        reach: snap?.reach ?? null,
        likes: snap?.likes ?? null,
        comments: snap?.comments ?? null,
        shares: snap?.shares ?? null,
        saves: snap?.saves ?? null,
        avgWatchTimeMs: snap?.avgWatchTimeMs ?? null,
        interactions,
        engagementRate: snap?.engagementRate ?? null,
        hasMetrics: Boolean(snap),
        collectedAt: snap?.collectedAt ?? null,
        signals,
        diagnosis,
      }
    })
    .sort((a, b) => {
      if (a.hasMetrics !== b.hasMetrics) return a.hasMetrics ? -1 : 1
      if (b.interactions !== a.interactions) return b.interactions - a.interactions
      if ((b.views ?? 0) !== (a.views ?? 0)) return (b.views ?? 0) - (a.views ?? 0)
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
    })
    .slice(0, 12)

  // Recent publish failures (last 5).
  const recentFailures: Array<RecentPublishFailure> = jobsInRange
    .filter((job) => job.status === 'failed')
    .slice(0, 5)
    .map((job) => ({
      jobId: job.id,
      contentItemId: job.contentItemId,
      itemTitle: itemById.get(job.contentItemId)?.title ?? 'Conteúdo removido',
      channel: job.channel,
      errorMessage: job.errorMessage ?? 'Falha desconhecida ao publicar.',
      failedAt: job.finishedAt ?? job.updatedAt,
    }))

  const connectedSocialChannels = allConnections
    .filter((c) => c.status === 'connected')
    .map((c) => c.channel)

  const kpis = {
    publishedCount: publishedItems.length,
    previousPublishedCount: previousPublishedItems ? previousPublishedItems.length : null,
    publishedDeltaPct:
      previousPublishedItems != null
        ? pctDelta(publishedItems.length, previousPublishedItems.length)
        : null,
    scheduledUpcoming7d,
    inProgressCount,
    avgLeadTimeHours: avg(currentLeadTimes),
    previousAvgLeadTimeHours: avg(previousLeadTimes),
    publishSuccessRate,
    publishSuccessCount,
    publishFailedCount,
    totalViews,
    totalReach,
    totalInteractions,
    avgEngagementRate,
    trackedPostsCount,
    lastSyncedAt,
  }

  const insights = buildInsights({
    period,
    channelFilter: channelFilter ?? null,
    kpis,
    channelSpotlight,
    pipeline,
    channels,
    formats,
    recentFailures,
    connectedSocialChannels,
  })

  return {
    period,
    channel: channelFilter ?? null,
    generatedAt: now,
    rangeStart,
    rangeEnd,
    kpis,
    insights,
    channelSpotlight,
    cadence,
    pipeline,
    channels,
    formats,
    weekdayRhythm,
    team,
    collaboration,
    topContent,
    recentFailures,
    connectedSocialChannels,
  }
}

function buildCadenceSeries(
  items: ReadonlyArray<typeof contentItem.$inferSelect>,
  latestSnapshotByItem: Map<string, SocialMetricSnapshot>,
  period: AnalyticsFilters['period'],
  rangeStart: Date | null,
  rangeEnd: Date,
): Array<CadenceBucket> {
  const endDay = startOfUtcDay(rangeEnd)
  const useWeekly = period === '90d' || period === 'all'

  if (!useWeekly) {
    const totalDays = period === '7d' ? 7 : 30
    const startDay = new Date(endDay.getTime() - (totalDays - 1) * DAY_MS)
    const buckets = new Map<string, CadenceBucket>()
    for (let i = 0; i < totalDays; i += 1) {
      const day = new Date(startDay.getTime() + i * DAY_MS)
      const key = isoDayKey(day)
      buckets.set(key, {
        key,
        label: formatBucketLabel(day),
        published: 0,
        scheduled: 0,
        views: 0,
        interactions: 0,
      })
    }

    for (const item of items) {
      if (item.status === 'published' && item.publishedAt) {
        const key = isoDayKey(startOfUtcDay(item.publishedAt))
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.published += 1
          const snap = latestSnapshotByItem.get(item.id)
          if (snap) {
            bucket.views += snap.views ?? 0
            bucket.interactions += sumInteractions(snap)
          }
        }
      } else if (item.status === 'scheduled' && item.scheduledAt) {
        const key = isoDayKey(startOfUtcDay(item.scheduledAt))
        const bucket = buckets.get(key)
        if (bucket) bucket.scheduled += 1
      }
    }
    return Array.from(buckets.values())
  }

  // Weekly buckets (13 weeks for 90d, or span of published items up to 16 weeks for 'all').
  const weeksCount = period === '90d' ? 13 : 12
  const firstBucketStart = rangeStart
    ? startOfUtcDay(rangeStart)
    : new Date(endDay.getTime() - (weeksCount * 7 - 1) * DAY_MS)

  const buckets: Array<CadenceBucket & { startMs: number; endMs: number }> = []
  const spanMs = Math.max(endDay.getTime() + DAY_MS - firstBucketStart.getTime(), 7 * DAY_MS)
  const stepMs = Math.ceil(spanMs / weeksCount)

  for (let i = 0; i < weeksCount; i += 1) {
    const startMs = firstBucketStart.getTime() + i * stepMs
    const endMs = startMs + stepMs
    const startDate = new Date(startMs)
    buckets.push({
      key: isoDayKey(startDate),
      label: formatBucketLabel(startDate),
      published: 0,
      scheduled: 0,
      views: 0,
      interactions: 0,
      startMs,
      endMs,
    })
  }

  for (const item of items) {
    if (item.status === 'published' && item.publishedAt) {
      const t = item.publishedAt.getTime()
      const bucket = buckets.find((b) => t >= b.startMs && t < b.endMs)
      if (bucket) {
        bucket.published += 1
        const snap = latestSnapshotByItem.get(item.id)
        if (snap) {
          bucket.views += snap.views ?? 0
          bucket.interactions += sumInteractions(snap)
        }
      }
    } else if (item.status === 'scheduled' && item.scheduledAt) {
      const t = item.scheduledAt.getTime()
      const bucket = buckets.find((b) => t >= b.startMs && t < b.endMs)
      if (bucket) bucket.scheduled += 1
    }
  }

  return buckets.map(({ startMs: _s, endMs: _e, ...rest }) => rest)
}

function buildInsights(ctx: {
  period: AnalyticsFilters['period']
  channelFilter: Channel | null
  kpis: WorkspaceAnalytics['kpis']
  channelSpotlight: ChannelSpotlight | null
  pipeline: Array<PipelineStageMetric>
  channels: Array<ChannelMetric>
  formats: Array<FormatMetric>
  recentFailures: Array<RecentPublishFailure>
  connectedSocialChannels: Array<string>
}): Array<AnalyticsInsight> {
  const insights: Array<AnalyticsInsight> = []

  // 1. Publishing failures need immediate attention.
  if (ctx.recentFailures.length > 0) {
    const count = ctx.recentFailures.length
    insights.push({
      id: 'publish-failures',
      tone: 'attention',
      title:
        count === 1
          ? '1 publicação automática falhou neste período'
          : `${count} publicações automáticas falharam neste período`,
      description: `Última falha em ${CHANNEL_LABELS[ctx.recentFailures[0]!.channel]}: ${ctx.recentFailures[0]!.errorMessage}`,
      action: { label: 'Ver falhas abaixo', to: '/connections' },
    })
  }

  // 2. Strongest platform-native signal highlight.
  const strongSignal = ctx.channelSpotlight?.signals.find((s) => s.strength === 'strong')
  if (ctx.channelSpotlight && strongSignal) {
    insights.push({
      id: `signal-${strongSignal.id}`,
      tone: 'positive',
      title: `${CHANNEL_LABELS[ctx.channelSpotlight.channel]}: ${strongSignal.label.toLowerCase()} em destaque (${strongSignal.formattedValue})`,
      description: strongSignal.explanation,
    })
  }

  // 3. Stale ready items waiting to be scheduled (actionable attention).
  const readyStage = ctx.pipeline.find((s) => s.status === 'ready')
  if (readyStage && readyStage.staleCount > 0) {
    insights.push({
      id: 'stale-ready',
      tone: 'attention',
      title:
        readyStage.staleCount === 1
          ? '1 conteúdo pronto parado há mais de 7 dias'
          : `${readyStage.staleCount} conteúdos prontos parados há mais de 7 dias`,
      description: 'Vale revisar e encaixar no calendário antes que percam o timing.',
      action: { label: 'Ver prontos', to: '/content', search: { statuses: ['ready'] } },
    })
  }

  // 4. Rhythm trend vs. previous period.
  if (
    ctx.kpis.publishedDeltaPct != null &&
    ctx.kpis.previousPublishedCount != null &&
    ctx.kpis.publishedCount > 0
  ) {
    const rounded = Math.round(ctx.kpis.publishedDeltaPct)
    if (rounded >= 15) {
      insights.push({
        id: 'rhythm-up',
        tone: 'positive',
        title: `Ritmo ${rounded}% acima do período anterior`,
        description: `Foram ${ctx.kpis.publishedCount} conteúdos publicados (antes: ${ctx.kpis.previousPublishedCount}).`,
      })
    } else if (rounded <= -20) {
      insights.push({
        id: 'rhythm-down',
        tone: 'attention',
        title: `Ritmo ${Math.abs(rounded)}% abaixo do período anterior`,
        description: `Foram ${ctx.kpis.publishedCount} publicações contra ${ctx.kpis.previousPublishedCount} no período anterior.`,
        action: { label: 'Abrir calendário', to: '/calendar' },
      })
    }
  }

  // 5. Best performing format (social engagement if available, else generic traction if no native signal was shown).
  const formatsWithEngagement = ctx.formats.filter((f) => f.avgEngagementRate != null)
  if (formatsWithEngagement.length >= 2) {
    const best = [...formatsWithEngagement].sort(
      (a, b) => (b.avgEngagementRate ?? 0) - (a.avgEngagementRate ?? 0),
    )[0]!
    insights.push({
      id: 'best-format',
      tone: 'positive',
      title: `${FORMAT_LABELS[best.format]} lidera em engajamento`,
      description: `Taxa média de ${formatPercent(best.avgEngagementRate!)} com ${formatCompactNumber(best.interactions)} interações em ${best.published} ${best.published === 1 ? 'publicação' : 'publicações'}.`,
    })
  } else if (!strongSignal && ctx.kpis.trackedPostsCount > 0 && ctx.kpis.totalViews > 0) {
    insights.push({
      id: 'social-traction',
      tone: 'positive',
      title: `${formatCompactNumber(ctx.kpis.totalViews)} visualizações coletadas`,
      description: `${formatCompactNumber(ctx.kpis.totalInteractions)} interações em ${ctx.kpis.trackedPostsCount} ${ctx.kpis.trackedPostsCount === 1 ? 'post monitorado' : 'posts monitorados'}.`,
    })
  }

  // 5. Upcoming 7-day calendar gap.
  if (ctx.kpis.scheduledUpcoming7d === 0 && !ctx.channelFilter) {
    insights.push({
      id: 'calendar-gap',
      tone: 'info',
      title: 'Próximos 7 dias livres',
      description:
        ctx.kpis.inProgressCount > 0
          ? `${ctx.kpis.inProgressCount} ${ctx.kpis.inProgressCount === 1 ? 'conteúdo em produção pronto' : 'conteúdos em produção prontos'} pra encaixar na agenda.`
          : 'Nenhum post agendado para esta semana.',
      action: { label: 'Calendário', to: '/calendar' },
    })
  }

  // 6. Prompt to connect social accounts if none connected yet.
  if (ctx.connectedSocialChannels.length === 0 && insights.length < 3) {
    insights.push({
      id: 'connect-social',
      tone: 'info',
      title: 'Conecte suas redes',
      description: 'Veja views, curtidas, comentários e salvos direto por aqui.',
      action: { label: 'Conectar', to: '/connections' },
    })
  }

  return insights.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Per-item analytics (for /content/$itemId mini-card and MCP get_item_analytics)
// ---------------------------------------------------------------------------

export async function getItemAnalytics(
  db: Database,
  organizationId: string,
  itemId: string,
): Promise<ItemAnalytics | null> {
  const [item] = await db
    .select()
    .from(contentItem)
    .where(and(eq(contentItem.id, itemId), eq(contentItem.organizationId, organizationId)))
    .limit(1)
  if (!item) return null

  const [
    snapshots,
    jobs,
    designVersions,
    photoVersions,
    connections,
    channelSnapshots,
  ] = await Promise.all([
    db
      .select()
      .from(socialMetricSnapshot)
      .where(
        and(
          eq(socialMetricSnapshot.organizationId, organizationId),
          eq(socialMetricSnapshot.contentItemId, itemId),
        ),
      )
      .orderBy(asc(socialMetricSnapshot.collectedAt)),
    db
      .select()
      .from(socialPublishJob)
      .where(
        and(
          eq(socialPublishJob.organizationId, organizationId),
          eq(socialPublishJob.contentItemId, itemId),
        ),
      )
      .orderBy(desc(socialPublishJob.createdAt)),
    db
      .select({ id: contentDesignVersion.id })
      .from(contentDesignVersion)
      .innerJoin(contentDesign, eq(contentDesign.id, contentDesignVersion.designId))
      .where(eq(contentDesign.contentItemId, itemId)),
    db
      .select({ id: contentPhotoEditVersion.id })
      .from(contentPhotoEditVersion)
      .innerJoin(contentPhotoEdit, eq(contentPhotoEdit.id, contentPhotoEditVersion.editId))
      .where(eq(contentPhotoEdit.contentItemId, itemId)),
    db
      .select({ channel: socialConnection.channel, status: socialConnection.status })
      .from(socialConnection)
      .where(eq(socialConnection.organizationId, organizationId)),
    item.channel !== 'blog'
      ? db
          .select({
            contentItemId: socialMetricSnapshot.contentItemId,
            engagementRateBps: socialMetricSnapshot.engagementRateBps,
            collectedAt: socialMetricSnapshot.collectedAt,
          })
          .from(socialMetricSnapshot)
          .where(
            and(
              eq(socialMetricSnapshot.organizationId, organizationId),
              eq(socialMetricSnapshot.channel, item.channel),
            ),
          )
          .orderBy(desc(socialMetricSnapshot.collectedAt))
      : Promise.resolve([]),
  ])

  const history = snapshots.map(toSnapshot)
  const latest = history.length > 0 ? history[history.length - 1]! : null
  const first = history.length >= 2 ? history[0]! : null

  const growth =
    latest && first
      ? {
          views:
            latest.views != null && first.views != null ? latest.views - first.views : null,
          likes:
            latest.likes != null && first.likes != null ? latest.likes - first.likes : null,
          comments:
            latest.comments != null && first.comments != null
              ? latest.comments - first.comments
              : null,
          shares:
            latest.shares != null && first.shares != null ? latest.shares - first.shares : null,
          interactions: sumInteractions(latest) - sumInteractions(first),
        }
      : null

  // Average engagement rate across the workspace's posts on the same channel.
  const latestRateByItem = new Map<string, number>()
  for (const row of channelSnapshots) {
    if (latestRateByItem.has(row.contentItemId)) continue
    const rate = bpsToPercent(row.engagementRateBps)
    if (rate != null) latestRateByItem.set(row.contentItemId, rate)
  }
  const channelRates = Array.from(latestRateByItem.values())
  const channelAvgEngagementRate =
    channelRates.length > 0 ? Number((avg(channelRates) ?? 0).toFixed(2)) : null

  const publishedJob = jobs.find((j) => j.status === 'published' && j.remotePostId)
  const hasConnectedChannel = connections.some(
    (c) => c.channel === item.channel && c.status === 'connected',
  )
  const signals = latest ? computeChannelSignalsFromTotals(item.channel, latest, 1) : []
  const diagnosis = latest
    ? diagnosePost(item.channel, latest, signals, channelAvgEngagementRate)
    : null

  const realPublishJobs = jobs.filter((j) => j.stage !== 'imported')
  const isImportedOnly = jobs.length > 0 && realPublishJobs.length === 0
  const remoteDeletedAtRaw = publishedJob?.providerState.remoteDeletedAt
  const remoteDeletedAt = remoteDeletedAtRaw ? new Date(remoteDeletedAtRaw) : null
  const validRemoteDeletedAt =
    remoteDeletedAt && !Number.isNaN(remoteDeletedAt.getTime()) ? remoteDeletedAt : null

  return {
    contentItemId: item.id,
    channel: item.channel,
    guide: CHANNEL_METRIC_GUIDES[item.channel],
    latest,
    history,
    signals,
    diagnosis,
    growth,
    editorial: {
      leadTimeHours: isImportedOnly ? null : leadTimeHoursOf(item),
      designVersionsCount: designVersions.length,
      photoEditVersionsCount: photoVersions.length,
      publishAttempts: realPublishJobs.length,
      channelAvgEngagementRate,
    },
    canSync: Boolean(publishedJob?.remotePostId && hasConnectedChannel && !validRemoteDeletedAt),
    remotePostId: publishedJob?.remotePostId ?? null,
    remoteDeletedAt: validRemoteDeletedAt,
  }
}
