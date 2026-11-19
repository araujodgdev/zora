/**
 * Client of the Zora Studio engine service (`apps/zora-studio-server` in the
 * Studio repo): Studio's engine running headless, stateless over HTTP. See
 * docs/STUDIO-PLAN.md, "Engine service":
 *
 * - `GET /health` -> `200 ok`
 * - `GET /commands[?q=]` -> `[{id, label, params}]`
 * - `POST /run` with `{source?, new?, images?, commands, render?, inspect?}`
 *   (bytes as base64) -> `{source, preview, results, inspect?}`, or `422
 *   {error, index}` for the first failing command.
 *
 * Server-only and independent of Cloudflare: the engine is reached through a
 * `StudioEngineTransport` (the container binding in production, a plain URL
 * in development; see `studio-engine-container.server.ts`), so tests pass a
 * fake one. Every call has a timeout and every size is checked before the
 * bytes are sent or kept.
 */
import { z } from 'zod'
import { formatBytes } from './content-assets'
import { MAX_DESIGN_PREVIEW_BYTES, MAX_DESIGN_SOURCE_BYTES } from './content-designs'

/** How the engine is reached: `path` starts with `/` (`/run`, `/commands?q=x`). */
export type StudioEngineTransport = {
  /** For messages: "container" or the URL. */
  readonly name: string
  fetch(path: string, init: RequestInit): Promise<Response>
}

/** Limits of one `/run` (the contract's, plus what a Worker can hold in memory). */
export const MAX_ENGINE_COMMANDS = 200
export const MAX_ENGINE_IMAGES = 20
export const MAX_ENGINE_SOURCE_BYTES = MAX_DESIGN_SOURCE_BYTES
/** One placed image, and all of them together (base64 adds a third on top). */
export const MAX_ENGINE_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_ENGINE_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024
/** The engine's JSON answer: a source and a preview in base64, plus results. */
export const MAX_ENGINE_RESPONSE_BYTES =
  Math.ceil(((MAX_DESIGN_SOURCE_BYTES + MAX_DESIGN_PREVIEW_BYTES) * 4) / 3) + 4 * 1024 * 1024
const MAX_COMMANDS_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_ERROR_BODY_BYTES = 64 * 1024

/** The engine allows 60 s per run; a cold container needs time to start too. */
export const ENGINE_RUN_TIMEOUT_MS = 100_000
export const ENGINE_QUERY_TIMEOUT_MS = 45_000

/** Names in `images` (referenced as `"zora-image:<name>"` in command params). */
export const ENGINE_IMAGE_NAME = /^[A-Za-z0-9_-]{1,64}$/
export const ENGINE_IMAGE_PREFIX = 'zora-image:'

export const ENGINE_NOT_CONFIGURED_MESSAGE =
  'The design engine is not configured on this Zora server, so designs cannot be edited, rendered or inspected through tools yet. The person can still edit the design in Zora Studio (its url).'

/** The engine could not do what was asked (unreachable, timeout, bad answer). Safe to show. */
export class StudioEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioEngineError'
  }
}

/** Neither the container nor `STUDIO_ENGINE_URL` is set up. */
export class StudioEngineNotConfiguredError extends StudioEngineError {
  constructor() {
    super(ENGINE_NOT_CONFIGURED_MESSAGE)
    this.name = 'StudioEngineNotConfiguredError'
  }
}

/** A command failed (`422`): nothing was produced. `index` is the command's position, from 0. */
export class StudioEngineCommandError extends Error {
  constructor(
    readonly engineMessage: string,
    readonly index: number | null,
  ) {
    super(engineMessage)
    this.name = 'StudioEngineCommandError'
  }
}

// --- base64 -------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: Array<string> = []
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)))
  }
  return btoa(parts.join(''))
}

/** Decodes base64, or `null` when it is not valid base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Bytes that a base64 text of this length decodes to (at most). */
function decodedLength(base64Length: number): number {
  return Math.floor((base64Length * 3) / 4)
}

// --- requests -------------------------------------------------------------------------

export type EngineCommand = { command: string; params?: Record<string, unknown> }

export type EngineRunRequest = {
  /** The design's current source; or `new` for a design without a version. */
  source?: Uint8Array
  new?: { width: number; height: number; name: string }
  /** Images placed by `"zora-image:<name>"` params. */
  images?: Record<string, Uint8Array>
  commands: Array<EngineCommand>
  render?: { scale?: number; maxSize?: number }
  inspect?: boolean
}

