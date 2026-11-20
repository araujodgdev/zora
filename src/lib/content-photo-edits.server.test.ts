import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import type { MediaBucket, MediaObject } from './content-assets.server'
import {
  createContentAsset,
  deleteContentAsset,
  deleteContentItemWithAssets,
  listContentAssets,
} from './content-assets.server'
import {
  MAX_PHOTO_ORIGINAL_BYTES,
  MAX_PHOTO_PREVIEW_BYTES,
  MAX_PHOTO_SETTINGS_BYTES,
  PHOTO_ORIGINAL_ACCEPT,
  hasPhotoOriginalSignature,
  hasPhotoSettingsSignature,
  photoEditOriginalKey,
  photoEditPreviewKey,
  photoEditSettingsKey,
  photoOriginalExtension,
  photoOriginalUploadError,
} from './content-photo-edits'
import {
  PhotoEditConflictError,
  PhotoEditFileError,
  PhotoEditRuleError,
  createPhotoEditFromAsset,
  createPhotoEditFromUpload,
  deleteContentPhotoEdit,
  getContentPhotoEdit,
  listContentPhotoEdits,
  listPhotoEditVersions,
  photoEditFilename,
  publishPhotoEditPreview,
  renameContentPhotoEdit,
  restorePhotoEditVersion,
  savePhotoEditVersion,
} from './content-photo-edits.server'
import type { PhotoEditFile } from './content-photo-edits.server'
import {
  photoEditFileResponse,
  photoEditMetadataResponse,
  photoEditOriginalResponse,
  photoEditOriginalUploadResponse,
  photoEditVersionUploadResponse,
} from './content-photo-edits.http.server'
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
      httpMetadata: { contentType: found.contentType },
    }
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
  },
}

const ws = 'ws-launch'
const other = 'ws-other'
const bytesOf = (text: string) => new TextEncoder().encode(text)
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 9])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const GIF = bytesOf('GIF89a....')
const CR2 = new Uint8Array([0x49, 0x49, 0x2a, 0, 0x10, 0, 0, 0, 0x43, 0x52, 2, 0])
const SETTINGS = bytesOf('{"process":"2026","light":{"exposure":0.5}}')
const SETTINGS_2 = bytesOf(' {"process":"2026","light":{"exposure":1}}')

function file(bytes: Uint8Array): PhotoEditFile {
  return { body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 16) }
}

async function setup() {
  await db.insert(user).values({ id: 'u1', name: 'Ana', email: 'ana@example.com', emailVerified: true })
  await seedWorkspace(db, ws, ['u1'])
  await seedWorkspace(db, other, ['u1'])
  const item = await createContentItem(
    db,
    ws,
    'u1',
    createContentItemSchema.parse({ title: 'Post', channel: 'instagram', format: 'post' }),
  )
  return { item }
}

async function addAsset(itemId: string, name: string, type: string, bytes: Uint8Array) {
  return (await createContentAsset(db, bucket, {
    organizationId: ws,
    contentItemId: itemId,
    createdById: 'u1',
    file: { name, type, size: bytes.length },
    body: bytes.slice().buffer,
  }))!
}

function upload(itemId: string, name: string, bytes: Uint8Array, organizationId = ws) {
  return createPhotoEditFromUpload(db, bucket, {
    organizationId,
    contentItemId: itemId,
    createdById: 'u1',
    file: { name, size: bytes.length },
    body: bytes.slice().buffer,
  })
}

function save(editId: string, baseVersionId: string | null, settings = SETTINGS, preview = JPEG) {
  return savePhotoEditVersion(db, bucket, {
    organizationId: ws,
    editId,
    createdById: 'u1',
    authorKind: 'user',
    baseVersionId,
    settings: file(settings),
    preview: file(preview),
  })
}

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
})

