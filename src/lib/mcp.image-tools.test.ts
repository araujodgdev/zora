import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { user } from '../db/schema'
import type { MediaBucket, MediaObject } from './content-assets.server'
import { createContentItemSchema } from './content'
import * as content from './content.server'
import { FAL_IMAGE_MODEL, MAX_PROVIDER_IMAGE_BYTES } from './image-providers.server'
import type { ImageProviderConfig } from './image-providers.server'
import { runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'

// The image tools (Unsplash, fal) with `fetch` mocked: no request leaves the
// test, and every request the tools make is recorded.

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
const UNSPLASH_KEY = 'unsplash-secret-key'
const FAL_KEY = 'fal-secret-key'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 9, 9])

type Call = { url: string; method: string; headers: Headers; body: string | null }
type Handler = (call: Call) => Response | Promise<Response>
let calls: Array<Call> = []
let routes: Array<[(url: URL) => boolean, Handler]> = []

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const call: Call = {
    url: url.toString(),
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: typeof init?.body === 'string' ? init.body : null,
  }
  calls.push(call)
  const route = routes.find(([match]) => match(url))
  if (!route) return new Response('not mocked', { status: 599 })
  return route[1](call)
}

function on(match: (url: URL) => boolean, handler: Handler) {
  routes.push([match, handler])
}
const json = (body: unknown, status = 200) => Response.json(body, { status })
const image = (bytes: Uint8Array = JPEG, type = 'image/jpeg', headers: Record<string, string> = {}) =>
  new Response(bytes.slice(), { headers: { 'content-type': type, ...headers } })

const keys: ImageProviderConfig = {
  unsplashAccessKey: UNSPLASH_KEY,
  falKey: FAL_KEY,
  fetch: fakeFetch,
  sleep: async () => {},
}
function deps(images: ImageProviderConfig = keys): McpDeps {
  return { db, bucket, user: ana, workspace, appUrl: 'https://zora.test', images }
}

async function call(name: string, args: unknown, images?: ImageProviderConfig) {
  const tool = zoraTools.find((t) => t.name === name)!
  const result = await runZoraTool(tool, args, deps(images))
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  // Keys never leak into what the agent reads.
  expect(JSON.stringify(result)).not.toContain(UNSPLASH_KEY)
  expect(JSON.stringify(result)).not.toContain(FAL_KEY)
  return { result, text, data: result.isError ? null : JSON.parse(text) }
}