export type EngineRunResult = {
  /** Absent only when the engine sent none (e.g. an inspect-only run). */
  source: Uint8Array | null
  preview: Uint8Array | null
  results: Array<unknown>
  inspect?: unknown
}

export type EngineCommandInfo = { id: string; label: string; params: unknown }

const commandInfoSchema = z.looseObject({
  id: z.string(),
  label: z.string().optional().default(''),
  params: z.unknown().optional(),
})
const commandsResponseSchema = z.union([
  z.array(commandInfoSchema),
  z.looseObject({ commands: z.array(commandInfoSchema) }).transform((value) => value.commands),
])

const runResponseSchema = z.looseObject({
  source: z.string().optional(),
  preview: z.string().optional(),
  results: z.array(z.unknown()).optional().default([]),
  inspect: z.unknown().optional(),
})

const errorBodySchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional(),
  index: z.number().int().optional(),
})

/** Checks a run request against the limits before anything is encoded or sent. */
export function engineRunRequestError(request: EngineRunRequest): string | null {
  if (request.source && request.new) return 'Send either a source or a new document, not both.'
  if (!request.source && !request.new) return 'A run needs a source or a new document.'
  if (request.commands.length > MAX_ENGINE_COMMANDS) {
    return `At most ${MAX_ENGINE_COMMANDS} commands per edit (got ${request.commands.length}).`
  }
  if (request.source && request.source.length > MAX_ENGINE_SOURCE_BYTES) {
    return `The design's source is larger than ${formatBytes(MAX_ENGINE_SOURCE_BYTES)}.`
  }
  const images = Object.entries(request.images ?? {})
  if (images.length > MAX_ENGINE_IMAGES) {
    return `At most ${MAX_ENGINE_IMAGES} images per edit (got ${images.length}).`
  }
  let total = 0
  for (const [name, bytes] of images) {
    if (!ENGINE_IMAGE_NAME.test(name)) {
      return `Image name "${name}" is not allowed: use 1 to 64 letters, digits, "_" or "-".`
    }
    if (bytes.length > MAX_ENGINE_IMAGE_BYTES) {
      return `Image "${name}" is larger than ${formatBytes(MAX_ENGINE_IMAGE_BYTES)}.`
    }
    total += bytes.length
  }
  if (total > MAX_ENGINE_IMAGES_TOTAL_BYTES) {
    return `The images of one edit may total at most ${formatBytes(MAX_ENGINE_IMAGES_TOTAL_BYTES)}.`
  }
  return null
}

// --- transport helpers ---------------------------------------------------------------

