import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import { createContentItemSchema } from './content'
import { createContentAsset } from './content-assets.server'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { designPreviewKey, designSourceKey } from './content-designs'
import { createContentDesign, listDesignVersions, saveDesignVersion } from './content-designs.server'
import * as content from './content.server'
import { MAX_MCP_IMAGE_PREVIEW_BYTES, runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'
import { MAX_ENGINE_IMAGE_BYTES, base64ToBytes, bytesToBase64 } from './studio-engine.server'
import type { StudioEngineTransport } from './studio-engine.server'

// The design engine tools with the engine faked: a transport that records
// every request and answers like the contract in docs/STUDIO-PLAN.md.

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

const PNG = (marker: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const text = (value: string) => new TextEncoder().encode(value)

type EngineCall = { path: string; method: string; body: Record<string, unknown> | null }
let engineCalls: Array<EngineCall> = []
let answer: (call: EngineCall) => Response | Promise<Response>

const fakeEngine: StudioEngineTransport = {
  name: 'fake',
  async fetch(path, init) {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const call = { path, method: init.method ?? 'GET', body }
    engineCalls.push(call)
    return answer(call)
  },
}

/** A successful `/run`: the source records how many commands ran. */
function runOk(call: EngineCall, extra: Record<string, unknown> = {}) {
  const commands = (call.body?.commands as Array<unknown>) ?? []
  return Response.json({
    source: bytesToBase64(text(JSON.stringify({ ran: commands.length }))),
    preview: bytesToBase64(PNG(commands.length)),
    results: commands.map((_, index) => ({ index, ok: true })),
    ...extra,
  })
}

function deps(engine: StudioEngineTransport | null = fakeEngine): McpDeps {
  return { db, bucket, user: ana, workspace, appUrl: 'https://zora.test', engine }
}

async function call(name: string, args: unknown, engine?: StudioEngineTransport | null) {
  const tool = zoraTools.find((t) => t.name === name)!
  const result = await runZoraTool(tool, args, deps(engine))
  const first = result.content[0]
  const body = first?.type === 'text' ? first.text : ''
  return { result, text: body, data: result.isError ? null : JSON.parse(body) }
}

const file = (bytes: Uint8Array) => ({ body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 8) })

let itemId: string
let designId: string

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
  designId = (await createContentDesign(db, workspace.id, ana.id, { itemId }))!.id
})

async function saveUserVersion(base: string | null, source: string) {
  return (await saveDesignVersion(db, bucket, {
    organizationId: workspace.id,
    designId,
    createdById: ana.id,
    authorKind: 'user',
    baseVersionId: base,
    source: file(text(source)),
    preview: file(PNG(99)),
  }))!
}

async function imageAsset(organizationId: string, forItem: string, bytes = JPEG, type = 'image/jpeg') {
  return (await createContentAsset(db, bucket, {
    organizationId,
    contentItemId: forItem,
    createdById: organizationId === workspace.id ? ana.id : bob.id,
    file: { name: 'photo.jpg', type, size: bytes.length },
    body: bytes.slice().buffer,
  }))!
}

