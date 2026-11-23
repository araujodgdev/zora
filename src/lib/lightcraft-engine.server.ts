/**
 * Client of the Zora LightCraft engine service (`apps/zora-lightcraft-server`
 * in the LightCraft repo): LightCraft's engine running headless, stateless over
 * HTTP. See docs/LIGHTCRAFT-PLAN.md, "Engine service":
 *
 * - `GET /health` -> `200 ok`
 * - `GET /commands[?q=]` -> `[{id, label, params}]`
 * - `POST /run` with `multipart/form-data` (binary, not base64 JSON):
 *   part `request` (JSON `{originalName, settings?, commands, render?, inspect?}`),
 *   part `original` (streamed raw/image bytes),
 *   optional parts `image:<name>` (streamed watermark logo files)
 *   -> `200 multipart/form-data` with part `result` (JSON `{settings, results, inspect?}`)
 *   and optional part `preview` (JPEG/PNG bytes), or `422 {error, index}` for
 *   the first failing command.
 *
 * Server-only and independent of Cloudflare: the engine is reached through a
 * `LightcraftEngineTransport` (the container binding in production, a plain URL
 * in development; see `lightcraft-engine-container.server.ts`), so tests pass a
 * fake one. Originals are streamed straight from R2 into the multipart request
 * without buffering (Workers have a 128 MB isolate limit), and the response's
 * preview is checked against the 20 MB limit while being read.
 */
import { z } from 'zod'
import { formatBytes } from './content-assets'
import {
  MAX_PHOTO_ORIGINAL_BYTES,
  MAX_PHOTO_PREVIEW_BYTES,
  PHOTO_SIGNATURE_BYTES,
  photoPreviewType,
} from './content-photo-edits'

/** How the photo engine is reached: `path` starts with `/` (`/run`, `/commands?q=x`). */
export type LightcraftEngineTransport = {
  /** For messages: "container" or the URL. */
  readonly name: string
  fetch(path: string, init?: RequestInit): Promise<Response>
}

/** Limits of one `/run` (from docs/LIGHTCRAFT-PLAN.md). */
export const MAX_LIGHTCRAFT_COMMANDS = 200
export const MAX_LIGHTCRAFT_ORIGINAL_BYTES = MAX_PHOTO_ORIGINAL_BYTES
export const MAX_LIGHTCRAFT_IMAGES = 20
export const MAX_LIGHTCRAFT_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_LIGHTCRAFT_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024
export const MAX_LIGHTCRAFT_REQUEST_BYTES = 150 * 1024 * 1024
export const MAX_LIGHTCRAFT_RESULT_BYTES = 4 * 1024 * 1024
export const MAX_LIGHTCRAFT_PREVIEW_BYTES = MAX_PHOTO_PREVIEW_BYTES
const MAX_LIGHTCRAFT_RESPONSE_BYTES =
  MAX_LIGHTCRAFT_RESULT_BYTES + MAX_LIGHTCRAFT_PREVIEW_BYTES + 2 * 1024 * 1024
const MAX_COMMANDS_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_ERROR_BODY_BYTES = 64 * 1024
const MAX_PART_HEADER_BYTES = 16 * 1024
const MAX_PREAMBLE_BYTES = 4 * 1024
const MAX_IGNORED_PART_BYTES = 4 * 1024 * 1024

/** The engine allows 60 s per run; a cold container needs time to start too. */
export const LIGHTCRAFT_RUN_TIMEOUT_MS = 100_000
export const LIGHTCRAFT_QUERY_TIMEOUT_MS = 45_000

/** Names in `images` (referenced as `"zora-image:<name>"` in command params). */
export const LIGHTCRAFT_IMAGE_NAME = /^[A-Za-z0-9_-]{1,64}$/
export const LIGHTCRAFT_IMAGE_PREFIX = 'zora-image:'

export const LIGHTCRAFT_NOT_CONFIGURED_MESSAGE =
  'O motor de edição de fotos (LightCraft) não está configurado neste servidor do Zora, então ainda não é possível editar, renderizar ou inspecionar fotos pelas ferramentas. A pessoa ainda pode editar a foto no Zora LightCraft (pela URL da edição).'

