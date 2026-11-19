/**
 * Image providers for designs: stock photos from Unsplash and generated
 * images from fal. Server-only, plain `fetch` (no SDKs), and independent of
 * TanStack Start so the MCP tools can be tested with `fetch` mocked.
 *
 * Every outbound request has a timeout and a status check, only goes to the
 * provider's own https hosts, and downloaded images are checked (type by
 * their first bytes, size while streaming) before anything is stored. Keys
 * never appear in errors or logs.
 *
 * Docs this follows:
 * - Unsplash API: https://unsplash.com/documentation (search, get a photo,
 *   track a download, dynamic resizing with `urls.raw` keeping `ixid`) and
 *   the API guidelines (attribution with UTM links, download tracking via
 *   `links.download_location`, hotlinked `photo.urls`).
 * - fal queue API: https://fal.ai/docs/model-apis/model-endpoints/queue
 *   (submit to `queue.fal.run/<endpoint>`, poll `status_url`, read
 *   `response_url`, `PUT cancel_url`; `Authorization: Key <FAL_KEY>`).
 */
import { z } from 'zod'
import { MEDIA_TYPES, formatBytes, withUnsplashUtm } from './content-assets'

export type ImageProviderConfig = {
  unsplashAccessKey?: string
  falKey?: string
  /** Defaults to the global `fetch`; tests pass a mock. */
  fetch?: typeof fetch
  /** Defaults to a timer; tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>
}

/** A provider refused or failed; the message is safe to show (no keys). */
export class ImageProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageProviderError'
  }
}

/** Timeout of one API request (search, status, result). */
const API_TIMEOUT_MS = 15_000
/** Timeout of one image download. */
const DOWNLOAD_TIMEOUT_MS = 60_000
/** Largest image Zora downloads from a provider (well under MAX_ASSET_BYTES and the Worker's memory). */
export const MAX_PROVIDER_IMAGE_BYTES = 30 * 1024 * 1024
/** Redirect hops followed for a download; each hop's host is checked again. */
const MAX_REDIRECTS = 3

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function fetcher(config: ImageProviderConfig): typeof fetch {
  return config.fetch ?? ((input, init) => fetch(input, init))
}

/** Parses `url` and checks it is https on one of `isAllowedHost`'s hosts. */
function checkedUrl(url: string, isAllowedHost: (host: string) => boolean, what: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ImageProviderError(`${what} returned an invalid URL.`)
  }
  if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname) || parsed.username || parsed.password) {
    throw new ImageProviderError(`${what} returned a URL outside its own domains (${parsed.hostname}); it was not fetched.`)
  }
  return parsed
}

async function requestJson(
  config: ImageProviderConfig,
  url: URL,
  init: RequestInit,
  provider: string,
): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetcher(config)(url.toString(), {
      ...init,
      // API answers are never redirects; a 3xx fails the status check.
      redirect: 'manual',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ImageProviderError(
      timedOut ? `${provider} did not answer within ${API_TIMEOUT_MS / 1000} s.` : `${provider} could not be reached.`,
    )
  }
  const text = await response.text().catch(() => '')
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

/** A provider's own error message from a JSON body, trimmed. */
function providerMessage(body: unknown): string | null {
  if (typeof body === 'string') return body.trim().slice(0, 300) || null
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  for (const key of ['errors', 'error', 'detail', 'message']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300)
    if (Array.isArray(value) && value.length > 0) {
      const parts = value.map((part) =>
        typeof part === 'string' ? part : typeof part?.msg === 'string' ? part.msg : JSON.stringify(part),
      )
      return parts.join('; ').slice(0, 300)
    }
  }
  return null
}

function statusError(provider: string, status: number, body: unknown): ImageProviderError {
  const detail = providerMessage(body)
  const hint =
    status === 401 || status === 403
      ? ' Check the API key (or the rate limit) configured on the Zora server.'
      : status === 429
        ? ' Too many requests; try again later.'
        : ''
  return new ImageProviderError(`${provider} answered HTTP ${status}${detail ? `: ${detail}` : ''}.${hint}`)
}

// --- image downloads ---------------------------------------------------------

const IMAGE_TYPES = Object.entries(MEDIA_TYPES)
  .filter(([, kind]) => kind === 'image')
  .map(([type]) => type)

/** The image type the bytes start with, among the ones Zora stores; else null. */
export function sniffImageType(head: Uint8Array): string | null {
  const starts = (...bytes: Array<number>) => bytes.every((byte, i) => head[i] === byte)
  const ascii = (offset: number, text: string) =>
    [...text].every((char, i) => head[offset + i] === char.charCodeAt(0))
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'image/avif'
  return null
}