describe('edit_design', () => {
  it('starts a design without a version from a blank artboard and saves an agent version', async () => {
    const edit = await call('edit_design', {
      designId,
      commands: [{ command: 'shape.rectangle', params: { x: 0, y: 0, width: 100, height: 100 } }],
    })
    expect(edit.result.isError).toBeFalsy()
    expect(edit.data).toMatchObject({ designId, number: 1, baseVersionId: null })
    expect(edit.data.results).toEqual([{ index: 0, ok: true }])
    expect(edit.data.url).toBe(`https://zora.test/content/${itemId}/designs/${designId}`)
    expect(edit.result.content[1]).toEqual({ type: 'image', data: bytesToBase64(PNG(1)), mimeType: 'image/png' })

    expect(engineCalls).toHaveLength(1)
    expect(engineCalls[0]).toMatchObject({ path: '/run', method: 'POST' })
    expect(engineCalls[0]!.body).toEqual({
      new: { width: 1080, height: 1080, name: 'Post do Instagram' },
      commands: [{ command: 'shape.rectangle', params: { x: 0, y: 0, width: 100, height: 100 } }],
      render: { scale: 1, maxSize: 4096 },
    })

    const [version] = (await listDesignVersions(db, workspace.id, designId))!
    expect(version).toMatchObject({ number: 1, authorKind: 'agent', createdById: ana.id })
    expect(objects.get(designSourceKey(designId, version!.id))).toEqual(text('{"ran":1}'))
    expect(objects.get(designPreviewKey(designId, version!.id))).toEqual(PNG(1))
  })

  it('runs on the current version and passes its source', async () => {
    const first = await saveUserVersion(null, '{"by":"ana"}')
    const edit = await call('edit_design', {
      designId,
      baseVersionId: first.versionId,
      commands: [{ command: 'text.add' }, { command: 'text.set_font', params: { family: 'Inter' } }],
    })
    expect(edit.data).toMatchObject({ number: 2, baseVersionId: first.versionId })
    const body = engineCalls[0]!.body!
    expect(base64ToBytes(body.source as string)).toEqual(text('{"by":"ana"}'))
    expect(body.new).toBeUndefined()
    // Missing params are sent as an empty object.
    expect(body.commands).toEqual([
      { command: 'text.add', params: {} },
      { command: 'text.set_font', params: { family: 'Inter' } },
    ])
  })

  it('maps a 422 to an error naming the failing command and saves nothing', async () => {
    answer = () => Response.json({ error: 'Unknown font "Comic"', index: 1 }, { status: 422 })
    const edit = await call('edit_design', {
      designId,
      commands: [{ command: 'text.add' }, { command: 'text.set_font', params: { family: 'Comic' } }],
    })
    expect(edit.result.isError).toBe(true)
    expect(edit.text).toContain('Command 1 ("text.set_font") failed: Unknown font "Comic"')
    expect(edit.text).toContain('Nothing was saved')
    expect(await listDesignVersions(db, workspace.id, designId)).toEqual([])
    expect([...objects.keys()].some((key) => key.startsWith('designs/'))).toBe(false)
  })

  it('refuses a stale base version before calling the engine', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    const second = await saveUserVersion(first.versionId, '{"v":2}')
    const edit = await call('edit_design', {
      designId,
      baseVersionId: first.versionId,
      commands: [{ command: 'text.add' }],
    })
    expect(edit.result.isError).toBe(true)
    expect(edit.text).toContain(`current version is number 2 (id ${second.versionId})`)
    expect(edit.text).toContain('Look at it again')
    expect(engineCalls).toHaveLength(0)
  })

  it('refuses to save when someone saved while the engine ran (409 rule)', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    answer = async (c) => {
      // The person saves in Studio while the engine works.
      await saveUserVersion(first.versionId, '{"v":"studio"}')
      return runOk(c)
    }
    const edit = await call('edit_design', { designId, commands: [{ command: 'text.add' }] })
    expect(edit.result.isError).toBe(true)
    expect(edit.text).toContain('current version is number 2')
    const versions = (await listDesignVersions(db, workspace.id, designId))!
    expect(versions.map((v) => [v.number, v.authorKind])).toEqual([[2, 'user'], [1, 'user']])
    // The engine's files were not left behind.
    expect([...objects.keys()].filter((key) => key.startsWith(`designs/${designId}/`))).toHaveLength(4)
  })

  it('passes images of the workspace as base64 by name', async () => {
    const otherItem = (
      await content.createContentItem(
        db,
        workspace.id,
        ana.id,
        createContentItemSchema.parse({ title: 'Logo', channel: 'x', format: 'post' }),
      )
    ).id
    const photo = await imageAsset(workspace.id, itemId)
    const logo = await imageAsset(workspace.id, otherItem, PNG(5), 'image/png')
    const edit = await call('edit_design', {
      designId,
      commands: [{ command: 'image.place', params: { path: 'zora-image:bg' } }],
      images: { bg: photo.id, logo: logo.id },
    })
    expect(edit.result.isError).toBeFalsy()
    const images = engineCalls[0]!.body!.images as Record<string, string>
    expect(Object.keys(images).sort()).toEqual(['bg', 'logo'])
    expect(base64ToBytes(images.bg!)).toEqual(JPEG)
    expect(base64ToBytes(images.logo!)).toEqual(PNG(5))
    expect(engineCalls[0]!.body!.commands).toEqual([
      { command: 'image.place', params: { path: 'zora-image:bg' } },
    ])
  })

  it('never reads images or designs of another workspace', async () => {
    const theirItem = (
      await content.createContentItem(
        db,
        OTHER_WORKSPACE,
        bob.id,
        createContentItemSchema.parse({ title: 'Theirs', channel: 'x', format: 'post' }),
      )
    ).id
    const theirPhoto = await imageAsset(OTHER_WORKSPACE, theirItem)
    const theirDesign = (await createContentDesign(db, OTHER_WORKSPACE, bob.id, { itemId: theirItem }))!

    const image = await call('edit_design', {
      designId,
      commands: [{ command: 'image.place', params: { path: 'zora-image:bg' } }],
      images: { bg: theirPhoto.id },
    })
    expect(image.result.isError).toBe(true)
    expect(image.text).toContain(`No media file with id ${theirPhoto.id}`)

    const design = await call('edit_design', { designId: theirDesign.id, commands: [{ command: 'text.add' }] })
    expect(design.text).toContain(`No design with id ${theirDesign.id}`)
    expect(engineCalls).toHaveLength(0)
  })

  it('refuses non-images, oversized images, bad names and too many commands', async () => {
    const pdf = (await createContentAsset(db, bucket, {
      organizationId: workspace.id,
      contentItemId: itemId,
      createdById: ana.id,
      file: { name: 'brief.pdf', type: 'application/pdf', size: 5 },
      body: text('%PDF-').slice().buffer,
    }))!
    const notImage = await call('edit_design', {
      designId,
      commands: [{ command: 'text.add' }],
      images: { doc: pdf.id },
    })
    expect(notImage.text).toContain('is not an image')

    // A recorded size over the limit is refused without reading the file.
    const big = await imageAsset(workspace.id, itemId)
    const { contentAsset } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    await db.update(contentAsset).set({ size: MAX_ENGINE_IMAGE_BYTES + 1 }).where(eq(contentAsset.id, big.id))
    const tooBig = await call('edit_design', {
      designId,
      commands: [{ command: 'text.add' }],
      images: { bg: big.id },
    })
    expect(tooBig.text).toContain('is larger than 25 MB')

    const badName = await call('edit_design', {
      designId,
      commands: [{ command: 'text.add' }],
      images: { 'no spaces': big.id },
    })
    expect(badName.result.isError).toBe(true)

    const tooMany = await call('edit_design', {
      designId,
      commands: Array.from({ length: 201 }, () => ({ command: 'text.add' })),
    })
    expect(tooMany.result.isError).toBe(true)
    expect(engineCalls).toHaveLength(0)
  })

  it('does not save engine output that is not a Studio document', async () => {
    answer = () =>
      Response.json({ source: bytesToBase64(text('<svg/>')), preview: bytesToBase64(PNG(1)), results: [] })
    const edit = await call('edit_design', { designId, commands: [{ command: 'text.add' }] })
    expect(edit.result.isError).toBe(true)
    expect(edit.text).toContain("output could not be stored")
    expect(await listDesignVersions(db, workspace.id, designId)).toEqual([])
  })

  it('does not inline a PNG over the preview limit', async () => {
    const huge = new Uint8Array(MAX_MCP_IMAGE_PREVIEW_BYTES + 1)
    huge.set(PNG(0))
    answer = () =>
      Response.json({ source: bytesToBase64(text('{}')), preview: bytesToBase64(huge), results: [] })
    const edit = await call('edit_design', { designId, commands: [{ command: 'text.add' }] })
    expect(edit.data.number).toBe(1)
    expect(edit.result.content).toHaveLength(2)
    expect(edit.result.content[1]).toMatchObject({ type: 'text' })
    expect((edit.result.content[1] as { text: string }).text).toContain('render_design')
  })
})

