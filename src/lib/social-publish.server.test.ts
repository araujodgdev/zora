import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { createContentItemSchema } from './content'
import { createContentAsset } from './content-assets.server'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { createContentItem, getContentItem } from './content.server'
import {
  disconnectChannel,
  listWorkspaceConnections,
  pollChannelConnection,
  selectChannelResource,
  startChannelConnection,
} from './social-connections.server'
import {
  listItemPublishJobs,
  pollPublishJob,
  publishContentItemNow,
  resolvePublishFailureRecipients,
  runScheduledPublishes,
} from './social-publish.server'
import type { SocialPublisher } from './social-publishers.server'
import type { SocialChannel } from './social'
import type { TregClient } from './treg.server'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

function fakeBucket() {
  const objects = new Map<string, Uint8Array>()
  const bucket: MediaBucket = {
    async put(key, value) {
      objects.set(key, new Uint8Array(await new Response(value).arrayBuffer()))
      return {}
    },
    async get(key): Promise<MediaObject | null> {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new Blob([new Uint8Array(found)]).stream(),
        size: found.length,
        httpEtag: '"etag"',
      }
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
  }
  return bucket
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

async function seedActors() {
  await db.insert(user).values([
    { id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true },
    { id: 'u2', name: 'Beto', email: 'beto@example.com', emailVerified: true },
  ])
  await seedWorkspace(db, 'ws-a', ['u1'], 'Workspace A')
  await seedWorkspace(db, 'ws-b', ['u2'], 'Workspace B')
}

async function connectFakeChannel(
  treg: TregClient,
  organizationId: string,
  userId: string,
  channel: SocialChannel,
  accountId: string,
  accountName: string,
) {
  ;(treg.startOAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    state: `state-${organizationId}-${channel}`,
    consentUrl: `https://social.example/auth/${channel}`,
    redirectUri: 'https://treg.to/oauth/callback',
    connectGuidance: null,
  })
  const started = await startChannelConnection(db, treg, {
    organizationId,
    userId,
    channel,
  })
  ;(treg.getOAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    status: 'done',
    secretId: 100,
    detail: null,
    name: started.connection.externalToolName,
  })
  ;(treg.listConnections as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: 100,
      name: started.connection.externalToolName,
      provider: channel,
      health: 'ok',
      expiresAt: null,
      resourceRef: accountId,
      resourceName: accountName,
      capabilities: ['write'],
      scopesInReview: [],
      reviewNote: null,
      authorizationMethod: 'default',
    },
  ])
  const polled = await pollChannelConnection(db, treg, organizationId, channel)
  return polled!.connection
}

beforeEach(() => resetDatabase(db))

describe('social connections', () => {
  it('connects a channel, supports YouTube resource selection and isolates workspaces', async () => {
    await seedActors()
    const treg = makeTreg({
      startOAuth: vi.fn().mockResolvedValue({
        state: 'yt-state',
        consentUrl: 'https://accounts.google.com/auth',
        redirectUri: 'https://treg.to/oauth/callback',
        connectGuidance: null,
      }),
      getOAuthStatus: vi.fn().mockResolvedValue({
        status: 'done',
        secretId: 55,
        detail: null,
        name: 'zora-youtube-wsa',
      }),
      listConnections: vi.fn().mockResolvedValue([
        {
          id: 55,
          name: 'zora-youtube-wsa',
          provider: 'youtube',
          health: 'ok',
          expiresAt: null,
          resourceRef: null,
          resourceName: null,
          capabilities: ['post'],
          scopesInReview: [],
          reviewNote: null,
          authorizationMethod: null,
        },
      ]),
      listConnectionResources: vi.fn().mockResolvedValue([
        { id: 'UC-1', name: 'Canal Principal' },
        { id: 'UC-2', name: 'Canal Secundário' },
      ]),
      selectConnectionResource: vi.fn().mockResolvedValue(undefined),
      revokeConnection: vi.fn().mockResolvedValue(undefined),
    })

    await startChannelConnection(db, treg, {
      organizationId: 'ws-a',
      userId: 'u1',
      channel: 'youtube',
    })
    const polled = await pollChannelConnection(db, treg, 'ws-a', 'youtube')
    expect(polled?.done).toBe(true)
    expect(polled?.connection.status).toBe('needs_resource')
    expect(polled?.resources).toHaveLength(2)

    const selected = await selectChannelResource(db, treg, {
      organizationId: 'ws-a',
      channel: 'youtube',
      resourceRef: 'UC-1',
      resourceName: 'Canal Principal',
    })
    expect(selected.status).toBe('connected')
    expect(selected.accountName).toBe('Canal Principal')

    // Workspace B sees none of Workspace A's connections.
    expect(await listWorkspaceConnections(db, 'ws-b')).toEqual([])

    expect(await disconnectChannel(db, treg, 'ws-a', 'youtube')).toBe(true)
    expect(treg.revokeConnection).toHaveBeenCalledWith('ws-a', 55)
    expect(await listWorkspaceConnections(db, 'ws-a')).toEqual([])
  })
})