/** The photo engine could not do what was asked (unreachable, timeout, bad answer). Safe to show. */
export class LightcraftEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LightcraftEngineError'
  }
}

/** Neither the container nor `LIGHTCRAFT_ENGINE_URL` is set up. */
export class LightcraftEngineNotConfiguredError extends LightcraftEngineError {
  constructor() {
    super(LIGHTCRAFT_NOT_CONFIGURED_MESSAGE)
    this.name = 'LightcraftEngineNotConfiguredError'
  }
}

/** A command failed (`422`): nothing was saved. `index` is the command's position, from 0. */
export class LightcraftEngineCommandError extends Error {
  constructor(
    readonly engineMessage: string,
    readonly index: number,
  ) {
    super(engineMessage)
    this.name = 'LightcraftEngineCommandError'
  }
}

// --- request & response types ---------------------------------------------------------

export type LightcraftEngineBinaryPart = {
  /** File name sent in Content-Disposition (LightCraft sniffs format from its extension). */
  name: string
  /** Stream of exact length `size` bytes. Never buffered whole in memory. */
  stream: ReadableStream<Uint8Array>
  /** Exact byte length of `stream` (used for Content-Length and pre-send limit checks). */
  size: number
  /** Optional Content-Type of the part; defaults to `application/octet-stream`. */
  contentType?: string
}

export type LightcraftEngineCommand = {
  command: string
  params?: Record<string, unknown>
}

export type LightcraftEngineRunInput = {
  original: LightcraftEngineBinaryPart
  /** Current version's develop settings JSON object, if any. */
  settings?: Record<string, unknown>
  commands: Array<LightcraftEngineCommand>
  /** Optional watermark logo images placed by `"zora-image:<name>"` params. */
  images?: Record<string, LightcraftEngineBinaryPart>
  render?: { scale?: number; maxSize?: number; format?: 'jpeg' | 'png' }
  inspect?: boolean
}

export type LightcraftEngineRunResult = {
  settings: Record<string, unknown>
  results: Array<unknown>
  preview?: Uint8Array
  previewContentType?: string
  inspect?: unknown
}

export type LightcraftEngineCommandInfo = {
  id: string
  label: string
  params: unknown
}

const commandInfoSchema = z.looseObject({
  id: z.string(),
  label: z.string().optional().default(''),
  params: z.unknown().optional(),
})
const commandsResponseSchema = z.union([
  z.array(commandInfoSchema),
  z.looseObject({ commands: z.array(commandInfoSchema) }).transform((value) => value.commands),
])

const runResultSchema = z.looseObject({
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  results: z.array(z.unknown()).optional().default([]),
  inspect: z.unknown().optional(),
})

const errorBodySchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional(),
  index: z.number().int().optional(),
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const CRLF = new Uint8Array([0x0d, 0x0a])

function sanitizeHeaderFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, '_').trim()
  return cleaned || 'file'
}

function cancelStreamsQuietly(input: LightcraftEngineRunInput): void {
  void input.original.stream.cancel().catch(() => {})
  if (input.images) {
    for (const part of Object.values(input.images)) {
      void part.stream.cancel().catch(() => {})
    }
  }
}

