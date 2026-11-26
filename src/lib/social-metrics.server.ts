/**
 * Social engagement metrics collector. Fetches post-level metrics from each
 * connected social network through `TregClient` and stores immutable snapshots
 * in `social_metric_snapshot`.
 *
 * Every adapter degrades gracefully when an OAuth connection lacks read/insight
 * scopes (returning a friendly pt-BR warning instead of breaking the sync).
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import {
  contentItem,
  socialConnection,
  socialMetricSnapshot,
  socialPublishJob,
} from '../db/schema'
import {
  bpsToPercent,
  computeEngagementRateBps,
} from './analytics'
import type {
  SocialMetricSnapshot,
  SyncItemMetricsResult,
  SyncWorkspaceMetricsResult,
} from './analytics'
import { CHANNEL_LABELS } from './content'
import type { ContentFormat } from './content'
import { isSocialChannel } from './social'
import type { SocialChannel, SocialConnection } from './social'
import { getWorkspaceConnection, listWorkspaceConnections } from './social-connections.server'
import { LINKEDIN_API_VERSION } from './social-publishers.server'
import { SocialPublishingError, TregApiError } from './treg.server'
import type { TregClient } from './treg.server'

const MAX_POST_AGE_MS = 60 * 24 * 60 * 60 * 1000
const RECENT_POST_AGE_MS = 14 * 24 * 60 * 60 * 1000
const RECENT_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000
const OLDER_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

export type RawCollectedMetrics = {
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  avgWatchTimeMs?: number | null
  rawPayload: Record<string, unknown>
}

export type MetricsFetchContext = {
  organizationId: string
  remotePostId: string
  connection: SocialConnection
  treg: TregClient
}

export type MetricsFetchOutcome =
  | { ok: true; metrics: RawCollectedMetrics }
  | { ok: false; supported: boolean; warning: string }

export type SocialMetricsFetcher = (ctx: MetricsFetchContext) => Promise<MetricsFetchOutcome>

export type ImportedRemotePost = {
  remotePostId: string
  publishedUrl: string | null
  title: string
  body: string
  format: ContentFormat
  publishedAt: Date
  initialMetrics?: RawCollectedMetrics | null
}

export type PostImportContext = {
  organizationId: string
  connection: SocialConnection
  treg: TregClient
  limit: number
}

export type PostImportOutcome =
  | { ok: true; posts: Array<ImportedRemotePost> }
  | { ok: false; warning: string }

export type SocialPostImporter = (ctx: PostImportContext) => Promise<PostImportOutcome>

export type SocialMetricsDeps = {
  db: Database
  treg: TregClient | null
  fetchers?: Partial<Record<SocialChannel, SocialMetricsFetcher>>
  importers?: Partial<Record<SocialChannel, SocialPostImporter>>
}

export type ImportRecentPostsResult = {
  imported: number
  importedItemIds: Array<string>
  importedWithSnapshotIds: Array<string>
  warnings: Array<string>
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed)
  }
  return null
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

function handleAdapterError(channel: SocialChannel, error: unknown): MetricsFetchOutcome {
  const label = CHANNEL_LABELS[channel]
  if (error instanceof TregApiError) {
    if (error.status === 401 || error.status === 428) {
      return {
        ok: false,
        supported: true,
        warning: `Reconecte sua conta do ${label} em Conexões para atualizar as métricas.`,
      }
    }
    if (error.status === 403) {
      return {
        ok: false,
        supported: false,
        warning: `A conexão atual do ${label} não tem permissão de leitura de métricas.`,
      }
    }
    if (error.status === 404) {
      return {
        ok: false,
        supported: true,
        warning: `A publicação não foi encontrada no ${label} (pode ter sido removida).`,
      }
    }
    if (error.status === 429) {
      return {
        ok: false,
        supported: true,
        warning: `Limite de consultas do ${label} atingido agora. Tente novamente em alguns minutos.`,
      }
    }
    return {
      ok: false,
      supported: true,
      warning: error.message,
    }
  }
  if (error instanceof SocialPublishingError) {
    return { ok: false, supported: true, warning: error.message }
  }
  return {
    ok: false,
    supported: true,
    warning: `Não foi possível coletar métricas do ${label} agora.`,
  }
}

// ---------------------------------------------------------------------------
// Channel adapters
// ---------------------------------------------------------------------------

const fetchInstagramMetrics: SocialMetricsFetcher = async (ctx) => {
  try {
    const basic = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/${encodeURIComponent(ctx.remotePostId)}`,
      method: 'GET',
      query: { fields: 'like_count,comments_count,media_type,media_product_type' },
    })
    const basicObj = asRecord(basic.data) ?? {}
    const likes = asNonNegativeInt(basicObj.like_count)
    const comments = asNonNegativeInt(basicObj.comments_count)

    let views: number | null = null
    let reach: number | null = null
    let shares: number | null = null
    let saves: number | null = null
    let avgWatchTimeMs: number | null = null
    let insightsRaw: unknown = null

    const isReelOrVideo =
      basicObj.media_product_type === 'REELS' || basicObj.media_type === 'VIDEO'
    const requestedMetrics = isReelOrVideo
      ? 'views,reach,saved,shares,ig_reels_avg_watch_time'
      : 'views,reach,saved,shares'

    const parseInsightsList = (payload: unknown) => {
      const list = Array.isArray(asRecord(payload)?.data)
        ? (asRecord(payload)?.data as Array<unknown>)
        : []
      for (const entry of list) {
        const row = asRecord(entry)
        const name = typeof row?.name === 'string' ? row.name : null
        const values = Array.isArray(row?.values) ? (row.values as Array<unknown>) : []
        const firstVal = asRecord(values[0])?.value
        const count = asNonNegativeInt(firstVal)
        if (name === 'views' || name === 'impressions' || name === 'plays') views = count
        if (name === 'reach') reach = count
        if (name === 'saved') saves = count
        if (name === 'shares') shares = count
        if (name === 'ig_reels_avg_watch_time') avgWatchTimeMs = count
      }
    }

    try {
      const insights = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: `/${encodeURIComponent(ctx.remotePostId)}/insights`,
        method: 'GET',
        query: { metric: requestedMetrics },
      })
      insightsRaw = insights.data
      parseInsightsList(insights.data)
    } catch {
      if (isReelOrVideo) {
        try {
          const fallback = await ctx.treg.callTool({
            organizationId: ctx.organizationId,
            toolName: ctx.connection.externalToolName,
            path: `/${encodeURIComponent(ctx.remotePostId)}/insights`,
            method: 'GET',
            query: { metric: 'views,reach,saved,shares' },
          })
          insightsRaw = fallback.data
          parseInsightsList(fallback.data)
        } catch {
          // Insights can be unavailable for very new posts or Stories after 24h.
        }
      }
    }

    return {
      ok: true,
      metrics: {
        views,
        reach,
        likes,
        comments,
        shares,
        saves,
        clicks: null,
        avgWatchTimeMs,
        rawPayload: { basic: basicObj, insights: insightsRaw },
      },
    }
  } catch (error) {
    return handleAdapterError('instagram', error)
  }
}

const fetchYouTubeMetrics: SocialMetricsFetcher = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/youtube/v3/videos',
      method: 'GET',
      query: { part: 'statistics', id: ctx.remotePostId },
    })
    const items = Array.isArray(asRecord(res.data)?.items)
      ? (asRecord(res.data)?.items as Array<unknown>)
      : []
    const stats = asRecord(asRecord(items[0])?.statistics)
    if (!stats) {
      return {
        ok: false,
        supported: true,
        warning: 'O YouTube ainda não retornou estatísticas para este vídeo.',
      }
    }
    return {
      ok: true,
      metrics: {
        views: asNonNegativeInt(stats.viewCount),
        reach: null,
        likes: asNonNegativeInt(stats.likeCount),
        comments: asNonNegativeInt(stats.commentCount),
        shares: null,
        saves: asNonNegativeInt(stats.favoriteCount),
        clicks: null,
        rawPayload: { statistics: stats },
      },
    }
  } catch (error) {
    return handleAdapterError('youtube', error)
  }
}

const fetchXMetrics: SocialMetricsFetcher = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/2/tweets/${encodeURIComponent(ctx.remotePostId)}`,
      method: 'GET',
      query: { 'tweet.fields': 'public_metrics' },
    })
    const tweet = asRecord(asRecord(res.data)?.data)
    const pub = asRecord(tweet?.public_metrics)
    if (!pub) {
      return {
        ok: false,
        supported: true,
        warning: 'O X não retornou métricas públicas para este post.',
      }
    }
    const retweets = asNonNegativeInt(pub.retweet_count) ?? 0
    const quotes = asNonNegativeInt(pub.quote_count) ?? 0
    return {
      ok: true,
      metrics: {
        views: asNonNegativeInt(pub.impression_count),
        reach: null,
        likes: asNonNegativeInt(pub.like_count),
        comments: asNonNegativeInt(pub.reply_count),
        shares: retweets + quotes,
        saves: asNonNegativeInt(pub.bookmark_count),
        clicks: null,
        rawPayload: { public_metrics: pub },
      },
    }
  } catch (error) {
    return handleAdapterError('x', error)
  }
}

const fetchTikTokMetrics: SocialMetricsFetcher = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/v2/video/query/',
      method: 'POST',
      query: { fields: 'id,like_count,comment_count,share_count,view_count' },
      body: { filters: { video_ids: [ctx.remotePostId] } },
    })
    const videos = Array.isArray(asRecord(asRecord(res.data)?.data)?.videos)
      ? (asRecord(asRecord(res.data)?.data)?.videos as Array<unknown>)
      : []
    const video = asRecord(videos[0])
    if (!video) {
      return {
        ok: false,
        supported: true,
        warning: 'O TikTok ainda não retornou estatísticas para este vídeo.',
      }
    }
    return {
      ok: true,
      metrics: {
        views: asNonNegativeInt(video.view_count),
        reach: null,
        likes: asNonNegativeInt(video.like_count),
        comments: asNonNegativeInt(video.comment_count),
        shares: asNonNegativeInt(video.share_count),
        saves: null,
        clicks: null,
        rawPayload: { video },
      },
    }
  } catch (error) {
    return handleAdapterError('tiktok', error)
  }
}

const fetchLinkedInMetrics: SocialMetricsFetcher = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/rest/socialActions/${encodeURIComponent(ctx.remotePostId)}`,
      method: 'GET',
      headers: {
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    })
    const data = asRecord(res.data)
    const likesSummary = asRecord(data?.likesSummary)
    const commentsSummary = asRecord(data?.commentsSummary)
    if (!likesSummary && !commentsSummary) {
      return {
        ok: false,
        supported: false,
        warning: 'O LinkedIn não disponibiliza métricas detalhadas para perfis pessoais nesta conexão.',
      }
    }
    return {
      ok: true,
      metrics: {
        views: null,
        reach: null,
        likes: asNonNegativeInt(likesSummary?.totalLikes),
        comments: asNonNegativeInt(commentsSummary?.totalFirstLevelComments),
        shares: null,
        saves: null,
        clicks: null,
        rawPayload: { socialActions: data },
      },
    }
  } catch (error) {
    return handleAdapterError('linkedin', error)
  }
}

export const SOCIAL_METRICS_FETCHERS: Record<SocialChannel, SocialMetricsFetcher> = {
  instagram: fetchInstagramMetrics,
  youtube: fetchYouTubeMetrics,
  x: fetchXMetrics,
  tiktok: fetchTikTokMetrics,
  linkedin: fetchLinkedInMetrics,
}

// ---------------------------------------------------------------------------
// Historical recent-post importers (so /analytics lights up immediately on connect)
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildImportedTitle(raw: string | null, channel: SocialChannel): string {
  if (raw) {
    const firstLine = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (firstLine) {
      return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
    }
  }
  return `Publicação no ${CHANNEL_LABELS[channel]}`
}

function clampImportedBody(raw: string | null): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  return trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed
}

function parseDateOrNow(value: unknown, fallback: Date): Date {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // TikTok returns Unix timestamps in seconds.
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value.trim())
    if (!Number.isNaN(d.getTime())) return d
  }
  return fallback
}

function parseIsoDurationSeconds(iso: string | null): number | null {
  if (!iso) return null
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso)
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const mins = Number(match[2] ?? 0)
  const secs = Number(match[3] ?? 0)
  return hours * 3600 + mins * 60 + secs
}

function parseInstagramInsightsPayload(payload: unknown): {
  views: number | null
  reach: number | null
  saves: number | null
  shares: number | null
  avgWatchTimeMs: number | null
} {
  let views: number | null = null
  let reach: number | null = null
  let saves: number | null = null
  let shares: number | null = null
  let avgWatchTimeMs: number | null = null

  const list = Array.isArray(asRecord(payload)?.data)
    ? (asRecord(payload)?.data as Array<unknown>)
    : []
  for (const entry of list) {
    const row = asRecord(entry)
    const name = typeof row?.name === 'string' ? row.name : null
    const values = Array.isArray(row?.values) ? (row.values as Array<unknown>) : []
    const firstVal = asRecord(values[0])?.value
    const count = asNonNegativeInt(firstVal)
    if (name === 'views' || name === 'impressions' || name === 'plays') views = count
    if (name === 'reach') reach = count
    if (name === 'saved') saves = count
    if (name === 'shares') shares = count
    if (name === 'ig_reels_avg_watch_time') avgWatchTimeMs = count
  }

  return { views, reach, saves, shares, avgWatchTimeMs }
}

const importInstagramPosts: SocialPostImporter = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/me/media',
      method: 'GET',
      query: {
        fields:
          'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
        limit: ctx.limit,
      },
    })
    const list = Array.isArray(asRecord(res?.data)?.data)
      ? (asRecord(res?.data)?.data as Array<unknown>)
      : []
    if (list.length === 0) return { ok: true, posts: [] }

    const now = new Date()
    const posts: Array<ImportedRemotePost> = []
    let insightsBudget = 10

    for (const entry of list) {
      const row = asRecord(entry)
      const id = asString(row?.id)
      if (!id) continue

      const mediaType = asString(row?.media_type)
      const productType = asString(row?.media_product_type)
      const isReelOrVideo = productType === 'REELS' || mediaType === 'VIDEO'
      const format: ContentFormat =
        productType === 'REELS'
          ? 'reel'
          : mediaType === 'CAROUSEL_ALBUM'
            ? 'carousel'
            : mediaType === 'VIDEO'
              ? 'video'
              : 'post'

      const caption = asString(row?.caption)
      const permalink = asString(row?.permalink)
      const likes = asNonNegativeInt(row?.like_count)
      const comments = asNonNegativeInt(row?.comments_count)

      let views: number | null = null
      let reach: number | null = null
      let shares: number | null = null
      let saves: number | null = null
      let avgWatchTimeMs: number | null = null
      let insightsRaw: unknown = null

      if (insightsBudget > 0) {
        insightsBudget -= 1
        const requestedMetrics = isReelOrVideo
          ? 'views,reach,saved,shares,ig_reels_avg_watch_time'
          : 'views,reach,saved,shares'
        try {
          const ins = await ctx.treg.callTool({
            organizationId: ctx.organizationId,
            toolName: ctx.connection.externalToolName,
            path: `/${encodeURIComponent(id)}/insights`,
            method: 'GET',
            query: { metric: requestedMetrics },
          })
          insightsRaw = ins?.data ?? null
          ;({ views, reach, saves, shares, avgWatchTimeMs } = parseInstagramInsightsPayload(
            ins?.data,
          ))
        } catch {
          if (isReelOrVideo) {
            try {
              const fallback = await ctx.treg.callTool({
                organizationId: ctx.organizationId,
                toolName: ctx.connection.externalToolName,
                path: `/${encodeURIComponent(id)}/insights`,
                method: 'GET',
                query: { metric: 'views,reach,saved,shares' },
              })
              insightsRaw = fallback?.data ?? null
              ;({ views, reach, saves, shares, avgWatchTimeMs } = parseInstagramInsightsPayload(
                fallback?.data,
              ))
            } catch {
              // Insights may be unavailable for very new posts or Stories.
            }
          }
        }
      }

      const hasAnyMetric =
        views != null ||
        reach != null ||
        likes != null ||
        comments != null ||
        shares != null ||
        saves != null ||
        avgWatchTimeMs != null

      posts.push({
        remotePostId: id,
        publishedUrl: permalink,
        title: buildImportedTitle(caption, 'instagram'),
        body: clampImportedBody(caption),
        format,
        publishedAt: parseDateOrNow(row?.timestamp, now),
        initialMetrics: hasAnyMetric
          ? {
              views,
              reach,
              likes,
              comments,
              shares,
              saves,
              clicks: null,
              avgWatchTimeMs,
              rawPayload: { basic: row ?? {}, insights: insightsRaw },
            }
          : null,
      })
    }

    return { ok: true, posts }
  } catch (error) {
    const outcome = handleAdapterError('instagram', error)
    return { ok: false, warning: outcome.ok ? '' : outcome.warning }
  }
}

const importTikTokPosts: SocialPostImporter = async (ctx) => {
  try {
    const res = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/v2/video/list/',
      method: 'POST',
      query: {
        fields:
          'id,title,video_description,create_time,share_url,like_count,comment_count,share_count,view_count',
      },
      body: { max_count: Math.min(ctx.limit, 20) },
    })
    const videos = Array.isArray(asRecord(asRecord(res?.data)?.data)?.videos)
      ? (asRecord(asRecord(res?.data)?.data)?.videos as Array<unknown>)
      : []
    if (videos.length === 0) return { ok: true, posts: [] }

    const now = new Date()
    const posts: Array<ImportedRemotePost> = []
    for (const entry of videos) {
      const video = asRecord(entry)
      const id = asString(video?.id)
      if (!id) continue
      const titleRaw = asString(video?.title) ?? asString(video?.video_description)
      const descRaw = asString(video?.video_description) ?? asString(video?.title)
      const views = asNonNegativeInt(video?.view_count)
      const likes = asNonNegativeInt(video?.like_count)
      const comments = asNonNegativeInt(video?.comment_count)
      const shares = asNonNegativeInt(video?.share_count)
      const hasAnyMetric = views != null || likes != null || comments != null || shares != null

      posts.push({
        remotePostId: id,
        publishedUrl: asString(video?.share_url),
        title: buildImportedTitle(titleRaw, 'tiktok'),
        body: clampImportedBody(descRaw),
        format: 'video',
        publishedAt: parseDateOrNow(video?.create_time, now),
        initialMetrics: hasAnyMetric
          ? {
              views,
              reach: null,
              likes,
              comments,
              shares,
              saves: null,
              clicks: null,
              rawPayload: { video: video ?? {} },
            }
          : null,
      })
    }
    return { ok: true, posts }
  } catch (error) {
    const outcome = handleAdapterError('tiktok', error)
    return { ok: false, warning: outcome.ok ? '' : outcome.warning }
  }
}

const importYouTubePosts: SocialPostImporter = async (ctx) => {
  try {
    const channelQuery: Record<string, string | boolean> = ctx.connection.accountId
      ? { part: 'contentDetails', id: ctx.connection.accountId }
      : { part: 'contentDetails', mine: true }

    const channelRes = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/youtube/v3/channels',
      method: 'GET',
      query: channelQuery,
    })
    const channelItems = Array.isArray(asRecord(channelRes?.data)?.items)
      ? (asRecord(channelRes?.data)?.items as Array<unknown>)
      : []
    const uploadsPlaylistId = asString(
      asRecord(asRecord(asRecord(channelItems[0])?.contentDetails)?.relatedPlaylists)?.uploads,
    )
    if (!uploadsPlaylistId) return { ok: true, posts: [] }

    const playlistRes = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/youtube/v3/playlistItems',
      method: 'GET',
      query: {
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: Math.min(ctx.limit, 25),
      },
    })
    const playlistItems = Array.isArray(asRecord(playlistRes?.data)?.items)
      ? (asRecord(playlistRes?.data)?.items as Array<unknown>)
      : []
    if (playlistItems.length === 0) return { ok: true, posts: [] }

    const entries: Array<{
      videoId: string
      title: string | null
      description: string | null
      publishedAt: unknown
    }> = []
    for (const raw of playlistItems) {
      const item = asRecord(raw)
      const snippet = asRecord(item?.snippet)
      const details = asRecord(item?.contentDetails)
      const videoId =
        asString(details?.videoId) ?? asString(asRecord(snippet?.resourceId)?.videoId)
      if (!videoId) continue
      entries.push({
        videoId,
        title: asString(snippet?.title),
        description: asString(snippet?.description),
        publishedAt: details?.videoPublishedAt ?? snippet?.publishedAt,
      })
    }
    if (entries.length === 0) return { ok: true, posts: [] }

    // Fetch statistics + duration for all videos in a single batched call.
    const statsById = new Map<
      string,
      { stats: Record<string, unknown> | null; durationSec: number | null }
    >()
    try {
      const videosRes = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/youtube/v3/videos',
        method: 'GET',
        query: {
          part: 'statistics,contentDetails',
          id: entries.map((e) => e.videoId).join(','),
        },
      })
      const videoItems = Array.isArray(asRecord(videosRes?.data)?.items)
        ? (asRecord(videosRes?.data)?.items as Array<unknown>)
        : []
      for (const raw of videoItems) {
        const row = asRecord(raw)
        const id = asString(row?.id)
        if (!id) continue
        statsById.set(id, {
          stats: asRecord(row?.statistics),
          durationSec: parseIsoDurationSeconds(
            asString(asRecord(row?.contentDetails)?.duration),
          ),
        })
      }
    } catch {
      // Proceed without initial stats; later metric sync can retry.
    }

    const now = new Date()
    const posts: Array<ImportedRemotePost> = entries.map((entry) => {
      const info = statsById.get(entry.videoId)
      const isShort = info?.durationSec != null && info.durationSec > 0 && info.durationSec <= 60
      const stats = info?.stats
      const views = asNonNegativeInt(stats?.viewCount)
      const likes = asNonNegativeInt(stats?.likeCount)
      const comments = asNonNegativeInt(stats?.commentCount)
      const saves = asNonNegativeInt(stats?.favoriteCount)
      const hasAnyMetric = views != null || likes != null || comments != null || saves != null

      return {
        remotePostId: entry.videoId,
        publishedUrl: isShort
          ? `https://youtube.com/shorts/${entry.videoId}`
          : `https://www.youtube.com/watch?v=${entry.videoId}`,
        title: buildImportedTitle(entry.title, 'youtube'),
        body: clampImportedBody(entry.description),
        format: isShort ? 'short' : 'video',
        publishedAt: parseDateOrNow(entry.publishedAt, now),
        initialMetrics: hasAnyMetric
          ? {
              views,
              reach: null,
              likes,
              comments,
              shares: null,
              saves,
              clicks: null,
              rawPayload: { statistics: stats ?? {} },
            }
          : null,
      }
    })

    return { ok: true, posts }
  } catch (error) {
    const outcome = handleAdapterError('youtube', error)
    return { ok: false, warning: outcome.ok ? '' : outcome.warning }
  }
}

/**
 * Networks that support free (`metered: false`) recent-post import via Treg.
 * X is intentionally excluded from automatic bulk import because Treg meters X API calls;
 * LinkedIn is excluded because `w_member_social` does not grant post-reading scopes.
 */