describe('social publishing and scheduled cron', () => {
  it('publishes immediately, updates the item to published and stores the URL', async () => {
    await seedActors()
    const treg = makeTreg()
    const bucket = fakeBucket()
    await connectFakeChannel(treg, 'ws-a', 'u1', 'x', 'x-1', '@zora')

    const item = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'Anúncio',
        body: 'Zora agora publica direto nas redes!',
        channel: 'x',
        format: 'post',
        status: 'ready',
      }),
    )

    const publisher: SocialPublisher = {
      start: vi.fn().mockResolvedValue({
        status: 'published',
        remotePostId: 'tweet-99',
        publishedUrl: 'https://x.com/zora/status/tweet-99',
        providerState: { costMicro: 15000 },
      }),
    }
    const publishers = {
      x: publisher,
      linkedin: publisher,
      instagram: publisher,
      tiktok: publisher,
      youtube: publisher,
    }

    const now = new Date('2026-11-19T18:00:00Z')
    const outcome = await publishContentItemNow(
      { db, bucket, treg, publishers },
      { organizationId: 'ws-a', itemId: item.id, userId: 'u1', trigger: 'manual' },
      now,
    )

    expect(outcome?.job.status).toBe('published')
    expect(outcome?.job.publishedUrl).toBe('https://x.com/zora/status/tweet-99')
    expect(outcome?.item?.status).toBe('published')
    expect(outcome?.item?.publishedUrl).toBe('https://x.com/zora/status/tweet-99')

    const reloaded = await getContentItem(db, 'ws-a', item.id)
    expect(reloaded?.status).toBe('published')
    expect(reloaded?.publishedUrl).toBe('https://x.com/zora/status/tweet-99')
  })

  it('tracks async video processing and finishes on pollPublishJob', async () => {
    await seedActors()
    const treg = makeTreg()
    const bucket = fakeBucket()
    await connectFakeChannel(treg, 'ws-a', 'u1', 'tiktok', 'tt-1', '@zora')

    const item = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'Vídeo lançamento',
        body: 'Vem ver!',
        channel: 'tiktok',
        format: 'video',
        status: 'ready',
      }),
    )
    await createContentAsset(db, bucket, {
      organizationId: 'ws-a',
      contentItemId: item.id,
      createdById: 'u1',
      file: { name: 'demo.mp4', type: 'video/mp4', size: 4 },
      body: new Blob([new Uint8Array([1, 2, 3, 4])]),
    })

    const tiktokPub: SocialPublisher = {
      start: vi.fn().mockResolvedValue({
        status: 'processing',
        stage: 'Processando vídeo no TikTok…',
        nextPollDelayMs: 15_000,
        providerState: { publishId: 'pub-1' },
      }),
      poll: vi.fn().mockResolvedValue({
        status: 'published',
        remotePostId: '777',
        publishedUrl: 'https://www.tiktok.com/@zora/video/777',
        providerState: { publishId: 'pub-1' },
      }),
    }
    const publishers = {
      x: tiktokPub,
      linkedin: tiktokPub,
      instagram: tiktokPub,
      tiktok: tiktokPub,
      youtube: tiktokPub,
    }

    const t0 = new Date('2026-11-19T18:00:00Z')
    const started = await publishContentItemNow(
      { db, bucket, treg, publishers },
      { organizationId: 'ws-a', itemId: item.id, userId: 'u1', trigger: 'manual' },
      t0,
    )
    expect(started?.job.status).toBe('processing')

    // Trying to publish again while in-flight is rejected.
    await expect(
      publishContentItemNow(
        { db, bucket, treg, publishers },
        { organizationId: 'ws-a', itemId: item.id, userId: 'u1', trigger: 'manual' },
        t0,
      ),
    ).rejects.toThrow(/andamento/)

    const polled = await pollPublishJob(
      { db, bucket, treg, publishers },
      'ws-a',
      started!.job.id,
      new Date('2026-11-19T18:00:20Z'),
    )
    expect(polled?.job.status).toBe('published')
    expect(polled?.item?.status).toBe('published')
    expect(polled?.item?.publishedUrl).toBe('https://www.tiktok.com/@zora/video/777')
  })

  it('dispatches due scheduled items via Cron idempotently and skips unconnected channels', async () => {
    await seedActors()
    const treg = makeTreg()
    const bucket = fakeBucket()
    await connectFakeChannel(treg, 'ws-a', 'u1', 'linkedin', 'urn:li:person:1', 'Ana')

    const dueTime = new Date('2026-11-19T17:55:00Z')
    const futureTime = new Date('2026-11-19T19:00:00Z')
    const now = new Date('2026-11-19T18:00:00Z')

    const dueConnected = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'Due LinkedIn',
        body: 'Texto agendado',
        channel: 'linkedin',
        format: 'post',
        status: 'scheduled',
        scheduledAt: dueTime,
      }),
    )
    // Future item: must not publish yet.
    await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'Future LinkedIn',
        body: 'Ainda não',
        channel: 'linkedin',
        format: 'post',
        status: 'scheduled',
        scheduledAt: futureTime,
      }),
    )
    // Due item on unconnected channel (X): skipped silently.
    const dueUnconnected = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'Due X unconnected',
        body: 'Sem conta conectada',
        channel: 'x',
        format: 'post',
        status: 'scheduled',
        scheduledAt: dueTime,
      }),
    )

    const startMock = vi.fn().mockResolvedValue({
      status: 'published',
      remotePostId: 'urn:li:share:1',
      publishedUrl: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1',
      providerState: {},
    })
    const pub: SocialPublisher = { start: startMock }
    const publishers = { x: pub, linkedin: pub, instagram: pub, tiktok: pub, youtube: pub }

    const firstRun = await runScheduledPublishes({ db, bucket, treg, publishers }, now)
    expect(firstRun).toEqual({
      polled: 0,
      dispatched: 1,
      published: 1,
      processing: 0,
      failed: 0,
      failures: [],
    })

    // Running a second overlapping tick must NOT re-dispatch.
    const secondRun = await runScheduledPublishes({ db, bucket, treg, publishers }, now)
    expect(secondRun.dispatched).toBe(0)
    expect(startMock).toHaveBeenCalledTimes(1)

    expect((await getContentItem(db, 'ws-a', dueConnected.id))?.status).toBe('published')
    expect((await getContentItem(db, 'ws-a', dueUnconnected.id))?.status).toBe('scheduled')
    expect(await listItemPublishJobs(db, 'ws-a', dueUnconnected.id)).toEqual([])
  })

  it('collects failure details when scheduled preflight or dispatch fails', async () => {
    await seedActors()
    const treg = makeTreg()
    const bucket = fakeBucket()
    await connectFakeChannel(treg, 'ws-a', 'u1', 'instagram', 'ig-1', '@zora')
    await connectFakeChannel(treg, 'ws-a', 'u1', 'linkedin', 'urn:li:person:1', 'Ana')

    const dueTime = new Date('2026-11-19T17:55:00Z')
    const now = new Date('2026-11-19T18:00:00Z')

    // Instagram post without media -> preflight failure.
    const noMedia = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'IG sem foto',
        body: 'Legenda',
        channel: 'instagram',
        format: 'post',
        status: 'scheduled',
        scheduledAt: dueTime,
      }),
    )
    // LinkedIn post whose publisher rejects -> dispatch failure.
    const liFails = await createContentItem(
      db,
      'ws-a',
      'u1',
      createContentItemSchema.parse({
        title: 'LinkedIn erro',
        body: 'Texto',
        channel: 'linkedin',
        format: 'post',
        status: 'scheduled',
        scheduledAt: dueTime,
      }),
    )

    const failingPub: SocialPublisher = {
      start: vi.fn().mockRejectedValue(new Error('Token expirado')),
    }
    const publishers = {
      x: failingPub,
      linkedin: failingPub,
      instagram: failingPub,
      tiktok: failingPub,
      youtube: failingPub,
    }

    const summary = await runScheduledPublishes({ db, bucket, treg, publishers }, now)
    expect(summary.failed).toBe(2)
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentItemId: noMedia.id,
          itemTitle: 'IG sem foto',
          assigneeId: null,
          channel: 'instagram',
          stage: 'preflight',
        }),
        expect.objectContaining({
          contentItemId: liFails.id,
          itemTitle: 'LinkedIn erro',
          assigneeId: null,
          channel: 'linkedin',
          stage: 'dispatch',
          errorMessage: 'Token expirado',
        }),
      ]),
    )
  })

  it('resolves publish failure recipients to the assignee or workspace owner, merged with ops alerts', async () => {
    await db.insert(user).values([
      { id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true },
      { id: 'u2', name: 'Beto', email: 'beto@example.com', emailVerified: true },
    ])
    await seedWorkspace(db, 'ws-a', ['u1', 'u2'], 'Workspace A')

    // Assigned to Beto (member): notifies Beto + ops, deduplicated.
    expect(
      await resolvePublishFailureRecipients(db, 'ws-a', 'u2', [
        'ops@example.com',
        'BETO@example.com',
      ]),
    ).toEqual(['beto@example.com', 'ops@example.com'])

    // Unassigned: falls back to workspace owner (Ana).
    expect(await resolvePublishFailureRecipients(db, 'ws-a', null, [])).toEqual(['ana@example.com'])
  })
})
