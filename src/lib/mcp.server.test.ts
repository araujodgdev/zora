import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { saveDesignVersion } from './content-designs.server'
import {
  createZoraMcpHandler,
  findMcpUser,
  runZoraTool,
  zoraTools,
} from './mcp.server'
import type { McpDeps } from './mcp.server'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

const ana = { id: 'u-ana', name: 'Ana', email: 'ana@example.com' }
const objects = new Map<string, Uint8Array>()
const bucket: MediaBucket = {
  async put(key, value) {
    objects.set(key, new Uint8Array(await new Response(value).arrayBuffer()))
    return {}
  },
  async get(key): Promise<MediaObject | null> {
    const bytes = objects.get(key)
    if (!bytes) return null
    return { body: new Blob([bytes.slice()]).stream(), size: bytes.length, httpEtag: '"e"' }
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
  },
}
const workspace = { id: 'ws-signum', name: 'Signum', slug: 'ws-signum', role: 'owner' }
const deps: McpDeps = { db, bucket, user: ana, workspace, appUrl: 'https://zora.test' }

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
  await db.insert(user).values({ ...ana, emailVerified: true })
  await seedWorkspace(db, workspace.id, [ana.id], workspace.name)
})

async function call(name: string, args: unknown = {}) {
  const tool = zoraTools.find((t) => t.name === name)!
  const result = await runZoraTool(tool, args, deps)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  return { result, text, data: result.isError ? null : JSON.parse(text) }
}