describe('accepted originals', () => {
  it('recognises extensions in any case and checks signatures', () => {
    expect(photoOriginalExtension('IMG_0001.CR3')).toBe('cr3')
    expect(photoOriginalExtension('photo.final.Nef')).toBe('nef')
    expect(photoOriginalExtension('anim.gif')).toBeNull()
    expect(photoOriginalExtension('noext')).toBeNull()
    expect(PHOTO_ORIGINAL_ACCEPT).toContain('.ARW')

    const raw = (text: string) => hasPhotoOriginalSignature('raw', bytesOf(text))
    expect(raw('II*\0\x08\0\0\0')).toBe(true) // TIFF, DNG, CR2, NEF, ARW...
    expect(raw('MM\0*\0\0\0\x08')).toBe(true)
    expect(raw('IIRO\x08\0\0\0')).toBe(true) // ORF
    expect(raw('IIU\0\x08\0\0\0')).toBe(true) // RW2
    expect(raw('FUJIFILMCCD-RAW 0201')).toBe(true) // RAF
    expect(raw('\0\0\0\x18ftypcrx \0\0\0\x01')).toBe(true) // CR3
    expect(raw('\0\0\0\x18ftypheic\0\0\0\0')).toBe(false)
    expect(raw('<html>')).toBe(false)
    expect(hasPhotoOriginalSignature('jpeg', JPEG)).toBe(true)
    expect(hasPhotoOriginalSignature('jpeg', PNG)).toBe(false)
    expect(hasPhotoOriginalSignature('webp', bytesOf('RIFF\0\0\0\0WEBPVP8 '))).toBe(true)
    expect(hasPhotoOriginalSignature('avif', bytesOf('\0\0\0\x1cftypavif\0\0\0\0'))).toBe(true)

    expect(hasPhotoSettingsSignature(bytesOf('\n {"a":1}'))).toBe(true)
    expect(hasPhotoSettingsSignature(bytesOf('[1]'))).toBe(false)
    expect(photoOriginalUploadError({ name: 'a.gif', size: 3 })).toMatch(/só é possível/)
    expect(photoOriginalUploadError({ name: 'a.nef', size: MAX_PHOTO_ORIGINAL_BYTES + 1 })).toMatch(
      /no máximo/,
    )
  })
})

describe('creating photo edits', () => {
  it('copies an image of the item into the edit, which survives deleting the media', async () => {
    const { item } = await setup()
    const asset = await addAsset(item.id, 'Produto.jpg', 'image/jpeg', JPEG)
    const edit = (await createPhotoEditFromAsset(db, bucket, {
      organizationId: ws,
      contentItemId: item.id,
      assetId: asset.id,
      createdById: 'u1',
    }))!
    expect(edit).toMatchObject({
      contentItemId: item.id,
      name: 'Produto',
      sourceAssetId: asset.id,
      originalName: 'Produto.jpg',
      originalSize: JPEG.length,
      currentVersionId: null,
      currentVersionNumber: null,
    })
    expect([...objects.get(photoEditOriginalKey(edit.id, 'jpg'))!.bytes]).toEqual([...JPEG])

    // The media goes away; the edit keeps its own copy and loses only the link.
    expect(await deleteContentAsset(db, bucket, ws, asset.id)).toBe(true)
    expect(await getContentPhotoEdit(db, ws, edit.id)).toMatchObject({ sourceAssetId: null })
    expect(objects.has(photoEditOriginalKey(edit.id, 'jpg'))).toBe(true)
  })

  it('refuses GIFs, media of other items and missing media', async () => {
    const { item } = await setup()
    const second = await createContentItem(
      db,
      ws,
      'u1',
      createContentItemSchema.parse({ title: 'Outro', channel: 'x', format: 'post' }),
    )
    const gif = await addAsset(item.id, 'anim.gif', 'image/gif', GIF)
    const elsewhere = await addAsset(second.id, 'b.png', 'image/png', PNG)
    for (const assetId of [gif.id, elsewhere.id, crypto.randomUUID()]) {
      await expect(
        createPhotoEditFromAsset(db, bucket, {
          organizationId: ws,
          contentItemId: item.id,
          assetId,
          createdById: 'u1',
        }),
      ).rejects.toBeInstanceOf(PhotoEditRuleError)
    }
    // An image whose bytes are not what its type says is refused, and not kept.
    const fake = await addAsset(item.id, 'fake.png', 'image/png', bytesOf('not a png at all'))
    await expect(
      createPhotoEditFromAsset(db, bucket, {
        organizationId: ws,
        contentItemId: item.id,
        assetId: fake.id,
        createdById: 'u1',
      }),
    ).rejects.toBeInstanceOf(PhotoEditFileError)
    expect([...objects.keys()].some((key) => key.startsWith('photo-edits/'))).toBe(false)
    expect(await listContentPhotoEdits(db, ws, item.id)).toEqual([])
  })

  it('stores an uploaded raw, checking the extension and the signature', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'IMG_0042.CR2', CR2))!
    expect(edit).toMatchObject({ name: 'IMG_0042', originalName: 'IMG_0042.CR2', sourceAssetId: null })
    expect(objects.has(photoEditOriginalKey(edit.id, 'cr2'))).toBe(true)

    await expect(upload(item.id, 'fake.nef', bytesOf('<script>alert(1)</script>'))).rejects.toThrow(
      /NEF válida/,
    )
    await expect(upload(item.id, 'anim.gif', GIF)).rejects.toMatchObject({ status: 422 })
    await expect(
      createPhotoEditFromUpload(db, bucket, {
        organizationId: ws,
        contentItemId: item.id,
        createdById: 'u1',
        file: { name: 'big.arw', size: MAX_PHOTO_ORIGINAL_BYTES + 1 },
        body: CR2.slice().buffer,
      }),
    ).rejects.toMatchObject({ status: 413 })
    expect(await upload(item.id, 'a.dng', CR2, other)).toBeNull()
    expect(objects.size).toBe(1)
  })
})

