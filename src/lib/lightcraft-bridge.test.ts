import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIGHTCRAFT_PREVIEW_EXPORT,
  LightcraftBridge,
  LightcraftClosedError,
  LightcraftCommandError,
  LightcraftFailedError,
  LightcraftOpenError,
  LightcraftTimeoutError,
  canonicalJson,
  inspectedFileName,
  openLightcraftPhoto,
  parseLightcraftMessage,
  pollLightcraftDirty,
  saveLightcraftPhoto,
  settingsDiffer,
  settingsDifferences,
} from './lightcraft-bridge'
import type { LightcraftMessage, LightcraftOutgoing, LightcraftTransport } from './lightcraft-bridge'
import { savePhotoEditVersion } from './content-photo-edits.upload'

/** A fake frame: records what the page posts, and lets the test answer. */
class FakeFrame implements LightcraftTransport {
  posted: Array<LightcraftOutgoing> = []
  transfers: Array<Array<Transferable> | undefined> = []
  private listener: ((message: LightcraftMessage) => void) | null = null
  /** Answers each `lightcraft:cmd` synchronously-later (a microtask) when set. */
  handler: ((id: string, params: unknown) => Array<LightcraftMessage> | null) | null = null

  post = (message: LightcraftOutgoing, transfer?: Array<Transferable>) => {
    this.posted.push(message)
    this.transfers.push(transfer)
    if (message.type === 'lightcraft:cmd' && this.handler) {
      const answer = this.handler(message.id, JSON.parse(message.params))
      if (answer) queueMicrotask(() => answer.forEach((m) => this.send(m)))
    }
  }

  subscribe = (listener: (message: LightcraftMessage) => void) => {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }

  send(message: LightcraftMessage) {
    this.listener?.(message)
  }

  get commands() {
    return this.posted.flatMap((m) =>
      m.type === 'lightcraft:cmd' ? [{ id: m.id, params: JSON.parse(m.params) as unknown }] : [],
    )
  }
}

const ok = (value: unknown): LightcraftMessage => ({
  type: 'lightcraft:response',
  ok: true,
  value: JSON.stringify(value),
})
const refused = (text: string): LightcraftMessage => ({
  type: 'lightcraft:response',
  ok: false,
  value: text,
})

describe('parseLightcraftMessage', () => {
  it('accepts the known shapes', () => {
    const bytes = new ArrayBuffer(4)
    expect(parseLightcraftMessage({ type: 'lightcraft:ready', version: '0.21.1' })).toEqual({
      type: 'lightcraft:ready',
      version: '0.21.1',
    })
    expect(parseLightcraftMessage({ type: 'lightcraft:ready' })).toEqual({
      type: 'lightcraft:ready',
      version: null,
    })
    expect(parseLightcraftMessage({ type: 'lightcraft:failed', error: 'boom' })).toEqual({
      type: 'lightcraft:failed',
      error: 'boom',
    })
    expect(parseLightcraftMessage({ type: 'lightcraft:dirty', dirty: true })).toEqual({
      type: 'lightcraft:dirty',
      dirty: true,
    })
    expect(parseLightcraftMessage({ type: 'lightcraft:save', name: 'a.jpg', bytes })).toEqual({
      type: 'lightcraft:save',
      name: 'a.jpg',
      bytes,
    })
    expect(
      parseLightcraftMessage({ type: 'lightcraft:response', ok: false, value: 'no photo' }),
    ).toEqual({ type: 'lightcraft:response', ok: false, value: 'no photo' })
  })

  it('copies a typed array into an ArrayBuffer', () => {
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3)
    const parsed = parseLightcraftMessage({ type: 'lightcraft:save', name: 'a', bytes: view })
    expect(parsed?.type).toBe('lightcraft:save')
    if (parsed?.type === 'lightcraft:save') expect([...new Uint8Array(parsed.bytes)]).toEqual([2, 3])
  })

  it('refuses anything else', () => {
    for (const data of [
      null,
      'lightcraft:ready',
      42,
      {},
      { type: 'zora-studio:ready' },
      { type: 'lightcraft:cmd', id: 'x', params: '{}' },
      { type: 'lightcraft:failed' },
      { type: 'lightcraft:dirty', dirty: 'yes' },
      { type: 'lightcraft:save', name: 'a.jpg', bytes: 'abc' },
      { type: 'lightcraft:save', bytes: new ArrayBuffer(1) },
      { type: 'lightcraft:response', ok: true, value: { a: 1 } },
      { type: 'lightcraft:response', ok: 'true', value: '{}' },
    ]) {
      expect(parseLightcraftMessage(data)).toBeNull()
    }
  })
})