/** Checks a run input against the limits before anything is streamed or sent. */
export function lightcraftRunInputError(input: LightcraftEngineRunInput): string | null {
  if (input.commands.length > MAX_LIGHTCRAFT_COMMANDS) {
    return `No máximo ${MAX_LIGHTCRAFT_COMMANDS} comandos por edição de foto (recebido: ${input.commands.length}).`
  }
  if (!Number.isInteger(input.original.size) || input.original.size <= 0) {
    return 'A foto original está vazia ou tem tamanho inválido.'
  }
  if (input.original.size > MAX_LIGHTCRAFT_ORIGINAL_BYTES) {
    return `A foto original é maior que ${formatBytes(MAX_LIGHTCRAFT_ORIGINAL_BYTES)}.`
  }
  const images = Object.entries(input.images ?? {})
  if (images.length > MAX_LIGHTCRAFT_IMAGES) {
    return `No máximo ${MAX_LIGHTCRAFT_IMAGES} imagens auxiliares por edição (recebido: ${images.length}).`
  }
  let totalImages = 0
  for (const [name, part] of images) {
    if (!LIGHTCRAFT_IMAGE_NAME.test(name)) {
      return `O nome de imagem "${name}" não é permitido: use de 1 a 64 letras, dígitos, "_" ou "-".`
    }
    if (!Number.isInteger(part.size) || part.size <= 0) {
      return `A imagem "${name}" está vazia ou tem tamanho inválido.`
    }
    if (part.size > MAX_LIGHTCRAFT_IMAGE_BYTES) {
      return `A imagem "${name}" é maior que ${formatBytes(MAX_LIGHTCRAFT_IMAGE_BYTES)}.`
    }
    totalImages += part.size
  }
  if (totalImages > MAX_LIGHTCRAFT_IMAGES_TOTAL_BYTES) {
    return `As imagens auxiliares de uma edição podem somar no máximo ${formatBytes(MAX_LIGHTCRAFT_IMAGES_TOTAL_BYTES)}.`
  }
  return null
}

// --- streaming multipart request builder ----------------------------------------------

type MultipartPiece =
  | { header: Uint8Array; bytes: Uint8Array; size: number }
  | { header: Uint8Array; stream: ReadableStream<Uint8Array>; size: number; label: string }

export type StreamingMultipartBody = {
  stream: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number
  boundary: string
}

/**
 * Builds a pull-based `ReadableStream<Uint8Array>` for `multipart/form-data`
 * with an exact pre-computed `Content-Length`. Binary parts (`original` and
 * `image:<name>`) are pulled chunk-by-chunk from their source streams and never
 * buffered whole in memory.
 */
