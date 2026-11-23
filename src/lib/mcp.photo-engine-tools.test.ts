import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { contentAsset, user } from '../db/schema'
import { createContentItemSchema } from './content'
import { createContentAsset } from './content-assets.server'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { photoEditPreviewKey, photoEditSettingsKey } from './content-photo-edits'
import {
  createPhotoEditFromAsset,
  listPhotoEditVersions,
  savePhotoEditVersion,
} from './content-photo-edits.server'
import * as content from './content.server'
import { MAX_LIGHTCRAFT_IMAGE_BYTES } from './lightcraft-engine.server'
import type { LightcraftEngineTransport } from './lightcraft-engine.server'
import { MAX_MCP_IMAGE_PREVIEW_BYTES, runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'
import { bytesToBase64 } from './studio-engine.server'

// The photo engine tools with the LightCraft engine faked: a transport that
// parses the streaming multipart request and answers with multipart/form-data
// matching the contract in docs/LIGHTCRAFT-PLAN.md.

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
const PNG = (marker: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ParsedRequest = {
  request: Record<string, unknown> | null
  original: { filename: string; bytes: Uint8Array } | null
  images: Record<string, { filename: string; bytes: Uint8Array }>
}

type PhotoEngineCall = {
  path: string
  method: string
  contentLength: number | null
  parsed: ParsedRequest | null
}

/** Parses the multipart/form-data request sent by `runPhotoEngine` in tests. */
async function parseIncomingMultipart(init?: RequestInit): Promise<ParsedRequest | null> {
  if (!init?.body) return null
  const headers = new Headers(init.headers)
  const contentType = headers.get('content-type') ?? ''
  const req = new Request('http://test/run', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: init.body,
    duplex: 'half',
  } as RequestInit)
  const form = await req.formData()
  const parsed: ParsedRequest = { request: null, original: null, images: {} }
  for (const [key, value] of form.entries()) {
    if (key === 'request') {
      const text = typeof value === 'string' ? value : await value.text()
      parsed.request = JSON.parse(text) as Record<string, unknown>
    } else if (key === 'original' && value instanceof File) {
      parsed.original = {
        filename: value.name,
        bytes: new Uint8Array(await value.arrayBuffer()),
      }
    } else if (key.startsWith('image:') && value instanceof File) {
      parsed.images[key.slice('image:'.length)] = {
        filename: value.name,
        bytes: new Uint8Array(await value.arrayBuffer()),
      }
    }
  }
  return parsed
}

function multipartAnswer(
  result: Record<string, unknown>,
  preview: Uint8Array | null,
  previewType = 'image/jpeg',
): Response {
  const boundary = 'fake-lc-resp'
  const parts: Array<Uint8Array> = [
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="result"\r\nContent-Type: application/json\r\n\r\n`,
    ),
    encoder.encode(JSON.stringify(result)),
    encoder.encode('\r\n'),
  ]
  if (preview) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="preview"\r\nContent-Type: ${previewType}\r\n\r\n`,
      ),
    )
    parts.push(preview)
    parts.push(encoder.encode('\r\n'))
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`))
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    body.set(p, offset)
    offset += p.byteLength
  }
  return new Response(body, {
    status: 200,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
}

let engineCalls: Array<PhotoEngineCall> = []
let answer: (call: PhotoEngineCall) => Response | Promise<Response>

const fakePhotoEngine: LightcraftEngineTransport = {
  name: 'fake-lightcraft',
  async fetch(path, init) {
    const headers = new Headers(init?.headers)
    const contentLength = headers.has('content-length') ? Number(headers.get('content-length')) : null
    const parsed = init?.method === 'POST' ? await parseIncomingMultipart(init) : null
    const call: PhotoEngineCall = { path, method: init?.method ?? 'GET', contentLength, parsed }
    engineCalls.push(call)
    return answer(call)
  },
}

function runOk(call: PhotoEngineCall, extra: Record<string, unknown> = {}, preview: Uint8Array | null = null) {
  const commands = (call.parsed?.request?.commands as Array<unknown>) ?? []
  const inspect = Boolean(call.parsed?.request?.inspect)
  const resolvedPreview = preview === null && !inspect ? JPEG(commands.length + 1) : preview
  return multipartAnswer(
    {
      settings: { ran: commands.length },
      results: commands.map((_, index) => ({ index, ok: true })),
      ...extra,
    },
    resolvedPreview,
  )
}

function deps(photoEngine: LightcraftEngineTransport | null = fakePhotoEngine): McpDeps {
  return { db, bucket, user: ana, workspace, appUrl: 'https://zora.test', photoEngine }
}

async function call(name: string, args: unknown, photoEngine?: LightcraftEngineTransport | null) {
  const tool = zoraTools.find((t) => t.name === name)!
  const result = await runZoraTool(tool, args, deps(photoEngine))
  const first = result.content[0]
  const text = first?.type === 'text' ? first.text : ''
  return { result, text, data: result.isError ? null : JSON.parse(text) }
}

const file = (bytes: Uint8Array) => ({
  body: bytes.slice().buffer,
  size: bytes.length,
  head: bytes.subarray(0, 16),
})

let itemId: string
let editId: string

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
  engineCalls = []
  answer = (c) => runOk(c)
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
  const sourceAsset = await imageAsset(workspace.id, itemId, JPEG(77), 'image/jpeg', 'produto.jpg')
  editId = (
    await createPhotoEditFromAsset(db, bucket, {
      organizationId: workspace.id,
      contentItemId: itemId,
      assetId: sourceAsset.id,
      createdById: ana.id,
    })
  )!.id
})

async function imageAsset(
  organizationId: string,
  forItem: string,
  bytes = JPEG(1),
  type = 'image/jpeg',
  name = 'photo.jpg',
) {
  return (await createContentAsset(db, bucket, {
    organizationId,
    contentItemId: forItem,
    createdById: organizationId === workspace.id ? ana.id : bob.id,
    file: { name, type, size: bytes.length },
    body: bytes.slice().buffer,
  }))!
}

async function saveUserVersion(base: string | null, settings: string, marker = 99) {
  return (await savePhotoEditVersion(db, bucket, {
    organizationId: workspace.id,
    editId,
    createdById: ana.id,
    authorKind: 'user',
    baseVersionId: base,
    settings: file(encoder.encode(settings)),
    preview: file(JPEG(marker)),
  }))!
}

describe('edit_photo', () => {
  it('streams the original, saves an agent version and returns the JPEG preview', async () => {
    const res = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }, { command: 'light.exposure', params: { value: 0.4 } }],
    })
    expect(res.result.isError).toBeFalsy()
    expect(res.data).toMatchObject({ editId, number: 1, baseVersionId: null })
    expect(res.data.results).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
    ])
    expect(res.data.url).toBe(`https://zora.test/content/${itemId}/photos/${editId}`)
    expect(res.result.content[1]).toEqual({
      type: 'image',
      data: bytesToBase64(JPEG(3)),
      mimeType: 'image/jpeg',
    })

    expect(engineCalls).toHaveLength(1)
    expect(engineCalls[0]!.path).toBe('/run')
    expect(engineCalls[0]!.contentLength).toBeGreaterThan(JPEG(77).byteLength)
    expect(engineCalls[0]!.parsed?.request).toEqual({
      originalName: 'produto.jpg',
      commands: [
        { command: 'develop.auto', params: {} },
        { command: 'light.exposure', params: { value: 0.4 } },
      ],
      render: { scale: 1, maxSize: 4096, format: 'jpeg' },
    })
    expect(engineCalls[0]!.parsed?.original?.bytes).toEqual(JPEG(77))

    const [version] = (await listPhotoEditVersions(db, workspace.id, editId))!
    expect(version).toMatchObject({ number: 1, authorKind: 'agent', createdById: ana.id })
    expect(decoder.decode(objects.get(photoEditSettingsKey(editId, version!.id)))).toBe('{"ran":2}')
    expect(objects.get(photoEditPreviewKey(editId, version!.id))).toEqual(JPEG(3))
  })

  it('passes current version settings and baseVersionId on subsequent edits', async () => {
    const first = await saveUserVersion(null, '{"exposure":0.2}')
    const res = await call('edit_photo', {
      editId,
      baseVersionId: first.versionId,
      commands: [{ command: 'color.vibrance', params: { value: 15 } }],
    })
    expect(res.result.isError).toBeFalsy()
    expect(res.data).toMatchObject({ number: 2, baseVersionId: first.versionId })
    expect(engineCalls[0]!.parsed?.request?.settings).toEqual({ exposure: 0.2 })
  })

  it('refuses a stale baseVersionId before calling the engine (409 rule)', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    const second = await saveUserVersion(first.versionId, '{"v":2}')
    const res = await call('edit_photo', {
      editId,
      baseVersionId: first.versionId,
      commands: [{ command: 'develop.auto' }],
    })
    expect(res.result.isError).toBe(true)
    expect(res.text).toContain(`versão atual é a 2 (id ${second.versionId})`)
    expect(res.text).toContain('Nada foi salvo')
    expect(engineCalls).toHaveLength(0)
  })

  it('refuses to save when someone saved in LightCraft while the engine ran (409 rule)', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    answer = async (c) => {
      await saveUserVersion(first.versionId, '{"v":"lightcraft"}')
      return runOk(c)
    }
    const res = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }],
    })
    expect(res.result.isError).toBe(true)
    expect(res.text).toContain('versão atual é a 2')
    const versions = (await listPhotoEditVersions(db, workspace.id, editId))!
    expect(versions.map((v) => [v.number, v.authorKind])).toEqual([
      [2, 'user'],
      [1, 'user'],
    ])
    // Original + 2 versions (settings + preview each) = 5 objects; engine's unsaved files cleaned up.
    expect([...objects.keys()].filter((k) => k.startsWith(`photo-edits/${editId}/`))).toHaveLength(5)
  })

  it('maps 422 to an error naming the failing command and saves nothing', async () => {
    answer = () => Response.json({ error: 'Invalid exposure value', index: 1 }, { status: 422 })
    const res = await call('edit_photo', {
      editId,
      commands: [
        { command: 'develop.auto' },
        { command: 'light.exposure', params: { value: 999 } },
      ],
    })
    expect(res.result.isError).toBe(true)
    expect(res.text).toContain('O comando 1 ("light.exposure") falhou: Invalid exposure value')
    expect(res.text).toContain('Nada foi salvo')
    expect(await listPhotoEditVersions(db, workspace.id, editId)).toEqual([])
  })

  it('streams watermark logo images from the workspace and enforces workspace isolation & limits', async () => {
    const logo = await imageAsset(workspace.id, itemId, PNG(5), 'image/png', 'marca.png')
    const res = await call('edit_photo', {
      editId,
      commands: [{ command: 'export.watermark', params: { logo: 'zora-image:logo' } }],
      images: { logo: logo.id },
    })
    expect(res.result.isError).toBeFalsy()
    expect(engineCalls[0]!.parsed?.images.logo?.bytes).toEqual(PNG(5))
    expect(engineCalls[0]!.parsed?.images.logo?.filename).toBe('marca.png')

    // Other workspace's image and photo edit are inaccessible.
    const theirItem = (
      await content.createContentItem(
        db,
        OTHER_WORKSPACE,
        bob.id,
        createContentItemSchema.parse({ title: 'Theirs', channel: 'x', format: 'post' }),
      )
    ).id
    const theirLogo = await imageAsset(OTHER_WORKSPACE, theirItem, PNG(9), 'image/png')
    const crossImage = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }],
      images: { logo: theirLogo.id },
    })
    expect(crossImage.result.isError).toBe(true)
    expect(crossImage.text).toContain(`No media file with id ${theirLogo.id}`)

    // Non-image and oversized image refused before engine call.
    const pdf = (await createContentAsset(db, bucket, {
      organizationId: workspace.id,
      contentItemId: itemId,
      createdById: ana.id,
      file: { name: 'brief.pdf', type: 'application/pdf', size: 5 },
      body: encoder.encode('%PDF-').slice().buffer,
    }))!
    const notImg = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }],
      images: { doc: pdf.id },
    })
    expect(notImg.result.isError).toBe(true)
    expect(notImg.text).toContain('não é uma imagem')

    await db
      .update(contentAsset)
      .set({ size: MAX_LIGHTCRAFT_IMAGE_BYTES + 1 })
      .where(eq(contentAsset.id, logo.id))
    const tooBig = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }],
      images: { logo: logo.id },
    })
    expect(tooBig.result.isError).toBe(true)
    expect(tooBig.text).toContain('maior que 25 MB')
    expect(engineCalls).toHaveLength(1)
  })

  it('does not inline a preview over 4 MB and points to render_photo', async () => {
    const huge = new Uint8Array(MAX_MCP_IMAGE_PREVIEW_BYTES + 1)
    huge.set(JPEG(0))
    answer = (c) => runOk(c, {}, huge)
    const res = await call('edit_photo', {
      editId,
      commands: [{ command: 'develop.auto' }],
    })
    expect(res.result.isError).toBeFalsy()
    expect(res.data.number).toBe(1)
    expect(res.result.content[1]).toMatchObject({ type: 'text' })
    expect((res.result.content[1] as { text: string }).text).toContain('render_photo')
  })
})