describe('LightcraftBridge (the command queue)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one command at a time, FIFO, with params as JSON text', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const first = bridge.command('develop.get')
    const second = bridge.command('photo.inspect', { id: 3 })
    expect(frame.posted).toEqual([{ type: 'lightcraft:cmd', id: 'develop.get', params: '{}' }])
    expect(bridge.isBusy).toBe(true)

    frame.send(ok({ a: 1 }))
    await expect(first).resolves.toEqual({ a: 1 })
    expect(frame.posted[1]).toEqual({
      type: 'lightcraft:cmd',
      id: 'photo.inspect',
      params: '{"id":3}',
    })
    frame.send(ok({ file_name: 'x.jpg' }))
    await expect(second).resolves.toEqual({ file_name: 'x.jpg' })
    expect(bridge.isBusy).toBe(false)
  })

  it('rejects a refused command with its text and goes on with the next', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const first = bridge.command('develop.get')
    const second = bridge.commandText('develop.get')
    frame.send(refused('no photo'))
    await expect(first).rejects.toEqual(new LightcraftCommandError('develop.get', 'no photo'))
    frame.send({ type: 'lightcraft:response', ok: true, value: '{"b":2}' })
    await expect(second).resolves.toBe('{"b":2}')
  })

  it('ignores an answer nobody waits for, and the dirty noise', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    frame.send(ok({ stray: true }))
    frame.send({ type: 'lightcraft:dirty', dirty: true })
    const value = bridge.command('develop.get')
    frame.send(ok({ real: true }))
    await expect(value).resolves.toEqual({ real: true })
  })

  it('rejects everything pending on lightcraft:failed', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const first = bridge.command('develop.get')
    const second = bridge.command('develop.get')
    frame.send({ type: 'lightcraft:failed', error: 'too large' })
    await expect(first).rejects.toBeInstanceOf(LightcraftFailedError)
    await expect(second).rejects.toThrow('too large')
    expect(bridge.isBusy).toBe(false)
    expect(bridge.lastFailure).toBe('too large')
  })

  it('rejects everything pending on dispose, and refuses new commands', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const pending = bridge.command('develop.get')
    const ready = bridge.whenReady()
    bridge.dispose()
    await expect(pending).rejects.toBeInstanceOf(LightcraftClosedError)
    await expect(ready).rejects.toBeInstanceOf(LightcraftClosedError)
    await expect(bridge.command('develop.get')).rejects.toBeInstanceOf(LightcraftClosedError)
  })

  it('times a command out and then stops sending', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame, undefined, 1000)
    const pending = bridge.command('develop.get')
    const queued = bridge.command('develop.get')
    const expectation = expect(pending).rejects.toBeInstanceOf(LightcraftTimeoutError)
    const queuedExpectation = expect(queued).rejects.toBeInstanceOf(LightcraftTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
    await queuedExpectation
    await expect(bridge.command('develop.get')).rejects.toBeInstanceOf(LightcraftTimeoutError)
    expect(frame.commands).toHaveLength(1)
    expect(bridge.isDisposed).toBe(true)
  })

  it('resolves whenReady with the version, before or after it arrives', async () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const ready = bridge.whenReady()
    frame.send({ type: 'lightcraft:ready', version: '0.21.1' })
    await expect(ready).resolves.toBe('0.21.1')
    await expect(bridge.whenReady()).resolves.toBe('0.21.1')
  })

  it('rejects whenReady on failed or timeout', async () => {
    const failing = new FakeFrame()
    const failed = new LightcraftBridge(failing).whenReady()
    failing.send({ type: 'lightcraft:failed', error: 'no webgl' })
    await expect(failed).rejects.toThrow('no webgl')

    const slow = new LightcraftBridge(new FakeFrame()).whenReady(500)
    const expectation = expect(slow).rejects.toBeInstanceOf(LightcraftTimeoutError)
    await vi.advanceTimersByTimeAsync(500)
    await expectation
  })

  it('transfers the bytes of lightcraft:open', () => {
    const frame = new FakeFrame()
    const bridge = new LightcraftBridge(frame)
    const bytes = new ArrayBuffer(8)
    bridge.open('photo.cr2', bytes)
    expect(frame.posted).toEqual([{ type: 'lightcraft:open', name: 'photo.cr2', bytes }])
    expect(frame.transfers[0]).toEqual([bytes])
  })
})

