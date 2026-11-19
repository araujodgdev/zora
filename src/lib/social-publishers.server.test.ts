import { describe, expect, it, vi } from 'vitest'
import type { ContentItem } from './content'
import type { ContentAsset } from './content-assets'
import type { SocialChannel, SocialConnection } from './social'
import {
  LINKEDIN_API_VERSION,
  SOCIAL_PUBLISHERS,
  computeTikTokChunks,
  escapeLinkedInCommentary,
} from './social-publishers.server'
import type { PublishContext } from './social-publishers.server'
import { TregApiError } from './treg.server'
import type { TregClient, TregToolCallResult } from './treg.server'

const NOW = new Date('2026-11-19T18:00:00Z')

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Lançamento Zora',
    body: 'Novidade chegando hoje!',
    channel: 'x',
    format: 'post',
    status: 'ready',
    scheduledAt: null,
    publishedAt: null,
    publishedUrl: null,
    notes: '',
    assetLinks: [],
    assigneeId: null,
    createdById: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeConnection(
  channel: SocialChannel,
  overrides: Partial<SocialConnection> = {},
): SocialConnection {
  return {
    id: `conn-${channel}`,
    organizationId: 'org-1',
    channel,
    provider: 'treg',
    externalSecretId: 10,
    externalToolName: `zora-${channel}-test`,
    status: 'connected',
    accountId: null,
    accountName: '@zora',
    accountMeta: {},
    connectedById: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeAsset(overrides: Partial<ContentAsset> = {}): ContentAsset {
  return {
    id: 'asset-1',
    contentItemId: '00000000-0000-4000-8000-000000000001',
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 12,
    attribution: null,
    createdById: 'u1',
    createdAt: NOW,
    ...overrides,
  }
}

function toolResult<T>(
  data: T,
  headers: Record<string, string> = {},
  costMicro = 0,
): TregToolCallResult<T> {
  return {
    status: 200,
    headers: new Headers(headers),
    data,
    callId: 'call-1',
    costMicro,
    reviewPendingScopes: [],
  }
}

function makeTreg(overrides: Partial<TregClient> = {}): TregClient {
  return {
    baseUrl: 'https://treg.to',
    startOAuth: vi.fn(),
    getOAuthStatus: vi.fn(),
    listConnections: vi.fn(),
    listConnectionResources: vi.fn(),
    selectConnectionResource: vi.fn(),
    revokeConnection: vi.fn(),
    uploadHostedMedia: vi.fn(),
    callTool: vi.fn(),
    ...overrides,
  }
}

function makeCtx(
  channel: SocialChannel,
  overrides: Partial<PublishContext> = {},
): PublishContext {
  return {
    organizationId: 'org-1',
    jobId: 'job-1',
    item: makeItem({ channel }),
    assets: [],
    connection: makeConnection(channel),
    options: {},
    readAssetBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    treg: makeTreg(),
    rawFetch: vi.fn<typeof fetch>(),
    now: NOW,
    ...overrides,
  }
}

describe('helpers', () => {
  it('escapes LinkedIn Little Text reserved characters', () => {
    expect(escapeLinkedInCommentary('Lançamento (v2) [beta] @zora #ok')).toBe(
      'Lançamento \\(v2\\) \\[beta\\] \\@zora #ok',
    )
  })

  it('computes TikTok chunk sizes cleanly for small and large videos', () => {
    expect(computeTikTokChunks(8 * 1024 * 1024)).toEqual({
      chunkSize: 8 * 1024 * 1024,
      totalChunkCount: 1,
    })
    expect(computeTikTokChunks(75 * 1024 * 1024)).toEqual({
      chunkSize: 10 * 1024 * 1024,
      totalChunkCount: 7,
    })
  })
})

describe('xPublisher', () => {
  it('publishes a multi-tweet thread chaining reply.in_reply_to_tweet_id', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(toolResult({ data: { id: '101' } }, {}, 15000))
      .mockResolvedValueOnce(toolResult({ data: { id: '102' } }, {}, 15000))
    const ctx = makeCtx('x', {
      item: makeItem({
        channel: 'x',
        format: 'thread',
        body: 'Primeiro tweet\n---\nSegundo tweet',
      }),
      connection: makeConnection('x', { accountName: '@lume' }),
      treg: makeTreg({ callTool }),
    })

    const result = await SOCIAL_PUBLISHERS.x.start(ctx)
    expect(result.status).toBe('published')
    if (result.status === 'published') {
      expect(result.remotePostId).toBe('101')
      expect(result.publishedUrl).toBe('https://x.com/lume/status/101')
      expect(result.providerState.costMicro).toBe(30000)
    }
    expect(callTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: '/2/tweets',
        body: { text: 'Primeiro tweet' },
        idempotencyKey: 'job-1-x-0',
      }),
    )
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: '/2/tweets',
        body: { text: 'Segundo tweet', reply: { in_reply_to_tweet_id: '101' } },
        idempotencyKey: 'job-1-x-1',
      }),
    )
  })
})

