/**
 * Social channel publishers behind a provider-agnostic `SocialPublisher`
 * interface. Each channel implements `start()` and optionally `poll()` for
 * asynchronous media transcoding (Instagram Reels/video, TikTok, LinkedIn
 * video/PDF).
 *
 * Today every adapter calls upstream APIs through `TregClient`; migrating any
 * single channel to a first-party OAuth app later only replaces its adapter.
 */
import type { ContentItem } from './content'
import { assetKind } from './content-assets'
import type { ContentAsset } from './content-assets'
import { splitXThread } from './social'
import type {
  SocialChannel,
  SocialConnection,
  SocialPublishOptions,
  SocialPublishProviderState,
  TikTokPrivacyLevel,
} from './social'
import { SocialPublishingError, TregApiError } from './treg.server'
import type { TregClient, TregToolCallResult } from './treg.server'

/** LinkedIn REST API version header (`YYYYMM`, retired quarterly by LinkedIn). */
export const LINKEDIN_API_VERSION = '202601'

const LINKEDIN_VIDEO_PART_BYTES = 2 * 1024 * 1024
const TIKTOK_SINGLE_CHUNK_MAX_BYTES = 64 * 1024 * 1024
const TIKTOK_MULTI_CHUNK_BYTES = 10 * 1024 * 1024
const YOUTUBE_MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
const DIRECT_UPLOAD_TIMEOUT_MS = 120_000

export type PublishContext = {
  organizationId: string
  jobId: string
  item: ContentItem
  assets: ReadonlyArray<ContentAsset>
  connection: SocialConnection
  options: SocialPublishOptions
  readAssetBytes: (asset: ContentAsset) => Promise<Uint8Array>
  treg: TregClient
  rawFetch: typeof fetch
  now: Date
}

export type PublishStepResult =
  | {
      status: 'published'
      remotePostId: string | null
      publishedUrl: string | null
      providerState: SocialPublishProviderState
    }
  | {
      status: 'processing'
      stage: string
      nextPollDelayMs: number
      providerState: SocialPublishProviderState
    }