describe('savePhotoEditVersion', () => {
  it('stores both files, numbers versions and moves the current version', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const first = (await save(edit.id, null))!
    expect(first.number).toBe(1)
    expect(objects.get(photoEditSettingsKey(edit.id, first.versionId))?.contentType).toBe('application/json')
    expect(objects.get(photoEditPreviewKey(edit.id, first.versionId))?.contentType).toBe('image/jpeg')

    const second = (await save(edit.id, first.versionId, SETTINGS_2, PNG))!
    expect(second.number).toBe(2)
    expect(objects.get(photoEditPreviewKey(edit.id, second.versionId))?.contentType).toBe('image/png')
    const current = await getContentPhotoEdit(db, ws, edit.id)
    expect(current).toMatchObject({ currentVersionId: second.versionId, currentVersionNumber: 2 })
    expect(current!.updatedAt.getTime()).toBeGreaterThan(edit.updatedAt.getTime())
    const versions = await listPhotoEditVersions(db, ws, edit.id)
    expect(versions?.map((v) => [v.number, v.authorKind, v.createdByName])).toEqual([
      [2, 'user', 'Ana'],
      [1, 'user', 'Ana'],
    ])
  })

  it('refuses a stale base, keeping no files', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const first = (await save(edit.id, null))!
    await save(edit.id, first.versionId)
    const stale = save(edit.id, first.versionId)
    await expect(stale).rejects.toBeInstanceOf(PhotoEditConflictError)
    await expect(stale).rejects.toMatchObject({ currentVersionNumber: 2 })
    await expect(save(edit.id, null)).rejects.toBeInstanceOf(PhotoEditConflictError)
    expect(objects.size).toBe(1 + 4)
  })

  it('lets only one of two first saves win', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const results = await Promise.allSettled([save(edit.id, null), save(edit.id, null)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(PhotoEditConflictError)
    expect(await listPhotoEditVersions(db, ws, edit.id)).toHaveLength(1)
    expect(objects.size).toBe(1 + 2)
  })

  it('retries after a rename that happened in between', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    await renameContentPhotoEdit(db, ws, edit.id, 'Novo nome')
    expect((await save(edit.id, null))?.number).toBe(1)
  })

  it('checks the file signatures and sizes', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    await expect(save(edit.id, null, bytesOf('<xmp/>'))).rejects.toThrow(/JSON/)
    await expect(save(edit.id, null, SETTINGS, GIF)).rejects.toThrow(/JPEG ou PNG/)
    const big = (part: 'settings' | 'preview', size: number) =>
      savePhotoEditVersion(db, bucket, {
        organizationId: ws,
        editId: edit.id,
        createdById: 'u1',
        authorKind: 'user',
        baseVersionId: null,
        settings: part === 'settings' ? { ...file(SETTINGS), size } : file(SETTINGS),
        preview: part === 'preview' ? { ...file(JPEG), size } : file(JPEG),
      })
    await expect(big('settings', MAX_PHOTO_SETTINGS_BYTES + 1)).rejects.toMatchObject({ status: 413 })
    await expect(big('preview', MAX_PHOTO_PREVIEW_BYTES + 1)).rejects.toMatchObject({ status: 413 })
    expect(objects.size).toBe(1)
  })
})

