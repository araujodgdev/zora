/**
 * Shared social publishing module: supported social channels, connection and
 * publish-job types, validation schemas, channel metadata and pre-flight
 * checks. Client-safe; imported by the database schema, server functions,
 * MCP server and UI.
 */
import { z } from 'zod'
import type { Channel, ContentFormat, ContentItem } from './content'
import { assetKind } from './content-assets'
import type { ContentAsset } from './content-assets'

// ---------------------------------------------------------------------------
// Enumerations and labels
// ---------------------------------------------------------------------------

/** Channels that support direct publishing via a connected social account. */
export const SOCIAL_CHANNELS = [
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
] as const
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number]

export function isSocialChannel(channel: Channel): channel is SocialChannel {
  return (SOCIAL_CHANNELS as ReadonlyArray<string>).includes(channel)
}

/** Channels whose official API + Treg OAuth scopes support deleting a published post. */
export function supportsRemoteDelete(channel: Channel): boolean {
  return channel === 'x'
}

/**
 * Backing provider of a social connection. Every connection starts on `treg`
 * (`https://treg.to`); adding `'native'` later lets any channel migrate to a
 * first-party OAuth app without changing the DB contract or UI.
 */
export const SOCIAL_PROVIDERS = ['treg'] as const
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]

export const SOCIAL_CONNECTION_STATUSES = [
  'pending',
  'needs_resource',
  'connected',
  'error',
] as const
export type SocialConnectionStatus = (typeof SOCIAL_CONNECTION_STATUSES)[number]

export const SOCIAL_CONNECTION_STATUS_LABELS: Record<SocialConnectionStatus, string> = {
  pending: 'Aguardando autorização…',
  needs_resource: 'Escolher canal',
  connected: 'Conectado',
  error: 'Precisa reconectar',
}

export const SOCIAL_PUBLISH_TRIGGERS = ['manual', 'scheduled', 'mcp'] as const
export type SocialPublishTrigger = (typeof SOCIAL_PUBLISH_TRIGGERS)[number]

export const SOCIAL_PUBLISH_STATUSES = [
  'pending',
  'processing',
  'published',
  'failed',
] as const
export type SocialPublishStatus = (typeof SOCIAL_PUBLISH_STATUSES)[number]

export const SOCIAL_PUBLISH_STATUS_LABELS: Record<SocialPublishStatus, string> = {
  pending: 'Na fila',
  processing: 'Processando na rede',
  published: 'Publicado',
  failed: 'Falhou',
}

export const TIKTOK_MODES = ['direct', 'inbox'] as const
export type TikTokPublishMode = (typeof TIKTOK_MODES)[number]

export const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const
export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number]

export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Público (todos)',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores mútuos)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu (privado)',
}

export const YOUTUBE_PRIVACY_STATUSES = ['public', 'unlisted', 'private'] as const
export type YouTubePrivacyStatus = (typeof YOUTUBE_PRIVACY_STATUSES)[number]

export const YOUTUBE_PRIVACY_LABELS: Record<YouTubePrivacyStatus, string> = {
  public: 'Público',
  unlisted: 'Não listado',
  private: 'Privado',
}

export const LINKEDIN_VISIBILITIES = ['PUBLIC', 'CONNECTIONS'] as const
export type LinkedInVisibility = (typeof LINKEDIN_VISIBILITIES)[number]

export const LINKEDIN_VISIBILITY_LABELS: Record<LinkedInVisibility, string> = {
  PUBLIC: 'Público',
  CONNECTIONS: 'Apenas conexões',
}

/** Human-facing notes shown on `/connections` and in the publish dialog. */
export const SOCIAL_CHANNEL_INFO: Record<
  SocialChannel,
  {
    summary: string
    caveat: string
    defaultCapability: string
    supportsResourcePicker: boolean
  }