/** A scripted LightCraft: the demo library, the import landing after a few polls. */
function scriptedLightcraft(
  frame: FakeFrame,
  options: {
    demoIds?: Array<number>
    deleteRefused?: boolean
    pollsBeforeImport?: number
    importedName?: string
    settings?: Record<string, unknown>
    ignoredOnMerge?: Array<string>
  } = {},
) {
  let imported = false
  let polls = 0
  let settings: Record<string, unknown> = options.settings ?? { light: { exposure: 0 }, version: 1 }
  frame.post = ((original) => (message: LightcraftOutgoing, transfer?: Array<Transferable>) => {
    if (message.type === 'lightcraft:open') {
      frame.posted.push(message)
      frame.transfers.push(transfer)
      polls = 0
      imported = false
      return
    }
    original(message, transfer)
  })(frame.post)
  frame.handler = (id, params) => {
    const p = params as Record<string, unknown>
    switch (id) {
      case 'catalog.query':
        return [ok({ total: 2, photos: (options.demoIds ?? [1, 2]).map((n) => ({ id: n })) })]
      case 'photo.deletePermanently':
        return options.deleteRefused ? [refused('nothing selected')] : [ok({ deleted: 2 })]
      case 'library.select':
        return [ok({})]
      case 'develop.get':
        polls += 1
        if (!imported && polls > (options.pollsBeforeImport ?? 2)) imported = true
        return imported ? [ok(settings)] : [refused('no photo')]
      case 'photo.inspect':
        return imported
          ? [ok({ id: 25, file_name: options.importedName ?? 'IMG_1.CR2' })]
          : [refused('no photo')]
      case 'develop.merge': {
        const merged = { ...settings, ...(p.settings as Record<string, unknown>) }
        // a key this LightCraft does not take from a merge keeps the import's value
        for (const key of options.ignoredOnMerge ?? []) merged[key] = settings[key]
        settings = merged
        return [ok({})]
      }
      default:
        return [refused(`unknown command ${id}`)]
    }
  }
}

