import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { MAX_DESIGN_PREVIEW_BYTES, MAX_DESIGN_SOURCE_BYTES, designPreviewKey, designSourceKey } from './content-designs'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { deleteContentItemWithAssets, listContentAssets } from './content-assets.server'
import {
  DesignConflictError,
  DesignFileError,
  DesignRuleError,
  createContentDesign,
  deleteContentDesign,
  designPngFilename,
  getContentDesign,
  listContentDesigns,
  listDesignVersions,
  publishDesignPreview,
  renameContentDesign,
  restoreDesignVersion,
  saveDesignVersion,
} from './content-designs.server'
import type { DesignFile } from './content-designs.server'
import {
  designFileResponse,
  designMetadataResponse,
  designVersionUploadResponse,
} from './content-designs.http.server'
import { createContentItem } from './content.server'
import { createContentItemSchema } from './content'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
const bucket: MediaBucket = {
  async put(key, value, options) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer())
    objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
    return {}
  },
  async get(key): Promise<MediaObject | null> {
    const found = objects.get(key)
    if (!found) return null
    return {
      body: new Blob([found.bytes.slice()]).stream(),
      size: found.bytes.length,
      httpEtag: '"etag"',
    }
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
  },
}

const ws = 'ws-launch'
const other = 'ws-other'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JSON_SOURCE = new TextEncoder().encode('{"version":1}')
const GZIP_SOURCE = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0])

function file(bytes: Uint8Array): DesignFile {
  return { body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 8) }
}

async function setup(channel: 'instagram' | 'x' | 'linkedin' | 'blog' = 'instagram') {
  await db
    .insert(user)
    .values({ id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true })
  await seedWorkspace(db, ws, ['u1'])
  await seedWorkspace(db, other, ['u1'])
  const item = await createContentItem(
    db,
    ws,
    'u1',
    createContentItemSchema.parse({ title: 'Post', channel, format: 'post' }),
  )
  return { item }
}

function save(designId: string, baseVersionId: string | null, source = JSON_SOURCE, preview = PNG) {
  return saveDesignVersion(db, bucket, {
    organizationId: ws,
    designId,
    createdById: 'u1',
    authorKind: 'user',
    baseVersionId,
    source: file(source),
    preview: file(preview),
  })
}

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
})

describe('createContentDesign', () => {
  it('takes the size from the item channel, a preset or explicit pixels', async () => {
    const { item } = await setup('linkedin')
    const byChannel = await createContentDesign(db, ws, 'u1', { itemId: item.id })
    expect(byChannel).toMatchObject({
      contentItemId: item.id,
      name: 'Post do LinkedIn',
      widthPx: 1200,
      heightPx: 627,
      preset: 'LinkedIn Post 1200×627',
      currentVersionId: null,
      currentVersionNumber: null,
    })

    const story = await createContentDesign(db, ws, 'u1', {
      itemId: item.id,
      name: 'Story',
      preset: 'Instagram Story 1080×1920',
    })
    expect(story).toMatchObject({ name: 'Story', widthPx: 1080, heightPx: 1920 })

    const custom = await createContentDesign(db, ws, 'u1', {
      itemId: item.id,
      name: 'Banner',
      width: 3000,
      height: 1000,
    })
    expect(custom).toMatchObject({ widthPx: 3000, heightPx: 1000, preset: null })
    expect(await listContentDesigns(db, ws, item.id)).toHaveLength(3)
  })

  it('returns null for an item of another workspace', async () => {
    const { item } = await setup()
    expect(await createContentDesign(db, other, 'u1', { itemId: item.id })).toBeNull()
  })

  it('is backed by CHECK constraints on the size', async () => {
    const { item } = await setup()
    await expect(
      createContentDesign(db, ws, 'u1', { itemId: item.id, width: 20000, height: 10 }),
    ).rejects.toThrow()
  })
})