export type DownloadedImage = { bytes: Uint8Array; contentType: string }

/**
 * Downloads an image from a provider's own hosts: https only, redirects
 * followed by hand with each hop checked, the declared and the actual type
 * must be an image type Zora stores, and the size is capped while reading.
 */
export async function downloadProviderImage(
  config: ImageProviderConfig,
  url: string,
  options: { provider: string; isAllowedHost: (host: string) => boolean; maxBytes?: number },
): Promise<DownloadedImage> {
  const maxBytes = options.maxBytes ?? MAX_PROVIDER_IMAGE_BYTES
  const what = `${options.provider} image`
  let target = checkedUrl(url, options.isAllowedHost, options.provider)
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      response = await fetcher(config)(target.toString(), { redirect: 'manual', signal })
    } catch {
      throw new ImageProviderError(`The ${what} could not be downloaded (network error or timeout).`)
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {})
      target = checkedUrl(new URL(location, target).toString(), options.isAllowedHost, options.provider)
      continue
    }
    break
  }
  if (!response || (response.status >= 300 && response.status < 400)) {
    throw new ImageProviderError(`The ${what} redirected too many times.`)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new ImageProviderError(`The ${what} download answered HTTP ${response.status}.`)
  }
  const declared = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!IMAGE_TYPES.includes(declared)) {
    await response.body?.cancel().catch(() => {})
    throw new ImageProviderError(`The ${what} is not a supported image (${declared || 'no content type'}).`)
  }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new ImageProviderError(`The ${what} is larger than ${formatBytes(maxBytes)}.`)
  }
  const bytes = await readCapped(response, maxBytes, what)
  if (bytes.length === 0) throw new ImageProviderError(`The ${what} is empty.`)
  const actual = sniffImageType(bytes.subarray(0, 16))
  if (!actual) throw new ImageProviderError(`The ${what} is not a valid ${declared} file.`)
  return { bytes, contentType: actual }
}

async function readCapped(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new ImageProviderError(`The ${what} is larger than ${formatBytes(maxBytes)}.`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ImageProviderError) throw error
    throw new ImageProviderError(`The ${what} download was interrupted.`)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function extensionFor(contentType: string): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }[
    contentType
  ] ?? 'img'
}

// --- Unsplash ------------------------------------------------------------------

const UNSPLASH_API = 'https://api.unsplash.com'
export const UNSPLASH_ORIENTATIONS = ['landscape', 'portrait', 'squarish'] as const
export type UnsplashOrientation = (typeof UNSPLASH_ORIENTATIONS)[number]

export const isUnsplashApiHost = (host: string) => host === 'api.unsplash.com'
/** Where Unsplash serves photo files (`photo.urls.*`). */
export const isUnsplashImageHost = (host: string) => host === 'images.unsplash.com'

/** Unsplash photo ids are short URL-safe slugs. */
export const unsplashPhotoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not an Unsplash photo id.')

const unsplashPhotoSchema = z.object({
  id: z.string(),
  width: z.number(),
  height: z.number(),
  description: z.string().nullish(),
  alt_description: z.string().nullish(),
  urls: z.object({ raw: z.string(), thumb: z.string(), small: z.string().optional() }),
  links: z.object({ html: z.string(), download_location: z.string() }),
  user: z.object({
    name: z.string(),
    username: z.string(),
    links: z.object({ html: z.string() }),
  }),
})
export type UnsplashPhoto = z.output<typeof unsplashPhotoSchema>

const unsplashSearchSchema = z.object({
  total: z.number(),
  total_pages: z.number(),
  results: z.array(unsplashPhotoSchema),
})

function unsplashKey(config: ImageProviderConfig): string {
  if (!config.unsplashAccessKey) {
    throw new ImageProviderError(
      'Stock photos are not configured: the UNSPLASH_ACCESS_KEY secret is not set on this Zora server. Ask the workspace owner to set it, or use generate_image or an upload instead.',
    )
  }
  return config.unsplashAccessKey
}

function unsplashHeaders(key: string): HeadersInit {
  return { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }
}

async function unsplashGet(config: ImageProviderConfig, url: URL): Promise<unknown> {
  const key = unsplashKey(config)
  checkedUrl(url.toString(), isUnsplashApiHost, 'Unsplash')
  const { status, body } = await requestJson(config, url, { headers: unsplashHeaders(key) }, 'Unsplash')
  if (status === 404) throw new ImageProviderError('Unsplash has no photo with that id.')
  if (status < 200 || status >= 300) throw statusError('Unsplash', status, body)
  return body
}

function parseUnsplash<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ImageProviderError('Unsplash returned an unexpected response.')
  return parsed.data
}

