import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIGHTCRAFT_RUN_TIMEOUT_MS,
  LightcraftEngineCommandError,
  LightcraftEngineError,
  LightcraftEngineNotConfiguredError,
  MAX_LIGHTCRAFT_IMAGES,
  MAX_LIGHTCRAFT_IMAGES_TOTAL_BYTES,
  MAX_LIGHTCRAFT_IMAGE_BYTES,
  MAX_LIGHTCRAFT_ORIGINAL_BYTES,
  MAX_LIGHTCRAFT_PREVIEW_BYTES,
  MAX_LIGHTCRAFT_REQUEST_BYTES,
  buildStreamingMultipart,
  lightcraftEngineHealth,
  lightcraftRunInputError,
  listPhotoEngineCommands,
  runPhotoEngine,
  urlLightcraftEngineTransport,
} from './lightcraft-engine.server'
import type {
  LightcraftEngineBinaryPart,
  LightcraftEngineTransport,
} from './lightcraft-engine.server'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42])
const encoder = new TextEncoder()

function streamOf(bytes: Uint8Array, chunkSize = bytes.byteLength || 1): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

function binaryPart(
  name: string,
  bytes: Uint8Array,
  size = bytes.byteLength,
): LightcraftEngineBinaryPart {
  return { name, stream: streamOf(bytes), size }
}

/** Builds a valid `200 multipart/form-data` response matching the LightCraft engine contract. */
function multipartResponse(
  parts: Array<{ name: string; contentType: string; body: Uint8Array }>,
  options: { boundary?: string; chunkSize?: number } = {},
): Response {
  const boundary = options.boundary ?? 'test-boundary-123'
  const chunks: Array<Uint8Array> = []
  for (const part of parts) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
      ),
    )
    chunks.push(part.body)
    chunks.push(encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const full = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    full.set(c, offset)
    offset += c.byteLength
  }
  const stream = options.chunkSize ? streamOf(full, options.chunkSize) : streamOf(full)
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
}

function okRunResponse(
  result: Record<string, unknown> = { settings: { exposure: 0.5 }, results: [{ ok: true }] },
  preview: Uint8Array | null = JPEG,
  chunkSize?: number,
): Response {
  const parts: Array<{ name: string; contentType: string; body: Uint8Array }> = [
    { name: 'result', contentType: 'application/json', body: encoder.encode(JSON.stringify(result)) },
  ]
  if (preview) {
    parts.push({ name: 'preview', contentType: 'image/jpeg', body: preview })
  }
  return multipartResponse(parts, { chunkSize })
}