export const SOCIAL_POST_IMPORTERS: Partial<Record<SocialChannel, SocialPostImporter>> = {
  instagram: importInstagramPosts,
  tiktok: importTikTokPosts,
  youtube: importYouTubePosts,
}

/**
 * Imports recent already-published posts from connected Instagram, TikTok, and
 * YouTube accounts so `/analytics` populates immediately without waiting for
 * posts published through Zora. Fully idempotent (deduped by remotePostId and URL).
 */
export async function importRecentSocialPosts(
  deps: SocialMetricsDeps,
  input: { organizationId: string; channel?: SocialChannel; limitPerChannel?: number },
  now: Date = new Date(),
): Promise<ImportRecentPostsResult> {
  if (!deps.treg) {
    return { imported: 0, importedItemIds: [], importedWithSnapshotIds: [], warnings: [] }
  }

  const limit = Math.min(Math.max(input.limitPerChannel ?? 15, 1), 25)
  const connections = input.channel
    ? [await getWorkspaceConnection(deps.db, input.organizationId, input.channel)].filter(
        (c): c is SocialConnection => c !== null,
      )
    : await listWorkspaceConnections(deps.db, input.organizationId)

  const eligible = connections.filter((c) => c.status === 'connected')
  if (eligible.length === 0) {
    return { imported: 0, importedItemIds: [], importedWithSnapshotIds: [], warnings: [] }
  }

  const importedItemIds: Array<string> = []
  const importedWithSnapshotIds: Array<string> = []
  const warningSet = new Set<string>()

  for (const connection of eligible) {
    const importer =
      deps.importers?.[connection.channel] ?? SOCIAL_POST_IMPORTERS[connection.channel]
    if (!importer) continue

    const outcome = await importer({
      organizationId: input.organizationId,
      connection,
      treg: deps.treg,
      limit,
    })

    if (!outcome.ok) {
      if (outcome.warning) warningSet.add(outcome.warning)
      continue
    }
    if (outcome.posts.length === 0) continue

    const [existingJobs, existingItems] = await Promise.all([
      deps.db
        .select({ remotePostId: socialPublishJob.remotePostId })
        .from(socialPublishJob)
        .where(
          and(
            eq(socialPublishJob.organizationId, input.organizationId),
            eq(socialPublishJob.channel, connection.channel),
            isNotNull(socialPublishJob.remotePostId),
          ),
        ),
      deps.db
        .select({ publishedUrl: contentItem.publishedUrl })
        .from(contentItem)
        .where(
          and(
            eq(contentItem.organizationId, input.organizationId),
            eq(contentItem.channel, connection.channel),
            isNotNull(contentItem.publishedUrl),
          ),
        ),
    ])

    const seenRemoteIds = new Set(
      existingJobs.map((j) => j.remotePostId).filter((id): id is string => Boolean(id)),
    )
    const seenUrls = new Set(
      existingItems
        .map((item) => item.publishedUrl?.trim())
        .filter((u): u is string => Boolean(u)),
    )

    for (const post of outcome.posts) {
      const normalizedUrl = post.publishedUrl?.trim() || null
      if (seenRemoteIds.has(post.remotePostId)) continue
      if (normalizedUrl && seenUrls.has(normalizedUrl)) continue

      seenRemoteIds.add(post.remotePostId)
      if (normalizedUrl) seenUrls.add(normalizedUrl)

      const [insertedItem] = await deps.db
        .insert(contentItem)
        .values({
          organizationId: input.organizationId,
          title: post.title,
          channel: connection.channel,
          format: post.format,
          status: 'published',
          body: post.body,
          publishedAt: post.publishedAt,
          publishedUrl: normalizedUrl,
          createdById: connection.connectedById,
          createdAt: post.publishedAt,
          updatedAt: now,
        })
        .returning({ id: contentItem.id })

      if (!insertedItem) continue

      const [insertedJob] = await deps.db
        .insert(socialPublishJob)
        .values({
          organizationId: input.organizationId,
          contentItemId: insertedItem.id,
          connectionId: connection.id,
          channel: connection.channel,
          trigger: 'manual',
          triggeredById: connection.connectedById,
          status: 'published',
          stage: 'imported',
          remotePostId: post.remotePostId,
          publishedUrl: normalizedUrl,
          createdAt: post.publishedAt,
          updatedAt: now,
          finishedAt: post.publishedAt,
        })
        .returning({ id: socialPublishJob.id })

      importedItemIds.push(insertedItem.id)

      if (post.initialMetrics) {
        await persistSnapshot(deps.db, {
          organizationId: input.organizationId,
          contentItemId: insertedItem.id,
          publishJobId: insertedJob?.id ?? null,
          channel: connection.channel,
          remotePostId: post.remotePostId,
          metrics: post.initialMetrics,
          now,
        })
        importedWithSnapshotIds.push(insertedItem.id)
      }
    }
  }

  return {
    imported: importedItemIds.length,
    importedItemIds,
    importedWithSnapshotIds,
    warnings: Array.from(warningSet),
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function persistSnapshot(
  db: Database,
  input: {
    organizationId: string
    contentItemId: string
    publishJobId: string | null
    channel: SocialChannel
    remotePostId: string
    metrics: RawCollectedMetrics
    now: Date
  },
): Promise<SocialMetricSnapshot> {
  const engagementRateBps = computeEngagementRateBps(input.metrics)
  const [inserted] = await db
    .insert(socialMetricSnapshot)
    .values({
      organizationId: input.organizationId,
      contentItemId: input.contentItemId,
      publishJobId: input.publishJobId,
      channel: input.channel,
      remotePostId: input.remotePostId,
      views: input.metrics.views,
      reach: input.metrics.reach,
      likes: input.metrics.likes,
      comments: input.metrics.comments,
      shares: input.metrics.shares,
      saves: input.metrics.saves,
      clicks: input.metrics.clicks,
      avgWatchTimeMs: input.metrics.avgWatchTimeMs ?? null,
      engagementRateBps,
      rawPayload: input.metrics.rawPayload,
      collectedAt: input.now,
    })
    .returning()
  return toSnapshot(inserted!)
}

/**
 * Refreshes social metrics for a single published content item.
 */
export async function syncItemSocialMetrics(
  deps: SocialMetricsDeps,
  input: { organizationId: string; itemId: string },
  now: Date = new Date(),
): Promise<SyncItemMetricsResult> {
  if (!deps.treg) {
    return {
      snapshot: null,
      supported: false,
      warning: 'A integração com redes sociais não está configurada neste servidor.',
    }
  }

  const [job] = await deps.db
    .select()
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, input.organizationId),
        eq(socialPublishJob.contentItemId, input.itemId),
        eq(socialPublishJob.status, 'published'),
        isNotNull(socialPublishJob.remotePostId),
      ),
    )
    .orderBy(desc(socialPublishJob.finishedAt), desc(socialPublishJob.createdAt))
    .limit(1)

  if (!job?.remotePostId) {
    return {
      snapshot: null,
      supported: false,
      warning: 'Este conteúdo não foi publicado por uma conta conectada no Zora.',
    }
  }

  const connection = await getWorkspaceConnection(deps.db, input.organizationId, job.channel)
  if (!connection || connection.status !== 'connected') {
    return {
      snapshot: null,
      supported: false,
      warning: `Conecte sua conta do ${CHANNEL_LABELS[job.channel]} em Conexões para coletar métricas.`,
    }
  }

  const fetcher = deps.fetchers?.[job.channel] ?? SOCIAL_METRICS_FETCHERS[job.channel]
  const outcome = await fetcher({
    organizationId: input.organizationId,
    remotePostId: job.remotePostId,
    connection,
    treg: deps.treg,
  })

  if (!outcome.ok) {
    return {
      snapshot: null,
      supported: outcome.supported,
      warning: outcome.warning,
    }
  }

  const snapshot = await persistSnapshot(deps.db, {
    organizationId: input.organizationId,
    contentItemId: input.itemId,
    publishJobId: job.id,
    channel: job.channel,
    remotePostId: job.remotePostId,
    metrics: outcome.metrics,
    now,
  })

  return { snapshot, supported: true, warning: null }
}