describe('openLightcraftPhoto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the demos, opens, polls until the right photo, merges and returns the baseline', async () => {
    const frame = new FakeFrame()
    scriptedLightcraft(frame, { pollsBeforeImport: 3 })
    const bridge = new LightcraftBridge(frame)
    const bytes = new ArrayBuffer(16)
    const opened = openLightcraftPhoto(bridge, {
      name: 'IMG_1.CR2',
      bytes,
      settings: { light: { exposure: 1.5 } },
      label: 'Versão 2',
    })
    await vi.advanceTimersByTimeAsync(5000)
    const baseline = await opened
    expect(JSON.parse(baseline)).toEqual({ light: { exposure: 1.5 }, version: 1 })

    const ids = frame.commands.map((c) => c.id)
    expect(ids.slice(0, 2)).toEqual(['catalog.query', 'photo.deletePermanently'])
    expect(frame.commands[1]?.params).toEqual({ ids: [1, 2] })
    expect(frame.posted.findIndex((m) => m.type === 'lightcraft:open')).toBe(2)
    expect(frame.commands.find((c) => c.id === 'develop.merge')?.params).toEqual({
      settings: { light: { exposure: 1.5 } },
      label: 'Versão 2',
    })
    expect(ids.at(-1)).toBe('develop.get')
    expect(ids.at(-2)).toBe('develop.merge')
  })

  it('returns the merged state silently when it is the saved version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const frame = new FakeFrame()
      scriptedLightcraft(frame, { pollsBeforeImport: 0 })
      const bridge = new LightcraftBridge(frame)
      const saved = { light: { exposure: 0.5 }, version: 1 }
      const opened = openLightcraftPhoto(bridge, {
        name: 'IMG_1.CR2',
        bytes: new ArrayBuffer(1),
        settings: saved,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(JSON.parse(await opened)).toEqual(saved)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('warns, naming the paths, when the merge does not reproduce the saved version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const frame = new FakeFrame()
      // a raw's import turns Remove Hot Pixels on; this LightCraft keeps it on through a merge
      scriptedLightcraft(frame, {
        pollsBeforeImport: 0,
        settings: { light: { exposure: 0 }, detail: { nr_outliers: true } },
        ignoredOnMerge: ['detail'],
      })
      const bridge = new LightcraftBridge(frame)
      const opened = openLightcraftPhoto(bridge, {
        name: 'IMG_1.CR2',
        bytes: new ArrayBuffer(1),
        settings: { light: { exposure: 0.5 }, detail: { nr_outliers: false } },
        label: 'Versão 1',
      })
      await vi.advanceTimersByTimeAsync(1000)
      // the editor's state is the baseline
      expect(JSON.parse(await opened)).toEqual({
        light: { exposure: 0.5 },
        detail: { nr_outliers: true },
      })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('Versão 1 at detail.nr_outliers')
    } finally {
      warn.mockRestore()
    }
  })

  it('skips the merge without a version, and deselects when delete is refused', async () => {
    const frame = new FakeFrame()
    scriptedLightcraft(frame, { deleteRefused: true, pollsBeforeImport: 0 })
    const bridge = new LightcraftBridge(frame)
    const opened = openLightcraftPhoto(bridge, { name: 'IMG_1.CR2', bytes: new ArrayBuffer(1) })
    await vi.advanceTimersByTimeAsync(1000)
    await opened
    const ids = frame.commands.map((c) => c.id)
    expect(ids).toContain('library.select')
    expect(frame.commands.find((c) => c.id === 'library.select')?.params).toEqual({ ids: [] })
    expect(ids).not.toContain('develop.merge')
  })

  it('times out when the active photo never becomes the opened one', async () => {
    const frame = new FakeFrame()
    scriptedLightcraft(frame, { importedName: 'demo-7.jpg', pollsBeforeImport: 0 })
    const bridge = new LightcraftBridge(frame)
    const opened = openLightcraftPhoto(bridge, {
      name: 'IMG_1.CR2',
      bytes: new ArrayBuffer(1),
      timeoutMs: 2000,
    })
    const expectation = expect(opened).rejects.toThrow('Não foi possível abrir a foto.')
    await vi.advanceTimersByTimeAsync(3000)
    await expectation
  })

  it('ends at once on lightcraft:failed', async () => {
    const frame = new FakeFrame()
    scriptedLightcraft(frame, { pollsBeforeImport: 1000 })
    const bridge = new LightcraftBridge(frame)
    const opened = openLightcraftPhoto(bridge, { name: 'IMG_1.CR2', bytes: new ArrayBuffer(1) })
    const expectation = expect(opened).rejects.toThrow(/too large/)
    await vi.advanceTimersByTimeAsync(500)
    frame.send({ type: 'lightcraft:failed', error: 'the file is too large to open' })
    await vi.advanceTimersByTimeAsync(500)
    await expectation
    await expect(opened).rejects.toBeInstanceOf(LightcraftOpenError)
  })

  it('reports a refused merge', async () => {
    const frame = new FakeFrame()
    scriptedLightcraft(frame, { pollsBeforeImport: 0 })
    const handler = frame.handler!
    frame.handler = (id, params) =>
      id === 'develop.merge' ? [refused('bad settings')] : handler(id, params)
    const bridge = new LightcraftBridge(frame)
    const opened = openLightcraftPhoto(bridge, {
      name: 'IMG_1.CR2',
      bytes: new ArrayBuffer(1),
      settings: { nope: true },
    })
    const expectation = expect(opened).rejects.toThrow('Não foi possível abrir a foto: bad settings')
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })
})