function transport(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const engine: LightcraftEngineTransport = {
    name: 'test',
    fetch: async (path, init) => {
      calls.push({ path, init })
      return handler(path, init)
    },
  }
  return { engine, calls }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('streaming multipart & 100 MB memory proof', () => {
  it('streams a 100 MiB original with exact Content-Length while keeping peak buffered memory tiny', async () => {
    const CHUNK_SIZE = 1024 * 1024 // 1 MiB
    const TOTAL_CHUNKS = 100 // 100 MiB = MAX_LIGHTCRAFT_ORIGINAL_BYTES
    const TOTAL_BYTES = CHUNK_SIZE * TOTAL_CHUNKS

    // Single reusable 1 MiB buffer: the entire 100 MiB file is NEVER allocated in memory.
    const patternChunk = new Uint8Array(CHUNK_SIZE)
    patternChunk.set(JPEG, 0)
    let producedChunks = 0
    let activeInFlightBytes = 0
    let peakInFlightBytes = 0

    const syntheticOriginalStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (producedChunks >= TOTAL_CHUNKS) {
          controller.close()
          return
        }
        producedChunks += 1
        activeInFlightBytes += patternChunk.byteLength
        if (activeInFlightBytes > peakInFlightBytes) peakInFlightBytes = activeInFlightBytes
        controller.enqueue(patternChunk)
      },
    })

    let observedBytes = 0
    let declaredLength = 0
    let observedContentType = ''
    let maxChunkRead = 0

    const { engine } = transport(async (path, init) => {
      expect(path).toBe('/run')
      expect(init?.method).toBe('POST')
      const headers = new Headers(init?.headers)
      declaredLength = Number(headers.get('content-length'))
      observedContentType = headers.get('content-type') ?? ''

      const bodyStream = init?.body as ReadableStream<Uint8Array>
      expect(bodyStream).toBeInstanceOf(ReadableStream)
      const reader = bodyStream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        observedBytes += value.byteLength
        if (value.byteLength > maxChunkRead) maxChunkRead = value.byteLength
        // Consumer drains each chunk immediately; release tracked in-flight bytes.
        if (value.byteLength === CHUNK_SIZE) {
          activeInFlightBytes = Math.max(0, activeInFlightBytes - value.byteLength)
        }
      }
      return okRunResponse({ settings: { exposure: 0.25 }, results: [{ ok: true }] }, JPEG)
    })

    const result = await runPhotoEngine(engine, {
      original: { name: 'camera.arw', stream: syntheticOriginalStream, size: TOTAL_BYTES },
      commands: [{ command: 'develop.auto' }],
      render: { scale: 1, maxSize: 4096, format: 'jpeg' },
    })

    expect(producedChunks).toBe(TOTAL_CHUNKS)
    expect(observedContentType).toMatch(/^multipart\/form-data; boundary=----ZoraLightcraft/)
    expect(declaredLength).toBeGreaterThan(TOTAL_BYTES)
    expect(observedBytes).toBe(declaredLength)
    // Peak buffered memory stays tiny (<= 2 MiB, well under 8 MiB, nowhere near 100 MiB).
    expect(peakInFlightBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(maxChunkRead).toBeLessThanOrEqual(CHUNK_SIZE)
    expect(result).toEqual({
      settings: { exposure: 0.25 },
      results: [{ ok: true }],
      preview: JPEG,
      previewContentType: 'image/jpeg',
    })
  })

  it('frames request JSON, original, and image:<name> parts with exact Content-Length', async () => {
    const multipart = buildStreamingMultipart({
      original: binaryPart('photo "1".cr2', JPEG),
      settings: { exposure: 0.3 },
      commands: [{ command: 'light.exposure', params: { value: 0.5 } }],
      images: { logo_main: binaryPart('logo.png', PNG) },
      render: { scale: 0.5, maxSize: 2048, format: 'jpeg' },
    })

    const full = new Uint8Array(await new Response(multipart.stream).arrayBuffer())
    expect(full.byteLength).toBe(multipart.contentLength)
    const text = new TextDecoder().decode(full)
    expect(text).toContain('name="request"')
    expect(text).toContain('"originalName":"photo \\"1\\".cr2"')
    expect(text).toContain('"settings":{"exposure":0.3}')
    expect(text).toContain('name="original"; filename="photo _1_.cr2"')
    expect(text).toContain('name="image:logo_main"; filename="logo.png"')
    expect(text).toContain(`--${multipart.boundary}--\r\n`)
  })
})