describe('linkedinPublisher', () => {
  it('publishes an image post with mandatory LinkedIn headers and x-restli-id URL', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult({
          value: { uploadUrl: 'https://media.linkedin.com/upload/1', image: 'urn:li:image:1' },
        }),
      )
      .mockResolvedValueOnce(toolResult(null, { 'x-restli-id': 'urn:li:share:999' }))
    const rawFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }))

    const ctx = makeCtx('linkedin', {
      item: makeItem({ channel: 'linkedin', body: 'Post (novo)!' }),
      assets: [makeAsset({ filename: 'foto.png', contentType: 'image/png', size: 4 })],
      connection: makeConnection('linkedin', { accountId: 'ABC123' }),
      treg: makeTreg({ callTool }),
      rawFetch,
    })

    const result = await SOCIAL_PUBLISHERS.linkedin.start(ctx)
    expect(result.status).toBe('published')
    if (result.status === 'published') {
      expect(result.remotePostId).toBe('urn:li:share:999')
      expect(result.publishedUrl).toBe(
        'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A999',
      )
    }
    expect(rawFetch).toHaveBeenCalledWith(
      'https://media.linkedin.com/upload/1',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/rest/posts',
        headers: {
          'LinkedIn-Version': LINKEDIN_API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: expect.objectContaining({
          author: 'urn:li:person:ABC123',
          commentary: 'Post \\(novo\\)!',
          content: { media: { id: 'urn:li:image:1' } },
        }),
      }),
    )
  })

  it('uploads video parts, finalizes, and publishes once poll sees AVAILABLE', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult({
          value: {
            video: 'urn:li:video:77',
            uploadInstructions: [
              { uploadUrl: 'https://media.linkedin.com/part/1', firstByte: 0, lastByte: 3 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(toolResult({}))
      .mockResolvedValueOnce(toolResult({ status: 'AVAILABLE' }))
      .mockResolvedValueOnce(toolResult(null, { 'x-restli-id': 'urn:li:ugcPost:77' }))

    const rawFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }))

    const ctx = makeCtx('linkedin', {
      item: makeItem({ channel: 'linkedin', format: 'video', body: 'Demo em vídeo' }),
      assets: [makeAsset()],
      connection: makeConnection('linkedin', { accountId: 'urn:li:person:SUB1' }),
      treg: makeTreg({ callTool }),
      rawFetch,
    })

    const started = await SOCIAL_PUBLISHERS.linkedin.start(ctx)
    expect(started.status).toBe('processing')
    if (started.status !== 'processing') expect.unreachable()

    const finished = await SOCIAL_PUBLISHERS.linkedin.poll!(ctx, started.providerState)
    expect(finished.status).toBe('published')
    if (finished.status === 'published') {
      expect(finished.remotePostId).toBe('urn:li:ugcPost:77')
    }
  })
})

