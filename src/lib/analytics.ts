/**
 * Shared analytics module: period options, search-param schemas, DTO types,
 * engagement math, and friendly pt-BR formatting helpers. Client-safe;
 * imported by server services, server functions, MCP tools, and UI components.
 */
import { z } from 'zod'
import type {
  ChannelMetricGuide,
  ChannelSignalMetric,
  PostDiagnosis,
} from './analytics-signals'
import { CHANNELS } from './content'
import type { Channel, ContentFormat, ContentStatus } from './content'
import type { SocialChannel } from './social'

// ---------------------------------------------------------------------------
// Periods and filters
// ---------------------------------------------------------------------------

export const ANALYTICS_PERIODS = ['7d', '30d', '90d', 'all'] as const
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  all: 'Tudo',
}

export const ANALYTICS_PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export const analyticsFiltersSchema = z.object({
  period: z.enum(ANALYTICS_PERIODS).default('30d'),
  channel: z.enum(CHANNELS).optional(),
})
export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>

export const analyticsSearchSchema = z.object({
  period: z.enum(ANALYTICS_PERIODS).catch('30d'),
  channel: z.enum(CHANNELS).optional().catch(undefined),
})
export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>

// ---------------------------------------------------------------------------
// Metric snapshots and engagement math
// ---------------------------------------------------------------------------

export type SocialMetricSnapshot = {
  id: string
  contentItemId: string
  publishJobId: string | null
  channel: SocialChannel
  remotePostId: string
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  /** Average watch time in milliseconds (Instagram Reels), or null when unavailable. */
  avgWatchTimeMs: number | null
  /** Engagement rate in percentage (e.g. 4.25 = 4.25%), or null when denominator is unavailable. */
  engagementRate: number | null
  collectedAt: Date
}

/** Total public/trackable interactions on a post (likes + comments + shares + saves). */
export function sumInteractions(metrics: {
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
}): number {
  return (
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.saves ?? 0)
  )
}

/**
 * Computes engagement rate in basis points (100 bps = 1.00%). Prefers `reach`
 * when present, falling back to `views`. Returns null when no exposure metric
 * is positive.
 */
export function computeEngagementRateBps(metrics: {
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
}): number | null {
  const base =
    metrics.reach != null && metrics.reach > 0
      ? metrics.reach
      : metrics.views != null && metrics.views > 0
        ? metrics.views
        : null
  if (!base) return null
  const interactions = sumInteractions(metrics)
  return Math.round((interactions / base) * 10_000)
}

export function bpsToPercent(bps: number | null): number | null {
  if (bps == null) return null
  return Number((bps / 100).toFixed(2))
}

// ---------------------------------------------------------------------------
// Workspace & item analytics DTOs
// ---------------------------------------------------------------------------

export type AnalyticsInsightTone = 'positive' | 'attention' | 'info'

export type AnalyticsInsight = {
  id: string
  tone: AnalyticsInsightTone
  title: string
  description: string
  action?: {
    label: string
    to: '/calendar' | '/pipeline' | '/content' | '/connections'
    search?: {
      statuses?: Array<ContentStatus>
      channels?: Array<Channel>
    }
  }
}

export type AnalyticsKpis = {
  publishedCount: number
  previousPublishedCount: number | null
  publishedDeltaPct: number | null
  scheduledUpcoming7d: number
  inProgressCount: number
  avgLeadTimeHours: number | null
  previousAvgLeadTimeHours: number | null
  publishSuccessRate: number | null
  publishSuccessCount: number
  publishFailedCount: number
  totalViews: number
  totalReach: number
  totalInteractions: number
  avgEngagementRate: number | null
  trackedPostsCount: number
  lastSyncedAt: Date | null
}

export type CadenceBucket = {
  /** ISO date (`YYYY-MM-DD`, UTC start of bucket). */
  key: string
  /** Short pt-BR label for axis/tooltip (e.g. "12 nov" or "Sem 46"). */
  label: string
  published: number
  scheduled: number
  views: number
  interactions: number
}

export type PipelineStageMetric = {
  status: ContentStatus
  count: number
  staleCount: number
}

export type ChannelMetric = {
  channel: Channel
  published: number
  scheduled: number
  inProgress: number
  views: number
  interactions: number
  avgEngagementRate: number | null
  avgLeadTimeHours: number | null
  trackedPosts: number
  /** Top platform-native signal for this channel (e.g. sends/reach on Instagram). */
  primarySignal: ChannelSignalMetric | null
}