/**
 * Refreshes metrics for the most recent published social items in a workspace.
 * Deduplicates warnings so the UI can show clean feedback.
 */
export async function syncWorkspaceSocialMetrics(
  deps: SocialMetricsDeps,
  input: { organizationId: string; limit?: number },
  now: Date = new Date(),
): Promise<SyncWorkspaceMetricsResult> {
  if (!deps.treg) {
    return {
      checked: 0,
      updated: 0,
      imported: 0,
      skipped: 0,
      warnings: ['A integração com redes sociais não está configurada neste servidor.'],
    }
  }

  const warningSet = new Set<string>()
  const importResult = await importRecentSocialPosts(
    deps,
    { organizationId: input.organizationId, limitPerChannel: 15 },
    now,
  )
  for (const w of importResult.warnings) warningSet.add(w)
  const freshlySnapshotted = new Set(importResult.importedWithSnapshotIds)

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 40)
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_MS)

  const jobs = await deps.db
    .select({
      id: socialPublishJob.id,
      contentItemId: socialPublishJob.contentItemId,
      channel: socialPublishJob.channel,
      remotePostId: socialPublishJob.remotePostId,
      finishedAt: socialPublishJob.finishedAt,
    })
    .from(socialPublishJob)
    .where(
      and(
        eq(socialPublishJob.organizationId, input.organizationId),
        eq(socialPublishJob.status, 'published'),
        isNotNull(socialPublishJob.remotePostId),
        gte(socialPublishJob.createdAt, cutoff),
      ),
    )
    .orderBy(desc(socialPublishJob.finishedAt), desc(socialPublishJob.createdAt))
    .limit(limit * 2)

  // Keep only the latest published job per content item, skipping items that
  // already received a fresh snapshot during the import step above.
  const seenItems = new Set<string>()
  const uniqueJobs = jobs
    .filter((job) => {
      if (
        !job.remotePostId ||
        seenItems.has(job.contentItemId) ||
        freshlySnapshotted.has(job.contentItemId)
      ) {
        return false
      }
      seenItems.add(job.contentItemId)
      return true
    })
    .slice(0, limit)

  let updated = freshlySnapshotted.size
  let skipped = 0

  for (const job of uniqueJobs) {
    const result = await syncItemSocialMetrics(
      deps,
      { organizationId: input.organizationId, itemId: job.contentItemId },
      now,
    )
    if (result.snapshot) {
      updated += 1
    } else {
      skipped += 1
      if (result.warning) warningSet.add(result.warning)
    }
  }

  return {
    checked: uniqueJobs.length + freshlySnapshotted.size,
    updated,
    imported: importResult.imported,
    skipped,
    warnings: Array.from(warningSet),
  }
}