describe('saveDesignVersion', () => {
  it('stores both files, numbers versions and moves the current version', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!

    const first = (await save(design.id, null))!
    expect(first.number).toBe(1)
    expect(objects.get(designSourceKey(design.id, first.versionId))?.contentType).toBe(
      'application/octet-stream',
    )
    expect([...objects.get(designPreviewKey(design.id, first.versionId))!.bytes]).toEqual([...PNG])

    const second = (await save(design.id, first.versionId, GZIP_SOURCE))!
    expect(second.number).toBe(2)
    const current = await getContentDesign(db, ws, design.id)
    expect(current).toMatchObject({ currentVersionId: second.versionId, currentVersionNumber: 2 })
    expect(current!.updatedAt.getTime()).toBeGreaterThan(design.updatedAt.getTime())

    const versions = await listDesignVersions(db, ws, design.id)
    expect(versions?.map((v) => [v.number, v.authorKind, v.createdByName])).toEqual([
      [2, 'user', 'Ana'],
      [1, 'user', 'Ana'],
    ])
  })

  it('refuses a stale base with the current version, keeping no files', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const first = (await save(design.id, null))!
    await save(design.id, first.versionId)

    const stale = save(design.id, first.versionId)
    await expect(stale).rejects.toBeInstanceOf(DesignConflictError)
    await expect(stale).rejects.toMatchObject({ currentVersionNumber: 2 })
    // A second "first save" is stale too.
    await expect(save(design.id, null)).rejects.toBeInstanceOf(DesignConflictError)
    expect(objects.size).toBe(4)
    expect(await listDesignVersions(db, ws, design.id)).toHaveLength(2)
  })

  it('lets only one of two saves from the same base win', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const results = await Promise.allSettled([save(design.id, null), save(design.id, null)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(DesignConflictError)
    expect(await listDesignVersions(db, ws, design.id)).toHaveLength(1)
    expect(objects.size).toBe(2)
  })

  it('retries after a rename that happened in between', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    await renameContentDesign(db, ws, design.id, 'Novo nome')
    expect((await save(design.id, null))?.number).toBe(1)
  })

  it('checks the file signatures and sizes', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    await expect(save(design.id, null, svg)).rejects.toBeInstanceOf(DesignFileError)
    await expect(save(design.id, null, JSON_SOURCE, JSON_SOURCE)).rejects.toThrow(/PNG/)
    await expect(
      saveDesignVersion(db, bucket, {
        organizationId: ws,
        designId: design.id,
        createdById: 'u1',
        authorKind: 'user',
        baseVersionId: null,
        source: { ...file(JSON_SOURCE), size: MAX_DESIGN_SOURCE_BYTES + 1 },
        preview: file(PNG),
      }),
    ).rejects.toMatchObject({ status: 413 })
    await expect(
      saveDesignVersion(db, bucket, {
        organizationId: ws,
        designId: design.id,
        createdById: 'u1',
        authorKind: 'user',
        baseVersionId: null,
        source: file(JSON_SOURCE),
        preview: { ...file(PNG), size: MAX_DESIGN_PREVIEW_BYTES + 1 },
      }),
    ).rejects.toMatchObject({ status: 413 })
    expect(objects.size).toBe(0)
  })
})

describe('restore, publish and delete', () => {
  it('restores an old version as a new one', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const first = (await save(design.id, null))!
    await save(design.id, first.versionId, GZIP_SOURCE)

    const restored = await restoreDesignVersion(db, bucket, {
      organizationId: ws,
      designId: design.id,
      versionId: first.versionId,
      createdById: 'u1',
      authorKind: 'agent',
    })
    expect(restored?.number).toBe(3)
    expect([...objects.get(designSourceKey(design.id, restored!.versionId))!.bytes]).toEqual([
      ...JSON_SOURCE,
    ])
    const versions = await listDesignVersions(db, ws, design.id)
    expect(versions?.[0]).toMatchObject({ number: 3, authorKind: 'agent' })
    await expect(
      restoreDesignVersion(db, bucket, {
        organizationId: ws,
        designId: design.id,
        versionId: restored!.versionId,
        createdById: 'u1',
        authorKind: 'user',
      }),
    ).rejects.toBeInstanceOf(DesignRuleError)
  })

  it('publishes the current PNG as media of the item', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id, name: 'Capa / v2' }))!
    await expect(publishDesignPreview(db, bucket, ws, 'u1', design.id)).rejects.toBeInstanceOf(
      DesignRuleError,
    )
    await save(design.id, null)
    const asset = await publishDesignPreview(db, bucket, ws, 'u1', design.id)
    expect(asset).toMatchObject({ filename: 'Capa v2.png', contentType: 'image/png', size: PNG.length })
    expect(await listContentAssets(db, ws, item.id)).toHaveLength(1)
    expect(designPngFilename('  ')).toBe('design.png')
  })

  it('deleting a design removes its versions and files', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const keep = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const first = (await save(design.id, null))!
    await save(design.id, first.versionId)
    await save(keep.id, null)

    expect(await deleteContentDesign(db, bucket, ws, design.id)).toBe(true)
    expect(await getContentDesign(db, ws, design.id)).toBeNull()
    expect([...objects.keys()].every((key) => key.startsWith(`designs/${keep.id}/`))).toBe(true)
    expect(objects.size).toBe(2)
    expect(await deleteContentDesign(db, bucket, ws, design.id)).toBe(false)
  })

  it('deleting the item removes its designs and their files', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    await save(design.id, null)
    expect(await deleteContentItemWithAssets(db, bucket, ws, item.id)).toBe(true)
    expect(await getContentDesign(db, ws, design.id)).toBeNull()
    expect(objects.size).toBe(0)
  })
})