describe('settingsDifferences', () => {
  it('names the differing paths, key order ignored', () => {
    expect(
      settingsDifferences({ a: 1, b: { c: [1, 2], d: true } }, { b: { d: true, c: [1, 2] }, a: 1 }),
    ).toEqual([])
    expect(settingsDifferences({ a: 1, b: { c: 2 } }, { a: 2, b: { c: 2, e: null } })).toEqual([
      'a',
      'b.e',
    ])
    expect(settingsDifferences({ detail: { nr_outliers: false } }, { detail: {} })).toEqual([
      'detail.nr_outliers',
    ])
    expect(settingsDifferences(1, 2)).toEqual(['(root)'])
  })

  it('lists at most 20', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]))
    expect(settingsDifferences(many, {})).toHaveLength(20)
  })
})

describe('inspectedFileName', () => {
  it('reads the catalog Photo field', () => {
    expect(inspectedFileName({ file_name: 'a.jpg' })).toBe('a.jpg')
    expect(inspectedFileName({ fileName: 'b.jpg' })).toBe('b.jpg')
    expect(inspectedFileName({})).toBeNull()
    expect(inspectedFileName(null)).toBeNull()
  })
})

describe('saveLightcraftPhoto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer

  it('gets the settings, exports with the pinned params and keeps the preview save', async () => {
    const frame = new FakeFrame()
    frame.handler = (id) => {
      if (id === 'develop.get') return [{ type: 'lightcraft:response', ok: true, value: '{"a":1}' }]
      if (id === 'app.export') {
        return [
          { type: 'lightcraft:save', name: 'library.zip', bytes: new ArrayBuffer(3) },
          { type: 'lightcraft:save', name: 'preview.jpg', bytes: jpeg },
          ok({ files: [{ path: 'preview.jpg' }] }),
        ]
      }
      return null
    }
    const bridge = new LightcraftBridge(frame)
    const saved = await saveLightcraftPhoto(bridge)
    expect(saved.settingsText).toBe('{"a":1}')
    expect(saved.preview).toBe(jpeg)
    expect(frame.commands[1]).toEqual({ id: 'app.export', params: LIGHTCRAFT_PREVIEW_EXPORT })
    expect(JSON.parse((frame.posted[1] as { params: string }).params)).toEqual({
      path: 'preview.jpg',
      format: 'jpeg',
      quality: 85,
      longEdge: 2048,
      dontEnlarge: true,
      metadata: 'none',
    })
  })

  it('retries once after a still-loading refusal', async () => {
    const frame = new FakeFrame()
    let exports = 0
    frame.handler = (id) => {
      if (id === 'develop.get') return [ok({ a: 1 })]
      exports += 1
      return exports === 1
        ? [refused('web/h1/a.cr2: the original is still loading from browser storage')]
        : [{ type: 'lightcraft:save', name: 'preview.jpg', bytes: jpeg }, ok({ files: [] })]
    }
    const bridge = new LightcraftBridge(frame)
    const saved = saveLightcraftPhoto(bridge, { retryMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(saved).resolves.toMatchObject({ preview: jpeg })
    expect(exports).toBe(2)
  })

  it('fails on other refusals, a second still-loading, or a missing preview', async () => {
    const frame = new FakeFrame()
    frame.handler = (id) => (id === 'develop.get' ? [ok({})] : [refused('no photo selected')])
    await expect(saveLightcraftPhoto(new LightcraftBridge(frame))).rejects.toThrow(
      'no photo selected',
    )

    const loading = new FakeFrame()
    loading.handler = (id) => (id === 'develop.get' ? [ok({})] : [refused('still loading')])
    const twice = saveLightcraftPhoto(new LightcraftBridge(loading), { retryMs: 10 })
    const expectation = expect(twice).rejects.toThrow('still loading')
    await vi.advanceTimersByTimeAsync(10)
    await expectation

    const silent = new FakeFrame()
    silent.handler = () => [ok({})]
    await expect(saveLightcraftPhoto(new LightcraftBridge(silent))).rejects.toThrow(/prévia/)
  })
})

describe('dirty', () => {
  it('compares settings by meaning, not by text', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"x":2,"y":1}]},"b":1}',
    )
    expect(settingsDiffer('{"a":1,"b":2}', '{ "b": 2, "a": 1 }')).toBe(false)
    expect(settingsDiffer('{"a":1,"b":2}', '{"a":1,"b":3}')).toBe(true)
    expect(settingsDiffer('{"a":[1,2]}', '{"a":[2,1]}')).toBe(true)
  })

  it('polls develop.get against the baseline, skipping while busy', async () => {
    const frame = new FakeFrame()
    let current = '{"light":{"exposure":0}}'
    frame.handler = (id) =>
      id === 'develop.get' ? [{ type: 'lightcraft:response', ok: true, value: current }] : null
    const bridge = new LightcraftBridge(frame)
    const baseline = '{"light":{"exposure":0}}'
    await expect(pollLightcraftDirty(bridge, baseline)).resolves.toBe(false)
    current = '{"light":{"exposure":0.3}}'
    await expect(pollLightcraftDirty(bridge, baseline)).resolves.toBe(true)

    // Busy: a command without an answer is in flight.
    frame.handler = null
    void bridge.command('app.export').catch(() => {})
    expect(bridge.isBusy).toBe(true)
    await expect(pollLightcraftDirty(bridge, baseline)).resolves.toBeNull()
    expect(frame.commands.filter((c) => c.id === 'develop.get')).toHaveLength(2)
    bridge.dispose()
    await expect(pollLightcraftDirty(bridge, baseline, { force: true })).resolves.toBeNull()
  })
})