describe('pre-send limit rejections', () => {
  it('checks all input limits and never calls the engine when over limit', async () => {
    const empty = () => binaryPart('a.jpg', new Uint8Array(0), 0)
    const dummyStream = (size: number): LightcraftEngineBinaryPart => ({
      name: 'big.arw',
      stream: new ReadableStream({ start(c) { c.close() } }),
      size,
    })

    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: Array.from({ length: 201 }, () => ({ command: 'x' })),
      }),
    ).toContain('No máximo 200 comandos')

    expect(lightcraftRunInputError({ original: empty(), commands: [] })).toContain('vazia')

    expect(
      lightcraftRunInputError({
        original: dummyStream(MAX_LIGHTCRAFT_ORIGINAL_BYTES + 1),
        commands: [],
      }),
    ).toContain('foto original é maior que')

    const tooManyImages = Object.fromEntries(
      Array.from({ length: MAX_LIGHTCRAFT_IMAGES + 1 }, (_, i) => [
        `img_${i}`,
        binaryPart(`i${i}.png`, PNG),
      ]),
    )
    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: [],
        images: tooManyImages,
      }),
    ).toContain('No máximo 20 imagens')

    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: [],
        images: { 'bad/name': binaryPart('l.png', PNG) },
      }),
    ).toContain('não é permitido')

    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: [],
        images: { big: dummyStream(MAX_LIGHTCRAFT_IMAGE_BYTES + 1) },
      }),
    ).toContain('é maior que 25 MB')

    const halfPlusOne = Math.floor(MAX_LIGHTCRAFT_IMAGES_TOTAL_BYTES / 2) + 1
    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: [],
        images: { a: dummyStream(halfPlusOne), b: dummyStream(halfPlusOne) },
      }),
    ).toContain('somar no máximo 40 MB')

    expect(
      lightcraftRunInputError({
        original: binaryPart('a.jpg', JPEG),
        commands: [],
        images: { ok_logo_1: binaryPart('logo.png', PNG) },
      }),
    ).toBeNull()

    const { engine, calls } = transport(() => okRunResponse())
    await expect(
      runPhotoEngine(engine, {
        original: dummyStream(MAX_LIGHTCRAFT_ORIGINAL_BYTES + 1),
        commands: [],
      }),
    ).rejects.toBeInstanceOf(LightcraftEngineError)
    expect(calls).toHaveLength(0)
  })

  it('rejects total multipart body over 150 MB before streaming', () => {
    // 100 MB original + 40 MB images + >10 MB settings JSON exceeds 150 MB.
    const bigSettings = { padding: 'x'.repeat(11 * 1024 * 1024) }
    const dummy = (size: number): LightcraftEngineBinaryPart => ({
      name: 'x.bin',
      stream: new ReadableStream({ start(c) { c.close() } }),
      size,
    })
    expect(() =>
      buildStreamingMultipart({
        original: dummy(MAX_LIGHTCRAFT_ORIGINAL_BYTES),
        settings: bigSettings,
        commands: [],
        images: {
          a: dummy(20 * 1024 * 1024),
          b: dummy(20 * 1024 * 1024),
        },
      }),
    ).toThrow(/excede o limite de 150 MB/)
    expect(MAX_LIGHTCRAFT_REQUEST_BYTES).toBe(150 * 1024 * 1024)
  })
})