export type FormatMetric = {
  format: ContentFormat
  published: number
  views: number
  interactions: number
  avgEngagementRate: number | null
}

export type WeekdayRhythm = {
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number
  label: string
  shortLabel: string
  published: number
  avgInteractions: number | null
}

export type TeamMemberMetric = {
  memberId: string
  name: string
  published: number
  inProgress: number
  designsCreated: number
  photoEditsCreated: number
}

export type HumanVsAgentMetric = {
  designVersionsHuman: number
  designVersionsAgent: number
  photoVersionsHuman: number
  photoVersionsAgent: number
  publishesManual: number
  publishesScheduled: number
  publishesMcp: number
}

export type TopContentEntry = {
  id: string
  title: string
  channel: Channel
  format: ContentFormat
  publishedAt: Date | null
  publishedUrl: string | null
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  avgWatchTimeMs: number | null
  interactions: number
  engagementRate: number | null
  hasMetrics: boolean
  collectedAt: Date | null
  signals: Array<ChannelSignalMetric>
  diagnosis: PostDiagnosis | null
}

export type ChannelSpotlight = {
  channel: Channel
  guide: ChannelMetricGuide
  signals: Array<ChannelSignalMetric>
  trackedPosts: number
}

export type RecentPublishFailure = {
  jobId: string
  contentItemId: string
  itemTitle: string
  channel: SocialChannel
  errorMessage: string
  failedAt: Date
}

export type WorkspaceAnalytics = {
  period: AnalyticsPeriod
  channel: Channel | null
  generatedAt: Date
  rangeStart: Date | null
  rangeEnd: Date
  kpis: AnalyticsKpis
  insights: Array<AnalyticsInsight>
  /** Platform-native metrics & beginner guide for the selected (or sole active) channel. */
  channelSpotlight: ChannelSpotlight | null
  cadence: Array<CadenceBucket>
  pipeline: Array<PipelineStageMetric>
  channels: Array<ChannelMetric>
  formats: Array<FormatMetric>
  weekdayRhythm: Array<WeekdayRhythm>
  team: Array<TeamMemberMetric>
  collaboration: HumanVsAgentMetric
  topContent: Array<TopContentEntry>
  recentFailures: Array<RecentPublishFailure>
  connectedSocialChannels: Array<SocialChannel>
}

export type ItemAnalytics = {
  contentItemId: string
  channel: Channel
  guide: ChannelMetricGuide
  latest: SocialMetricSnapshot | null
  history: Array<SocialMetricSnapshot>
  signals: Array<ChannelSignalMetric>
  diagnosis: PostDiagnosis | null
  /** Delta between latest and earliest snapshot when >= 2 snapshots exist. */
  growth: {
    views: number | null
    likes: number | null
    comments: number | null
    shares: number | null
    interactions: number
  } | null
  editorial: {
    leadTimeHours: number | null
    designVersionsCount: number
    photoEditVersionsCount: number
    publishAttempts: number
    channelAvgEngagementRate: number | null
  }
  canSync: boolean
  remotePostId: string | null
  remoteDeletedAt: Date | null
}

export type SyncItemMetricsResult = {
  snapshot: SocialMetricSnapshot | null
  supported: boolean
  warning: string | null
}

export type SyncWorkspaceMetricsResult = {
  checked: number
  updated: number
  imported: number
  skipped: number
  warnings: Array<string>
}

// ---------------------------------------------------------------------------
// Friendly pt-BR formatters
// ---------------------------------------------------------------------------

const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatCompactNumber(value: number): string {
  if (Math.abs(value) < 1000) return integerFormatter.format(Math.round(value))
  return compactFormatter.format(value)
}

export function formatInteger(value: number): string {
  return integerFormatter.format(Math.round(value))
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`
}

export function formatDeltaPct(deltaPct: number | null): string | null {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return null
  const rounded = Math.round(deltaPct)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

/** Human-friendly duration in pt-BR, e.g. "4 h", "2,5 dias", "menos de 1 h". */
export function formatLeadTime(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—'
  if (hours < 1) return 'menos de 1 h'
  if (hours < 48) return `${Math.round(hours)} h`
  const days = hours / 24
  if (days < 10) {
    return `${days.toFixed(1).replace('.', ',')} dias`
  }
  return `${Math.round(days)} dias`
}