describe('instagramPublisher', () => {
  it('stages a single feed image via treg /media and publishes with permalink', async () => {
    const uploadHostedMedia = vi.fn().mockResolvedValue({
      url: 'https://treg.to/m/pic.jpg',
      token: 'pic',
      contentType: 'image/jpeg',
      size: 4,
      expiresAt: '2026-11-26T00:00:00Z',
    })
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(toolResult({ id: 'cont-1' }))
      .mockResolvedValueOnce(toolResult({ id: 'media-1' }))
      .mockResolvedValueOnce(toolResult({ permalink: 'https://www.instagram.com/p/ABC/' }))

    const ctx = makeCtx('instagram', {
      item: makeItem({ channel: 'instagram', format: 'post', body: 'Legenda!' }),
      assets: [makeAsset({ filename: 'post.jpg', contentType: 'image/jpeg', size: 4 })],
      connection: makeConnection('instagram', { accountId: '1784140001' }),
      treg: makeTreg({ uploadHostedMedia, callTool }),
    })

    const result = await SOCIAL_PUBLISHERS.instagram.start(ctx)
    expect(result.status).toBe('published')
    if (result.status === 'published') {
      expect(result.remotePostId).toBe('media-1')
      expect(result.publishedUrl).toBe('https://www.instagram.com/p/ABC/')
    }
    expect(callTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: '/1784140001/media',
        query: { image_url: 'https://treg.to/m/pic.jpg', caption: 'Legenda!' },
      }),
    )
  })

  it('returns processing for Reels and publishes once container status is FINISHED', async () => {
    const uploadHostedMedia = vi.fn().mockResolvedValue({
      url: 'https://treg.to/m/reel.mp4',
      token: 'reel',
      contentType: 'video/mp4',
      size: 4,
      expiresAt: '2026-11-26T00:00:00Z',
    })
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(toolResult({ id: 'reel-cont-1' }))
      .mockResolvedValueOnce(toolResult({ status_code: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(toolResult({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(toolResult({ id: 'reel-media-1' }))
      .mockResolvedValueOnce(toolResult({ permalink: 'https://www.instagram.com/reel/XYZ/' }))

    const ctx = makeCtx('instagram', {
      item: makeItem({ channel: 'instagram', format: 'reel', body: 'Meu reel' }),
      assets: [makeAsset()],
      connection: makeConnection('instagram', { accountId: '1784140001' }),
      treg: makeTreg({ uploadHostedMedia, callTool }),
    })

    const started = await SOCIAL_PUBLISHERS.instagram.start(ctx)
    expect(started.status).toBe('processing')
    if (started.status !== 'processing') expect.unreachable()

    const stillProcessing = await SOCIAL_PUBLISHERS.instagram.poll!(ctx, started.providerState)
    expect(stillProcessing.status).toBe('processing')
    if (stillProcessing.status !== 'processing') expect.unreachable()

    const done = await SOCIAL_PUBLISHERS.instagram.poll!(ctx, stillProcessing.providerState)
    expect(done.status).toBe('published')
    if (done.status === 'published') {
      expect(done.publishedUrl).toBe('https://www.instagram.com/reel/XYZ/')
    }
  })
})

describe('tiktokPublisher', () => {
  it('uploads video directly and resolves PUBLISH_COMPLETE with public URL', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult({
          error: { code: 'ok' },
          data: {
            creator_username: 'zoraapp',
            privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          },
        }),
      )
      .mockResolvedValueOnce(
        toolResult({
          error: { code: 'ok' },
          data: {
            publish_id: 'v_pub_1',
            upload_url: 'https://open-upload.tiktokapis.com/upload?token=1',
          },
        }),
      )
      .mockResolvedValueOnce(
        toolResult({
          error: { code: 'ok' },
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['7123456789'],
          },
        }),
      )
    const rawFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }))

    const ctx = makeCtx('tiktok', {
      item: makeItem({ channel: 'tiktok', format: 'video', body: 'Bastidores #dev' }),
      assets: [makeAsset({ size: 4 })],
      connection: makeConnection('tiktok', { accountName: '@zoraapp' }),
      treg: makeTreg({ callTool }),
      rawFetch,
    })

    const started = await SOCIAL_PUBLISHERS.tiktok.start(ctx)
    expect(started.status).toBe('processing')
    if (started.status !== 'processing') expect.unreachable()
    expect(rawFetch).toHaveBeenCalledWith(
      'https://open-upload.tiktokapis.com/upload?token=1',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': 'bytes 0-3/4',
        },
      }),
    )

    const done = await SOCIAL_PUBLISHERS.tiktok.poll!(ctx, started.providerState)
    expect(done.status).toBe('published')
    if (done.status === 'published') {
      expect(done.publishedUrl).toBe('https://www.tiktok.com/@zoraapp/video/7123456789')
    }
  })

  it('supports inbox draft mode and surfaces a clear message on unaudited direct post error', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult({
          error: { code: 'ok' },
          data: {
            publish_id: 'v_inbox_1',
            upload_url: 'https://open-upload.tiktokapis.com/inbox',
          },
        }),
      )
      .mockResolvedValueOnce(
        toolResult({
          error: { code: 'ok' },
          data: { status: 'SEND_TO_USER_INBOX' },
        }),
      )
    const rawFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }))

    const ctx = makeCtx('tiktok', {
      item: makeItem({ channel: 'tiktok', format: 'video' }),
      assets: [makeAsset({ size: 4 })],
      options: { tiktok: { mode: 'inbox' } },
      treg: makeTreg({ callTool }),
      rawFetch,
    })

    const started = await SOCIAL_PUBLISHERS.tiktok.start(ctx)
    expect(started.status).toBe('processing')
    if (started.status !== 'processing') expect.unreachable()

    const done = await SOCIAL_PUBLISHERS.tiktok.poll!(ctx, started.providerState)
    expect(done.status).toBe('published')
    if (done.status === 'published') {
      expect(done.publishedUrl).toBeNull()
      expect(done.providerState.note).toContain('Inbox do TikTok')
    }

    // Unaudited direct post guidance.
    const unauditedCall = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult({ error: { code: 'ok' }, data: { privacy_level_options: ['SELF_ONLY'] } }),
      )
      .mockRejectedValueOnce(
        new TregApiError('unaudited', {
          status: 403,
          isTregError: false,
          code: 'unaudited_client_can_only_post_to_private_accounts',
        }),
      )
    await expect(
      SOCIAL_PUBLISHERS.tiktok.start(
        makeCtx('tiktok', {
          item: makeItem({ channel: 'tiktok', format: 'video' }),
          assets: [makeAsset()],
          treg: makeTreg({ callTool: unauditedCall }),
        }),
      ),
    ).rejects.toThrow(/Inbox/)
  })
})