describe('savePhotoEditVersion', () => {
  const editId = '00000000-0000-4000-8000-000000000001'

  it('posts the multipart form and returns the new version', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(await (form.get('settings') as Blob).text()).toBe('{"a":1}')
      expect((form.get('preview') as Blob).size).toBe(4)
      expect(form.get('baseVersionId')).toBe('')
      return Response.json({ versionId: 'v1', number: 1 }, { status: 201 })
    })
    await expect(
      savePhotoEditVersion(
        editId,
        { settingsText: '{"a":1}', preview: new ArrayBuffer(4), baseVersionId: null },
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toEqual({ kind: 'saved', versionId: 'v1', number: 1 })
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/photo-edits/${editId}/versions`)
  })

  it('returns a conflict, and throws the server message otherwise', async () => {
    const conflict = vi.fn(async () =>
      Response.json(
        { error: 'Há uma versão mais nova.', currentVersionId: 'v3', currentVersionNumber: 3 },
        { status: 409 },
      ),
    )
    await expect(
      savePhotoEditVersion(
        editId,
        { settingsText: '{}', preview: new ArrayBuffer(1), baseVersionId: 'v2' },
        conflict as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      kind: 'conflict',
      error: 'Há uma versão mais nova.',
      currentVersionId: 'v3',
      currentVersionNumber: 3,
    })

    const tooLarge = vi.fn(async () =>
      Response.json({ error: 'A prévia é grande demais.' }, { status: 413 }),
    )
    await expect(
      savePhotoEditVersion(
        editId,
        { settingsText: '{}', preview: new ArrayBuffer(1), baseVersionId: null },
        tooLarge as unknown as typeof fetch,
      ),
    ).rejects.toThrow('A prévia é grande demais.')

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      savePhotoEditVersion(
        editId,
        { settingsText: '{}', preview: new ArrayBuffer(1), baseVersionId: null },
        offline as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/conexão/)
  })
})