describe('render_photo, inspect_photo and list_photo_commands', () => {
  it('serves stored preview without scale, and renders via engine with scale without saving', async () => {
    const noVer = await call('render_photo', { editId })
    expect(noVer.result.isError).toBe(true)
    expect(noVer.text).toContain('ainda não tem nenhuma versão salva')

    const first = await saveUserVersion(null, '{"exposure":0.1}', 88)
    const stored = await call('render_photo', { editId }, null)
    expect(stored.result.isError).toBeFalsy()
    expect(stored.data).toMatchObject({ editId, versionId: first.versionId, number: 1 })
    expect(stored.result.content[1]).toEqual({
      type: 'image',
      data: bytesToBase64(JPEG(88)),
      mimeType: 'image/jpeg',
    })

    const scaled = await call('render_photo', { editId, scale: 0.5 })
    expect(scaled.result.isError).toBeFalsy()
    expect(scaled.data).toMatchObject({ editId, versionId: first.versionId, number: 1, scale: 0.5 })
    expect(engineCalls[0]!.parsed?.request).toEqual({
      originalName: 'produto.jpg',
      settings: { exposure: 0.1 },
      commands: [],
      render: { scale: 0.5, maxSize: 4096, format: 'jpeg' },
    })
    expect((await listPhotoEditVersions(db, workspace.id, editId))!).toHaveLength(1)
  })

  it('inspects an unsaved edit and a specific saved version', async () => {
    answer = (c) =>
      runOk(c, { inspect: { width: 4000, height: 3000, format: 'jpeg', settings: {} } }, null)
    const rawInspect = await call('inspect_photo', { editId })
    expect(rawInspect.result.isError).toBeFalsy()
    expect(rawInspect.data).toMatchObject({
      editId,
      versionId: null,
      number: null,
      originalName: 'produto.jpg',
      info: { width: 4000, height: 3000, format: 'jpeg', settings: {} },
    })
    expect(engineCalls[0]!.parsed?.request).toEqual({
      originalName: 'produto.jpg',
      commands: [],
      inspect: true,
    })

    const first = await saveUserVersion(null, '{"wb":{"temp":5500}}')
    const verInspect = await call('inspect_photo', { editId, versionId: first.versionId })
    expect(verInspect.result.isError).toBeFalsy()
    expect(verInspect.data).toMatchObject({ versionId: first.versionId, number: 1 })
    expect(engineCalls[1]!.parsed?.request?.settings).toEqual({ wb: { temp: 5500 } })
  })

  it('lists photo commands with filtering and compact params', async () => {
    answer = () =>
      Response.json(
        Array.from({ length: 50 }, (_, i) => ({
          id: `light.cmd${i}`,
          label: `Light ${i}`,
          params: i === 0 ? { doc: 'x'.repeat(5000) } : { value: 'number' },
          extra: 'dropped',
        })),
      )
    const list = await call('list_photo_commands', { query: 'light', limit: 10 })
    expect(engineCalls[0]!.path).toBe('/commands?q=light')
    expect(list.data).toMatchObject({ total: 50, shown: 10 })
    expect(list.data.note).toContain('narrow the query')
    expect(list.data.commands[1]).toEqual({
      id: 'light.cmd1',
      label: 'Light 1',
      params: { value: 'number' },
    })
    expect(typeof list.data.commands[0].params).toBe('string')
    expect(list.data.commands[0].params).toContain('(cut:')
  })

  it('reports not-configured when photoEngine is null or container returns 503 not-configured', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    for (const [name, args] of [
      ['list_photo_commands', {}],
      ['edit_photo', { editId, commands: [{ command: 'develop.auto' }] }],
      ['inspect_photo', { editId }],
      ['render_photo', { editId, scale: 0.5 }],
    ] as const) {
      const res = await call(name, args, null)
      expect(res.result.isError, name).toBe(true)
      expect(res.text, name).toContain('não está configurado')
    }
    expect((await listPhotoEditVersions(db, workspace.id, editId))!.map((v) => v.id)).toEqual([
      first.versionId,
    ])

    answer = () => Response.json({ error: 'not-configured' }, { status: 503 })
    const unconfigured = await call('list_photo_commands', {})
    expect(unconfigured.result.isError).toBe(true)
    expect(unconfigured.text).toContain('não está configurado')
  })
})