describe('without an engine', () => {
  it('says the engine is not configured and touches nothing', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    for (const [name, args] of [
      ['edit_design', { designId, commands: [{ command: 'text.add' }] }],
      ['list_design_commands', {}],
      ['inspect_design', { designId }],
      ['render_design', { designId, scale: 0.5 }],
    ] as const) {
      const result = await call(name, args, null)
      expect(result.result.isError, name).toBe(true)
      expect(result.text, name).toContain('design engine is not configured')
    }
    expect((await listDesignVersions(db, workspace.id, designId))!.map((v) => v.id)).toEqual([
      first.versionId,
    ])
  })

  it('still renders the stored preview and lists fonts', async () => {
    await saveUserVersion(null, '{"v":1}')
    const render = await call('render_design', { designId }, null)
    expect(render.data).toMatchObject({ number: 1, size: 9 })
    expect(render.result.content[1]).toEqual({ type: 'image', data: bytesToBase64(PNG(99)), mimeType: 'image/png' })
    const fonts = await call('list_design_fonts', {}, null)
    expect(fonts.data.count).toBe(0)
    expect(fonts.data.note).toContain('fonts:sync')
  })

  it('reports a container without an image as not configured', async () => {
    answer = () => Response.json({ error: 'not-configured' }, { status: 503 })
    const list = await call('list_design_commands', {})
    expect(list.text).toContain('design engine is not configured')
  })
})