/** The compact form of a photo returned to agents, with UTM links. */
export function describeUnsplashPhoto(photo: UnsplashPhoto) {
  return {
    id: photo.id,
    description: photo.description || photo.alt_description || null,
    width: photo.width,
    height: photo.height,
    thumbnailUrl: photo.urls.thumb,
    photographer: { name: photo.user.name, profileUrl: withUnsplashUtm(photo.user.links.html) },
    unsplashUrl: withUnsplashUtm(photo.links.html),
  }
}

export async function searchUnsplashPhotos(
  config: ImageProviderConfig,
  input: { query: string; page: number; perPage: number; orientation?: UnsplashOrientation },
): Promise<{ total: number; totalPages: number; photos: Array<UnsplashPhoto> }> {
  const url = new URL('/search/photos', UNSPLASH_API)
  url.searchParams.set('query', input.query)
  url.searchParams.set('page', String(input.page))
  url.searchParams.set('per_page', String(input.perPage))
  // Content for a team's public posts: Unsplash's stricter filter.
  url.searchParams.set('content_filter', 'high')
  if (input.orientation) url.searchParams.set('orientation', input.orientation)
  const body = parseUnsplash(unsplashSearchSchema, await unsplashGet(config, url))
  return { total: body.total, totalPages: body.total_pages, photos: body.results }
}

export async function getUnsplashPhoto(config: ImageProviderConfig, id: string): Promise<UnsplashPhoto> {
  const url = new URL(`/photos/${encodeURIComponent(id)}`, UNSPLASH_API)
  return parseUnsplash(unsplashPhotoSchema, await unsplashGet(config, url))
}

/**
 * The file URL for a photo with its longest side capped at `maxSide`, built
 * from `urls.raw` as the docs describe (its `ixid` and other parameters kept).
 */
export function unsplashFileUrl(photo: UnsplashPhoto, maxSide: number): string {
  const url = checkedUrl(photo.urls.raw, isUnsplashImageHost, 'Unsplash')
  const side = photo.width >= photo.height ? 'w' : 'h'
  url.searchParams.set(side, String(Math.min(maxSide, Math.max(photo.width, photo.height))))
  url.searchParams.set('fit', 'max')
  url.searchParams.set('fm', 'jpg')
  url.searchParams.set('q', '85')
  return url.toString()
}

/**
 * Tells Unsplash the photo was used (the guidelines require it whenever a
 * photo is inserted somewhere). Calls `links.download_location` as returned,
 * with every parameter kept, authorized with the access key.
 */
export async function trackUnsplashDownload(config: ImageProviderConfig, photo: UnsplashPhoto): Promise<void> {
  const url = checkedUrl(photo.links.download_location, isUnsplashApiHost, 'Unsplash')
  await unsplashGet(config, url)
}

// --- fal -----------------------------------------------------------------------

/**
 * The fal text-to-image endpoint. Nano Banana 2 (Google): a current, highly
 * ranked general model that renders text well and is fast and mid-priced; it
 * takes an aspect ratio, a resolution and a count, which is what designs need.
 * Change only this constant (and `FAL_ASPECT_RATIOS` / the input mapping in
 * `generateFalImages` if the new model's schema differs).
 */
export const FAL_IMAGE_MODEL = 'fal-ai/nano-banana-2'
export const FAL_ASPECT_RATIOS = [
  '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4',
] as const
export type FalAspectRatio = (typeof FAL_ASPECT_RATIOS)[number]
export const FAL_RESOLUTIONS = ['1K', '2K', '4K'] as const
export type FalResolution = (typeof FAL_RESOLUTIONS)[number]
export const MAX_FAL_IMAGES = 4

const FAL_QUEUE = 'https://queue.fal.run'
export const isFalQueueHost = (host: string) => host === 'queue.fal.run'
/** Where fal serves generated files (e.g. `v3b.fal.media`). */
export const isFalMediaHost = (host: string) => host === 'fal.media' || host.endsWith('.fal.media')

/**
 * Polling: every 2.5 s for at most 90 s, i.e. at most 36 status reads. With
 * the submit, the result, a cancel and up to four downloads, one generation
 * stays under the 50 subrequests a Worker request gets on the Free plan.
 */
export const FAL_POLL_INTERVAL_MS = 2_500
export const FAL_MAX_WAIT_MS = 90_000

/** The supported aspect ratio closest to `width`:`height`. */
export function nearestFalAspectRatio(width: number, height: number): FalAspectRatio {
  const target = Math.log(width / height)
  let best: FalAspectRatio = '1:1'
  let bestDistance = Infinity
  for (const ratio of FAL_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number) as [number, number]
    const distance = Math.abs(Math.log(w / h) - target)
    if (distance < bestDistance) {
      best = ratio
      bestDistance = distance
    }
  }
  return best
}