async function send(
  transport: StudioEngineTransport,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  // The signal aborts the request; the race also covers a transport that
  // ignores signals (a Durable Object stub may).
  const signal = AbortSignal.timeout(timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException('The engine request timed out.', 'TimeoutError')),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([transport.fetch(path, { ...init, signal }), timeout])
  } catch (error) {
    if (error instanceof StudioEngineError) throw error
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new StudioEngineError(
      timedOut
        ? `The design engine did not answer within ${Math.round(timeoutMs / 1000)} s. Try again, or with fewer commands.`
        : 'The design engine could not be reached. Try again in a minute.',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Reads a body up to `maxBytes`, or throws. */
async function readLimited(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new StudioEngineError(`The design engine's ${what} is larger than ${formatBytes(maxBytes)}.`)
  }
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) {
        await reader.cancel()
        throw new StudioEngineError(
          `The design engine's ${what} is larger than ${formatBytes(maxBytes)}.`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof StudioEngineError) throw error
    throw new StudioEngineError(`The design engine's ${what} could not be read (timeout or lost connection).`)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

async function readJson(response: Response, maxBytes: number, what: string): Promise<unknown> {
  const bytes = await readLimited(response, maxBytes, what)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new StudioEngineError(`The design engine sent an invalid ${what} (not JSON).`)
  }
}

/** Turns a non-2xx answer into the right error. */
async function failure(response: Response): Promise<never> {
  let body: z.infer<typeof errorBodySchema> = {}
  let text = ''
  try {
    const bytes = await readLimited(response, MAX_ERROR_BODY_BYTES, 'error')
    text = new TextDecoder().decode(bytes).trim()
    body = errorBodySchema.parse(JSON.parse(text))
  } catch {
    // Not JSON: keep the text.
  }
  const message = (body.error ?? body.message ?? text).slice(0, 500)
  if (response.status === 422) {
    throw new StudioEngineCommandError(message || 'A command failed.', body.index ?? null)
  }
  if (response.status === 503 && body.error === 'not-configured') {
    throw new StudioEngineNotConfiguredError()
  }
  if (response.status === 413) {
    throw new StudioEngineError(
      `The edit is too large for the design engine${message ? `: ${message}` : ''}.`,
    )
  }
  throw new StudioEngineError(
    `The design engine failed (HTTP ${response.status})${message ? `: ${message}` : ''}.`,
  )
}

// --- calls ----------------------------------------------------------------------------

/** Whether the engine answers `GET /health` with 200. Never throws. */
export async function engineHealth(transport: StudioEngineTransport): Promise<boolean> {
  try {
    const response = await send(transport, '/health', { method: 'GET' }, ENGINE_QUERY_TIMEOUT_MS)
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

/** The engine's command catalogue, filtered by `query` when given. */
export async function listEngineCommands(
  transport: StudioEngineTransport,
  query?: string,
): Promise<Array<EngineCommandInfo>> {
  const q = query?.trim()
  const path = q ? `/commands?${new URLSearchParams({ q }).toString()}` : '/commands'
  const response = await send(
    transport,
    path,
    { method: 'GET', headers: { accept: 'application/json' } },
    ENGINE_QUERY_TIMEOUT_MS,
  )
  if (!response.ok) await failure(response)
  const parsed = commandsResponseSchema.safeParse(
    await readJson(response, MAX_COMMANDS_RESPONSE_BYTES, 'command list'),
  )
  if (!parsed.success) throw new StudioEngineError('The design engine sent an invalid command list.')
  return parsed.data.map(({ id, label, params }) => ({ id, label, params: params ?? null }))
}

/** The JSON body of `POST /run` (bytes as base64). Exported for tests. */
export function encodeRunRequest(request: EngineRunRequest): string {
  const body: Record<string, unknown> = {
    commands: request.commands.map(({ command, params }) => ({ command, params: params ?? {} })),
  }
  if (request.source) body.source = bytesToBase64(request.source)
  if (request.new) body.new = request.new
  const images = Object.entries(request.images ?? {})
  if (images.length > 0) {
    body.images = Object.fromEntries(images.map(([name, bytes]) => [name, bytesToBase64(bytes)]))
  }
  if (request.render) body.render = request.render
  if (request.inspect) body.inspect = true
  return JSON.stringify(body)
}

function decodeField(value: string | undefined, maxBytes: number, what: string): Uint8Array | null {
  if (value === undefined || value === '') return null
  if (decodedLength(value.length) > maxBytes + 2) {
    throw new StudioEngineError(`The design engine returned a ${what} larger than ${formatBytes(maxBytes)}.`)
  }
  const bytes = base64ToBytes(value)
  if (!bytes) throw new StudioEngineError(`The design engine returned an invalid ${what} (not base64).`)
  if (bytes.length > maxBytes) {
    throw new StudioEngineError(`The design engine returned a ${what} larger than ${formatBytes(maxBytes)}.`)
  }
  return bytes
}

/**
 * Runs commands on a design (`POST /run`). Throws `StudioEngineCommandError`
 * for a failing command (422), `StudioEngineError` for anything else.
 */
export async function runEngine(
  transport: StudioEngineTransport,
  request: EngineRunRequest,
): Promise<EngineRunResult> {
  const problem = engineRunRequestError(request)
  if (problem) throw new StudioEngineError(problem)
  const response = await send(
    transport,
    '/run',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: encodeRunRequest(request),
    },
    ENGINE_RUN_TIMEOUT_MS,
  )
  if (!response.ok) await failure(response)
  const parsed = runResponseSchema.safeParse(
    await readJson(response, MAX_ENGINE_RESPONSE_BYTES, 'answer'),
  )
  if (!parsed.success) throw new StudioEngineError('The design engine sent an invalid answer.')
  return {
    source: decodeField(parsed.data.source, MAX_DESIGN_SOURCE_BYTES, 'source'),
    preview: decodeField(parsed.data.preview, MAX_DESIGN_PREVIEW_BYTES, 'preview'),
    results: parsed.data.results,
    ...(parsed.data.inspect !== undefined ? { inspect: parsed.data.inspect } : {}),
  }
}

/** A transport for an engine reachable at a URL (`STUDIO_ENGINE_URL`, development). */
export function urlEngineTransport(
  baseUrl: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): StudioEngineTransport {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    name: base,
    fetch: (path, init) => fetcher(`${base}${path}`, init),
  }
}
