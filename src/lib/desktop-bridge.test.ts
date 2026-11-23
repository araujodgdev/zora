import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_EDITOR_EVENT_NAME,
  closeNativeEditor,
  focusNativeEditor,
  getDesktopInfo,
  isDesktopClosedPayload,
  isZoraDesktop,
  listOpenNativeEditors,
  openNativeDesignEditor,
  openNativePhotoEditor,
  parseDesktopEditorEvent,
  subscribeDesktopEditorEvents,
} from './desktop-bridge'
import type { DesktopBridgeDeps, DesktopEditorEvent, DesktopInfo } from './desktop-bridge'

describe('isZoraDesktop', () => {
  it('detects __TAURI_INTERNALS__ on the provided window object', () => {
    expect(isZoraDesktop({ __TAURI_INTERNALS__: {} })).toBe(true)
    expect(isZoraDesktop({ __TAURI_INTERNALS__: undefined })).toBe(true)
  })

  it('returns false outside Tauri and for non-object values', () => {
    expect(isZoraDesktop({})).toBe(false)
    expect(isZoraDesktop(undefined)).toBe(false)
    expect(isZoraDesktop(null)).toBe(false)
    expect(isZoraDesktop('window')).toBe(false)
  })
})

describe('parseDesktopEditorEvent', () => {
  it('parses valid studio and lightcraft events', () => {
    expect(
      parseDesktopEditorEvent({
        editor: 'studio',
        id: 'd-1',
        payload: { type: 'zora-studio:ready', designId: 'd-1' },
      }),
    ).toEqual({
      editor: 'studio',
      id: 'd-1',
      payload: { type: 'zora-studio:ready', designId: 'd-1' },
    })

    expect(
      parseDesktopEditorEvent({
        editor: 'lightcraft',
        id: 'e-1',
        payload: { type: 'zora-desktop:closed', exitCode: 0 },
      }),
    ).toEqual({
      editor: 'lightcraft',
      id: 'e-1',
      payload: { type: 'zora-desktop:closed', exitCode: 0 },
    })
  })

  it('rejects malformed events, unknown editors, empty ids and non-object payloads', () => {
    for (const invalid of [
      null,
      undefined,
      'event',
      [],
      {},
      { editor: 'other', id: 'd-1', payload: {} },
      { editor: 'studio', id: '', payload: {} },
      { editor: 'studio', id: 123, payload: {} },
      { editor: 'studio', id: 'd-1', payload: null },
      { editor: 'studio', id: 'd-1', payload: [] },
      { editor: 'studio', id: 'd-1', payload: 'ready' },
    ]) {
      expect(parseDesktopEditorEvent(invalid)).toBeNull()
    }
  })
})

describe('isDesktopClosedPayload', () => {
  it('accepts closed events with null or integer exitCode', () => {
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed', exitCode: 0 })).toBe(true)
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed', exitCode: 1 })).toBe(true)
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed', exitCode: null })).toBe(true)
  })

  it('rejects other message types and invalid exit codes', () => {
    expect(isDesktopClosedPayload({ type: 'zora-studio:ready', designId: 'd-1' })).toBe(false)
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed' })).toBe(false)
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed', exitCode: 1.5 })).toBe(false)
    expect(isDesktopClosedPayload({ type: 'zora-desktop:closed', exitCode: '0' })).toBe(false)
    expect(isDesktopClosedPayload(null)).toBe(false)
    expect(isDesktopClosedPayload([])).toBe(false)
  })
})