/**
 * Background Cron sync: picks up to `batchLimit` stale published social items
 * across all workspaces and collects fresh metric snapshots.
 */
export async function runScheduledMetricsSync(
  deps: SocialMetricsDeps,
  now: Date = new Date(),
  batchLimit: number = 8,
): Promise<{ checked: number; updated: number; skipped: number }> {
  if (!deps.treg) return { checked: 0, updated: 0, skipped: 0 }

  const cutoff = new Date(now.getTime() - MAX_POST_AGE_MS)
  const candidates = await deps.db
    .select({
      organizationId: socialPublishJob.organizationId,
      contentItemId: socialPublishJob.contentItemId,
      channel: socialPublishJob.channel,
      remotePostId: socialPublishJob.remotePostId,
      finishedAt: socialPublishJob.finishedAt,
      createdAt: socialPublishJob.createdAt,
    })
    .from(socialPublishJob)
    .innerJoin(contentItem, eq(contentItem.id, socialPublishJob.contentItemId))
    .innerJoin(
      socialConnection,
      and(
        eq(socialConnection.organizationId, socialPublishJob.organizationId),
        eq(socialConnection.channel, socialPublishJob.channel),
        eq(socialConnection.status, 'connected'),
      ),
    )
    .where(
      and(
        eq(socialPublishJob.status, 'published'),
        isNotNull(socialPublishJob.remotePostId),
        gte(socialPublishJob.createdAt, cutoff),
      ),
    )
    .orderBy(desc(socialPublishJob.finishedAt), desc(socialPublishJob.createdAt))
    .limit(60)

  const seen = new Set<string>()
  const uniqueCandidates = candidates.filter((row) => {
    if (!isSocialChannel(row.channel) || !row.remotePostId || seen.has(row.contentItemId)) {
      return false
    }
    seen.add(row.contentItemId)
    return true
  })

  if (uniqueCandidates.length === 0) {
    return { checked: 0, updated: 0, skipped: 0 }
  }

  const itemIds = uniqueCandidates.map((row) => row.contentItemId)
  const existingSnapshots = await deps.db
    .select({
      contentItemId: socialMetricSnapshot.contentItemId,
      collectedAt: socialMetricSnapshot.collectedAt,
    })
    .from(socialMetricSnapshot)
    .where(inArray(socialMetricSnapshot.contentItemId, itemIds))
    .orderBy(desc(socialMetricSnapshot.collectedAt))

  const latestByItem = new Map<string, Date>()
  for (const snap of existingSnapshots) {
    if (!latestByItem.has(snap.contentItemId)) {
      latestByItem.set(snap.contentItemId, snap.collectedAt)
    }
  }

  const due = uniqueCandidates
    .filter((candidate) => {
      const last = latestByItem.get(candidate.contentItemId)
      if (!last) return true
      const publishedAt = candidate.finishedAt ?? candidate.createdAt
      const ageMs = now.getTime() - publishedAt.getTime()
      const minInterval = ageMs <= RECENT_POST_AGE_MS ? RECENT_MIN_INTERVAL_MS : OLDER_MIN_INTERVAL_MS
      return now.getTime() - last.getTime() >= minInterval
    })
    .slice(0, batchLimit)

  let updated = 0
  let skipped = 0
  for (const candidate of due) {
    const res = await syncItemSocialMetrics(
      deps,
      { organizationId: candidate.organizationId, itemId: candidate.contentItemId },
      now,
    )
    if (res.snapshot) updated += 1
    else skipped += 1
  }

  return { checked: due.length, updated, skipped }
}