describe('youtubePublisher', () => {
  it('uploads video via resumable session and attaches custom thumbnail', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        toolResult(null, { location: 'https://youtube.googleapis.com/upload/session/1' }),
      )
      .mockResolvedValueOnce(toolResult({ items: [] }))
    const rawFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'dQw4w9WgXcQ' }), { status: 200 }))

    const ctx = makeCtx('youtube', {
      item: makeItem({
        channel: 'youtube',
        format: 'video',
        title: 'Demo completa',
        body: 'Descrição do vídeo',
      }),
      assets: [
        makeAsset({ id: 'vid-1', filename: 'demo.mp4', contentType: 'video/mp4', size: 4 }),
        makeAsset({ id: 'img-1', filename: 'capa.png', contentType: 'image/png', size: 4 }),
      ],
      options: { youtube: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false } },
      treg: makeTreg({ callTool }),
      rawFetch,
    })

    const result = await SOCIAL_PUBLISHERS.youtube.start(ctx)
    expect(result.status).toBe('published')
    if (result.status === 'published') {
      expect(result.remotePostId).toBe('dQw4w9WgXcQ')
      expect(result.publishedUrl).toBe('https://youtu.be/dQw4w9WgXcQ')
    }
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: '/upload/youtube/v3/thumbnails/set',
        query: { videoId: 'dQw4w9WgXcQ', uploadType: 'media' },
      }),
    )
  })
})