describe('tools', () => {
  it('creates, lists, schedules, publishes and deletes an item', async () => {
    const created = await call('create_content_item', {
      title: 'Launch teaser',
      channel: 'linkedin',
      format: 'post',
      assigneeId: ana.id,
    })
    expect(created.data).toMatchObject({ title: 'Launch teaser', status: 'idea', createdById: ana.id })
    expect(created.data.url).toBe(`https://zora.test/content/${created.data.id}`)
    const itemId = created.data.id as string

    const scheduled = await call('update_content_item', {
      id: itemId,
      status: 'scheduled',
      scheduledAt: '2026-11-24T09:00:00-03:00',
    })
    expect(scheduled.data.scheduledAt).toBe('2026-11-24T12:00:00.000Z')

    const listed = await call('list_content_items', {
      scheduledFrom: '2026-11-24T00:00:00Z',
      scheduledTo: '2026-11-25T00:00:00Z',
      statuses: ['scheduled'],
    })
    expect(listed.data.count).toBe(1)

    const published = await call('change_content_item_status', { id: itemId, status: 'published' })
    expect(published.data.publishedAt).toBeTruthy()

    expect((await call('delete_content_item', { id: itemId })).data).toEqual({ deleted: itemId })
    const missing = await call('get_content_item', { id: itemId })
    expect(missing.result.isError).toBe(true)
    expect(missing.text).toContain('No content item')
  })

  it('reports rule violations and bad input as readable tool errors', async () => {
    const noDate = await call('create_content_item', {
      title: 'T', channel: 'x', format: 'post', status: 'scheduled',
    })
    expect(noDate.result.isError).toBe(true)
    expect(noDate.text).toMatch(/data e hora de agendamento/i)

    const badChannel = await call('create_content_item', { title: 'T', channel: 'bluesky', format: 'post' })
    expect(badChannel.result.isError).toBe(true)

    const noOffset = await call('reschedule_content_item', {
      id: '00000000-0000-4000-8000-000000000000',
      scheduledAt: '2026-11-24T09:00:00',
    })
    expect(noOffset.result.isError).toBe(true)
  })

  it('uploads, shows and deletes an image', async () => {
    const item = (await call('create_content_item', { title: 'T', channel: 'x', format: 'post' })).data
    const png = 'iVBORw0KGgo='
    const uploaded = await call('upload_content_asset', {
      itemId: item.id, filename: 'dir/a.png', contentType: 'image/png', dataBase64: png,
    })
    expect(uploaded.data).toMatchObject({ filename: 'a.png', size: 8, kind: 'image' })

    const shown = await call('get_content_asset', { assetId: uploaded.data.id })
    expect(shown.result.content[1]).toEqual({ type: 'image', data: png, mimeType: 'image/png' })

    const withMedia = await call('get_content_item', { id: item.id })
    expect(withMedia.data.media).toHaveLength(1)

    const svg = await call('upload_content_asset', {
      itemId: item.id, filename: 'a.svg', contentType: 'image/svg+xml', dataBase64: png,
    })
    expect(svg.result.isError).toBe(true)
    const junk = await call('upload_content_asset', {
      itemId: item.id, filename: 'a.png', contentType: 'image/png', dataBase64: '***',
    })
    expect(junk.text).toContain('not valid base64')

    expect((await call('delete_content_asset', { assetId: uploaded.data.id })).data).toBeTruthy()
    expect(objects.size).toBe(0)
  })

  it('creates, shows, restores and publishes a design', async () => {
    const item = (await call('create_content_item', { title: 'T', channel: 'instagram', format: 'post' })).data
    const created = await call('create_design', { itemId: item.id })
    expect(created.data).toMatchObject({
      name: 'Post do Instagram',
      widthPx: 1080,
      heightPx: 1080,
      preset: 'Instagram Post 1080×1080',
      currentVersionId: null,
    })
    expect(created.data.url).toBe(`https://zora.test/content/${item.id}/designs/${created.data.id}`)
    const designId = created.data.id as string

    const custom = await call('create_design', { itemId: item.id, name: 'Banner', width: 2000, height: 500 })
    expect(custom.data).toMatchObject({ widthPx: 2000, heightPx: 500, preset: null })
    const half = await call('create_design', { itemId: item.id, width: 2000 })
    expect(half.result.isError).toBe(true)

    // Nothing to show or publish before the first save.
    const empty = await call('get_design', { designId })
    expect(empty.data.shownVersion).toBeNull()
    expect(empty.result.content).toHaveLength(1)
    const early = await call('publish_design', { designId })
    expect(early.result.isError).toBe(true)
    expect(early.text).toMatch(/Salve o design/)

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
    const versionFile = (bytes: Uint8Array) => ({ body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 8) })
    const first = (await saveDesignVersion(db, bucket, {
      organizationId: workspace.id, designId, createdById: ana.id, authorKind: 'user', baseVersionId: null,
      source: versionFile(new TextEncoder().encode('{"v":1}')), preview: versionFile(png),
    }))!
    await saveDesignVersion(db, bucket, {
      organizationId: workspace.id, designId, createdById: ana.id, authorKind: 'user', baseVersionId: first.versionId,
      source: versionFile(new TextEncoder().encode('{"v":2}')), preview: versionFile(png),
    })

    const listed = await call('list_designs', { itemId: item.id })
    expect(listed.data.count).toBe(2)
    expect(listed.data.designs[0]).toMatchObject({ id: designId, currentVersionNumber: 2 })

    const shown = await call('get_design', { designId, versionId: first.versionId })
    expect(shown.data.shownVersion).toMatchObject({ number: 1 })
    expect(shown.result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })

    const restored = await call('restore_design_version', { designId, versionId: first.versionId })
    expect(restored.data.number).toBe(3)
    const versions = await call('list_design_versions', { designId })
    expect(versions.data.versions.map((v: { number: number; authorKind: string }) => [v.number, v.authorKind])).toEqual([
      [3, 'agent'], [2, 'user'], [1, 'user'],
    ])

    const published = await call('publish_design', { designId })
    expect(published.data).toMatchObject({ filename: 'Post do Instagram.png', contentType: 'image/png', kind: 'image' })
    expect((await call('get_content_item', { id: item.id })).data.media).toHaveLength(1)

    const missing = await call('get_design', { designId: '00000000-0000-4000-8000-000000000000' })
    expect(missing.text).toContain('No design')

    // Deleting the item takes the design files with it.
    await call('delete_content_item', { id: item.id })
    expect([...objects.keys()].some((key) => key.startsWith('designs/'))).toBe(false)
  })

  it('finds the token user and nobody else', async () => {
    expect(await findMcpUser(db, ana.id)).toEqual(ana)
    expect(await findMcpUser(db, 'someone-else')).toBeNull()
  })
})

describe('over JSON-RPC', () => {
  async function rpc(method: string, params: unknown, protocolVersion = '2025-11-25') {
    const handler = createZoraMcpHandler(deps)
    const response = await handler.fetch(
      new Request('https://zora.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': protocolVersion,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    const text = await response.text()
    const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice(6)
    return { status: response.status, body: JSON.parse(json) }
  }

  it('lists every tool with a JSON Schema', async () => {
    const { status, body } = await rpc('tools/list', {})
    expect(status).toBe(200)
    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(zoraTools.map((t) => t.name))
    const create = body.result.tools.find((t: { name: string }) => t.name === 'create_content_item')
    expect(create.inputSchema.required).toEqual(['title', 'channel', 'format'])
    expect(create.annotations.readOnlyHint).toBe(false)
  })

  it('calls a tool', async () => {
    const { body } = await rpc('tools/call', { name: 'get_current_user', arguments: {} })
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      ...ana,
      workspace: { id: workspace.id, name: 'Signum', slug: workspace.slug, role: 'owner' },
    })
  })
})