> = {
  instagram: {
    summary: 'Publica Posts (imagem), Carrosséis (2 a 10 mídias), Reels e Stories.',
    caveat: 'Exige conta Profissional (Business ou Creator). Mídias são enviadas via URL temporária.',
    defaultCapability: 'post',
    supportsResourcePicker: false,
  },
  tiktok: {
    summary: 'Publica vídeos diretamente no perfil ou envia como rascunho para o Inbox.',
    caveat: 'Somente vídeo (MP4, MOV ou WebM). Posts de foto ainda não são suportados.',
    defaultCapability: 'post',
    supportsResourcePicker: false,
  },
  youtube: {
    summary: 'Envia vídeos e Shorts, com thumbnail personalizada opcional.',
    caveat: 'Vídeos até 100 MB (limite atual de mídia do Zora). Thumbnail exige canal verificado.',
    defaultCapability: 'post',
    supportsResourcePicker: true,
  },
  linkedin: {
    summary: 'Publica texto, imagem, múltiplas imagens, vídeo e carrossel em PDF.',
    caveat: 'Publica apenas no perfil pessoal conectado (Páginas de Empresa ainda não disponíveis).',
    defaultCapability: 'write',
    supportsResourcePicker: false,
  },
  x: {
    summary: 'Publica posts de texto e threads (separe tweets com uma linha ---).',
    caveat: 'No momento, a publicação no X envia apenas texto (sem imagens ou vídeos).',
    defaultCapability: 'write',
    supportsResourcePicker: false,
  },
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SocialConnectionMeta = {
  capabilities?: Array<string>
  scopesInReview?: Array<string>
  reviewNote?: string | null
  authorizationMethod?: string | null
  health?: string | null
  expiresAt?: string | null
  connectGuidance?: string | null
  lastError?: string | null
}

/** A workspace's connected social account (metadata only — never holds tokens). */
export type SocialConnection = {
  id: string
  organizationId: string
  channel: SocialChannel
  provider: SocialProvider
  externalSecretId: number | null
  externalToolName: string
  status: SocialConnectionStatus
  accountId: string | null
  accountName: string | null
  accountMeta: SocialConnectionMeta
  connectedById: string
  createdAt: Date
  updatedAt: Date
}

/** An upstream resource (e.g. a YouTube channel) that can be picked for a connection. */
export type SocialResourceOption = {
  id: string
  name: string
}

export type SocialPublishOptions = {
  tiktok?: {
    mode?: TikTokPublishMode
    privacyLevel?: TikTokPrivacyLevel
    disableComment?: boolean
    disableDuet?: boolean
    disableStitch?: boolean
    isAigc?: boolean
  }
  youtube?: {
    privacyStatus?: YouTubePrivacyStatus
    selfDeclaredMadeForKids?: boolean
    thumbnailAssetId?: string | null
    notifySubscribers?: boolean
  }
  linkedin?: {
    visibility?: LinkedInVisibility
  }
}

export type SocialPublishProviderState = {
  /** Instagram container id (or child ids while staging a carousel). */
  containerId?: string
  childContainerIds?: Array<string>
  igUserId?: string
  /** TikTok publish_id returned by init. */
  publishId?: string
  tiktokMode?: TikTokPublishMode
  tiktokUsername?: string
  /** LinkedIn video/document URN waiting to become AVAILABLE. */
  linkedinMediaUrn?: string
  linkedinMediaKind?: 'video' | 'document'
  linkedinAuthorUrn?: string
  linkedinReadyAfterMs?: number
  /** All tweet ids posted for an X post or thread (first is `remotePostId`). */
  remoteTweetIds?: Array<string>
  /** ISO timestamp recorded when the network confirmed this post was deleted. */
  remoteDeletedAt?: string
  /** Audit trail of treg call ids and total metered micro-USD. */
  tregCallIds?: Array<string>
  costMicro?: number
  /** Informational note (e.g. TikTok inbox 24h reminder). */
  note?: string
}

/** One publication attempt (or in-flight async job) of a content item. */
export type SocialPublishJob = {
  id: string
  organizationId: string
  contentItemId: string
  connectionId: string | null
  channel: SocialChannel
  trigger: SocialPublishTrigger
  triggeredById: string | null
  status: SocialPublishStatus
  stage: string
  options: SocialPublishOptions
  providerState: SocialPublishProviderState
  remotePostId: string | null
  publishedUrl: string | null
  errorMessage: string | null
  attempts: number
  nextPollAt: Date | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const uuid = z.uuid()
export const socialChannelSchema = z.enum(SOCIAL_CHANNELS)

export const startSocialConnectionSchema = z.object({
  channel: socialChannelSchema,
  capability: z.string().trim().min(1).max(40).optional(),
})
export type StartSocialConnectionInput = z.input<typeof startSocialConnectionSchema>

export const pollSocialConnectionSchema = z.object({
  channel: socialChannelSchema,
})

export const selectSocialResourceSchema = z.object({
  channel: socialChannelSchema,
  resourceRef: z.string().trim().min(1).max(300),
  resourceName: z.string().trim().max(300).optional(),
})
export type SelectSocialResourceInput = z.input<typeof selectSocialResourceSchema>

export const disconnectSocialConnectionSchema = z.object({
  channel: socialChannelSchema,
})

export const socialPublishOptionsSchema = z
  .object({
    tiktok: z
      .object({
        mode: z.enum(TIKTOK_MODES).optional(),
        privacyLevel: z.enum(TIKTOK_PRIVACY_LEVELS).optional(),
        disableComment: z.boolean().optional(),
        disableDuet: z.boolean().optional(),
        disableStitch: z.boolean().optional(),
        isAigc: z.boolean().optional(),
      })
      .optional(),
    youtube: z
      .object({
        privacyStatus: z.enum(YOUTUBE_PRIVACY_STATUSES).optional(),
        selfDeclaredMadeForKids: z.boolean().optional(),
        thumbnailAssetId: uuid.nullable().optional(),
        notifySubscribers: z.boolean().optional(),
      })
      .optional(),
    linkedin: z
      .object({
        visibility: z.enum(LINKEDIN_VISIBILITIES).optional(),
      })
      .optional(),
  })
  .default({})

export const publishContentItemSchema = z.object({
  itemId: uuid,
  options: socialPublishOptionsSchema.optional(),
})
export type PublishContentItemInput = z.input<typeof publishContentItemSchema>

export const listItemPublishJobsSchema = z.object({
  itemId: uuid,
})

export const pollPublishJobSchema = z.object({
  jobId: uuid,
})

// ---------------------------------------------------------------------------
// Helpers: tool naming, thread splitting and pre-flight validation
// ---------------------------------------------------------------------------

/** Deterministic 32-bit FNV-1a hex hash so connection names never collide across workspaces. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The stable, valid treg connection/tool name for one workspace + channel,
 * e.g. `zora-instagram-a1b2c3d4`. Strictly lowercase `[a-z0-9-]`.
 */
export function buildTregConnectionName(
  organizationId: string,
  channel: SocialChannel,
): string {
  const clean = organizationId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12)
  const suffix = clean ? `${clean}-${shortHash(organizationId)}` : shortHash(organizationId)
  return `zora-${channel}-${suffix}`
}

/**
 * Splits a thread body into individual tweets. A line containing only `---`
 * (three or more hyphens) separates consecutive tweets in the thread.
 */
export function splitXThread(body: string): Array<string> {
  return body
    .split(/\r?\n\s*-{3,}\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export type PublishPreflight = {
  errors: Array<string>
  warnings: Array<string>
}

export type PublishableItemSnapshot = Pick<
  ContentItem,
  'title' | 'body' | 'channel' | 'format'
>

/**
 * Checks whether an item and its uploaded media can be published to its
 * channel. Shared by the UI (instant guidance in the publish dialog) and
 * the server (authoritative guard before calling any upstream API).
 */
export function validateItemForSocialPublish(
  item: PublishableItemSnapshot,
  assets: ReadonlyArray<Pick<ContentAsset, 'id' | 'filename' | 'contentType' | 'size'>>,
): PublishPreflight {
  const errors: Array<string> = []
  const warnings: Array<string> = []

  if (!isSocialChannel(item.channel)) {
    errors.push('O canal Blog não suporta publicação automática em redes sociais.')
    return { errors, warnings }
  }

  const images = assets.filter((asset) => assetKind(asset.contentType) === 'image')
  const videos = assets.filter((asset) => assetKind(asset.contentType) === 'video')
  const docs = assets.filter((asset) => assetKind(asset.contentType) === 'document')
  const body = item.body.trim()

  switch (item.channel) {
    case 'x': {
      const tweets = item.format === 'thread' ? splitXThread(body) : body ? [body] : []
      if (tweets.length === 0) {
        errors.push('Escreva o texto do post antes de publicar no X.')
      }
      if (assets.length > 0) {
        warnings.push(
          'A publicação no X envia apenas texto no momento: imagens e vídeos não serão enviados.',
        )
      }
      break
    }

    case 'linkedin': {
      if (!body && assets.length === 0) {
        errors.push('Adicione texto ou pelo menos uma mídia antes de publicar no LinkedIn.')
      }
      if (videos.length > 1) {
        warnings.push('Apenas o primeiro vídeo será enviado no post do LinkedIn.')
      } else if (videos.length === 0 && docs.length > 1) {
        warnings.push('Apenas o primeiro PDF será enviado como carrossel de documento no LinkedIn.')
      }
      if (videos.length > 0 && (images.length > 0 || docs.length > 0)) {
        warnings.push('O LinkedIn aceita um tipo de mídia por post: o vídeo terá prioridade.')
      }
      break
    }

    case 'instagram': {
      const visualAssets = [...images, ...videos]
      if (item.format === 'reel') {
        if (videos.length === 0) {
          errors.push('Um Reel do Instagram precisa de um vídeo (MP4 ou MOV) na mídia do item.')
        }
      } else if (item.format === 'carousel') {
        if (visualAssets.length < 2 || visualAssets.length > 10) {
          errors.push('Um carrossel do Instagram precisa de 2 a 10 imagens ou vídeos.')
        }
      } else if (item.format === 'story') {
        if (visualAssets.length === 0) {
          errors.push('Um Story do Instagram precisa de uma imagem ou vídeo.')
        }
      } else if (visualAssets.length === 0) {
        errors.push('O Instagram exige pelo menos uma imagem ou vídeo para publicar.')
      } else if (visualAssets.length > 10) {
        errors.push('O Instagram aceita no máximo 10 mídias em um carrossel.')
      }
      const oversized = visualAssets.find((asset) => asset.size > 30 * 1024 * 1024)
      if (oversized) {
        errors.push(
          `“${oversized.filename}” passa de 30 MB, limite de tamanho de mídia para publicação no Instagram.`,
        )
      }
      const nonJpegImage = images.find((asset) => asset.contentType !== 'image/jpeg')
      if (nonJpegImage) {
        warnings.push(
          `A API do Instagram recomenda imagens JPEG (“${nonJpegImage.filename}” é ${nonJpegImage.contentType}). Se a Meta recusar, converta para JPG.`,
        )
      }
      break
    }

    case 'tiktok': {
      if (videos.length === 0) {
        errors.push('O TikTok exige um arquivo de vídeo (MP4, MOV ou WebM) na mídia do item.')
      }
      if (videos.length > 1) {
        warnings.push('Apenas o primeiro vídeo será enviado ao TikTok.')
      }
      break
    }

    case 'youtube': {
      if (videos.length === 0) {
        errors.push('O YouTube exige um arquivo de vídeo na mídia do item.')
      }
      if (item.title.trim().length > 100) {
        errors.push('O título no YouTube pode ter no máximo 100 caracteres.')
      }
      if (videos.length > 1) {
        warnings.push('Apenas o primeiro vídeo será enviado ao YouTube.')
      }
      break
    }
  }

  return { errors, warnings }
}

/** Suggested default formats per channel (non-restrictive helper). */
export const CHANNEL_DEFAULT_FORMAT: Record<Channel, ContentFormat> = {
  x: 'post',
  linkedin: 'post',
  instagram: 'post',
  tiktok: 'video',
  youtube: 'video',
  blog: 'article',
}
