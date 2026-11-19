import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { createContentItemSchema } from './content'
import type { MediaBucket } from './content-assets.server'
import { createContentItem } from './content.server'
import { runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'
import { pollChannelConnection, startChannelConnection } from './social-connections.server'
import type { TregClient } from './treg.server'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

const emptyBucket: MediaBucket = {
  put: async () => ({}),
  get: async () => null,
  delete: async () => {},
}

function tool(name: string) {
  const found = zoraTools.find((entry) => entry.name === name)
  if (!found) throw new Error(`Missing tool ${name}`)
  return found
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((part) => part.type === 'text')?.text ?? ''
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

beforeEach(() => resetDatabase(db))

async function setupDeps(treg: TregClient | null): Promise<McpDeps> {
  await db
    .insert(user)
    .values({ id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true })
  await seedWorkspace(db, 'ws-1', ['u1'], 'Signum')
  return {
    db,
    bucket: emptyBucket,
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
    workspace: { id: 'ws-1', name: 'Signum', slug: 'signum', role: 'owner' },
    appUrl: 'https://zora.lume.software',
    treg,
  }
}

describe('MCP social publishing tools', () => {
  it('lists social connections and reports configured=false when TREG_TOKEN is unset', async () => {
    const deps = await setupDeps(null)
    const res = await runZoraTool(tool('list_social_connections'), {}, deps)
    expect(res.isError).toBeFalsy()
    const payload = JSON.parse(textOf(res))
    expect(payload.configured).toBe(false)
    expect(payload.connectionsUrl).toBe('https://zora.lume.software/connections')
    expect(payload.connections).toEqual([])
  })

  it('returns an isError when publish_content_item runs without TREG_TOKEN', async () => {
    const deps = await setupDeps(null)
    const item = await createContentItem(
      db,
      'ws-1',
      'u1',
      createContentItemSchema.parse({
        title: 'Post',
        body: 'Oi X',
        channel: 'x',
        format: 'post',
      }),
    )
    const res = await runZoraTool(tool('publish_content_item'), { id: item.id }, deps)
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain('TREG_TOKEN')
  })

  it('publishes an X post through publish_content_item and returns its status via get_publish_status', async () => {
    const treg = makeTreg({
      startOAuth: vi.fn().mockResolvedValue({
        state: 'st-x',
        consentUrl: 'https://x.com/oauth',
        redirectUri: 'https://treg.to/oauth/callback',
        connectGuidance: null,
      }),
      getOAuthStatus: vi.fn().mockResolvedValue({
        status: 'done',
        secretId: 9,
        detail: null,
        name: 'zora-x-ws1',
      }),
      listConnections: vi.fn().mockResolvedValue([
        {
          id: 9,
          name: 'zora-x-ws1',
          provider: 'x',
          health: 'ok',
          expiresAt: null,
          resourceRef: 'x-uid',
          resourceName: '@signum',
          capabilities: ['write'],
          scopesInReview: [],
          reviewNote: null,
          authorizationMethod: null,
        },
      ]),
      callTool: vi.fn().mockResolvedValue({
        status: 201,
        headers: new Headers(),
        data: { data: { id: 'tweet-555' } },
        callId: 'c-1',
        costMicro: 15000,
        reviewPendingScopes: [],
      }),
    })

    const deps = await setupDeps(treg)
    await startChannelConnection(db, treg, {
      organizationId: 'ws-1',
      userId: 'u1',
      channel: 'x',
    })
    await pollChannelConnection(db, treg, 'ws-1', 'x')

    const item = await createContentItem(
      db,
      'ws-1',
      'u1',
      createContentItemSchema.parse({
        title: 'Lançamento',
        body: 'Hoje é dia de lançamento!',
        channel: 'x',
        format: 'post',
      }),
    )

    const pub = await runZoraTool(tool('publish_content_item'), { id: item.id }, deps)
    expect(pub.isError).toBeFalsy()
    const pubData = JSON.parse(textOf(pub))
    expect(pubData.job.status).toBe('published')
    expect(pubData.job.publishedUrl).toBe('https://x.com/signum/status/tweet-555')
    expect(pubData.item.status).toBe('published')

    const status = await runZoraTool(tool('get_publish_status'), { id: item.id }, deps)
    expect(status.isError).toBeFalsy()
    const statusData = JSON.parse(textOf(status))
    expect(statusData.jobs).toHaveLength(1)
    expect(statusData.jobs[0].status).toBe('published')
  })
})