function falKey(config: ImageProviderConfig): string {
  if (!config.falKey) {
    throw new ImageProviderError(
      'Image generation is not configured: the FAL_KEY secret is not set on this Zora server. Ask the workspace owner to set it, or use search_stock_images or an upload instead.',
    )
  }
  return config.falKey
}

const falSubmitSchema = z.object({
  request_id: z.string(),
  status_url: z.string(),
  response_url: z.string(),
  cancel_url: z.string().optional(),
})
const falStatusSchema = z.object({
  status: z.string(),
  error: z.string().nullish(),
  error_type: z.string().nullish(),
})
const falResultSchema = z.object({
  images: z.array(
    z.object({
      url: z.string(),
      content_type: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
    }),
  ),
  description: z.string().nullish(),
})

export type FalGeneration = {
  requestId: string
  images: Array<{ url: string; width: number | null; height: number | null }>
  description: string | null
}

/**
 * Generates images through fal's queue: submit, poll the status with a
 * bounded wait (cancelling the request when it runs out), then read the
 * result. Network waits do not count as Worker CPU time, and the number of
 * requests stays well under the per-request subrequest limit.
 */
export async function generateFalImages(
  config: ImageProviderConfig,
  input: { prompt: string; aspectRatio: FalAspectRatio; resolution: FalResolution; count: number },
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<FalGeneration> {
  const key = falKey(config)
  const sleep = config.sleep ?? defaultSleep
  const maxWaitMs = options.maxWaitMs ?? FAL_MAX_WAIT_MS
  const pollIntervalMs = options.pollIntervalMs ?? FAL_POLL_INTERVAL_MS
  const headers = { Authorization: `Key ${key}` }

  const submitted = await requestJson(
    config,
    new URL(`/${FAL_IMAGE_MODEL}`, FAL_QUEUE),
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt,
        num_images: input.count,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        // JPEG keeps files small enough to show the agent and decodes everywhere.
        output_format: 'jpeg',
      }),
    },
    'fal',
  )
  if (submitted.status < 200 || submitted.status >= 300) throw statusError('fal', submitted.status, submitted.body)
  const job = falSubmitSchema.safeParse(submitted.body)
  if (!job.success) throw new ImageProviderError('fal returned an unexpected response to the submission.')
  const statusUrl = checkedUrl(job.data.status_url, isFalQueueHost, 'fal')
  const responseUrl = checkedUrl(job.data.response_url, isFalQueueHost, 'fal')
  const requestId = job.data.request_id

  const polls = Math.max(1, Math.ceil(maxWaitMs / pollIntervalMs))
  let completed = false
  for (let poll = 0; poll < polls; poll += 1) {
    await sleep(pollIntervalMs)
    const { status, body } = await requestJson(config, statusUrl, { headers }, 'fal')
    if (status < 200 || status >= 300) throw statusError('fal', status, body)
    const state = falStatusSchema.safeParse(body)
    if (!state.success) throw new ImageProviderError('fal returned an unexpected status response.')
    if (state.data.status === 'COMPLETED') {
      if (state.data.error) {
        throw new ImageProviderError(
          `fal could not generate the image: ${state.data.error.slice(0, 300)}${state.data.error_type ? ` (${state.data.error_type})` : ''}.`,
        )
      }
      completed = true
      break
    }
    if (state.data.status !== 'IN_QUEUE' && state.data.status !== 'IN_PROGRESS') {
      throw new ImageProviderError(`fal reported an unknown status (${state.data.status.slice(0, 40)}).`)
    }
  }
  if (!completed) {
    if (job.data.cancel_url) {
      const cancelUrl = checkedUrl(job.data.cancel_url, isFalQueueHost, 'fal')
      await requestJson(config, cancelUrl, { method: 'PUT', headers }, 'fal').catch(() => {})
    }
    throw new ImageProviderError(
      `fal did not finish within ${Math.round(maxWaitMs / 1000)} s, so the request was cancelled. Try again, perhaps with fewer images or a lower resolution.`,
    )
  }

  const result = await requestJson(config, responseUrl, { headers }, 'fal')
  if (result.status < 200 || result.status >= 300) throw statusError('fal', result.status, result.body)
  const output = falResultSchema.safeParse(result.body)
  if (!output.success) throw new ImageProviderError('fal returned an unexpected result.')
  if (output.data.images.length === 0) {
    throw new ImageProviderError('fal returned no images (the prompt may have been blocked by its safety filter).')
  }
  return {
    requestId,
    images: output.data.images.map((image) => ({
      url: image.url,
      width: image.width ?? null,
      height: image.height ?? null,
    })),
    description: output.data.description || null,
  }
}