describe('render_design and inspect_design', () => {
  it('re-renders at a scale without saving', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    const render = await call('render_design', { designId, scale: 0.5 })
    expect(render.data).toMatchObject({ versionId: first.versionId, scale: 0.5 })
    expect(engineCalls[0]!.body).toMatchObject({ commands: [], render: { scale: 0.5, maxSize: 4096 } })
    expect(base64ToBytes(engineCalls[0]!.body!.source as string)).toEqual(text('{"v":1}'))
    expect((await listDesignVersions(db, workspace.id, designId))!).toHaveLength(1)
  })

  it('needs a saved version', async () => {
    const render = await call('render_design', { designId })
    expect(render.text).toContain('has no saved version yet')
  })

  it('returns the structure of a given version', async () => {
    const first = await saveUserVersion(null, '{"v":1}')
    await saveUserVersion(first.versionId, '{"v":2}')
    answer = (c) => runOk(c, { inspect: { artboards: [{ name: 'Post', layers: 3 }] } })
    const inspected = await call('inspect_design', { designId, versionId: first.versionId })
    expect(inspected.data).toMatchObject({
      versionId: first.versionId,
      number: 1,
      structure: { artboards: [{ name: 'Post', layers: 3 }] },
    })
    expect(engineCalls[0]!.body).toMatchObject({ commands: [], inspect: true })
    expect(base64ToBytes(engineCalls[0]!.body!.source as string)).toEqual(text('{"v":1}'))
  })
})

describe('list_design_commands and list_design_fonts', () => {
  it('filters through the engine and keeps the list compact', async () => {
    answer = () =>
      Response.json(
        Array.from({ length: 50 }, (_, i) => ({
          id: `text.cmd${i}`,
          label: `Text ${i}`,
          params: i === 0 ? { doc: 'x'.repeat(5000) } : { size: 'number' },
          extra: 'dropped',
        })),
      )
    const list = await call('list_design_commands', { query: 'text', limit: 10 })
    expect(engineCalls[0]!.path).toBe('/commands?q=text')
    expect(list.data).toMatchObject({ total: 50, shown: 10 })
    expect(list.data.note).toContain('narrow the query')
    expect(list.data.commands[1]).toEqual({ id: 'text.cmd1', label: 'Text 1', params: { size: 'number' } })
    expect(typeof list.data.commands[0].params).toBe('string')
    expect(list.data.commands[0].params).toContain('(cut:')
  })

  it('lists the font library from R2', async () => {
    objects.set(
      'studio-fonts/manifest.json',
      text(
        JSON.stringify({
          version: 'v1',
          source: { repo: 'google/fonts', commit: 'abc' },
          families: [
            {
              family: 'Inter',
              category: 'SANS_SERIF',
              license: 'OFL-1.1',
              licenseUrl: '/studio-fonts/inter/OFL.txt',
              axes: [{ tag: 'wght', min: 100, max: 900 }],
              files: [
                { style: 'Regular', weight: 400, italic: false, url: '/a', sha256: 'a', size: 1, variable: true },
                { style: 'Italic', weight: 400, italic: true, url: '/b', sha256: 'b', size: 1, variable: true },
              ],
            },
            {
              family: 'Lora',
              category: 'SERIF',
              license: 'OFL-1.1',
              licenseUrl: '/studio-fonts/lora/OFL.txt',
              axes: [],
              files: [{ style: 'Regular', weight: 400, italic: false, url: '/c', sha256: 'c', size: 1, variable: false }],
            },
          ],
        }),
      ),
    )
    const all = await call('list_design_fonts', {})
    expect(all.data.families).toEqual([
      { family: 'Inter', category: 'SANS_SERIF', styles: ['Regular', 'Italic'], axes: ['wght 100-900'] },
      { family: 'Lora', category: 'SERIF', styles: ['Regular'] },
    ])
    expect(all.data.note).toContain('built-in fonts')
    const serif = await call('list_design_fonts', { category: 'serif' })
    expect(serif.data.families.map((f: { family: string }) => f.family)).toEqual(['Lora'])
    expect(engineCalls).toHaveLength(0)
  })
})
