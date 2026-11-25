import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import type { Database } from '../db/client.server'
import {
  contentDesign,
  contentDesignVersion,
  contentItem,
  socialConnection,
  socialMetricSnapshot,
  socialPublishJob,
  user,
} from '../db/schema'
import { computeEngagementRateBps, formatLeadTime } from './analytics'
import {
  computeChannelSignalsFromTotals,
  diagnosePost,
  formatWatchTimeSeconds,
} from './analytics-signals'
import { getItemAnalytics, getWorkspaceAnalytics } from './analytics.server'
import { runZoraTool, zoraTools } from './mcp.server'
import {
  runScheduledMetricsSync,
  syncItemSocialMetrics,
  syncWorkspaceSocialMetrics,
} from './social-metrics.server'
import { createTregClient } from './treg.server'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

describe('analytics and social metrics', () => {
  let db: Database
  const userId = 'user-analytics-1'
  const orgId = 'org-analytics-1'

  beforeAll(async () => {
    db = await createTestDb()
  })

  afterAll(async () => {
    await closeTestDb(db)
  })

  beforeEach(async () => {
    await resetDatabase(db)
    await db.insert(user).values({
      id: userId,
      name: 'Ana',
      email: 'ana@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await seedWorkspace(db, orgId, [userId], 'Zora Test')
  })

  it('computes engagement rate in basis points and formats lead times cleanly', () => {
    expect(
      computeEngagementRateBps({
        views: 1000,
        reach: 500,
        likes: 20,
        comments: 5,
        shares: 5,
        saves: 0,
      }),
    ).toBe(600) // 30 / 500 = 6.00%

    expect(
      computeEngagementRateBps({
        views: 2000,
        reach: null,
        likes: 40,
        comments: 10,
        shares: 0,
        saves: 0,
      }),
    ).toBe(250) // 50 / 2000 = 2.50%

    expect(formatLeadTime(0.5)).toBe('menos de 1 h')
    expect(formatLeadTime(18)).toBe('18 h')
    expect(formatLeadTime(60)).toBe('2,5 dias')
    expect(formatLeadTime(null)).toBe('—')
  })

  it('aggregates editorial, operational, collaboration, and social metrics for a workspace', async () => {
    const now = new Date('2026-11-25T15:00:00Z')
    const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS)
    const fiveDaysAgo = new Date(now.getTime() - 5 * DAY_MS)
    const fortyDaysAgo = new Date(now.getTime() - 40 * DAY_MS)
    const tenDaysAgo = new Date(now.getTime() - 10 * DAY_MS)
    const inThreeDays = new Date(now.getTime() + 3 * DAY_MS)

    const [igPost, liPost, oldPost, readyStale, scheduledUpcoming] = await db
      .insert(contentItem)
      .values([
        {
          organizationId: orgId,
          title: 'Carrossel de lançamento',
          channel: 'instagram',
          format: 'carousel',
          status: 'published',
          publishedAt: twoDaysAgo,
          publishedUrl: 'https://instagram.com/p/abc',
          assigneeId: userId,
          createdById: userId,
          createdAt: new Date(twoDaysAgo.getTime() - 24 * HOUR_MS),
          updatedAt: twoDaysAgo,
        },
        {
          organizationId: orgId,
          title: 'Post técnico no LinkedIn',
          channel: 'linkedin',
          format: 'post',
          status: 'published',
          publishedAt: fiveDaysAgo,
          assigneeId: userId,
          createdById: userId,
          createdAt: new Date(fiveDaysAgo.getTime() - 48 * HOUR_MS),
          updatedAt: fiveDaysAgo,
        },
        {
          organizationId: orgId,
          title: 'Post do período anterior',
          channel: 'instagram',
          format: 'post',
          status: 'published',
          publishedAt: fortyDaysAgo,
          assigneeId: userId,
          createdById: userId,
          createdAt: new Date(fortyDaysAgo.getTime() - 12 * HOUR_MS),
          updatedAt: fortyDaysAgo,
        },
        {
          organizationId: orgId,
          title: 'Reel pronto parado',
          channel: 'instagram',
          format: 'reel',
          status: 'ready',
          assigneeId: userId,
          createdById: userId,
          createdAt: tenDaysAgo,
          updatedAt: tenDaysAgo,
        },
        {
          organizationId: orgId,
          title: 'Thread agendada',
          channel: 'x',
          format: 'thread',
          status: 'scheduled',
          scheduledAt: inThreeDays,
          assigneeId: userId,
          createdById: userId,
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
        },
      ])
      .returning()

    await db.insert(socialConnection).values({
      organizationId: orgId,
      channel: 'instagram',
      externalToolName: 'ig_tool',
      status: 'connected',
      connectedById: userId,
    })

    const [publishedJob] = await db
      .insert(socialPublishJob)
      .values([
        {
          organizationId: orgId,
          contentItemId: igPost!.id,
          channel: 'instagram',
          trigger: 'scheduled',
          status: 'published',
          remotePostId: 'ig_123',
          publishedUrl: 'https://instagram.com/p/abc',
          createdAt: twoDaysAgo,
          finishedAt: twoDaysAgo,
        },
        {
          organizationId: orgId,
          contentItemId: liPost!.id,
          channel: 'linkedin',
          trigger: 'mcp',
          status: 'failed',
          errorMessage: 'Token expirado',
          createdAt: fiveDaysAgo,
          finishedAt: fiveDaysAgo,
        },
      ])
      .returning()

    await db.insert(socialMetricSnapshot).values([
      {
        organizationId: orgId,
        contentItemId: igPost!.id,
        publishJobId: publishedJob!.id,
        channel: 'instagram',
        remotePostId: 'ig_123',
        views: 1200,
        reach: 1000,
        likes: 50,
        comments: 10,
        shares: 5,
        saves: 25,
        engagementRateBps: 900,
        collectedAt: new Date(now.getTime() - HOUR_MS),
      },
    ])

    const [design] = await db
      .insert(contentDesign)
      .values({
        contentItemId: igPost!.id,
        name: 'Capa',
        widthPx: 1080,
        heightPx: 1350,
        createdById: userId,
      })
      .returning()

    await db.insert(contentDesignVersion).values([
      {
        designId: design!.id,
        number: 1,
        authorKind: 'agent',
        createdById: userId,
        sourceSize: 100,
        previewSize: 200,
        createdAt: twoDaysAgo,
      },
      {
        designId: design!.id,
        number: 2,
        authorKind: 'user',
        createdById: userId,
        sourceSize: 110,
        previewSize: 210,
        createdAt: twoDaysAgo,
      },
    ])

    expect(oldPost).toBeDefined()
    expect(readyStale).toBeDefined()
    expect(scheduledUpcoming).toBeDefined()

    const report = await getWorkspaceAnalytics(db, orgId, { period: '30d' }, now)

    expect(report.kpis.publishedCount).toBe(2)
    expect(report.kpis.previousPublishedCount).toBe(1)
    expect(report.kpis.publishedDeltaPct).toBe(100)
    expect(report.kpis.scheduledUpcoming7d).toBe(1)
    expect(report.kpis.avgLeadTimeHours).toBe(36)
    expect(report.kpis.publishSuccessRate).toBe(50)
    expect(report.kpis.totalViews).toBe(1200)
    expect(report.kpis.totalReach).toBe(1000)
    expect(report.kpis.totalInteractions).toBe(90)
    expect(report.kpis.avgEngagementRate).toBe(9)
    expect(report.kpis.trackedPostsCount).toBe(1)

    expect(report.collaboration.designVersionsAgent).toBe(1)
    expect(report.collaboration.designVersionsHuman).toBe(1)
    expect(report.collaboration.publishesScheduled).toBe(1)
    expect(report.collaboration.publishesMcp).toBe(1)

    const readyStage = report.pipeline.find((s) => s.status === 'ready')
    expect(readyStage?.count).toBe(1)
    expect(readyStage?.staleCount).toBe(1)

    expect(report.recentFailures).toHaveLength(1)
    expect(report.recentFailures[0]?.errorMessage).toBe('Token expirado')
    expect(report.insights.some((i) => i.id === 'publish-failures')).toBe(true)
    expect(report.insights.some((i) => i.id === 'stale-ready')).toBe(true)
    expect(report.topContent[0]?.id).toBe(igPost!.id)
    expect(report.topContent[0]?.signals.some((s) => s.id === 'saves_per_reach')).toBe(true)
    expect(report.topContent[0]?.diagnosis?.badge).toBe('Conteúdo de referência')
    expect(report.channelSpotlight?.channel).toBe('instagram')
    expect(report.channelSpotlight?.signals.some((s) => s.id === 'sends_per_reach')).toBe(true)
  })

  it('computes platform-native signals and beginner-friendly diagnoses per network', () => {
    const igSignals = computeChannelSignalsFromTotals('instagram', {
      views: 3000,
      reach: 2000,
      likes: 120,
      comments: 15,
      shares: 40, // 2.0% sends/reach -> strong discovery
      saves: 30,
      avgWatchTimeMs: 14_500,
      engagementRate: 10.25,
    })
    expect(igSignals.find((s) => s.id === 'sends_per_reach')?.strength).toBe('strong')
    expect(igSignals.find((s) => s.id === 'avg_watch_time')?.formattedValue).toBe('14,5 s')
    expect(formatWatchTimeSeconds(75_000)).toBe('1m 15s')

    const igDiagnosis = diagnosePost(
      'instagram',
      {
        views: 3000,
        reach: 2000,
        likes: 120,
        comments: 15,
        shares: 40,
        saves: 30,
        avgWatchTimeMs: 14_500,
        engagementRate: 10.25,
      },
      igSignals,
      5,
    )
    expect(igDiagnosis?.badge).toBe('Alto potencial de descoberta')

    const xSignals = computeChannelSignalsFromTotals('x', {
      views: 10_000,
      reach: null,
      likes: 80,
      comments: 12,
      shares: 20,
      saves: 60, // 0.6% bookmarks -> strong utility
      avgWatchTimeMs: null,
      engagementRate: 1.72,
    })
    expect(xSignals.find((s) => s.id === 'bookmarks_per_view')?.strength).toBe('strong')
  })

  it('syncs item and workspace social metrics via adapters and tracks growth over time', async () => {
    const now = new Date('2026-11-25T15:00:00Z')
    const [item] = await db
      .insert(contentItem)
      .values({
        organizationId: orgId,
        title: 'Vídeo no YouTube',
        channel: 'youtube',
        format: 'reel',
        status: 'published',
        publishedAt: new Date(now.getTime() - DAY_MS),
        createdById: userId,
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
      })
      .returning()

    await db.insert(socialConnection).values({
      organizationId: orgId,
      channel: 'youtube',
      externalToolName: 'yt_tool',
      status: 'connected',
      connectedById: userId,
    })

    await db.insert(socialPublishJob).values({
      organizationId: orgId,
      contentItemId: item!.id,
      channel: 'youtube',
      trigger: 'manual',
      status: 'published',
      remotePostId: 'yt_vid_99',
      publishedUrl: 'https://youtu.be/yt_vid_99',
      createdAt: new Date(now.getTime() - DAY_MS),
      finishedAt: new Date(now.getTime() - DAY_MS),
    })

    const treg = createTregClient({
      token: 'test-token',
      fetch: async () => new Response(JSON.stringify({}), { status: 200 }),
    })

    let callCount = 0
    const mockFetcher = async () => {
      callCount += 1
      return {
        ok: true as const,
        metrics: {
          views: callCount === 1 ? 500 : 1200,
          reach: null,
          likes: callCount === 1 ? 25 : 70,
          comments: callCount === 1 ? 3 : 10,
          shares: null,
          saves: null,
          clicks: null,
          rawPayload: { callCount },
        },
      }
    }

    const first = await syncItemSocialMetrics(
      { db: db, treg, fetchers: { youtube: mockFetcher } },
      { organizationId: orgId, itemId: item!.id },
      new Date(now.getTime() - 6 * HOUR_MS),
    )
    expect(first.snapshot?.views).toBe(500)
    expect(first.snapshot?.engagementRate).toBe(5.6)

    // Scheduled sync should pick it up since last snapshot was 6h ago (> 4h threshold).
    const cronRes = await runScheduledMetricsSync(
      { db: db, treg, fetchers: { youtube: mockFetcher } },
      now,
    )
    expect(cronRes.checked).toBe(1)
    expect(cronRes.updated).toBe(1)

    // Immediate re-run should skip because a fresh snapshot was just saved.
    const cronRes2 = await runScheduledMetricsSync(
      { db: db, treg, fetchers: { youtube: mockFetcher } },
      new Date(now.getTime() + 60_000),
    )
    expect(cronRes2.checked).toBe(0)

    const itemReport = await getItemAnalytics(db, orgId, item!.id)
    expect(itemReport?.history).toHaveLength(2)
    expect(itemReport?.latest?.views).toBe(1200)
    expect(itemReport?.growth?.views).toBe(700)
    expect(itemReport?.growth?.likes).toBe(45)
    expect(itemReport?.canSync).toBe(true)

    const wsSync = await syncWorkspaceSocialMetrics(
      { db: db, treg, fetchers: { youtube: mockFetcher } },
      { organizationId: orgId },
      new Date(now.getTime() + 2 * HOUR_MS),
    )
    expect(wsSync.updated).toBe(1)
  })

  it('exposes analytics tools on the MCP server', async () => {
    const tool = zoraTools.find((t) => t.name === 'get_workspace_analytics')
    expect(tool).toBeDefined()

    const result = await runZoraTool(
      tool!,
      { period: '7d' },
      {
        db: db,
        bucket: {} as never,
        user: { id: userId, name: 'Ana', email: 'ana@example.com' },
        workspace: { id: orgId, name: 'Test', slug: 'test', role: 'owner' },
        appUrl: 'https://zora.lume.software',
      },
    )
    expect(result.isError).toBeFalsy()
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const parsed = JSON.parse(text) as {
      period: string
      analyticsUrl: string
      channelGuides: Record<string, { headline: string }>
    }
    expect(parsed.period).toBe('7d')
    expect(parsed.analyticsUrl).toBe('https://zora.lume.software/analytics')
    expect(parsed.channelGuides.instagram?.headline).toContain('Instagram')
  })
})