describe('workspace isolation', () => {
  it('hides and refuses the designs of another workspace', async () => {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id }))!
    const first = (await save(design.id, null))!

    expect(await listContentDesigns(db, other, item.id)).toEqual([])
    expect(await getContentDesign(db, other, design.id)).toBeNull()
    expect(await listDesignVersions(db, other, design.id)).toBeNull()
    expect(await renameContentDesign(db, other, design.id, 'x')).toBeNull()
    expect(await deleteContentDesign(db, bucket, other, design.id)).toBe(false)
    expect(await publishDesignPreview(db, bucket, other, 'u1', design.id)).toBeNull()
    expect(
      await saveDesignVersion(db, bucket, {
        organizationId: other,
        designId: design.id,
        createdById: 'u1',
        authorKind: 'user',
        baseVersionId: first.versionId,
        source: file(JSON_SOURCE),
        preview: file(PNG),
      }),
    ).toBeNull()
    expect(
      await restoreDesignVersion(db, bucket, {
        organizationId: other,
        designId: design.id,
        versionId: first.versionId,
        createdById: 'u1',
        authorKind: 'user',
      }),
    ).toBeNull()
    expect(objects.size).toBe(2)
  })
})

describe('HTTP API', () => {
  async function designWithVersion() {
    const { item } = await setup()
    const design = (await createContentDesign(db, ws, 'u1', { itemId: item.id, name: 'Capa é' }))!
    return { item, design }
  }

  function upload(
    designId: string,
    fields: { source?: Uint8Array | string; preview?: Uint8Array; baseVersionId?: string },
    organizationId: string | null = ws,
  ) {
    const form = new FormData()
    if (fields.source !== undefined) {
      if (typeof fields.source === 'string') form.set('source', fields.source)
      else form.set('source', new Blob([fields.source.slice()]), 'design.vectorcraft')
    }
    if (fields.preview) form.set('preview', new Blob([fields.preview.slice()]), 'preview.png')
    if (fields.baseVersionId !== undefined) form.set('baseVersionId', fields.baseVersionId)
    const body = new Request('https://zora.test/', { method: 'POST', body: form })
    return body.arrayBuffer().then((bytes) =>
      designVersionUploadResponse(
        db,
        bucket,
        { organizationId, userId: 'u1' },
        designId,
        new Request(`https://zora.test/api/designs/${designId}/versions`, {
          method: 'POST',
          headers: {
            'content-type': body.headers.get('content-type')!,
            'content-length': String(bytes.byteLength),
          },
          body: bytes,
        }),
      ),
    )
  }

  it('serves metadata per the contract', async () => {
    const { item, design } = await designWithVersion()
    const response = await designMetadataResponse(db, ws, design.id)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      id: design.id,
      itemId: item.id,
      name: 'Capa é',
      width: 1080,
      height: 1080,
      preset: 'Instagram Post 1080×1080',
      currentVersionId: null,
      currentVersionNumber: null,
      updatedAt: design.updatedAt.toISOString(),
    })
    expect((await designMetadataResponse(db, other, design.id)).status).toBe(404)
    expect((await designMetadataResponse(db, null, design.id)).status).toBe(404)
    expect((await designMetadataResponse(db, ws, 'not-a-uuid')).status).toBe(404)
  })

  it('saves versions, refusing a stale base with 409', async () => {
    const { design } = await designWithVersion()
    const created = await upload(design.id, { source: JSON_SOURCE, preview: PNG, baseVersionId: '' })
    expect(created.status).toBe(201)
    const first = (await created.json()) as { versionId: string; number: number }
    expect(first.number).toBe(1)

    const next = await upload(design.id, {
      source: GZIP_SOURCE,
      preview: PNG,
      baseVersionId: first.versionId,
    })
    expect(next.status).toBe(201)
    const second = (await next.json()) as { versionId: string }

    const stale = await upload(design.id, {
      source: JSON_SOURCE,
      preview: PNG,
      baseVersionId: first.versionId,
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({
      error: expect.any(String),
      currentVersionId: second.versionId,
      currentVersionNumber: 2,
    })
    const noBase = await upload(design.id, { source: JSON_SOURCE, preview: PNG })
    expect(noBase.status).toBe(409)
  })

  it('refuses bad files, other workspaces and bad requests', async () => {
    const { design } = await designWithVersion()
    const html = new TextEncoder().encode('<html><script>alert(1)</script>')
    expect((await upload(design.id, { source: html, preview: PNG })).status).toBe(422)
    expect((await upload(design.id, { source: JSON_SOURCE, preview: html })).status).toBe(422)
    expect((await upload(design.id, { source: 'text field', preview: PNG })).status).toBe(422)
    expect((await upload(design.id, { source: JSON_SOURCE })).status).toBe(422)
    expect(
      (await upload(design.id, { source: JSON_SOURCE, preview: PNG, baseVersionId: 'nope' })).status,
    ).toBe(422)
    expect((await upload(design.id, { source: JSON_SOURCE, preview: PNG }, other)).status).toBe(404)

    const tooLarge = await designVersionUploadResponse(
      db,
      bucket,
      { organizationId: ws, userId: 'u1' },
      design.id,
      new Request('https://zora.test/', {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(MAX_DESIGN_SOURCE_BYTES + MAX_DESIGN_PREVIEW_BYTES + 2 * 1024 * 1024),
        },
        body: 'x',
      }),
    )
    expect(tooLarge.status).toBe(413)
    const notMultipart = await designVersionUploadResponse(
      db,
      bucket,
      { organizationId: ws, userId: 'u1' },
      design.id,
      new Request('https://zora.test/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(notMultipart.status).toBe(415)
    expect(objects.size).toBe(0)
  })

  it('serves the source as a download and the preview inline, with safety headers', async () => {
    const { design } = await designWithVersion()
    const url = (kind: string, version?: string) =>
      new URL(`https://zora.test/api/designs/${design.id}/${kind}${version ? `?version=${version}` : ''}`)

    expect((await designFileResponse(db, bucket, ws, design.id, 'source', url('source'))).status).toBe(404)
    expect((await designFileResponse(db, bucket, ws, design.id, 'preview', url('preview'))).status).toBe(404)

    const first = (await save(design.id, null))!
    const second = (await save(design.id, first.versionId, GZIP_SOURCE))!

    const source = await designFileResponse(db, bucket, ws, design.id, 'source', url('source'))
    expect(source.status).toBe(200)
    expect(Object.fromEntries(source.headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''Capa%20%C3%A9.vectorcraft",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'x-design-version': second.versionId,
    })
    expect([...new Uint8Array(await source.arrayBuffer())]).toEqual([...GZIP_SOURCE])

    const old = await designFileResponse(
      db, bucket, ws, design.id, 'source', url('source', first.versionId),
    )
    expect(old.headers.get('x-design-version')).toBe(first.versionId)
    expect([...new Uint8Array(await old.arrayBuffer())]).toEqual([...JSON_SOURCE])

    const preview = await designFileResponse(db, bucket, ws, design.id, 'preview', url('preview'))
    expect(Object.fromEntries(preview.headers)).toMatchObject({
      'content-type': 'image/png',
      'content-disposition': "inline; filename*=UTF-8''Capa%20%C3%A9.png",
      'x-content-type-options': 'nosniff',
      'x-design-version': second.versionId,
    })
    expect(preview.headers.get('cache-control')).toMatch(/^private/)

    // Unknown or malformed versions, and other workspaces, are not found.
    for (const response of [
      await designFileResponse(db, bucket, ws, design.id, 'preview', url('preview', crypto.randomUUID())),
      await designFileResponse(db, bucket, ws, design.id, 'preview', url('preview', 'nope')),
      await designFileResponse(db, bucket, other, design.id, 'source', url('source')),
      await designFileResponse(db, bucket, null, design.id, 'source', url('source')),
    ]) {
      expect(response.status).toBe(404)
    }
  })
})