describe('multipart response parsing & errors', () => {
  it('parses chunk-split multipart responses (7 bytes per chunk) and inspect-only responses', async () => {
    const { engine } = transport(() =>
      okRunResponse({ settings: { contrast: 12 }, results: [{ applied: true }] }, PNG, 7),
    )
    const result = await runPhotoEngine(engine, {
      original: binaryPart('photo.jpg', JPEG),
      commands: [{ command: 'light.contrast', params: { value: 12 } }],
    })
    expect(result).toEqual({
      settings: { contrast: 12 },
      results: [{ applied: true }],
      preview: PNG,
      previewContentType: 'image/png',
    })

    const inspectTransport = transport(() =>
      okRunResponse(
        { settings: {}, results: [], inspect: { width: 6000, height: 4000, camera: 'Sony A7IV' } },
        null,
        5,
      ),
    )
    const inspected = await runPhotoEngine(inspectTransport.engine, {
      original: binaryPart('photo.arw', JPEG),
      commands: [],
      inspect: true,
    })
    expect(inspected).toEqual({
      settings: {},
      results: [],
      inspect: { width: 6000, height: 4000, camera: 'Sony A7IV' },
    })
    expect(inspected.preview).toBeUndefined()
  })

  it('aborts immediately while reading a preview larger than 20 MB', async () => {
    const boundary = 'cap-test'
    const CHUNK = 1024 * 1024 // 1 MiB
    const oneMb = new Uint8Array(CHUNK)
    oneMb.set(JPEG, 0)
    let chunksSent = 0
    let cancelled = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const resultPart = encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="result"\r\nContent-Type: application/json\r\n\r\n{"settings":{},"results":[]}\r\n--${boundary}\r\nContent-Disposition: form-data; name="preview"\r\nContent-Type: image/jpeg\r\n\r\n`,
        )
        controller.enqueue(resultPart)
      },
      pull(controller) {
        if (chunksSent >= 30) {
          controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`))
          controller.close()
          return
        }
        chunksSent += 1
        controller.enqueue(oneMb)
      },
      cancel() {
        cancelled = true
      },
    })

    const { engine } = transport(
      () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        }),
    )

    await expect(
      runPhotoEngine(engine, { original: binaryPart('photo.jpg', JPEG), commands: [] }),
    ).rejects.toThrow(/prévia retornada pelo motor de fotos é maior que 20 MB/)
    expect(cancelled).toBe(true)
    // Stopped right after exceeding 20 MiB, never read all 30 MiB.
    expect(chunksSent).toBeLessThanOrEqual(22)
    expect(MAX_LIGHTCRAFT_PREVIEW_BYTES).toBe(20 * 1024 * 1024)
  })

  it('maps 422 to LightcraftEngineCommandError with index', async () => {
    const { engine } = transport(() =>
      Response.json({ error: 'Unknown parameter "foo"', index: 2 }, { status: 422 }),
    )
    const error = await runPhotoEngine(engine, {
      original: binaryPart('photo.jpg', JPEG),
      commands: [],
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LightcraftEngineCommandError)
    expect(error).toMatchObject({ engineMessage: 'Unknown parameter "foo"', index: 2 })
  })

  it('maps 503 not-configured, 413, 500, bad content-type and missing result part', async () => {
    const notConfigured = transport(() =>
      Response.json({ error: 'not-configured' }, { status: 503 }),
    )
    await expect(
      runPhotoEngine(notConfigured.engine, {
        original: binaryPart('photo.jpg', JPEG),
        commands: [],
      }),
    ).rejects.toBeInstanceOf(LightcraftEngineNotConfiguredError)

    const cases: Array<[Response, RegExp]> = [
      [new Response('too big', { status: 413 }), /grande demais para o motor de fotos: too big/],
      [new Response('boom', { status: 500 }), /falhou \(HTTP 500\): boom/],
      [new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), /multipart\/form-data/],
      [
        multipartResponse([{ name: 'preview', contentType: 'image/jpeg', body: JPEG }]),
        /parte "result"/,
      ],
    ]
    for (const [response, pattern] of cases) {
      const { engine } = transport(() => response)
      await expect(
        runPhotoEngine(engine, { original: binaryPart('photo.jpg', JPEG), commands: [] }),
      ).rejects.toThrow(pattern)
    }
  })

  it('times out and reports unreachable engine', async () => {
    vi.useFakeTimers()
    const hanging = transport(() => new Promise<Response>(() => {}))
    const pending = runPhotoEngine(hanging.engine, {
      original: binaryPart('photo.jpg', JPEG),
      commands: [],
    }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(LIGHTCRAFT_RUN_TIMEOUT_MS + 1)
    const error = await pending
    expect(error).toBeInstanceOf(LightcraftEngineError)
    expect((error as Error).message).toContain('não respondeu em 100 s')

    vi.useRealTimers()
    const down = transport(() => {
      throw new TypeError('fetch failed')
    })
    await expect(
      runPhotoEngine(down.engine, { original: binaryPart('photo.jpg', JPEG), commands: [] }),
    ).rejects.toThrow(/Não foi possível alcançar o motor de fotos/)
  })
})

describe('commands, health and URL transport', () => {
  it('lists commands with query in either answer shape', async () => {
    const list = [
      { id: 'develop.auto', label: 'Auto develop', params: {} },
      { id: 'light.exposure' },
    ]
    const { engine, calls } = transport(() => Response.json(list))
    expect(await listPhotoEngineCommands(engine, ' exposure ')).toEqual([
      { id: 'develop.auto', label: 'Auto develop', params: {} },
      { id: 'light.exposure', label: '', params: null },
    ])
    expect(calls[0]!.path).toBe('/commands?q=exposure')

    const wrapped = transport(() => Response.json({ commands: list }))
    expect(await listPhotoEngineCommands(wrapped.engine)).toHaveLength(2)
    expect(wrapped.calls[0]!.path).toBe('/commands')
  })

  it('checks health without throwing and builds URLs cleanly', async () => {
    expect(await lightcraftEngineHealth(transport(() => new Response('ok')).engine)).toBe(true)
    expect(
      await lightcraftEngineHealth(transport(() => new Response('', { status: 503 })).engine),
    ).toBe(false)
    expect(
      await lightcraftEngineHealth(
        transport(() => {
          throw new TypeError('down')
        }).engine,
      ),
    ).toBe(false)

    const seen: Array<string> = []
    const urlEngine = urlLightcraftEngineTransport('http://127.0.0.1:8081/', async (input) => {
      seen.push(String(input))
      return new Response('ok')
    })
    await lightcraftEngineHealth(urlEngine)
    expect(seen).toEqual(['http://127.0.0.1:8081/health'])
    expect(urlEngine.name).toBe('http://127.0.0.1:8081')
  })
})