export function buildStreamingMultipart(input: LightcraftEngineRunInput): StreamingMultipartBody {
  const boundary = `----ZoraLightcraft${crypto.randomUUID().replace(/-/g, '')}`
  const requestPayload: Record<string, unknown> = {
    originalName: input.original.name,
    commands: input.commands.map(({ command, params }) => ({ command, params: params ?? {} })),
  }
  if (input.settings !== undefined) requestPayload.settings = input.settings
  if (input.render !== undefined) requestPayload.render = input.render
  if (input.inspect) requestPayload.inspect = true

  const requestBytes = encoder.encode(JSON.stringify(requestPayload))
  const pieces: Array<MultipartPiece> = [
    {
      header: encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n`,
      ),
      bytes: requestBytes,
      size: requestBytes.byteLength,
    },
    {
      header: encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="original"; filename="${sanitizeHeaderFilename(input.original.name)}"\r\nContent-Type: ${input.original.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      stream: input.original.stream,
      size: input.original.size,
      label: 'foto original',
    },
  ]

  for (const [name, part] of Object.entries(input.images ?? {})) {
    pieces.push({
      header: encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="image:${name}"; filename="${sanitizeHeaderFilename(part.name)}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      stream: part.stream,
      size: part.size,
      label: `imagem "${name}"`,
    })
  }

  const closing = encoder.encode(`--${boundary}--\r\n`)
  const contentLength =
    pieces.reduce((total, piece) => total + piece.header.byteLength + piece.size + CRLF.byteLength, 0) +
    closing.byteLength

  if (contentLength > MAX_LIGHTCRAFT_REQUEST_BYTES) {
    cancelStreamsQuietly(input)
    throw new LightcraftEngineError(
      `A requisição para o motor de fotos excede o limite de ${formatBytes(MAX_LIGHTCRAFT_REQUEST_BYTES)}.`,
    )
  }

  let pieceIndex = 0
  let phase: 'header' | 'body' | 'crlf' | 'closing' | 'done' = 'header'
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let streamedForPiece = 0

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (phase === 'done') return
        if (phase === 'closing') {
          phase = 'done'
          controller.enqueue(closing)
          controller.close()
          return
        }
        const piece = pieces[pieceIndex]!
        if (phase === 'header') {
          phase = 'body'
          streamedForPiece = 0
          controller.enqueue(piece.header)
          return
        }
        if (phase === 'body') {
          if ('bytes' in piece) {
            phase = 'crlf'
            if (piece.bytes.byteLength > 0) {
              controller.enqueue(piece.bytes)
              return
            }
            continue
          }
          activeReader ??= piece.stream.getReader()
          const { done, value } = await activeReader.read()
          if (done) {
            activeReader.releaseLock()
            activeReader = null
            if (streamedForPiece !== piece.size) {
              controller.error(
                new LightcraftEngineError(
                  `O tamanho real da ${piece.label} (${streamedForPiece} B) difere do esperado (${piece.size} B).`,
                ),
              )
              return
            }
            phase = 'crlf'
            continue
          }
          if (value.byteLength === 0) continue
          streamedForPiece += value.byteLength
          if (streamedForPiece > piece.size) {
            await activeReader.cancel().catch(() => {})
            activeReader = null
            controller.error(
              new LightcraftEngineError(
                `A ${piece.label} enviou mais bytes do que o tamanho declarado (${piece.size} B).`,
              ),
            )
            return
          }
          controller.enqueue(value)
          return
        }
        // phase === 'crlf'
        pieceIndex += 1
        phase = pieceIndex < pieces.length ? 'header' : 'closing'
        controller.enqueue(CRLF)
        return
      }
    },
    async cancel(reason) {
      if (activeReader) {
        await activeReader.cancel(reason).catch(() => {})
        activeReader = null
      }
      for (let i = pieceIndex; i < pieces.length; i += 1) {
        const piece = pieces[i]!
        if ('stream' in piece && !piece.stream.locked) {
          await piece.stream.cancel(reason).catch(() => {})
        }
      }
      phase = 'done'
    },
  })

  return {
    stream,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength,
    boundary,
  }
}

// --- streaming multipart response parser ----------------------------------------------

function extractMultipartBoundary(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType.trim())) return null
  const match = /;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  return boundary && boundary.length > 0 ? boundary : null
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b
  if (b.byteLength === 0) return a
  const out = new Uint8Array(a.byteLength + b.byteLength)
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

function joinChunks(chunks: Array<Uint8Array>, totalSize: number): Uint8Array {
  const out = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
  const limit = haystack.byteLength - needle.byteLength
  if (limit < fromIndex) return -1
  const first = needle[0]!
  outer: for (let i = fromIndex; i <= limit; i += 1) {
    if (haystack[i] !== first) continue
    for (let j = 1; j < needle.byteLength; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

function parsePartHeaders(raw: string): { name: string | null; contentType?: string } {
  let name: string | null = null
  let contentType: string | undefined
  for (const line of raw.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'content-disposition') {
      const match = /;\s*name=(?:"([^"]+)"|([^\s;]+))/i.exec(value)
      name = match?.[1] ?? match?.[2] ?? null
    } else if (key === 'content-type') {
      contentType = value.split(';')[0]?.trim().toLowerCase() || undefined
    }
  }
  return { name, contentType }
}

type ParsedMultipartRunResponse = {
  resultBytes: Uint8Array | null
  previewBytes: Uint8Array | null
  previewContentType?: string
}

/**
 * Streams a `200 multipart/form-data` answer from `POST /run`, enforcing the
 * 4 MB cap on `result` and the 20 MB cap on `preview` while reading and
 * cancelling the reader immediately if either is exceeded.
 */
async function parseMultipartResponse(response: Response): Promise<ParsedMultipartRunResponse> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_LIGHTCRAFT_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new LightcraftEngineError(
      `A resposta do motor de fotos é maior que ${formatBytes(MAX_LIGHTCRAFT_RESPONSE_BYTES)}.`,
    )
  }

  const boundary = extractMultipartBoundary(response.headers.get('content-type'))
  if (!boundary) {
    await response.body?.cancel()
    throw new LightcraftEngineError(
      'O motor de fotos enviou uma resposta inválida (esperado multipart/form-data).',
    )
  }
  if (!response.body) {
    throw new LightcraftEngineError('O motor de fotos enviou uma resposta vazia.')
  }

  const firstBoundary = encoder.encode(`--${boundary}`)
  const nextBoundary = encoder.encode(`\r\n--${boundary}`)
  const headerEnd = encoder.encode('\r\n\r\n')

  const reader = response.body.getReader()
  let buf: Uint8Array = new Uint8Array(0)
  let state: 'preamble' | 'after_boundary' | 'headers' | 'body' | 'done' = 'preamble'
  let preambleSkipped = 0
  let ignoredBytes = 0

  let partName: string | null = null
  let partContentType: string | undefined
  let partChunks: Array<Uint8Array> = []
  let partSize = 0

  let resultBytes: Uint8Array | null = null
  let previewBytes: Uint8Array | null = null
  let previewContentType: string | undefined

  const emitPartSlice = async (slice: Uint8Array) => {
    if (slice.byteLength === 0) return
    if (partName === 'result') {
      partSize += slice.byteLength
      if (partSize > MAX_LIGHTCRAFT_RESULT_BYTES) {
        await reader.cancel().catch(() => {})
        throw new LightcraftEngineError(
          `O resultado JSON do motor de fotos é maior que ${formatBytes(MAX_LIGHTCRAFT_RESULT_BYTES)}.`,
        )
      }
      partChunks.push(slice.slice())
      return
    }
    if (partName === 'preview') {
      partSize += slice.byteLength
      if (partSize > MAX_LIGHTCRAFT_PREVIEW_BYTES) {
        await reader.cancel().catch(() => {})
        throw new LightcraftEngineError(
          `A prévia retornada pelo motor de fotos é maior que ${formatBytes(MAX_LIGHTCRAFT_PREVIEW_BYTES)}.`,
        )
      }
      partChunks.push(slice.slice())
      return
    }
    ignoredBytes += slice.byteLength
    if (ignoredBytes > MAX_IGNORED_PART_BYTES) {
      await reader.cancel().catch(() => {})
      throw new LightcraftEngineError('O motor de fotos enviou dados inesperados em excesso.')
    }
  }

  const finishPart = () => {
    if (partName === 'result') {
      resultBytes = joinChunks(partChunks, partSize)
    } else if (partName === 'preview') {
      previewBytes = joinChunks(partChunks, partSize)
      previewContentType = partContentType
    }
    partName = null
    partContentType = undefined
    partChunks = []
    partSize = 0
  }

  try {
    outer: for (;;) {
      const { done, value } = await reader.read()
      if (!done && value.byteLength > 0) {
        buf = concatBytes(buf, value)
      }

      for (;;) {
        if (state === 'preamble') {
          const idx = indexOfBytes(buf, firstBoundary)
          if (idx !== -1) {
            buf = buf.subarray(idx + firstBoundary.byteLength)
            state = 'after_boundary'
            continue
          }
          const keep = firstBoundary.byteLength - 1
          if (buf.byteLength > keep) {
            preambleSkipped += buf.byteLength - keep
            if (preambleSkipped > MAX_PREAMBLE_BYTES) {
              await reader.cancel().catch(() => {})
              throw new LightcraftEngineError('O motor de fotos enviou uma resposta multipart inválida.')
            }
            buf = buf.subarray(buf.byteLength - keep)
          }
          break
        }

        if (state === 'after_boundary') {
          if (buf.byteLength < 2) break
          if (buf[0] === 0x2d && buf[1] === 0x2d) {
            state = 'done'
            await reader.cancel().catch(() => {})
            break outer
          }
          if (buf[0] === 0x0d && buf[1] === 0x0a) {
            buf = buf.subarray(2)
            state = 'headers'
            continue
          }
          await reader.cancel().catch(() => {})
          throw new LightcraftEngineError('O motor de fotos enviou uma resposta multipart malformada.')
        }

        if (state === 'headers') {
          const idx = indexOfBytes(buf, headerEnd)
          if (idx === -1) {
            if (buf.byteLength > MAX_PART_HEADER_BYTES) {
              await reader.cancel().catch(() => {})
              throw new LightcraftEngineError('Os cabeçalhos da resposta do motor de fotos são grandes demais.')
            }
            break
          }
          const parsed = parsePartHeaders(decoder.decode(buf.subarray(0, idx)))
          partName = parsed.name
          partContentType = parsed.contentType
          partChunks = []
          partSize = 0
          buf = buf.subarray(idx + headerEnd.byteLength)
          state = 'body'
          continue
        }

        if (state === 'body') {
          const idx = indexOfBytes(buf, nextBoundary)
          if (idx !== -1) {
            await emitPartSlice(buf.subarray(0, idx))
            finishPart()
            buf = buf.subarray(idx + nextBoundary.byteLength)
            state = 'after_boundary'
            continue
          }
          const safeLen = buf.byteLength - (nextBoundary.byteLength - 1)
          if (safeLen > 0) {
            await emitPartSlice(buf.subarray(0, safeLen))
            buf = buf.subarray(safeLen)
          }
          break
        }

        break outer
      }

      if (done) {
        throw new LightcraftEngineError('A resposta do motor de fotos foi interrompida antes do fim.')
      }
    }
  } catch (error) {
    if (error instanceof LightcraftEngineError) throw error
    throw new LightcraftEngineError(
      'Não foi possível ler a resposta do motor de fotos (tempo esgotado ou conexão interrompida).',
    )
  }

  return { resultBytes, previewBytes, previewContentType }
}

// --- transport helpers ----------------------------------------------------------------

async function send(
  transport: LightcraftEngineTransport,
  path: string,
  init: RequestInit & { duplex?: 'half' },
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException('A requisição ao motor de fotos expirou.', 'TimeoutError')),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([transport.fetch(path, { ...init, signal }), timeout])
  } catch (error) {
    if (error instanceof LightcraftEngineError) throw error
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new LightcraftEngineError(
      timedOut
        ? `O motor de fotos não respondeu em ${Math.round(timeoutMs / 1000)} s. Tente novamente ou com menos comandos.`
        : 'Não foi possível alcançar o motor de fotos. Tente novamente em instantes.',
    )
  } finally {
    clearTimeout(timer)
  }
}

async function readLimited(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new LightcraftEngineError(`O retorno (${what}) do motor de fotos é maior que ${formatBytes(maxBytes)}.`)
  }
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new LightcraftEngineError(
          `O retorno (${what}) do motor de fotos é maior que ${formatBytes(maxBytes)}.`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof LightcraftEngineError) throw error
    throw new LightcraftEngineError(
      `Não foi possível ler ${what} do motor de fotos (tempo esgotado ou conexão interrompida).`,
    )
  }
  return joinChunks(chunks, size)
}

async function readJson(response: Response, maxBytes: number, what: string): Promise<unknown> {
  const bytes = await readLimited(response, maxBytes, what)
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw new LightcraftEngineError(`O motor de fotos enviou um retorno inválido em ${what} (não é JSON).`)
  }
}

async function failure(response: Response): Promise<never> {
  let body: z.infer<typeof errorBodySchema> = {}
  let text = ''
  try {
    const bytes = await readLimited(response, MAX_ERROR_BODY_BYTES, 'erro')
    text = decoder.decode(bytes).trim()
    body = errorBodySchema.parse(JSON.parse(text))
  } catch {
    // Not JSON: keep the plain text.
  }
  const message = (body.error ?? body.message ?? text).slice(0, 500)
  if (response.status === 422) {
    throw new LightcraftEngineCommandError(message || 'Um comando falhou.', body.index ?? -1)
  }
  if (response.status === 503 && body.error === 'not-configured') {
    throw new LightcraftEngineNotConfiguredError()
  }
  if (response.status === 413) {
    throw new LightcraftEngineError(
      `A edição é grande demais para o motor de fotos${message ? `: ${message}` : ''}.`,
    )
  }
  throw new LightcraftEngineError(
    `O motor de fotos falhou (HTTP ${response.status})${message ? `: ${message}` : ''}.`,
  )
}

// --- calls ----------------------------------------------------------------------------

/** Whether the photo engine answers `GET /health` with 200. Never throws. */
export async function lightcraftEngineHealth(transport: LightcraftEngineTransport): Promise<boolean> {
  try {
    const response = await send(transport, '/health', { method: 'GET' }, LIGHTCRAFT_QUERY_TIMEOUT_MS)
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

/** The photo engine's command catalogue, filtered by `query` when given. */
export async function listPhotoEngineCommands(
  transport: LightcraftEngineTransport,
  query?: string,
): Promise<Array<LightcraftEngineCommandInfo>> {
  const q = query?.trim()
  const path = q ? `/commands?${new URLSearchParams({ q }).toString()}` : '/commands'
  const response = await send(
    transport,
    path,
    { method: 'GET', headers: { accept: 'application/json' } },
    LIGHTCRAFT_QUERY_TIMEOUT_MS,
  )
  if (!response.ok) await failure(response)
  const parsed = commandsResponseSchema.safeParse(
    await readJson(response, MAX_COMMANDS_RESPONSE_BYTES, 'lista de comandos'),
  )
  if (!parsed.success) {
    throw new LightcraftEngineError('O motor de fotos enviou uma lista de comandos inválida.')
  }
  return parsed.data.map(({ id, label, params }) => ({ id, label, params: params ?? null }))
}

/**
 * Runs commands on a photo (`POST /run`) using streaming `multipart/form-data`.
 * Throws `LightcraftEngineCommandError` for a failing command (422),
 * `LightcraftEngineNotConfiguredError` for 503 `not-configured`, and
 * `LightcraftEngineError` for anything else.
 */
export async function runPhotoEngine(
  transport: LightcraftEngineTransport,
  input: LightcraftEngineRunInput,
): Promise<LightcraftEngineRunResult> {
  const problem = lightcraftRunInputError(input)
  if (problem) {
    cancelStreamsQuietly(input)
    throw new LightcraftEngineError(problem)
  }

  const multipart = buildStreamingMultipart(input)
  const response = await send(
    transport,
    '/run',
    {
      method: 'POST',
      headers: {
        'content-type': multipart.contentType,
        'content-length': String(multipart.contentLength),
        accept: 'multipart/form-data',
      },
      body: multipart.stream,
      duplex: 'half',
    },
    LIGHTCRAFT_RUN_TIMEOUT_MS,
  )
  if (!response.ok) await failure(response)

  const parsedParts = await parseMultipartResponse(response)
  if (!parsedParts.resultBytes) {
    throw new LightcraftEngineError('O motor de fotos não retornou a parte "result" na resposta.')
  }

  let rawResult: unknown
  try {
    rawResult = JSON.parse(decoder.decode(parsedParts.resultBytes))
  } catch {
    throw new LightcraftEngineError('O motor de fotos enviou um resultado inválido (não é JSON).')
  }
  const parsed = runResultSchema.safeParse(rawResult)
  if (!parsed.success) {
    throw new LightcraftEngineError('O motor de fotos enviou um resultado em formato inválido.')
  }

  const preview =
    parsedParts.previewBytes && parsedParts.previewBytes.byteLength > 0
      ? parsedParts.previewBytes
      : undefined
  const previewContentType = preview
    ? (photoPreviewType(preview.subarray(0, PHOTO_SIGNATURE_BYTES)) ??
      parsedParts.previewContentType)
    : undefined

  return {
    settings: parsed.data.settings,
    results: parsed.data.results,
    ...(preview ? { preview } : {}),
    ...(previewContentType ? { previewContentType } : {}),
    ...(parsed.data.inspect !== undefined ? { inspect: parsed.data.inspect } : {}),
  }
}

/** A transport for a photo engine reachable at a URL (`LIGHTCRAFT_ENGINE_URL`, development). */
export function urlLightcraftEngineTransport(
  baseUrl: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): LightcraftEngineTransport {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    name: base,
    fetch: (path, init) => fetcher(`${base}${path}`, init),
  }
}
