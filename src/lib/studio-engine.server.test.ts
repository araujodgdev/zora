import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENGINE_RUN_TIMEOUT_MS,
  MAX_ENGINE_IMAGES,
  MAX_ENGINE_IMAGES_TOTAL_BYTES,
  MAX_ENGINE_SOURCE_BYTES,
  StudioEngineCommandError,
  StudioEngineError,
  StudioEngineNotConfiguredError,
  base64ToBytes,
  bytesToBase64,
  encodeRunRequest,
  engineHealth,
  engineRunRequestError,
  listEngineCommands,
  runEngine,
  urlEngineTransport,
} from './studio-engine.server'
import type { StudioEngineTransport } from './studio-engine.server'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SOURCE = new TextEncoder().encode('{"doc":1}')

function transport(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; init: RequestInit }> = []
  const engine: StudioEngineTransport = {
    name: 'test',
    fetch: async (path, init) => {
      calls.push({ path, init })
      return handler(path, init)
    },
  }
  return { engine, calls }
}

const okRun = () =>
  Response.json({ source: bytesToBase64(SOURCE), preview: bytesToBase64(PNG), results: [{ ok: true }] })

afterEach(() => {
  vi.useRealTimers()
})

describe('base64', () => {
  it('round-trips large binary data', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
  it('rejects invalid text', () => {
    expect(base64ToBytes('not base64!')).toBeNull()
    expect(base64ToBytes('abcde')).toBeNull()
  })
})

describe('run request', () => {
  it('encodes the contract shape', () => {
    const body = JSON.parse(
      encodeRunRequest({
        source: SOURCE,
        images: { bg: PNG },
        commands: [{ command: 'a' }, { command: 'b', params: { x: 1 } }],
        render: { scale: 1, maxSize: 4096 },
      }),
    )
    expect(body).toEqual({
      source: bytesToBase64(SOURCE),
      images: { bg: bytesToBase64(PNG) },
      commands: [
        { command: 'a', params: {} },
        { command: 'b', params: { x: 1 } },
      ],
      render: { scale: 1, maxSize: 4096 },
    })
    expect(JSON.parse(encodeRunRequest({ new: { width: 1, height: 2, name: 'n' }, commands: [], inspect: true }))).toEqual({
      new: { width: 1, height: 2, name: 'n' },
      commands: [],
      inspect: true,
    })
  })

  it('checks the limits', () => {
    const base = { commands: [] }
    expect(engineRunRequestError(base)).toContain('source or a new document')
    expect(engineRunRequestError({ ...base, source: SOURCE, new: { width: 1, height: 1, name: 'x' } })).toContain('not both')
    expect(
      engineRunRequestError({ source: SOURCE, commands: Array.from({ length: 201 }, () => ({ command: 'x' })) }),
    ).toContain('At most 200 commands')
    expect(engineRunRequestError({ ...base, source: new Uint8Array(MAX_ENGINE_SOURCE_BYTES + 1) })).toContain(
      'larger than',
    )
    const many = Object.fromEntries(Array.from({ length: MAX_ENGINE_IMAGES + 1 }, (_, i) => [`i${i}`, PNG]))
    expect(engineRunRequestError({ ...base, source: SOURCE, images: many })).toContain('At most 20 images')
    expect(engineRunRequestError({ ...base, source: SOURCE, images: { 'a/b': PNG } })).toContain('not allowed')
    const half = new Uint8Array(MAX_ENGINE_IMAGES_TOTAL_BYTES / 2 + 1)
    expect(engineRunRequestError({ ...base, source: SOURCE, images: { a: half, b: half } })).toContain('total')
    expect(engineRunRequestError({ ...base, source: SOURCE, images: { ok_name: PNG } })).toBeNull()
  })

  it('does not call the engine for a request over the limits', async () => {
    const { engine, calls } = transport(okRun)
    await expect(
      runEngine(engine, { source: SOURCE, commands: Array.from({ length: 201 }, () => ({ command: 'x' })) }),
    ).rejects.toBeInstanceOf(StudioEngineError)
    expect(calls).toHaveLength(0)
  })
})

describe('runEngine', () => {
  it('posts JSON to /run and decodes the answer', async () => {
    const { engine, calls } = transport(okRun)
    const result = await runEngine(engine, { source: SOURCE, commands: [{ command: 'a' }] })
    expect(result).toEqual({ source: SOURCE, preview: PNG, results: [{ ok: true }] })
    expect(calls[0]!.path).toBe('/run')
    expect(calls[0]!.init.method).toBe('POST')
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json')
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps 422 to a command error with its index', async () => {
    const { engine } = transport(() => Response.json({ error: 'bad colour', index: 3 }, { status: 422 }))
    const error = await runEngine(engine, { source: SOURCE, commands: [] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StudioEngineCommandError)
    expect(error).toMatchObject({ engineMessage: 'bad colour', index: 3 })
  })

  it('maps other failures to readable errors', async () => {
    const cases: Array<[Response, RegExp]> = [
      [new Response('too big', { status: 413 }), /too large for the design engine: too big/],
      [new Response('boom', { status: 500 }), /failed \(HTTP 500\): boom/],
      [Response.json({ error: 'not-configured' }, { status: 503 }), /not configured/],
      [new Response('<html>', { status: 200 }), /invalid answer \(not JSON\)/],
      [Response.json({ source: 'not base64!', preview: bytesToBase64(PNG) }), /invalid source/],
      [Response.json({ results: 'nope' }), /invalid answer/],
    ]
    for (const [response, message] of cases) {
      const { engine } = transport(() => response)
      await expect(runEngine(engine, { source: SOURCE, commands: [] })).rejects.toThrow(message)
    }
    const { engine } = transport(() => Response.json({ error: 'not-configured' }, { status: 503 }))
    await expect(runEngine(engine, { source: SOURCE, commands: [] })).rejects.toBeInstanceOf(
      StudioEngineNotConfiguredError,
    )
  })

  it('refuses an answer declared larger than the limit without reading it', async () => {
    const { engine } = transport(
      () => new Response('{}', { headers: { 'content-length': String(500 * 1024 * 1024) } }),
    )
    await expect(runEngine(engine, { source: SOURCE, commands: [] })).rejects.toThrow(/answer is larger than/)
  })

  it('refuses a preview over the design preview limit', async () => {
    const big = 'A'.repeat(28 * 1024 * 1024)
    const { engine } = transport(() => Response.json({ source: bytesToBase64(SOURCE), preview: big }))
    await expect(runEngine(engine, { source: SOURCE, commands: [] })).rejects.toThrow(/preview larger than 20 MB/)
  })

  it('times out', async () => {
    vi.useFakeTimers()
    const { engine } = transport(() => new Promise<Response>(() => {}))
    const pending = runEngine(engine, { source: SOURCE, commands: [] }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(ENGINE_RUN_TIMEOUT_MS + 1)
    const error = await pending
    expect(error).toBeInstanceOf(StudioEngineError)
    expect((error as Error).message).toContain('did not answer within 100 s')
  })

  it('reports an unreachable engine', async () => {
    const { engine } = transport(() => {
      throw new TypeError('fetch failed')
    })
    await expect(runEngine(engine, { source: SOURCE, commands: [] })).rejects.toThrow(/could not be reached/)
  })
})

describe('commands and health', () => {
  it('lists commands with a query, in either answer shape', async () => {
    const list = [{ id: 'text.add', label: 'Add text', params: { text: 'string' } }, { id: 'x' }]
    const { engine, calls } = transport(() => Response.json(list))
    expect(await listEngineCommands(engine, ' add text ')).toEqual([
      { id: 'text.add', label: 'Add text', params: { text: 'string' } },
      { id: 'x', label: '', params: null },
    ])
    expect(calls[0]!.path).toBe('/commands?q=add+text')
    const wrapped = transport(() => Response.json({ commands: list }))
    expect(await listEngineCommands(wrapped.engine)).toHaveLength(2)
    expect(wrapped.calls[0]!.path).toBe('/commands')
  })

  it('checks health without throwing', async () => {
    expect(await engineHealth(transport(() => new Response('ok')).engine)).toBe(true)
    expect(await engineHealth(transport(() => new Response('', { status: 503 })).engine)).toBe(false)
    expect(
      await engineHealth(
        transport(() => {
          throw new TypeError('down')
        }).engine,
      ),
    ).toBe(false)
  })

  it('builds URLs for a plain-URL engine', async () => {
    const seen: Array<string> = []
    const engine = urlEngineTransport('http://127.0.0.1:8080/', async (input) => {
      seen.push(String(input))
      return new Response('ok')
    })
    await engineHealth(engine)
    expect(seen).toEqual(['http://127.0.0.1:8080/health'])
    expect(engine.name).toBe('http://127.0.0.1:8080')
  })
})