export type SocialPublisher = {
  start(ctx: PublishContext): Promise<PublishStepResult>
  poll?(ctx: PublishContext, state: SocialPublishProviderState): Promise<PublishStepResult>
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function recordCall(
  state: SocialPublishProviderState,
  result: Pick<TregToolCallResult, 'callId' | 'costMicro'>,
): SocialPublishProviderState {
  const callIds = [...(state.tregCallIds ?? [])]
  if (result.callId) callIds.push(result.callId)
  return {
    ...state,
    tregCallIds: callIds,
    costMicro: (state.costMicro ?? 0) + result.costMicro,
  }
}

async function putDirectBytes(
  rawFetch: typeof fetch,
  url: string,
  bytes: Uint8Array,
  headers: Record<string, string>,
  label: string,
): Promise<Response> {
  let response: Response
  try {
    response = await rawFetch(url, {
      method: 'PUT',
      headers,
      body: toArrayBuffer(bytes),
      signal: AbortSignal.timeout(DIRECT_UPLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    console.error(`[social] direct PUT failed (${label}):`, error)
    throw new SocialPublishingError(`Falha ao enviar o arquivo de mídia (${label}). Tente novamente.`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new SocialPublishingError(
      `Falha ao enviar o arquivo de mídia (${label}, HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    )
  }
  return response
}

/** Escapes LinkedIn Little Text reserved characters (`\ ( ) [ ] { } < > @ | ~`). */
export function escapeLinkedInCommentary(text: string): string {
  return text.replace(/([\\()[\]{}<>@|~])/g, '\\$1')
}

/** Calculates TikTok's strict chunk layout (5–64 MB; <= 64 MB goes as 1 chunk). */
export function computeTikTokChunks(size: number): {
  chunkSize: number
  totalChunkCount: number
} {
  if (size <= TIKTOK_SINGLE_CHUNK_MAX_BYTES) {
    return { chunkSize: size, totalChunkCount: 1 }
  }
  const chunkSize = TIKTOK_MULTI_CHUNK_BYTES
  return { chunkSize, totalChunkCount: Math.floor(size / chunkSize) }
}

// ---------------------------------------------------------------------------
// X (Twitter)
// ---------------------------------------------------------------------------

const xPublisher: SocialPublisher = {
  async start(ctx) {
    const body = ctx.item.body.trim()
    const tweets = ctx.item.format === 'thread' ? splitXThread(body) : body ? [body] : []
    if (tweets.length === 0) {
      throw new SocialPublishingError('Escreva o texto do post antes de publicar no X.')
    }

    let state: SocialPublishProviderState = {}
    let firstId: string | null = null
    let prevId: string | null = null

    for (let i = 0; i < tweets.length; i += 1) {
      const payload: Record<string, unknown> = { text: tweets[i] }
      if (prevId) {
        payload.reply = { in_reply_to_tweet_id: prevId }
      }
      const res = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/2/tweets',
        method: 'POST',
        body: payload,
        idempotencyKey: `${ctx.jobId}-x-${i}`,
      })
      state = recordCall(state, res)
      const tweetId = asString(asRecord(asRecord(res.data)?.data)?.id)
      if (!tweetId) {
        throw new SocialPublishingError('O X não retornou o identificador do post publicado.')
      }
      if (!firstId) firstId = tweetId
      prevId = tweetId
    }

    const handle = ctx.connection.accountName?.replace(/^@/, '').trim()
    const publishedUrl = handle
      ? `https://x.com/${encodeURIComponent(handle)}/status/${firstId}`
      : `https://x.com/i/web/status/${firstId}`

    return {
      status: 'published',
      remotePostId: firstId,
      publishedUrl,
      providerState: state,
    }
  },
}

// ---------------------------------------------------------------------------
// LinkedIn (personal profile via /rest/posts)
// ---------------------------------------------------------------------------

const linkedinHeaders = {
  'LinkedIn-Version': LINKEDIN_API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
}

async function resolveLinkedInAuthorUrn(
  ctx: PublishContext,
  state: SocialPublishProviderState,
): Promise<{ authorUrn: string; state: SocialPublishProviderState }> {
  const saved = ctx.connection.accountId?.trim()
  if (saved) {
    return {
      authorUrn: saved.startsWith('urn:li:') ? saved : `urn:li:person:${saved}`,
      state,
    }
  }
  const profile = await ctx.treg.callTool({
    organizationId: ctx.organizationId,
    toolName: ctx.connection.externalToolName,
    path: '/v2/userinfo',
    method: 'GET',
  })
  const sub = asString(asRecord(profile.data)?.sub)
  if (!sub) {
    throw new SocialPublishingError(
      'Não foi possível identificar o perfil do LinkedIn conectado. Reconecte a conta em Conexões.',
    )
  }
  return {
    authorUrn: `urn:li:person:${sub}`,
    state: recordCall(state, profile),
  }
}

async function postLinkedInShare(
  ctx: PublishContext,
  authorUrn: string,
  state: SocialPublishProviderState,
  content?: Record<string, unknown>,
): Promise<PublishStepResult> {
  const payload: Record<string, unknown> = {
    author: authorUrn,
    commentary: escapeLinkedInCommentary(ctx.item.body.trim()),
    visibility: ctx.options.linkedin?.visibility ?? 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  if (content) payload.content = content

  const res = await ctx.treg.callTool({
    organizationId: ctx.organizationId,
    toolName: ctx.connection.externalToolName,
    path: '/rest/posts',
    method: 'POST',
    headers: linkedinHeaders,
    body: payload,
    idempotencyKey: `${ctx.jobId}-li-post`,
  })
  const nextState = recordCall(state, res)
  const postUrn =
    res.headers.get('x-restli-id')?.trim() || asString(asRecord(res.data)?.id) || null
  const publishedUrl = postUrn
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`
    : null

  return {
    status: 'published',
    remotePostId: postUrn,
    publishedUrl,
    providerState: nextState,
  }
}

const linkedinPublisher: SocialPublisher = {
  async start(ctx) {
    let state: SocialPublishProviderState = {}
    const resolved = await resolveLinkedInAuthorUrn(ctx, state)
    const authorUrn = resolved.authorUrn
    state = resolved.state

    const videos = ctx.assets.filter((asset) => assetKind(asset.contentType) === 'video')
    const docs = ctx.assets.filter((asset) => assetKind(asset.contentType) === 'document')
    const images = ctx.assets.filter((asset) => assetKind(asset.contentType) === 'image')

    // 1. Video upload (chunked 2 MB parts + finalize + async processing wait).
    if (videos.length > 0) {
      const video = videos[0]!
      const bytes = await ctx.readAssetBytes(video)
      const init = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/rest/videos',
        method: 'POST',
        query: { action: 'initializeUpload' },
        headers: linkedinHeaders,
        body: {
          initializeUploadRequest: {
            owner: authorUrn,
            fileSizeBytes: bytes.byteLength,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        },
        idempotencyKey: `${ctx.jobId}-li-video-init`,
      })
      state = recordCall(state, init)
      const value = asRecord(asRecord(init.data)?.value)
      const videoUrn = asString(value?.video)
      const instructions = Array.isArray(value?.uploadInstructions)
        ? value.uploadInstructions
        : []
      if (!videoUrn || instructions.length === 0) {
        throw new SocialPublishingError('O LinkedIn não retornou as URLs de upload do vídeo.')
      }

      const etags: Array<string> = []
      for (let i = 0; i < instructions.length; i += 1) {
        const part = asRecord(instructions[i])
        const uploadUrl = asString(part?.uploadUrl)
        const firstByte = typeof part?.firstByte === 'number' ? part.firstByte : i * LINKEDIN_VIDEO_PART_BYTES
        const lastByte =
          typeof part?.lastByte === 'number'
            ? part.lastByte
            : Math.min(bytes.byteLength - 1, firstByte + LINKEDIN_VIDEO_PART_BYTES - 1)
        if (!uploadUrl) {
          throw new SocialPublishingError('URL de parte de vídeo inválida recebida do LinkedIn.')
        }
        const slice = bytes.subarray(firstByte, lastByte + 1)
        const putRes = await putDirectBytes(
          ctx.rawFetch,
          uploadUrl,
          slice,
          { 'Content-Type': 'application/octet-stream' },
          `LinkedIn vídeo parte ${i + 1}`,
        )
        const etag = putRes.headers.get('etag')?.replace(/^"|"$/g, '') ?? ''
        if (!etag) {
          throw new SocialPublishingError('O LinkedIn não retornou o ETag da parte do vídeo.')
        }
        etags.push(etag)
      }

      const finalize = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/rest/videos',
        method: 'POST',
        query: { action: 'finalizeUpload' },
        headers: linkedinHeaders,
        body: {
          finalizeUploadRequest: {
            video: videoUrn,
            uploadToken: '',
            uploadedPartIds: etags,
          },
        },
        idempotencyKey: `${ctx.jobId}-li-video-finalize`,
      })
      state = recordCall(state, finalize)

      return {
        status: 'processing',
        stage: 'Processando vídeo no LinkedIn…',
        nextPollDelayMs: 15_000,
        providerState: {
          ...state,
          linkedinMediaUrn: videoUrn,
          linkedinMediaKind: 'video',
          linkedinAuthorUrn: authorUrn,
        },
      }
    }

    // 2. PDF carousel document upload.
    if (docs.length > 0) {
      const pdf = docs[0]!
      const bytes = await ctx.readAssetBytes(pdf)
      const init = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/rest/documents',
        method: 'POST',
        query: { action: 'initializeUpload' },
        headers: linkedinHeaders,
        body: { initializeUploadRequest: { owner: authorUrn } },
        idempotencyKey: `${ctx.jobId}-li-doc-init`,
      })
      state = recordCall(state, init)
      const value = asRecord(asRecord(init.data)?.value)
      const docUrn = asString(value?.document)
      const uploadUrl = asString(value?.uploadUrl)
      if (!docUrn || !uploadUrl) {
        throw new SocialPublishingError('O LinkedIn não retornou a URL de upload do PDF.')
      }
      await putDirectBytes(
        ctx.rawFetch,
        uploadUrl,
        bytes,
        { 'Content-Type': pdf.contentType },
        'LinkedIn PDF',
      )
      // Personal w_member_social tokens cannot poll /rest/documents, so wait ~10s.
      return {
        status: 'processing',
        stage: 'Processando documento PDF no LinkedIn…',
        nextPollDelayMs: 10_000,
        providerState: {
          ...state,
          linkedinMediaUrn: docUrn,
          linkedinMediaKind: 'document',
          linkedinAuthorUrn: authorUrn,
          linkedinReadyAfterMs: ctx.now.getTime() + 10_000,
        },
      }
    }

    // 3. Images (single or multiImage).
    if (images.length > 0) {
      const uploadedUrns: Array<string> = []
      for (let i = 0; i < Math.min(images.length, 20); i += 1) {
        const img = images[i]!
        const bytes = await ctx.readAssetBytes(img)
        const init = await ctx.treg.callTool({
          organizationId: ctx.organizationId,
          toolName: ctx.connection.externalToolName,
          path: '/rest/images',
          method: 'POST',
          query: { action: 'initializeUpload' },
          headers: linkedinHeaders,
          body: { initializeUploadRequest: { owner: authorUrn } },
          idempotencyKey: `${ctx.jobId}-li-img-${i}`,
        })
        state = recordCall(state, init)
        const value = asRecord(asRecord(init.data)?.value)
        const imageUrn = asString(value?.image)
        const uploadUrl = asString(value?.uploadUrl)
        if (!imageUrn || !uploadUrl) {
          throw new SocialPublishingError('O LinkedIn não retornou a URL de upload da imagem.')
        }
        await putDirectBytes(
          ctx.rawFetch,
          uploadUrl,
          bytes,
          { 'Content-Type': img.contentType },
          `LinkedIn imagem ${i + 1}`,
        )
        uploadedUrns.push(imageUrn)
      }

      const content =
        uploadedUrns.length === 1
          ? { media: { id: uploadedUrns[0] } }
          : { multiImage: { images: uploadedUrns.map((id) => ({ id })) } }
      return postLinkedInShare(ctx, authorUrn, state, content)
    }

    // 4. Plain text / link post.
    return postLinkedInShare(ctx, authorUrn, state)
  },

  async poll(ctx, prevState) {
    const urn = prevState.linkedinMediaUrn
    const authorUrn = prevState.linkedinAuthorUrn
    if (!urn || !authorUrn) {
      throw new SocialPublishingError('Estado de publicação do LinkedIn incompleto.')
    }

    if (prevState.linkedinMediaKind === 'document') {
      const readyAfter = prevState.linkedinReadyAfterMs ?? 0
      if (ctx.now.getTime() < readyAfter) {
        return {
          status: 'processing',
          stage: 'Processando documento PDF no LinkedIn…',
          nextPollDelayMs: Math.max(2_000, readyAfter - ctx.now.getTime()),
          providerState: prevState,
        }
      }
      return postLinkedInShare(ctx, authorUrn, prevState, {
        media: { id: urn, title: ctx.item.title.trim() },
      })
    }

    // Video processing status check.
    const check = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/rest/videos/${encodeURIComponent(urn)}`,
      method: 'GET',
      headers: linkedinHeaders,
    })
    const state = recordCall(prevState, check)
    const videoStatus = asString(asRecord(check.data)?.status)
    if (videoStatus === 'PROCESSING_FAILED') {
      throw new SocialPublishingError('O LinkedIn rejeitou o vídeo durante o processamento.')
    }
    if (videoStatus !== 'AVAILABLE') {
      return {
        status: 'processing',
        stage: 'Processando vídeo no LinkedIn…',
        nextPollDelayMs: 15_000,
        providerState: state,
      }
    }
    return postLinkedInShare(ctx, authorUrn, state, {
      media: { id: urn, title: ctx.item.title.trim() },
    })
  },
}

// ---------------------------------------------------------------------------
// Instagram (container create -> status -> media_publish -> permalink)
// ---------------------------------------------------------------------------

async function resolveInstagramUserId(
  ctx: PublishContext,
  state: SocialPublishProviderState,
): Promise<{ igUserId: string; state: SocialPublishProviderState }> {
  if (ctx.connection.accountId?.trim()) {
    return { igUserId: ctx.connection.accountId.trim(), state }
  }
  const me = await ctx.treg.callTool({
    organizationId: ctx.organizationId,
    toolName: ctx.connection.externalToolName,
    path: '/me',
    method: 'GET',
    query: { fields: 'user_id,id,username' },
  })
  const obj = asRecord(me.data)
  const igUserId = asString(obj?.user_id) ?? asString(obj?.id)
  if (!igUserId) {
    throw new SocialPublishingError(
      'Não foi possível identificar a conta Profissional do Instagram. Reconecte em Conexões.',
    )
  }
  return { igUserId, state: recordCall(state, me) }
}

async function checkInstagramContainer(
  ctx: PublishContext,
  containerId: string,
  state: SocialPublishProviderState,
): Promise<{
  statusCode: string | null
  statusText: string | null
  state: SocialPublishProviderState
}> {
  const res = await ctx.treg.callTool({
    organizationId: ctx.organizationId,
    toolName: ctx.connection.externalToolName,
    path: `/${encodeURIComponent(containerId)}`,
    method: 'GET',
    query: { fields: 'status_code,status' },
  })
  const obj = asRecord(res.data)
  return {
    statusCode: asString(obj?.status_code),
    statusText: asString(obj?.status),
    state: recordCall(state, res),
  }
}

async function publishInstagramContainer(
  ctx: PublishContext,
  igUserId: string,
  containerId: string,
  state: SocialPublishProviderState,
): Promise<PublishStepResult> {
  const pub = await ctx.treg.callTool({
    organizationId: ctx.organizationId,
    toolName: ctx.connection.externalToolName,
    path: `/${encodeURIComponent(igUserId)}/media_publish`,
    method: 'POST',
    query: { creation_id: containerId },
    idempotencyKey: `${ctx.jobId}-ig-publish`,
  })
  let nextState = recordCall(state, pub)
  const mediaId = asString(asRecord(pub.data)?.id)
  if (!mediaId) {
    throw new SocialPublishingError('O Instagram não retornou o identificador da publicação.')
  }

  let permalink: string | null = null
  try {
    const meta = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/${encodeURIComponent(mediaId)}`,
      method: 'GET',
      query: { fields: 'permalink' },
    })
    nextState = recordCall(nextState, meta)
    permalink = asString(asRecord(meta.data)?.permalink)
  } catch {
    // Stories often have no public permalink; publishing already succeeded.
  }

  return {
    status: 'published',
    remotePostId: mediaId,
    publishedUrl: permalink,
    providerState: nextState,
  }
}

const instagramPublisher: SocialPublisher = {
  async start(ctx) {
    const visualAssets = ctx.assets.filter((asset) => {
      const kind = assetKind(asset.contentType)
      return kind === 'image' || kind === 'video'
    })
    if (visualAssets.length === 0) {
      throw new SocialPublishingError('O Instagram exige pelo menos uma imagem ou vídeo.')
    }

    let state: SocialPublishProviderState = {}
    const resolved = await resolveInstagramUserId(ctx, state)
    const igUserId = resolved.igUserId
    state = resolved.state

    const isCarousel =
      ctx.item.format === 'carousel' ||
      (ctx.item.format !== 'story' && ctx.item.format !== 'reel' && visualAssets.length >= 2)

    if (isCarousel) {
      const items = visualAssets.slice(0, 10)
      if (items.length < 2) {
        throw new SocialPublishingError('Um carrossel do Instagram precisa de pelo menos 2 mídias.')
      }

      const childIds: Array<string> = []
      let hasVideo = false
      for (let i = 0; i < items.length; i += 1) {
        const asset = items[i]!
        const isVideo = assetKind(asset.contentType) === 'video'
        if (isVideo) hasVideo = true
        const bytes = await ctx.readAssetBytes(asset)
        const hosted = await ctx.treg.uploadHostedMedia(ctx.organizationId, {
          body: bytes,
          contentType: asset.contentType,
        })
        const query: Record<string, string | boolean> = {
          is_carousel_item: true,
          ...(isVideo
            ? { video_url: hosted.url, media_type: 'VIDEO' }
            : { image_url: hosted.url }),
        }
        const child = await ctx.treg.callTool({
          organizationId: ctx.organizationId,
          toolName: ctx.connection.externalToolName,
          path: `/${encodeURIComponent(igUserId)}/media`,
          method: 'POST',
          query,
          idempotencyKey: `${ctx.jobId}-ig-child-${i}`,
        })
        state = recordCall(state, child)
        const childId = asString(asRecord(child.data)?.id)
        if (!childId) {
          throw new SocialPublishingError(`Falha ao preparar o item ${i + 1} do carrossel.`)
        }
        childIds.push(childId)
      }

      if (hasVideo) {
        return {
          status: 'processing',
          stage: 'Processando vídeos do carrossel no Instagram…',
          nextPollDelayMs: 15_000,
          providerState: { ...state, igUserId, childContainerIds: childIds },
        }
      }

      const parent = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: `/${encodeURIComponent(igUserId)}/media`,
        method: 'POST',
        query: {
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          ...(ctx.item.body.trim() ? { caption: ctx.item.body.trim() } : {}),
        },
        idempotencyKey: `${ctx.jobId}-ig-carousel-parent`,
      })
      state = recordCall(state, parent)
      const containerId = asString(asRecord(parent.data)?.id)
      if (!containerId) {
        throw new SocialPublishingError('Falha ao criar o container do carrossel no Instagram.')
      }

      const check = await checkInstagramContainer(ctx, containerId, state)
      state = check.state
      if (check.statusCode === 'ERROR' || check.statusCode === 'EXPIRED') {
        throw new SocialPublishingError(
          `O Instagram recusou o carrossel${check.statusText ? `: ${check.statusText}` : '.'}`,
        )
      }
      if (check.statusCode && check.statusCode !== 'FINISHED') {
        return {
          status: 'processing',
          stage: 'Processando carrossel no Instagram…',
          nextPollDelayMs: 10_000,
          providerState: { ...state, igUserId, containerId },
        }
      }
      return publishInstagramContainer(ctx, igUserId, containerId, {
        ...state,
        igUserId,
        containerId,
      })
    }

    // Single media: Reel, Story, or feed Post.
    const asset =
      ctx.item.format === 'reel'
        ? visualAssets.find((entry) => assetKind(entry.contentType) === 'video')
        : visualAssets[0]
    if (!asset) {
      throw new SocialPublishingError('Um Reel do Instagram precisa de um arquivo de vídeo.')
    }

    const isVideo = assetKind(asset.contentType) === 'video'
    const bytes = await ctx.readAssetBytes(asset)
    const hosted = await ctx.treg.uploadHostedMedia(ctx.organizationId, {
      body: bytes,
      contentType: asset.contentType,
    })

    const query: Record<string, string> = isVideo
      ? { video_url: hosted.url }
      : { image_url: hosted.url }

    if (ctx.item.format === 'story') {
      query.media_type = 'STORIES'
    } else if (ctx.item.format === 'reel' || isVideo) {
      query.media_type = 'REELS'
      if (ctx.item.body.trim()) query.caption = ctx.item.body.trim()
    } else if (ctx.item.body.trim()) {
      query.caption = ctx.item.body.trim()
    }

    const staged = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: `/${encodeURIComponent(igUserId)}/media`,
      method: 'POST',
      query,
      idempotencyKey: `${ctx.jobId}-ig-stage`,
    })
    state = recordCall(state, staged)
    const containerId = asString(asRecord(staged.data)?.id)
    if (!containerId) {
      throw new SocialPublishingError('O Instagram não retornou o identificador da mídia preparada.')
    }

    if (isVideo) {
      return {
        status: 'processing',
        stage: 'Processando vídeo no Instagram…',
        nextPollDelayMs: 15_000,
        providerState: { ...state, igUserId, containerId },
      }
    }

    return publishInstagramContainer(ctx, igUserId, containerId, {
      ...state,
      igUserId,
      containerId,
    })
  },

  async poll(ctx, prevState) {
    let state = prevState
    const igUserId = state.igUserId ?? ctx.connection.accountId?.trim()
    if (!igUserId) {
      throw new SocialPublishingError('Conta do Instagram não identificada para concluir o envio.')
    }

    // Stage 1: wait for carousel children before creating parent container.
    const childIds = state.childContainerIds
    if (!state.containerId && childIds && childIds.length > 0) {
      for (const childId of childIds) {
        const check = await checkInstagramContainer(ctx, childId, state)
        state = check.state
        if (check.statusCode === 'ERROR' || check.statusCode === 'EXPIRED') {
          throw new SocialPublishingError(
            `O Instagram recusou uma mídia do carrossel${check.statusText ? `: ${check.statusText}` : '.'}`,
          )
        }
        if (check.statusCode !== 'FINISHED') {
          return {
            status: 'processing',
            stage: 'Processando mídias do carrossel no Instagram…',
            nextPollDelayMs: 15_000,
            providerState: state,
          }
        }
      }

      const parent = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: `/${encodeURIComponent(igUserId)}/media`,
        method: 'POST',
        query: {
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          ...(ctx.item.body.trim() ? { caption: ctx.item.body.trim() } : {}),
        },
        idempotencyKey: `${ctx.jobId}-ig-carousel-parent`,
      })
      state = recordCall(state, parent)
      const parentId = asString(asRecord(parent.data)?.id)
      if (!parentId) {
        throw new SocialPublishingError('Falha ao finalizar o container do carrossel no Instagram.')
      }
      state = { ...state, containerId: parentId, childContainerIds: undefined }
    }

    const containerId = state.containerId
    if (!containerId) {
      throw new SocialPublishingError('Estado do container do Instagram ausente.')
    }

    const check = await checkInstagramContainer(ctx, containerId, state)
    state = check.state
    if (check.statusCode === 'ERROR' || check.statusCode === 'EXPIRED') {
      throw new SocialPublishingError(
        `O Instagram não conseguiu processar a mídia${check.statusText ? `: ${check.statusText}` : '.'}`,
      )
    }
    if (check.statusCode === 'IN_PROGRESS') {
      return {
        status: 'processing',
        stage: 'Processando mídia no Instagram…',
        nextPollDelayMs: 15_000,
        providerState: state,
      }
    }

    return publishInstagramContainer(ctx, igUserId, containerId, state)
  },
}

// ---------------------------------------------------------------------------
// TikTok (direct post or inbox draft via FILE_UPLOAD + status polling)
// ---------------------------------------------------------------------------

function extractTikTokError(data: unknown): { code: string; message: string } | null {
  const err = asRecord(asRecord(data)?.error)
  if (!err) return null
  const code = asString(err.code)
  if (!code || code === 'ok') return null
  return { code, message: asString(err.message) ?? code }
}

const tiktokPublisher: SocialPublisher = {
  async start(ctx) {
    const video = ctx.assets.find((asset) => assetKind(asset.contentType) === 'video')
    if (!video) {
      throw new SocialPublishingError('O TikTok exige um arquivo de vídeo na mídia do item.')
    }

    const bytes = await ctx.readAssetBytes(video)
    const { chunkSize, totalChunkCount } = computeTikTokChunks(bytes.byteLength)
    const mode = ctx.options.tiktok?.mode ?? 'direct'
    let state: SocialPublishProviderState = { tiktokMode: mode }
    let tiktokUsername = ctx.connection.accountName?.replace(/^@/, '').trim() || undefined

    let initPath: string
    let initBody: Record<string, unknown>

    if (mode === 'direct') {
      const creatorInfoRes = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: '/v2/post/publish/creator_info/query/',
        method: 'POST',
        body: {},
      })
      state = recordCall(state, creatorInfoRes)
      const creatorErr = extractTikTokError(creatorInfoRes.data)
      if (creatorErr) {
        throw new SocialPublishingError(
          `O TikTok recusou a consulta da conta (${creatorErr.message}).`,
        )
      }
      const creatorData = asRecord(asRecord(creatorInfoRes.data)?.data)
      const nickname = asString(creatorData?.creator_username) ?? asString(creatorData?.creator_nickname)
      if (nickname) tiktokUsername = nickname
      const allowedPrivacy = Array.isArray(creatorData?.privacy_level_options)
        ? creatorData.privacy_level_options.filter((v): v is TikTokPrivacyLevel => typeof v === 'string')
        : []

      const requestedPrivacy = ctx.options.tiktok?.privacyLevel
      let privacyLevel: TikTokPrivacyLevel
      if (requestedPrivacy && (allowedPrivacy.length === 0 || allowedPrivacy.includes(requestedPrivacy))) {
        privacyLevel = requestedPrivacy
      } else if (allowedPrivacy.includes('PUBLIC_TO_EVERYONE')) {
        privacyLevel = 'PUBLIC_TO_EVERYONE'
      } else if (allowedPrivacy.length > 0) {
        privacyLevel = allowedPrivacy[0]!
      } else {
        privacyLevel = 'SELF_ONLY'
      }

      initPath = '/v2/post/publish/video/init/'
      initBody = {
        post_info: {
          title: (ctx.item.body.trim() || ctx.item.title.trim()).slice(0, 2200),
          privacy_level: privacyLevel,
          disable_comment: ctx.options.tiktok?.disableComment ?? false,
          disable_duet: ctx.options.tiktok?.disableDuet ?? false,
          disable_stitch: ctx.options.tiktok?.disableStitch ?? false,
          is_aigc: ctx.options.tiktok?.isAigc ?? false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: bytes.byteLength,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      }
    } else {
      initPath = '/v2/post/publish/inbox/video/init/'
      initBody = {
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: bytes.byteLength,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      }
    }

    let initRes: TregToolCallResult
    try {
      initRes = await ctx.treg.callTool({
        organizationId: ctx.organizationId,
        toolName: ctx.connection.externalToolName,
        path: initPath,
        method: 'POST',
        body: initBody,
        idempotencyKey: `${ctx.jobId}-tiktok-init`,
      })
    } catch (error) {
      if (
        error instanceof TregApiError &&
        error.code === 'unaudited_client_can_only_post_to_private_accounts'
      ) {
        throw new SocialPublishingError(
          'A publicação direta pública no TikTok ainda aguarda auditoria do app. Escolha o modo "Enviar para o Inbox" para finalizar pelo app do TikTok.',
        )
      }
      throw error
    }
    state = recordCall(state, initRes)
    const initErr = extractTikTokError(initRes.data)
    if (initErr) {
      if (initErr.code === 'unaudited_client_can_only_post_to_private_accounts') {
        throw new SocialPublishingError(
          'A publicação direta pública no TikTok ainda aguarda auditoria do app. Escolha o modo "Enviar para o Inbox" para finalizar pelo app do TikTok.',
        )
      }
      throw new SocialPublishingError(`O TikTok recusou o envio: ${initErr.message}`)
    }

    const initData = asRecord(asRecord(initRes.data)?.data)
    const publishId = asString(initData?.publish_id)
    const uploadUrl = asString(initData?.upload_url)
    if (!publishId || !uploadUrl) {
      throw new SocialPublishingError('O TikTok não retornou a URL de upload do vídeo.')
    }

    // Upload chunks directly to TikTok's upload_url (never through treg).
    for (let i = 0; i < totalChunkCount; i += 1) {
      const start = i * chunkSize
      const end = i === totalChunkCount - 1 ? bytes.byteLength - 1 : start + chunkSize - 1
      const slice = bytes.subarray(start, end + 1)
      await putDirectBytes(
        ctx.rawFetch,
        uploadUrl,
        slice,
        {
          'Content-Type': video.contentType,
          'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
        },
        `TikTok vídeo parte ${i + 1}/${totalChunkCount}`,
      )
    }

    return {
      status: 'processing',
      stage:
        mode === 'inbox'
          ? 'Enviando rascunho para o Inbox do TikTok…'
          : 'Processando vídeo no TikTok…',
      nextPollDelayMs: 15_000,
      providerState: {
        ...state,
        publishId,
        tiktokMode: mode,
        tiktokUsername,
      },
    }
  },

  async poll(ctx, prevState) {
    if (!prevState.publishId) {
      throw new SocialPublishingError('Identificador de publicação do TikTok ausente.')
    }
    const statusRes = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/v2/post/publish/status/fetch/',
      method: 'POST',
      body: { publish_id: prevState.publishId },
    })
    const state = recordCall(prevState, statusRes)
    const err = extractTikTokError(statusRes.data)
    if (err) {
      throw new SocialPublishingError(`Erro ao consultar status no TikTok: ${err.message}`)
    }

    const data = asRecord(asRecord(statusRes.data)?.data)
    const status = asString(data?.status)

    if (status === 'FAILED') {
      const reason = asString(data?.fail_reason) ?? 'motivo não informado pelo TikTok'
      throw new SocialPublishingError(`O TikTok recusou o vídeo: ${reason}.`)
    }

    if (status === 'SEND_TO_USER_INBOX') {
      return {
        status: 'published',
        remotePostId: prevState.publishId,
        publishedUrl: null,
        providerState: {
          ...state,
          note: 'Vídeo enviado ao Inbox do TikTok. Abra o app do TikTok em até 24 horas para revisar a legenda e publicar.',
        },
      }
    }

    if (status === 'PUBLISH_COMPLETE') {
      // TikTok API's documented spelling is `publicaly_available_post_id`.
      const ids = Array.isArray(data?.publicaly_available_post_id)
        ? data.publicaly_available_post_id
        : Array.isArray(data?.publicly_available_post_id)
          ? data.publicly_available_post_id
          : []
      const postId = ids.length > 0 ? String(ids[0]) : prevState.publishId
      const username = prevState.tiktokUsername?.replace(/^@/, '').trim()
      const publishedUrl =
        ids.length > 0 && username
          ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(String(ids[0]))}`
          : null
      return {
        status: 'published',
        remotePostId: postId,
        publishedUrl,
        providerState: state,
      }
    }

    return {
      status: 'processing',
      stage:
        prevState.tiktokMode === 'inbox'
          ? 'Enviando rascunho para o Inbox do TikTok…'
          : 'Processando vídeo no TikTok…',
      nextPollDelayMs: 20_000,
      providerState: state,
    }
  },
}

// ---------------------------------------------------------------------------
// YouTube (resumable upload + optional custom thumbnail)
// ---------------------------------------------------------------------------

const youtubePublisher: SocialPublisher = {
  async start(ctx) {
    const video = ctx.assets.find((asset) => assetKind(asset.contentType) === 'video')
    if (!video) {
      throw new SocialPublishingError('O YouTube exige um arquivo de vídeo na mídia do item.')
    }

    const bytes = await ctx.readAssetBytes(video)
    const privacyStatus = ctx.options.youtube?.privacyStatus ?? 'public'
    const madeForKids = ctx.options.youtube?.selfDeclaredMadeForKids ?? false
    const notifySubscribers = ctx.options.youtube?.notifySubscribers ?? true

    const init = await ctx.treg.callTool({
      organizationId: ctx.organizationId,
      toolName: ctx.connection.externalToolName,
      path: '/upload/youtube/v3/videos',
      method: 'POST',
      query: {
        part: 'id,snippet,status',
        uploadType: 'resumable',
        notifySubscribers,
      },
      headers: {
        'X-Upload-Content-Length': String(bytes.byteLength),
        'X-Upload-Content-Type': video.contentType,
      },
      body: {
        snippet: {
          title: ctx.item.title.trim().slice(0, 100),
          description: ctx.item.body.trim(),
          categoryId: '22',
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: madeForKids,
        },
      },
      idempotencyKey: `${ctx.jobId}-yt-init`,
    })
    let state = recordCall({}, init)

    const uploadLocation = init.headers.get('location')?.trim()
    if (!uploadLocation) {
      throw new SocialPublishingError(
        'O YouTube não retornou a URL de upload resumível. Verifique se o canal está selecionado em Conexões.',
      )
    }

    const putRes = await putDirectBytes(
      ctx.rawFetch,
      uploadLocation,
      bytes,
      {
        'Content-Type': video.contentType,
        'Content-Length': String(bytes.byteLength),
      },
      'YouTube vídeo',
    )
    const uploadedBody = await putRes.json().catch(() => null)
    const videoId = asString(asRecord(uploadedBody)?.id)
    if (!videoId) {
      throw new SocialPublishingError('O YouTube concluiu o upload sem retornar o ID do vídeo.')
    }

    // Optional thumbnail: explicit selection, or first eligible PNG/JPEG <= 2 MB unless disabled with null.
    const explicitThumbId = ctx.options.youtube?.thumbnailAssetId
    let thumbAsset: ContentAsset | undefined
    if (explicitThumbId) {
      thumbAsset = ctx.assets.find((asset) => asset.id === explicitThumbId)
    } else if (explicitThumbId === undefined) {
      thumbAsset = ctx.assets.find(
        (asset) =>
          (asset.contentType === 'image/jpeg' || asset.contentType === 'image/png') &&
          asset.size <= YOUTUBE_MAX_THUMBNAIL_BYTES,
      )
    }

    if (thumbAsset) {
      if (thumbAsset.size > YOUTUBE_MAX_THUMBNAIL_BYTES) {
        state = {
          ...state,
          note: 'Vídeo enviado, mas a thumbnail foi ignorada por passar de 2 MB.',
        }
      } else {
        try {
          const thumbBytes = await ctx.readAssetBytes(thumbAsset)
          const thumbRes = await ctx.treg.callTool({
            organizationId: ctx.organizationId,
            toolName: ctx.connection.externalToolName,
            path: '/upload/youtube/v3/thumbnails/set',
            method: 'POST',
            query: { videoId, uploadType: 'media' },
            headers: { 'Content-Type': thumbAsset.contentType },
            body: toArrayBuffer(thumbBytes),
          })
          state = recordCall(state, thumbRes)
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'erro desconhecido'
          state = {
            ...state,
            note: `Vídeo enviado, mas não foi possível aplicar a thumbnail (canais não verificados não aceitam capa personalizada): ${reason}`,
          }
        }
      }
    }

    return {
      status: 'published',
      remotePostId: videoId,
      publishedUrl: `https://youtu.be/${encodeURIComponent(videoId)}`,
      providerState: state,
    }
  },
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SOCIAL_PUBLISHERS: Record<SocialChannel, SocialPublisher> = {
  x: xPublisher,
  linkedin: linkedinPublisher,
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
}