function photo(id = 'abc123', overrides: Record<string, unknown> = {}) {
  return {
    id,
    width: 6000,
    height: 4000,
    description: 'A desk with a laptop',
    alt_description: 'laptop on a desk',
    urls: {
      raw: `https://images.unsplash.com/photo-${id}?ixid=IX${id}`,
      thumb: `https://images.unsplash.com/photo-${id}?ixid=IX${id}&w=200`,
      small: `https://images.unsplash.com/photo-${id}?ixid=IX${id}&w=400`,
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download: `https://unsplash.com/photos/${id}/download`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=IX${id}`,
    },
    user: { name: 'Ana Lúcia', username: 'analu', links: { html: 'https://unsplash.com/@analu' } },
    ...overrides,
  }
}

let itemId: string

function newItem(organizationId: string, fields: { title: string; channel: string; format: string }) {
  return content.createContentItem(db, organizationId, ana.id, createContentItemSchema.parse(fields))
}

beforeEach(async () => {
  await resetDatabase(db)
  objects.clear()
  calls = []
  routes = []
  await db.insert(user).values({ ...ana, emailVerified: true })
  await seedWorkspace(db, workspace.id, [ana.id], workspace.name)
  itemId = (await newItem(workspace.id, { title: 'T', channel: 'instagram', format: 'post' })).id
})

describe('missing keys', () => {
  it('names the missing secret and calls nobody', async () => {
    const none = { fetch: fakeFetch, sleep: async () => {} }
    const search = await call('search_stock_images', { query: 'desk' }, none)
    expect(search.result.isError).toBe(true)
    expect(search.text).toContain('UNSPLASH_ACCESS_KEY')
    const add = await call('add_stock_image', { itemId, photoId: 'abc123' }, none)
    expect(add.text).toContain('UNSPLASH_ACCESS_KEY')
    const generate = await call('generate_image', { itemId, prompt: 'a cat' }, none)
    expect(generate.result.isError).toBe(true)
    expect(generate.text).toContain('FAL_KEY')
    expect(calls).toHaveLength(0)
  })

  it('keeps the tools listed', () => {
    const names = zoraTools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['search_stock_images', 'add_stock_image', 'generate_image']))
  })
})

describe('search_stock_images', () => {
  it('searches with the key, the design shape and returns thumbnails', async () => {
    const design = (await call('create_design', { itemId })).data // Instagram 1080×1080
    on((u) => u.pathname === '/search/photos', () =>
      json({ total: 2, total_pages: 1, results: [photo('abc123'), photo('def456')] }),
    )
    on((u) => u.hostname === 'images.unsplash.com', () => image())

    const found = await call('search_stock_images', { query: 'desk', designId: design.id, perPage: 5 })
    expect(found.result.isError).toBeFalsy()
    const request = new URL(calls[0]!.url)
    expect(request.origin).toBe('https://api.unsplash.com')
    expect(Object.fromEntries(request.searchParams)).toMatchObject({
      query: 'desk', orientation: 'squarish', per_page: '5', page: '1', content_filter: 'high',
    })
    expect(calls[0]!.headers.get('authorization')).toBe(`Client-ID ${UNSPLASH_KEY}`)
    expect(calls[0]!.headers.get('accept-version')).toBe('v1')

    expect(found.data.photos[0]).toEqual({
      id: 'abc123',
      description: 'A desk with a laptop',
      width: 6000,
      height: 4000,
      thumbnailUrl: 'https://images.unsplash.com/photo-abc123?ixid=IXabc123&w=200',
      photographer: { name: 'Ana Lúcia', profileUrl: 'https://unsplash.com/@analu?utm_source=zora&utm_medium=referral' },
      unsplashUrl: 'https://unsplash.com/photos/abc123?utm_source=zora&utm_medium=referral',
    })
    // The thumbnails exactly as returned (hotlinked URLs), shown as images.
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      'https://images.unsplash.com/photo-abc123?ixid=IXabc123&w=200',
      'https://images.unsplash.com/photo-def456?ixid=IXdef456&w=200',
    ])
    const shown = found.result.content.filter((c) => c.type === 'image')
    expect(shown).toHaveLength(2)
    expect(shown[0]).toMatchObject({ mimeType: 'image/jpeg' })
    expect(objects.size).toBe(0)
  })

  it('skips thumbnails on request and reports provider errors', async () => {
    on((u) => u.pathname === '/search/photos', () => json({ total: 1, total_pages: 1, results: [photo()] }))
    const plain = await call('search_stock_images', { query: 'desk', orientation: 'portrait', previews: false })
    expect(plain.result.content).toHaveLength(1)
    expect(calls).toHaveLength(1)

    routes = []
    on(() => true, () => json({ errors: ['OAuth error: The access token is invalid'] }, 401))
    const refused = await call('search_stock_images', { query: 'desk' })
    expect(refused.result.isError).toBe(true)
    expect(refused.text).toMatch(/HTTP 401.*access token is invalid/)

    routes = []
    on(() => true, () => json({ unexpected: true }))
    expect((await call('search_stock_images', { query: 'desk' })).text).toMatch(/unexpected response/)
  })
})

describe('add_stock_image', () => {
  function photoRoutes(file: () => Response = () => image()) {
    on((u) => u.hostname === 'api.unsplash.com' && u.pathname === '/photos/abc123', () => json(photo()))
    on((u) => u.hostname === 'api.unsplash.com' && u.pathname === '/photos/abc123/download', () =>
      json({ url: 'https://images.unsplash.com/photo-abc123?ixid=IXabc123' }),
    )
    on((u) => u.hostname === 'images.unsplash.com', file)
  }

  it('stores the photo with its attribution and tracks the download', async () => {
    photoRoutes()
    const added = await call('add_stock_image', { itemId, photoId: 'abc123' })
    expect(added.result.isError).toBeFalsy()
    expect(added.data.asset).toMatchObject({
      filename: 'unsplash-ana-lucia-abc123.jpg',
      contentType: 'image/jpeg',
      size: JPEG.length,
      kind: 'image',
      attribution: {
        provider: 'unsplash',
        photoId: 'abc123',
        photographer: 'Ana Lúcia',
        photographerUrl: 'https://unsplash.com/@analu?utm_source=zora&utm_medium=referral',
        photoUrl: 'https://unsplash.com/photos/abc123?utm_source=zora&utm_medium=referral',
      },
    })
    expect(added.data.attribution).toMatchObject({
      text: 'Photo by Ana Lúcia on Unsplash',
      textPtBr: 'Foto: Ana Lúcia / Unsplash',
      unsplashUrl: 'https://unsplash.com/?utm_source=zora&utm_medium=referral',
    })
    expect(added.data.downloadTracked).toBe(true)

    // The file comes from urls.raw with ixid kept and the long side capped.
    const file = new URL(calls[1]!.url)
    expect(file.hostname).toBe('images.unsplash.com')
    expect(Object.fromEntries(file.searchParams)).toEqual({ ixid: 'IXabc123', w: '3000', fit: 'max', fm: 'jpg', q: '85' })
    // Tracking: download_location as returned (ixid kept), with the key, after storing.
    expect(calls[2]!.url).toBe('https://api.unsplash.com/photos/abc123/download?ixid=IXabc123')
    expect(calls[2]!.headers.get('authorization')).toBe(`Client-ID ${UNSPLASH_KEY}`)
    expect(calls).toHaveLength(3)

    const key = `content/${itemId}/${added.data.asset.id}`
    expect(objects.get(key)).toEqual(JPEG)
    const item = await call('get_content_item', { id: itemId })
    expect(item.data.media[0].attribution.photographer).toBe('Ana Lúcia')
  })

  it('caps a portrait photo by its height and honours maxSide', async () => {
    on((u) => u.pathname === '/photos/tall', () => json(photo('tall', { width: 2000, height: 5000 })))
    on((u) => u.pathname === '/photos/tall/download', () => json({ url: 'x' }))
    on((u) => u.hostname === 'images.unsplash.com', () => image())
    await call('add_stock_image', { itemId, photoId: 'tall', maxSide: 1200 })
    expect(new URL(calls[1]!.url).searchParams.get('h')).toBe('1200')
  })

  it('refuses wrong types, fake images, oversized files and foreign hosts without storing or tracking', async () => {
    const cases: Array<[() => Response, RegExp]> = [
      [() => new Response('<html>', { headers: { 'content-type': 'text/html' } }), /not a supported image \(text\/html\)/],
      [() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), /not a supported image/],
      [() => image(new TextEncoder().encode('<html>not a jpeg</html>')), /not a valid image\/jpeg/],
      [() => image(JPEG, 'image/jpeg', { 'content-length': String(MAX_PROVIDER_IMAGE_BYTES + 1) }), /larger than 30 MB/],
      [() => new Response(null, { status: 404 }), /HTTP 404/],
    ]
    for (const [file, message] of cases) {
      routes = []
      calls = []
      photoRoutes(file)
      const added = await call('add_stock_image', { itemId, photoId: 'abc123' })
      expect(added.result.isError, String(message)).toBe(true)
      expect(added.text).toMatch(message)
      expect(calls.some((c) => c.url.includes('/download'))).toBe(false)
    }

    // A body larger than the cap without a Content-Length is cut off while reading.
    routes = []
    calls = []
    const big = new Uint8Array(MAX_PROVIDER_IMAGE_BYTES + 1024)
    big.set(JPEG)
    photoRoutes(() => new Response(new Blob([big]).stream(), { headers: { 'content-type': 'image/jpeg' } }))
    expect((await call('add_stock_image', { itemId, photoId: 'abc123' })).text).toMatch(/larger than/)

    // A redirect off Unsplash's hosts is not followed.
    routes = []
    calls = []
    photoRoutes(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } }))
    expect((await call('add_stock_image', { itemId, photoId: 'abc123' })).text).toMatch(/outside its own domains/)
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false)

    // A file URL on another host is never fetched.
    routes = []
    calls = []
    on((u) => u.pathname === '/photos/abc123', () =>
      json(photo('abc123', { urls: { raw: 'https://evil.example/p?ixid=1', thumb: 'https://evil.example/t' } })),
    )
    expect((await call('add_stock_image', { itemId, photoId: 'abc123' })).text).toMatch(/outside its own domains/)
    expect(calls).toHaveLength(1)
    expect(objects.size).toBe(0)
  })

  it('stores the photo even when tracking fails, and says so', async () => {
    on((u) => u.pathname === '/photos/abc123', () => json(photo()))
    on((u) => u.pathname === '/photos/abc123/download', () => json({}, 500))
    on((u) => u.hostname === 'images.unsplash.com', () => image())
    const added = await call('add_stock_image', { itemId, photoId: 'abc123' })
    expect(added.data.downloadTracked).toBe(false)
    expect(objects.size).toBe(1)
  })

  it('reports an unknown photo and rejects malformed ids', async () => {
    on(() => true, () => json({ errors: ['Couldn\'t find Photo'] }, 404))
    expect((await call('add_stock_image', { itemId, photoId: 'nope' })).text).toMatch(/no photo with that id/)
    expect((await call('add_stock_image', { itemId, photoId: '../x' })).result.isError).toBe(true)
  })
})

describe('workspace scoping', () => {
  it('refuses items and designs of another workspace before calling a provider', async () => {
    await seedWorkspace(db, 'ws-other', [])
    const foreign = await newItem('ws-other', { title: 'X', channel: 'x', format: 'post' })
    on(() => true, () => json({}))

    const add = await call('add_stock_image', { itemId: foreign.id, photoId: 'abc123' })
    expect(add.text).toContain('No content item')
    const generate = await call('generate_image', { itemId: foreign.id, prompt: 'a cat' })
    expect(generate.text).toContain('No content item')
    expect(calls).toHaveLength(0)

    // A design id that is not in this workspace is "not found" too.
    const search = await call('search_stock_images', {
      query: 'desk',
      designId: '00000000-0000-4000-8000-000000000000',
    })
    expect(search.text).toContain('No design')
    expect(calls).toHaveLength(0)
  })
})

describe('generate_image', () => {
  const QUEUE = `https://queue.fal.run/${FAL_IMAGE_MODEL}`
  const STATUS = 'https://queue.fal.run/fal-ai/nano-banana-2/requests/req-123/status'
  const RESULT = 'https://queue.fal.run/fal-ai/nano-banana-2/requests/req-123'
  const CANCEL = 'https://queue.fal.run/fal-ai/nano-banana-2/requests/req-123/cancel'

  function falRoutes(statuses: Array<unknown>, result: unknown = {
    images: [
      { url: 'https://v3b.fal.media/files/b/one.jpg', content_type: 'image/jpeg', width: 2048, height: 1152 },
      { url: 'https://v3b.fal.media/files/b/two.jpg', content_type: 'image/jpeg', width: 2048, height: 1152 },
    ],
    description: 'Two images',
  }) {
    on((u) => u.toString() === QUEUE, () =>
      json({ request_id: 'req-123', status_url: STATUS, response_url: RESULT, cancel_url: CANCEL, queue_position: 0 }),
    )
    let poll = 0
    on((u) => u.toString() === STATUS, () => json(statuses[Math.min(poll++, statuses.length - 1)]))
    on((u) => u.toString() === CANCEL, () => json({ status: 'CANCELLATION_REQUESTED' }, 202))
    on((u) => u.toString() === RESULT, () => json(result))
    on((u) => u.hostname.endsWith('fal.media'), () => image())
  }

  it('submits, polls, stores every image and shows them', async () => {
    const item = await newItem(workspace.id, { title: 'X', channel: 'x', format: 'post' })
    const design = (await call('create_design', { itemId: item.id })).data // X 1600×900
    falRoutes([{ status: 'IN_QUEUE', queue_position: 1 }, { status: 'IN_PROGRESS' }, { status: 'COMPLETED' }])

    const generated = await call('generate_image', {
      itemId: item.id, designId: design.id, prompt: 'Lime clay cat on a desk', count: 2,
    })
    expect(generated.result.isError).toBeFalsy()

    const submit = calls[0]!
    expect(submit).toMatchObject({ url: QUEUE, method: 'POST' })
    expect(submit.headers.get('authorization')).toBe(`Key ${FAL_KEY}`)
    expect(JSON.parse(submit.body!)).toEqual({
      prompt: 'Lime clay cat on a desk', num_images: 2, aspect_ratio: '16:9', resolution: '2K', output_format: 'jpeg',
    })
    expect(calls.filter((c) => c.url === STATUS)).toHaveLength(3)
    expect(calls.filter((c) => c.url === RESULT)).toHaveLength(1)

    expect(generated.data).toMatchObject({ model: FAL_IMAGE_MODEL, requestId: 'req-123', aspectRatio: '16:9', resolution: '2K' })
    expect(generated.data.assets).toHaveLength(2)
    expect(generated.data.assets[0]).toMatchObject({
      filename: 'lime-clay-cat-on-a-desk-req-123-1.jpg',
      contentType: 'image/jpeg',
      attribution: { provider: 'fal', model: FAL_IMAGE_MODEL, prompt: 'Lime clay cat on a desk' },
    })
    expect(objects.size).toBe(2)
    expect(generated.result.content.filter((c) => c.type === 'image')).toHaveLength(2)
  })

  it('defaults to 1:1 at 1K and takes an explicit aspect ratio', async () => {
    falRoutes([{ status: 'COMPLETED' }], { images: [{ url: 'https://fal.media/files/a.jpg' }] })
    await call('generate_image', { itemId, prompt: 'a cat' })
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ aspect_ratio: '1:1', resolution: '1K', num_images: 1 })
    calls = []
    await call('generate_image', { itemId, prompt: 'a cat', aspectRatio: '9:16', resolution: '4K' })
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ aspect_ratio: '9:16', resolution: '4K' })
  })

  it('reports failures: HTTP errors, failed requests, timeouts, foreign hosts, bad files', async () => {
    on(() => true, () => json({ detail: 'Invalid key' }, 401))
    const refused = await call('generate_image', { itemId, prompt: 'a cat' })
    expect(refused.text).toMatch(/fal answered HTTP 401: Invalid key/)

    routes = []
    falRoutes([{ status: 'COMPLETED', error: 'Prompt was blocked', error_type: 'content_policy_violation' }])
    expect((await call('generate_image', { itemId, prompt: 'a cat' })).text).toMatch(/Prompt was blocked \(content_policy_violation\)/)

    routes = []
    calls = []
    falRoutes([{ status: 'IN_PROGRESS' }])
    const slow = await call('generate_image', { itemId, prompt: 'a cat' })
    expect(slow.text).toMatch(/did not finish within 90 s/)
    expect(calls.filter((c) => c.url === STATUS)).toHaveLength(36)
    expect(calls.find((c) => c.url === CANCEL)?.method).toBe('PUT')

    routes = []
    falRoutes([{ status: 'COMPLETED' }], { images: [{ url: 'https://evil.example/a.jpg' }] })
    expect((await call('generate_image', { itemId, prompt: 'a cat' })).text).toMatch(/No image could be stored.*outside its own domains/)

    routes = []
    on((u) => u.toString() === QUEUE, () =>
      json({ request_id: 'r', status_url: 'https://evil.example/s', response_url: RESULT }),
    )
    expect((await call('generate_image', { itemId, prompt: 'a cat' })).text).toMatch(/outside its own domains/)

    routes = []
    falRoutes([{ status: 'COMPLETED' }], { images: [{ url: 'https://v3b.fal.media/a.png' }, { url: 'https://v3b.fal.media/b.png' }] })
    let first = true
    routes.unshift([(u) => u.hostname === 'v3b.fal.media', () => {
      const ok = first
      first = false
      return ok ? image() : new Response('x', { headers: { 'content-type': 'text/plain' } })
    }])
    const partial = await call('generate_image', { itemId, prompt: 'a cat', count: 2 })
    expect(partial.data.assets).toHaveLength(1)
    expect(partial.data.failed[0]).toMatch(/Image 2: .*not a supported image/)

    routes = []
    falRoutes([{ status: 'COMPLETED' }], { images: [] })
    expect((await call('generate_image', { itemId, prompt: 'a cat' })).text).toMatch(/no images/)
  })

  it('refuses a design of another item', async () => {
    const other = await newItem(workspace.id, { title: 'O', channel: 'x', format: 'post' })
    const design = (await call('create_design', { itemId: other.id })).data
    const refused = await call('generate_image', { itemId, designId: design.id, prompt: 'a cat' })
    expect(refused.text).toMatch(/belongs to another content item/)
    expect(calls).toHaveLength(0)
  })
})
