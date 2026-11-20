import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { createContentItemSchema } from './content'
import { createContentAsset } from './content-assets.server'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { savePhotoEditVersion } from './content-photo-edits.server'
import * as content from './content.server'
import { runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'

// The photo edit tools that need no engine (task Z2 of docs/LIGHTCRAFT-PLAN.md).

const db = await createTestDb()
afterAll(() => closeTestDb(db))

const ana = { id: 'u-ana', name: 'Ana', email: 'ana@example.com' }
const bob = { id: 'u-bob', name: 'Bob', email: 'bob@example.com' }
const workspace = { id: 'ws-signum', name: 'Signum', slug: 'ws-signum', role: 'owner' }
const OTHER_WORKSPACE = 'ws-other'

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

const JPEG = (marker: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, marker])
const GIF = new TextEncoder().encode('GIF89a....')
const file = (bytes: Uint8Array) => ({
  body: bytes.slice().buffer,
  size: bytes.length,
  head: bytes.subarray(0, 16),
})

async function call(name: string, args: unknown, as: McpDeps['workspace'] = workspace) {
  const tool = zoraTools.find((t) => t.name === name)!
  const deps: McpDeps = { db, bucket, user: ana, workspace: as, appUrl: 'https://zora.test' }
  const result = await runZoraTool(tool, args, deps)
  const first = result.content[0]
  const text = first?.type === 'text' ? first.text : ''
  return { result, text, data: result.isError ? null : JSON.parse(text) }
}

let itemId: string

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
  await db.insert(user).values([
    { ...ana, emailVerified: true },
    { ...bob, emailVerified: true },
  ])
  await seedWorkspace(db, workspace.id, [ana.id], workspace.name)
  await seedWorkspace(db, OTHER_WORKSPACE, [bob.id])
  itemId = (
    await content.createContentItem(
      db,
      workspace.id,
      ana.id,
      createContentItemSchema.parse({ title: 'Launch', channel: 'instagram', format: 'post' }),
    )
  ).id
})

async function addImage(name: string, type: string, bytes: Uint8Array) {
  return (await createContentAsset(db, bucket, {
    organizationId: workspace.id,
    contentItemId: itemId,
    createdById: ana.id,
    file: { name, type, size: bytes.length },
    body: bytes.slice().buffer,
  }))!
}

describe('photo edit tools', () => {
  it('creates, shows, restores and publishes a photo edit', async () => {
    const image = await addImage('Produto.jpg', 'image/jpeg', JPEG(1))
    const created = await call('create_photo_edit', { itemId, assetId: image.id })
    expect(created.data).toMatchObject({
      name: 'Produto',
      sourceAssetId: image.id,
      originalName: 'Produto.jpg',
      currentVersionId: null,
    })
    expect(created.data.url).toBe(`https://zora.test/content/${itemId}/photos/${created.data.id}`)
    const editId = created.data.id as string

    // Nothing to show or publish before the first save.
    const empty = await call('get_photo_edit', { editId })
    expect(empty.data.shownVersion).toBeNull()
    expect(empty.result.content).toHaveLength(1)
    const early = await call('publish_photo_edit', { editId })
    expect(early.result.isError).toBe(true)
    expect(early.text).toMatch(/Salve a edição/)

    const save = (base: string | null, settings: string, marker: number) =>
      savePhotoEditVersion(db, bucket, {
        organizationId: workspace.id,
        editId,
        createdById: ana.id,
        authorKind: 'user',
        baseVersionId: base,
        settings: file(new TextEncoder().encode(settings)),
        preview: file(JPEG(marker)),
      })
    const first = (await save(null, '{"v":1}', 10))!
    await save(first.versionId, '{"v":2}', 20)

    const listed = await call('list_photo_edits', { itemId })
    expect(listed.data.count).toBe(1)
    expect(listed.data.photoEdits[0]).toMatchObject({ id: editId, currentVersionNumber: 2 })

    const shown = await call('get_photo_edit', { editId, versionId: first.versionId })
    expect(shown.data.shownVersion).toMatchObject({ number: 1 })
    expect(shown.result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })

    const restored = await call('restore_photo_edit_version', { editId, versionId: first.versionId })
    expect(restored.data.number).toBe(3)
    const versions = await call('list_photo_edit_versions', { editId })
    expect(
      versions.data.versions.map((v: { number: number; authorKind: string }) => [v.number, v.authorKind]),
    ).toEqual([
      [3, 'agent'],
      [2, 'user'],
      [1, 'user'],
    ])

    const published = await call('publish_photo_edit', { editId })
    expect(published.data).toMatchObject({ filename: 'Produto.jpg', contentType: 'image/jpeg', kind: 'image' })
    expect((await call('get_content_item', { id: itemId })).data.media).toHaveLength(2)

    // Deleting the item takes the photo edit files with it.
    await call('delete_content_item', { id: itemId })
    expect([...objects.keys()].some((key) => key.startsWith('photo-edits/'))).toBe(false)
  })

  it('refuses GIFs, unknown ids and other workspaces', async () => {
    const gif = await addImage('anim.gif', 'image/gif', GIF)
    const refused = await call('create_photo_edit', { itemId, assetId: gif.id })
    expect(refused.result.isError).toBe(true)
    expect(refused.text).toMatch(/JPEG, PNG, WebP ou AVIF/)

    const missing = await call('get_photo_edit', { editId: '00000000-0000-4000-8000-000000000000' })
    expect(missing.text).toContain('No photo edit')
    const noItem = await call('list_photo_edits', { itemId: crypto.randomUUID() })
    expect(noItem.text).toContain('No content item')

    const image = await addImage('a.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))
    const editId = (await call('create_photo_edit', { itemId, assetId: image.id })).data.id as string
    const otherWorkspace = { id: OTHER_WORKSPACE, name: 'Other', slug: OTHER_WORKSPACE, role: 'owner' }
    expect((await call('get_photo_edit', { editId }, otherWorkspace)).text).toContain('No photo edit')
    expect(
      (await call('create_photo_edit', { itemId, assetId: image.id }, otherWorkspace)).text,
    ).toContain('No content item')
    expect((await call('list_photo_edit_versions', { editId }, null)).text).toMatch(/No active workspace/)
  })
})