describe('desktop IPC wrappers', () => {
  it('rejects cleanly when not running in Zora Desktop', async () => {
    const invoke = vi.fn()
    const deps: DesktopBridgeDeps = { isDesktop: () => false, invoke }

    await expect(getDesktopInfo(deps)).rejects.toThrow('Zora Desktop is not available')
    await expect(
      openNativeDesignEditor(
        { designId: 'd-1', itemId: 'i-1', name: 'Capa', theme: 'dark' },
        deps,
      ),
    ).rejects.toThrow('Zora Desktop is not available')
    await expect(
      openNativePhotoEditor(
        { editId: 'e-1', itemId: 'i-1', name: 'Foto', theme: 'light' },
        deps,
      ),
    ).rejects.toThrow('Zora Desktop is not available')
    await expect(focusNativeEditor({ editor: 'studio', id: 'd-1' }, deps)).rejects.toThrow(
      'Zora Desktop is not available',
    )
    await expect(closeNativeEditor({ editor: 'lightcraft', id: 'e-1' }, deps)).rejects.toThrow(
      'Zora Desktop is not available',
    )
    await expect(listOpenNativeEditors(deps)).rejects.toThrow('Zora Desktop is not available')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forwards exact command names and payloads to Tauri invoke', async () => {
    const info: DesktopInfo = {
      version: '0.1.0',
      platform: 'windows',
      serverUrl: 'http://localhost:3000',
      studioAvailable: true,
      lightcraftAvailable: true,
    }
    const invoke = vi.fn(async (cmd: string) => {
      switch (cmd) {
        case 'desktop_info':
          return info
        case 'open_design_editor':
          return { status: 'opened', pid: 4242 }
        case 'open_photo_editor':
          return { status: 'already-open' }
        case 'focus_editor':
          return { focused: true }
        case 'close_editor':
          return { closed: true }
        case 'list_open_editors':
          return [{ editor: 'studio', id: 'd-1', itemId: 'i-1', name: 'Capa', dirty: false }]
        default:
          throw new Error(`unexpected command: ${cmd}`)
      }
    })
    const deps: DesktopBridgeDeps = {
      isDesktop: () => true,
      invoke: invoke as DesktopBridgeDeps['invoke'],
    }

    expect(await getDesktopInfo(deps)).toEqual(info)
    expect(
      await openNativeDesignEditor(
        { designId: 'd-1', itemId: 'i-1', name: 'Capa', theme: 'dark' },
        deps,
      ),
    ).toEqual({ status: 'opened', pid: 4242 })
    expect(
      await openNativePhotoEditor(
        { editId: 'e-1', itemId: 'i-1', name: 'Foto', theme: 'light' },
        deps,
      ),
    ).toEqual({ status: 'already-open' })
    expect(await focusNativeEditor({ editor: 'studio', id: 'd-1' }, deps)).toEqual({
      focused: true,
    })
    expect(await closeNativeEditor({ editor: 'lightcraft', id: 'e-1' }, deps)).toEqual({
      closed: true,
    })
    expect(await listOpenNativeEditors(deps)).toEqual([
      { editor: 'studio', id: 'd-1', itemId: 'i-1', name: 'Capa', dirty: false },
    ])

    expect(invoke.mock.calls).toEqual([
      ['desktop_info', undefined],
      ['open_design_editor', { designId: 'd-1', itemId: 'i-1', name: 'Capa', theme: 'dark' }],
      ['open_photo_editor', { editId: 'e-1', itemId: 'i-1', name: 'Foto', theme: 'light' }],
      ['focus_editor', { editor: 'studio', id: 'd-1' }],
      ['close_editor', { editor: 'lightcraft', id: 'e-1' }],
      ['list_open_editors', undefined],
    ])
  })
})

describe('subscribeDesktopEditorEvents', () => {
  it('is a no-op outside Zora Desktop', () => {
    const listen = vi.fn()
    const listener = vi.fn()
    const unsubscribe = subscribeDesktopEditorEvents(listener, {
      isDesktop: () => false,
      listen,
    })
    unsubscribe()
    expect(listen).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('parses valid events, ignores malformed ones, and cleans up on unsubscribe', async () => {
    const callbacks: Array<(event: { payload: unknown }) => void> = []
    const unlisten = vi.fn()
    const listen = vi.fn(async (eventName: string, cb: (event: { payload: unknown }) => void) => {
      expect(eventName).toBe(DESKTOP_EDITOR_EVENT_NAME)
      callbacks.push(cb)
      return unlisten
    })
    const received: Array<DesktopEditorEvent> = []

    const unsubscribe = subscribeDesktopEditorEvents((event) => received.push(event), {
      isDesktop: () => true,
      listen: listen as DesktopBridgeDeps['listen'],
    })

    // Wait for the listen promise to resolve.
    await Promise.resolve()

    const emit = callbacks[0]
    expect(emit).toBeDefined()

    emit!({ payload: { invalid: true } })
    emit!({
      payload: {
        editor: 'studio',
        id: 'd-1',
        payload: { type: 'zora-studio:dirty', designId: 'd-1', dirty: true },
      },
    })

    expect(received).toEqual([
      {
        editor: 'studio',
        id: 'd-1',
        payload: { type: 'zora-studio:dirty', designId: 'd-1', dirty: true },
      },
    ])

    unsubscribe()
    expect(unlisten).toHaveBeenCalledTimes(1)

    // Events emitted after unsubscribe are ignored.
    emit!({
      payload: {
        editor: 'studio',
        id: 'd-1',
        payload: { type: 'zora-desktop:closed', exitCode: 0 },
      },
    })
    expect(received).toHaveLength(1)
  })

  it('immediately calls unlisten if disposed before listen resolves', async () => {
    let resolveListen!: (fn: () => void) => void
    const unlisten = vi.fn()
    const listen = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve
        }),
    )

    const unsubscribe = subscribeDesktopEditorEvents(vi.fn(), {
      isDesktop: () => true,
      listen: listen as DesktopBridgeDeps['listen'],
    })

    unsubscribe()
    resolveListen(unlisten)
    await Promise.resolve()
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('swallows listen rejections safely', async () => {
    const listen = vi.fn(() => Promise.reject(new Error('bridge unavailable')))
    const unsubscribe = subscribeDesktopEditorEvents(vi.fn(), {
      isDesktop: () => true,
      listen: listen as DesktopBridgeDeps['listen'],
    })
    await Promise.resolve()
    expect(() => unsubscribe()).not.toThrow()
  })
})