describe('restore, publish and delete', () => {
  it('restores an old version as a new one', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const first = (await save(edit.id, null))!
    await save(edit.id, first.versionId, SETTINGS_2)
    const restored = (await restorePhotoEditVersion(db, bucket, {
      organizationId: ws,
      editId: edit.id,
      versionId: first.versionId,
      createdById: 'u1',
      authorKind: 'agent',
    }))!
    expect(restored.number).toBe(3)
    expect([...objects.get(photoEditSettingsKey(edit.id, restored.versionId))!.bytes]).toEqual([
      ...SETTINGS,
    ])
    expect((await listPhotoEditVersions(db, ws, edit.id))?.[0]).toMatchObject({
      number: 3,
      authorKind: 'agent',
    })
    await expect(
      restorePhotoEditVersion(db, bucket, {
        organizationId: ws,
        editId: edit.id,
        versionId: restored.versionId,
        createdById: 'u1',
        authorKind: 'user',
      }),
    ).rejects.toBeInstanceOf(PhotoEditRuleError)
  })

  it('publishes the current preview as media, with its real type', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    await renameContentPhotoEdit(db, ws, edit.id, 'Produto / final')
    await expect(publishPhotoEditPreview(db, bucket, ws, 'u1', edit.id)).rejects.toBeInstanceOf(
      PhotoEditRuleError,
    )
    const first = (await save(edit.id, null))!
    expect(await publishPhotoEditPreview(db, bucket, ws, 'u1', edit.id)).toMatchObject({
      filename: 'Produto final.jpg',
      contentType: 'image/jpeg',
      size: JPEG.length,
    })
    await save(edit.id, first.versionId, SETTINGS, PNG)
    expect(await publishPhotoEditPreview(db, bucket, ws, 'u1', edit.id)).toMatchObject({
      filename: 'Produto final.png',
      contentType: 'image/png',
    })
    expect(await listContentAssets(db, ws, item.id)).toHaveLength(2)
    expect(photoEditFilename('  ', 'jpg')).toBe('foto.jpg')
  })

  it('deleting an edit removes its versions, original and files', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const keep = (await upload(item.id, 'b.dng', CR2))!
    const first = (await save(edit.id, null))!
    await save(edit.id, first.versionId)
    await save(keep.id, null)
    expect(await deleteContentPhotoEdit(db, bucket, ws, edit.id)).toBe(true)
    expect(await getContentPhotoEdit(db, ws, edit.id)).toBeNull()
    expect([...objects.keys()].every((key) => key.startsWith(`photo-edits/${keep.id}/`))).toBe(true)
    expect(objects.size).toBe(3)
    expect(await deleteContentPhotoEdit(db, bucket, ws, edit.id)).toBe(false)
  })

  it('deleting the item removes its photo edits and their files', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    await save(edit.id, null)
    expect(await deleteContentItemWithAssets(db, bucket, ws, item.id)).toBe(true)
    expect(await getContentPhotoEdit(db, ws, edit.id)).toBeNull()
    expect(objects.size).toBe(0)
  })
})

describe('workspace isolation', () => {
  it('hides and refuses the photo edits of another workspace', async () => {
    const { item } = await setup()
    const edit = (await upload(item.id, 'a.dng', CR2))!
    const first = (await save(edit.id, null))!
    expect(await listContentPhotoEdits(db, other, item.id)).toEqual([])
    expect(await getContentPhotoEdit(db, other, edit.id)).toBeNull()
    expect(await listPhotoEditVersions(db, other, edit.id)).toBeNull()
    expect(await renameContentPhotoEdit(db, other, edit.id, 'x')).toBeNull()
    expect(await deleteContentPhotoEdit(db, bucket, other, edit.id)).toBe(false)
    expect(await publishPhotoEditPreview(db, bucket, other, 'u1', edit.id)).toBeNull()
    expect(
      await savePhotoEditVersion(db, bucket, {
        organizationId: other,
        editId: edit.id,
        createdById: 'u1',
        authorKind: 'user',
        baseVersionId: first.versionId,
        settings: file(SETTINGS),
        preview: file(JPEG),
      }),
    ).toBeNull()
    expect(
      await restorePhotoEditVersion(db, bucket, {
        organizationId: other,
        editId: edit.id,
        versionId: first.versionId,
        createdById: 'u1',
        authorKind: 'user',
      }),
    ).toBeNull()
    expect(
      await createPhotoEditFromAsset(db, bucket, {
        organizationId: other,
        contentItemId: item.id,
        assetId: crypto.randomUUID(),
        createdById: 'u1',
      }),
    ).toBeNull()
    expect(objects.size).toBe(3)
  })
})

