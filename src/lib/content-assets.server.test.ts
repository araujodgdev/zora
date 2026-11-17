import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { MAX_ASSET_BYTES } from './content-assets'
import {
  AssetUploadError,
  assetObjectKey,
  buildAssetResponse,
  createContentAsset,
  deleteContentAsset,
  deleteContentItemWithAssets,
  getContentAsset,
  listContentAssets,
} from './content-assets.server'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { createContentItem } from './content.server'
import { createContentItemSchema } from './content'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

/** An in-memory bucket with the part of the R2 API the service uses. */
function fakeBucket() {
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
        body: new Blob([new Uint8Array(found.bytes)]).stream(),
        size: found.bytes.length,
        httpEtag: '"etag"',
      }
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
  }
  return { bucket, objects }
}

const ws = 'ws-launch'

async function setup() {
  const [author] = await db
    .insert(user)
    .values({ id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true })
    .returning()
  await seedWorkspace(db, ws, [author!.id])
  const item = await createContentItem(
    db,
    ws,
    author!.id,
    createContentItemSchema.parse({ title: 'Post', channel: 'x', format: 'post' }),
  )
  return { author: author!, item }
}

const png = { name: 'a.png', type: 'image/png', size: 4 }
const BYTES = [1, 2, 3, 4]
const bytes = () => new Blob([new Uint8Array(BYTES)])

beforeEach(() => resetDatabase(db))

describe('createContentAsset', () => {
  it('stores the bytes under the item and records the file', async () => {
    const { author, item } = await setup()
    const { bucket, objects } = fakeBucket()

    const asset = await createContentAsset(db, bucket, {
      organizationId: ws,
      contentItemId: item.id,
      createdById: author.id,
      file: png,
      body: bytes(),
    })

    expect(asset).toMatchObject({
      contentItemId: item.id,
      filename: 'a.png',
      contentType: 'image/png',
      size: 4,
    })
    const stored = objects.get(assetObjectKey(item.id, asset!.id))
    expect([...stored!.bytes]).toEqual(BYTES)
    expect(stored?.contentType).toBe('image/png')
    expect(await listContentAssets(db, ws, item.id)).toHaveLength(1)
  })

  it('refuses types that are not media, empty files and large files', async () => {
    const { author, item } = await setup()
    const { bucket, objects } = fakeBucket()
    const upload = (file: { name: string; type: string; size: number }) =>
      createContentAsset(db, bucket, {
        organizationId: ws,
        contentItemId: item.id,
        createdById: author.id,
        file,
        body: bytes(),
      })

    await expect(
      upload({ name: 'x.svg', type: 'image/svg+xml', size: 4 }),
    ).rejects.toBeInstanceOf(AssetUploadError)
    await expect(upload({ ...png, size: 0 })).rejects.toThrow(/vazio/)
    await expect(
      upload({ ...png, size: MAX_ASSET_BYTES + 1 }),
    ).rejects.toThrow(/no máximo/)
    expect(objects.size).toBe(0)
  })

  it('returns null for an item that does not exist, storing nothing', async () => {
    const { author } = await setup()
    const { bucket, objects } = fakeBucket()
    const asset = await createContentAsset(db, bucket, {
      organizationId: ws,
      contentItemId: '00000000-0000-4000-8000-000000000000',
      createdById: author.id,
      file: png,
      body: bytes(),
    })
    expect(asset).toBeNull()
    expect(objects.size).toBe(0)
  })
})

describe('deleteContentAsset', () => {
  it('removes the row and the object', async () => {
    const { author, item } = await setup()
    const { bucket, objects } = fakeBucket()
    const asset = (await createContentAsset(db, bucket, {
      organizationId: ws,
      contentItemId: item.id,
      createdById: author.id,
      file: png,
      body: bytes(),
    }))!

    expect(await deleteContentAsset(db, bucket, ws, asset.id)).toBe(true)
    expect(await getContentAsset(db, ws, asset.id)).toBeNull()
    expect(objects.size).toBe(0)
    expect(await deleteContentAsset(db, bucket, ws, asset.id)).toBe(false)
  })
})

describe('workspace isolation', () => {
  it('hides, refuses and keeps the files of another workspace', async () => {
    const { author, item } = await setup()
    await seedWorkspace(db, 'ws-other', [author.id])
    const { bucket, objects } = fakeBucket()
    const asset = (await createContentAsset(db, bucket, {
      organizationId: ws,
      contentItemId: item.id,
      createdById: author.id,
      file: png,
      body: bytes(),
    }))!

    expect(await listContentAssets(db, 'ws-other', item.id)).toEqual([])
    expect(await getContentAsset(db, 'ws-other', asset.id)).toBeNull()
    expect(await deleteContentAsset(db, bucket, 'ws-other', asset.id)).toBe(false)
    expect(
      await createContentAsset(db, bucket, {
        organizationId: 'ws-other',
        contentItemId: item.id,
        createdById: author.id,
        file: png,
        body: bytes(),
      }),
    ).toBeNull()
    expect(await deleteContentItemWithAssets(db, bucket, 'ws-other', item.id)).toBe(false)
    expect(objects.size).toBe(1)
    expect(await getContentAsset(db, ws, asset.id)).toMatchObject({ id: asset.id })
  })
})

describe('deleteContentItemWithAssets', () => {
  it('removes the item, its rows and its objects, and no one else\'s', async () => {
    const { author, item } = await setup()
    const other = await createContentItem(
      db,
      ws,
      author.id,
      createContentItemSchema.parse({ title: 'Other', channel: 'x', format: 'post' }),
    )
    const { bucket, objects } = fakeBucket()
    for (const id of [item.id, item.id, other.id]) {
      await createContentAsset(db, bucket, {
        organizationId: ws,
        contentItemId: id,
        createdById: author.id,
        file: png,
        body: bytes(),
      })
    }

    expect(await deleteContentItemWithAssets(db, bucket, ws, item.id)).toBe(true)

    expect(await listContentAssets(db, ws, item.id)).toEqual([])
    expect(await listContentAssets(db, ws, other.id)).toHaveLength(1)
    expect([...objects.keys()].every((key) => key.startsWith(`content/${other.id}/`))).toBe(true)
    expect(objects.size).toBe(1)
  })

  it('is false for a missing item', async () => {
    const { bucket } = fakeBucket()
    expect(
      await deleteContentItemWithAssets(
        db,
        bucket,
        ws,
        '00000000-0000-4000-8000-000000000000',
      ),
    ).toBe(false)
  })
})

describe('buildAssetResponse', () => {
  const asset = { filename: 'café é.png', contentType: 'image/png' }
  const object: MediaObject = {
    body: new Blob([new Uint8Array(10)]).stream(),
    size: 10,
    httpEtag: '"e"',
  }

  it('serves the whole file inline with its type', async () => {
    const response = buildAssetResponse(asset, object, false)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toBe(
      "inline; filename*=UTF-8''caf%C3%A9%20%C3%A9.png",
    )
  })

  it('answers a range with 206 and Content-Range', () => {
    const partial = buildAssetResponse(
      asset,
      { ...object, range: { offset: 2, length: 3 } },
      true,
    )
    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toBe('bytes 2-4/10')
    expect(partial.headers.get('Content-Length')).toBe('3')

    const suffix = buildAssetResponse(
      asset,
      { ...object, range: { suffix: 4 } },
      true,
    )
    expect(suffix.headers.get('Content-Range')).toBe('bytes 6-9/10')
  })
})
