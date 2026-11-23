import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import type { Event, UnlistenFn } from '@tauri-apps/api/event'

/**
 * Client-safe, SSR-safe bridge to the Zora Desktop (Tauri v2) host.
 *
 * When Zora runs in a normal web browser, `isZoraDesktop()` returns `false`
 * and none of the Tauri IPC commands are invoked. When running inside the
 * Zora Desktop shell, editor routes use this bridge to launch, focus, close,
 * and receive lifecycle events from native Rust/wgpu Zora Studio and Zora
 * LightCraft windows.
 */

export type DesktopEditorKind = 'studio' | 'lightcraft'

export type DesktopTheme = 'dark' | 'light'

export type DesktopInfo = {
  version: string
  platform: string
  serverUrl: string
  studioAvailable: boolean
  lightcraftAvailable: boolean
}

export type OpenEditorResult = {
  status: 'opened' | 'already-open'
  pid?: number
}

export type OpenEditorEntry = {
  editor: DesktopEditorKind
  id: string
  itemId: string
  name: string
  dirty: boolean
}

export type DesktopClosedEvent = {
  type: 'zora-desktop:closed'
  exitCode: number | null
}

export type DesktopEditorEvent = {
  editor: DesktopEditorKind
  id: string
  payload: Record<string, unknown>
}

export const DESKTOP_EDITOR_EVENT_NAME = 'zora-desktop:editor-event'

/** Stable public download URL for the latest Windows single installer (GitHub Releases). */
export const ZORA_DESKTOP_DOWNLOAD_URL =
  'https://github.com/araujodgdev/zora/releases/latest/download/Zora-Desktop-Setup-x64.exe'

/** Public GitHub Releases page for Zora Desktop. */
export const ZORA_DESKTOP_RELEASES_URL =
  'https://github.com/araujodgdev/zora/releases/latest'

export type DesktopBridgeDeps = {
  isDesktop?: () => boolean
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  listen?: <T>(
    event: string,
    handler: (event: Pick<Event<T>, 'payload'>) => void,
  ) => Promise<UnlistenFn>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDesktopEditorKind(value: unknown): value is DesktopEditorKind {
  return value === 'studio' || value === 'lightcraft'
}

/**
 * Returns `true` when running inside the Zora Desktop (Tauri v2) webview.
 * Safe to call during SSR and in unit tests (pass a custom `win` to test).
 */
export function isZoraDesktop(
  win: unknown = typeof window !== 'undefined' ? window : undefined,
): boolean {
  return typeof win === 'object' && win !== null && '__TAURI_INTERNALS__' in win
}

/**
 * Parses an incoming `zora-desktop:editor-event` payload.
 * Returns `null` when the shape is invalid or missing required fields.
 */
export function parseDesktopEditorEvent(data: unknown): DesktopEditorEvent | null {
  if (!isPlainRecord(data)) return null
  if (!isDesktopEditorKind(data.editor)) return null
  if (typeof data.id !== 'string' || data.id.length === 0) return null
  if (!isPlainRecord(data.payload)) return null
  return {
    editor: data.editor,
    id: data.id,
    payload: data.payload,
  }
}

/**
 * Type guard for the synthetic closed event emitted by Zora Desktop when a
 * native editor process exits.
 */
export function isDesktopClosedPayload(payload: unknown): payload is DesktopClosedEvent {
  if (!isPlainRecord(payload)) return false
  if (payload.type !== 'zora-desktop:closed') return false
  const { exitCode } = payload
  return exitCode === null || (typeof exitCode === 'number' && Number.isInteger(exitCode))
}

function invokeDesktop<T>(
  cmd: string,
  args?: Record<string, unknown>,
  deps?: DesktopBridgeDeps,
): Promise<T> {
  const checkDesktop = deps?.isDesktop ?? isZoraDesktop
  if (!checkDesktop()) {
    return Promise.reject(new Error('Zora Desktop is not available in this environment'))
  }
  const invokeFn = deps?.invoke ?? tauriInvoke
  return invokeFn<T>(cmd, args)
}

/** Returns version, platform, server URL and native editor availability. */
export function getDesktopInfo(deps?: DesktopBridgeDeps): Promise<DesktopInfo> {
  return invokeDesktop<DesktopInfo>('desktop_info', undefined, deps)
}

/** Launches (or focuses) the native Zora Studio window for a design. */
export function openNativeDesignEditor(
  args: { designId: string; itemId: string; name: string; theme: DesktopTheme },
  deps?: DesktopBridgeDeps,
): Promise<OpenEditorResult> {
  return invokeDesktop<OpenEditorResult>('open_design_editor', args, deps)
}

/** Launches (or focuses) the native Zora LightCraft window for a photo edit. */
export function openNativePhotoEditor(
  args: { editId: string; itemId: string; name: string; theme: DesktopTheme },
  deps?: DesktopBridgeDeps,
): Promise<OpenEditorResult> {
  return invokeDesktop<OpenEditorResult>('open_photo_editor', args, deps)
}

/** Brings an already-open native editor window to the foreground. */
export function focusNativeEditor(
  args: { editor: DesktopEditorKind; id: string },
  deps?: DesktopBridgeDeps,
): Promise<{ focused: boolean }> {
  return invokeDesktop<{ focused: boolean }>('focus_editor', args, deps)
}

/** Requests closing an open native editor window. */
export function closeNativeEditor(
  args: { editor: DesktopEditorKind; id: string },
  deps?: DesktopBridgeDeps,
): Promise<{ closed: boolean }> {
  return invokeDesktop<{ closed: boolean }>('close_editor', args, deps)
}

/** Lists all native editors currently tracked by Zora Desktop. */
export function listOpenNativeEditors(deps?: DesktopBridgeDeps): Promise<Array<OpenEditorEntry>> {
  return invokeDesktop<Array<OpenEditorEntry>>('list_open_editors', undefined, deps)
}

/**
 * Subscribes to `zora-desktop:editor-event` notifications from Zora Desktop.
 * Returns a synchronous cleanup function safe to return from `useEffect`.
 * No-ops safely when not running inside Zora Desktop.
 */
export function subscribeDesktopEditorEvents(
  listener: (event: DesktopEditorEvent) => void,
  deps?: DesktopBridgeDeps,
): () => void {
  const checkDesktop = deps?.isDesktop ?? isZoraDesktop
  if (!checkDesktop()) return () => {}

  const listenFn = deps?.listen ?? tauriListen
  let disposed = false
  let unlisten: UnlistenFn | null = null

  void listenFn<unknown>(DESKTOP_EDITOR_EVENT_NAME, (tauriEvent) => {
    if (disposed) return
    const parsed = parseDesktopEditorEvent(tauriEvent.payload)
    if (parsed) listener(parsed)
  })
    .then((fn) => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    })
    .catch(() => {
      // Ignore subscription failures if the desktop bridge is unavailable.
    })

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }
}