describe('HTTP API', () => {
  async function newEdit() {
    const { item } = await setup()
    const edit = (await upload(item.id, 'Foto é.CR2', CR2))!
    return { item, edit }
  }

  function versionUpload(
    editId: string,
    fields: { settings?: Uint8Array | string; preview?: Uint8Array; baseVersionId?: string },
    organizationId: string | null = ws,
  ) {
    const form = new FormData()
    if (fields.settings !== undefined) {
      if (typeof fields.settings === 'string') form.set('settings', fields.settings)
      else form.set('settings', new Blob([fields.settings.slice()]), 'settings.json')
    }
    if (fields.preview) form.set('preview', new Blob([fields.preview.slice()]), 'preview.jpg')
    if (fields.baseVersionId !== undefined) form.set('baseVersionId', fields.baseVersionId)
    const body = new Request('https://zora.test/', { method: 'POST', body: form })
    return body.arrayBuffer().then((bytes) =>
      photoEditVersionUploadResponse(
        db,
        bucket,
        { organizationId, userId: 'u1' },
        editId,
        new Request(`https://zora.test/api/photo-edits/${editId}/versions`, {
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
    const { item, edit } = await newEdit()
    const response = await photoEditMetadataResponse(db, ws, edit.id)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      id: edit.id,
      itemId: item.id,
      name: 'Foto é',
      originalName: 'Foto é.CR2',
      currentVersionId: null,
      currentVersionNumber: null,
      updatedAt: edit.updatedAt.toISOString(),
    })
    expect((await photoEditMetadataResponse(db, other, edit.id)).status).toBe(404)
    expect((await photoEditMetadataResponse(db, null, edit.id)).status).toBe(404)
    expect((await photoEditMetadataResponse(db, ws, 'not-a-uuid')).status).toBe(404)
  })

  it('saves versions, refusing a stale base with 409', async () => {
    const { edit } = await newEdit()
    const created = await versionUpload(edit.id, { settings: SETTINGS, preview: JPEG, baseVersionId: '' })
    expect(created.status).toBe(201)
    const first = (await created.json()) as { versionId: string; number: number }
    expect(first.number).toBe(1)
    const next = await versionUpload(edit.id, {
      settings: SETTINGS_2,
      preview: JPEG,
      baseVersionId: first.versionId,
    })
    expect(next.status).toBe(201)
    const second = (await next.json()) as { versionId: string }
    const stale = await versionUpload(edit.id, {
      settings: SETTINGS,
      preview: JPEG,
      baseVersionId: first.versionId,
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({
      error: expect.any(String),
      currentVersionId: second.versionId,
      currentVersionNumber: 2,
    })
  })

  it('refuses bad files, other workspaces and bad requests', async () => {
    const { edit } = await newEdit()
    const html = bytesOf('<html><script>alert(1)</script>')
    expect((await versionUpload(edit.id, { settings: html, preview: JPEG })).status).toBe(422)
    expect((await versionUpload(edit.id, { settings: SETTINGS, preview: html })).status).toBe(422)
    expect((await versionUpload(edit.id, { settings: 'text field', preview: JPEG })).status).toBe(422)
    expect((await versionUpload(edit.id, { settings: SETTINGS })).status).toBe(422)
    expect(
      (await versionUpload(edit.id, { settings: SETTINGS, preview: JPEG, baseVersionId: 'nope' }))
        .status,
    ).toBe(422)
    expect((await versionUpload(edit.id, { settings: SETTINGS, preview: JPEG }, other)).status).toBe(404)

    const raw = (headers: Record<string, string>, body = 'x') =>
      photoEditVersionUploadResponse(
        db,
        bucket,
        { organizationId: ws, userId: 'u1' },
        edit.id,
        new Request('https://zora.test/', { method: 'POST', headers, body }),
      )
    expect(
      (
        await raw({
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(MAX_PHOTO_SETTINGS_BYTES + MAX_PHOTO_PREVIEW_BYTES + 2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413)
    expect((await raw({ 'content-type': 'application/json' }, '{}')).status).toBe(415)
    expect(objects.size).toBe(1)
  })

  it('serves the original and settings as downloads and the preview inline', async () => {
    const { edit } = await newEdit()
    const url = (kind: string, version?: string) =>
      new URL(`https://zora.test/api/photo-edits/${edit.id}/${kind}${version ? `?version=${version}` : ''}`)

    const original = await photoEditOriginalResponse(db, bucket, ws, edit.id)
    expect(Object.fromEntries(original.headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''Foto%20%C3%A9.CR2",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    expect([...new Uint8Array(await original.arrayBuffer())]).toEqual([...CR2])
    expect((await photoEditOriginalResponse(db, bucket, other, edit.id)).status).toBe(404)

    expect((await photoEditFileResponse(db, bucket, ws, edit.id, 'settings', url('settings'))).status).toBe(404)
    expect((await photoEditFileResponse(db, bucket, ws, edit.id, 'preview', url('preview'))).status).toBe(404)

    const first = (await save(edit.id, null))!
    const second = (await save(edit.id, first.versionId, SETTINGS_2, PNG))!

    const settings = await photoEditFileResponse(db, bucket, ws, edit.id, 'settings', url('settings'))
    expect(Object.fromEntries(settings.headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''Foto%20%C3%A9.json",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'x-photo-edit-version': second.versionId,
    })
    expect(new TextDecoder().decode(await settings.arrayBuffer())).toBe(new TextDecoder().decode(SETTINGS_2))

    const oldPreview = await photoEditFileResponse(
      db, bucket, ws, edit.id, 'preview', url('preview', first.versionId),
    )
    expect(Object.fromEntries(oldPreview.headers)).toMatchObject({
      'content-type': 'image/jpeg',
      'content-disposition': "inline; filename*=UTF-8''Foto%20%C3%A9.jpg",
      'x-photo-edit-version': first.versionId,
      'cache-control': 'private, max-age=31536000, immutable',
    })
    const currentPreview = await photoEditFileResponse(db, bucket, ws, edit.id, 'preview', url('preview'))
    expect(currentPreview.headers.get('content-type')).toBe('image/png')
    expect(currentPreview.headers.get('cache-control')).toBe('private, no-cache')

    for (const response of [
      await photoEditFileResponse(db, bucket, ws, edit.id, 'preview', url('preview', crypto.randomUUID())),
      await photoEditFileResponse(db, bucket, ws, edit.id, 'preview', url('preview', 'nope')),
      await photoEditFileResponse(db, bucket, other, edit.id, 'settings', url('settings')),
      await photoEditFileResponse(db, bucket, null, edit.id, 'settings', url('settings')),
    ]) {
      expect(response.status).toBe(404)
    }
  })

  it('creates an edit from a raw-body upload of an original', async () => {
    const { item } = await setup()
    const post = (query: string, body: Uint8Array | null, headers: Record<string, string> = {}, organizationId: string | null = ws) =>
      photoEditOriginalUploadResponse(
        db,
        bucket,
        { organizationId, userId: 'u1' },
        item.id,
        new Request(`https://zora.test/api/content/${item.id}/photo-edits?${query}`, {
          method: 'POST',
          headers: body ? { 'content-length': String(body.length), ...headers } : headers,
          body: body ? body.slice() : null,
        }),
      )

    const created = await post('filename=dir%2FDSC_1.NEF&name=Retrato', CR2)
    expect(created.status).toBe(201)
    const { edit } = (await created.json()) as { edit: { id: string; name: string; originalName: string } }
    expect(edit).toMatchObject({ name: 'Retrato', originalName: 'DSC_1.NEF' })

    expect((await post('filename=x.nef', bytesOf('<html>'))).status).toBe(422)
    expect((await post('filename=x.gif', GIF)).status).toBe(422)
    expect((await post('', CR2)).status).toBe(422)
    expect((await post(`filename=x.nef&name=${'a'.repeat(201)}`, CR2)).status).toBe(422)
    expect((await post('filename=x.nef', null)).status).toBe(411)
    expect(
      (await post('filename=x.nef', CR2, { 'content-length': String(MAX_PHOTO_ORIGINAL_BYTES + 1) })).status,
    ).toBe(413)
    expect((await post('filename=x.nef', CR2, {}, other)).status).toBe(404)
    expect((await post('filename=x.nef', CR2, {}, null)).status).toBe(404)
    expect(await listContentPhotoEdits(db, ws, item.id)).toHaveLength(1)
    expect(objects.size).toBe(1)
  })
})
