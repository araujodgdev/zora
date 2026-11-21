/**
 * The page side of LightCraft's parent bridge (`?host=parent`), for the photo
 * editor page (`/content/$itemId/photos/$editId`). Framework-free and
 * client-safe; the contract is docs/LIGHTCRAFT-PLAN.md, "Editor page (iframe,
 * parent-driven)", measured against LightCraft 0.21.1.
 *
 * - `parseLightcraftMessage` accepts only the frame's known message shapes.
 *   The page checks `event.origin` and `event.source` before calling it.
 * - `LightcraftBridge` is the single command queue: `lightcraft:response`
 *   carries no request id and answers come back in order, so one command is
 *   in flight at a time and each answer resolves the oldest one.
 * - `openLightcraftPhoto`, `saveLightcraftPhoto` and `pollLightcraftDirty` are
 *   the open, save and dirty flows of the contract, on top of the queue.
 *
 * The transport (posting to the frame, hearing its messages) and the timers
 * are injected, so tests drive everything with fakes.
 */

import { LIGHTCRAFT_BUNDLE } from './studio-hosting'

/** The iframe's URL: the parent bridge on, the memory store (nothing kept in the browser). */
export const LIGHTCRAFT_EDITOR_URL = `${LIGHTCRAFT_BUNDLE.urlPrefix}?host=parent&store=memory`

// --- messages -------------------------------------------------------------------

/** A message from the LightCraft frame, once understood. */
export type LightcraftMessage =
  | { type: 'lightcraft:ready'; version: string | null }
  | { type: 'lightcraft:failed'; error: string }
  | { type: 'lightcraft:dirty'; dirty: boolean }
  | { type: 'lightcraft:save'; name: string; bytes: ArrayBuffer }
  | { type: 'lightcraft:response'; ok: boolean; value: string }

/** A message to the LightCraft frame. `params` is JSON text: an object is read as `{}`. */
export type LightcraftOutgoing =
  | { type: 'lightcraft:cmd'; id: string; params: string }
  | { type: 'lightcraft:open'; name: string; bytes: ArrayBuffer }

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  // Cross-realm safe (a buffer from another window fails `instanceof`).
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

/**
 * The LightCraft message in `data`, or null for anything else (other
 * messages, malformed fields). Check `event.origin` and `event.source` first.
 */
export function parseLightcraftMessage(data: unknown): LightcraftMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  switch (message.type) {
    case 'lightcraft:ready':
      return {
        type: 'lightcraft:ready',
        version: typeof message.version === 'string' ? message.version : null,
      }
    case 'lightcraft:failed':
      return typeof message.error === 'string'
        ? { type: 'lightcraft:failed', error: message.error }
        : null
    case 'lightcraft:dirty':
      return typeof message.dirty === 'boolean'
        ? { type: 'lightcraft:dirty', dirty: message.dirty }
        : null
    case 'lightcraft:save': {
      if (typeof message.name !== 'string') return null
      const bytes = message.bytes
      if (isArrayBuffer(bytes)) return { type: 'lightcraft:save', name: message.name, bytes }
      if (ArrayBuffer.isView(bytes)) {
        const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        return { type: 'lightcraft:save', name: message.name, bytes: view.slice().buffer }
      }
      return null
    }
    case 'lightcraft:response':
      return typeof message.ok === 'boolean' && typeof message.value === 'string'
        ? { type: 'lightcraft:response', ok: message.ok, value: message.value }
        : null
    default:
      return null
  }
}

// --- errors ---------------------------------------------------------------------

/** A command LightCraft answered with `ok: false`; the message is its error text. */
export class LightcraftCommandError extends Error {
  constructor(
    readonly command: string,
    message: string,
  ) {
    super(message)
    this.name = 'LightcraftCommandError'
  }
}

/** LightCraft sent `lightcraft:failed` (it could not start, or refused an open). */
export class LightcraftFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LightcraftFailedError'
  }
}

/** A command, `ready` or the open poll took too long. */
export class LightcraftTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LightcraftTimeoutError'
  }
}

/** The bridge was disposed (the frame was removed or reloaded). */
export class LightcraftClosedError extends Error {
  constructor() {
    super('O LightCraft foi fechado.')
    this.name = 'LightcraftClosedError'
  }
}

// --- transport, timers ----------------------------------------------------------------

export type LightcraftTransport = {
  /** Posts a message to the frame (transferring `transfer`). */
  post: (message: LightcraftOutgoing, transfer?: Array<Transferable>) => void
  /** Hears the frame's messages (already origin/source-checked and parsed); returns an unsubscribe. */
  subscribe: (listener: (message: LightcraftMessage) => void) => () => void
}

export type LightcraftTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

/** The global timers, read at call time (so test fakes installed later apply). */
export const defaultLightcraftTimers: LightcraftTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export function sleep(timers: LightcraftTimers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms)
  })
}

// --- the command queue ------------------------------------------------------------

/** Longest wait for one command's answer (an export of a large raw included). */
export const LIGHTCRAFT_COMMAND_TIMEOUT_MS = 60_000
/** Longest wait for `lightcraft:ready` after the frame starts loading (the wasm is ~34 MB). */
export const LIGHTCRAFT_READY_TIMEOUT_MS = 120_000

type QueuedCommand = {
  id: string
  params: string
  resolve: (value: string) => void
  reject: (error: Error) => void
}

/**
 * One LightCraft frame's bridge: the single command queue (FIFO, one in
 * flight), `ready`, `failed` and `save` tracking. Create it before the frame
 * loads (so `ready` is not missed) and `dispose()` it with the frame.
 */
export class LightcraftBridge {
  private readonly queue: Array<QueuedCommand> = []
  private inFlight: { command: QueuedCommand; timer: unknown } | null = null
  private readonly unsubscribe: () => void
  private readonly saveListeners = new Set<(name: string, bytes: ArrayBuffer) => void>()
  private readonly failedListeners = new Set<(error: string) => void>()
  private readyWaiters: Array<{ resolve: (v: string | null) => void; reject: (e: Error) => void }> =
    []
  private disposed = false
  /** Set when a command timed out: a late answer would be taken for the next one's. */
  private stalled: LightcraftTimeoutError | null = null
  /** `lightcraft:ready`'s version, once heard (`undefined` before). */
  readyVersion: string | null | undefined = undefined
  /** How many `lightcraft:failed` messages arrived, and the last one's text. */
  failureCount = 0
  lastFailure: string | null = null

  constructor(
    private readonly transport: LightcraftTransport,
    private readonly timers: LightcraftTimers = defaultLightcraftTimers,
    private readonly commandTimeoutMs = LIGHTCRAFT_COMMAND_TIMEOUT_MS,
  ) {
    this.unsubscribe = transport.subscribe((message) => this.receive(message))
  }

  /** Whether a command is in flight or waiting: the dirty poll skips its tick then. */
  get isBusy(): boolean {
    return this.inFlight !== null || this.queue.length > 0
  }

  /** Disposed, or stalled by a command that never got an answer: send nothing more. */
  get isDisposed(): boolean {
    return this.disposed || this.stalled !== null
  }

  /** Resolves with LightCraft's version once `lightcraft:ready` arrives. */
  whenReady(timeoutMs = LIGHTCRAFT_READY_TIMEOUT_MS): Promise<string | null> {
    if (this.disposed) return Promise.reject(new LightcraftClosedError())
    if (this.readyVersion !== undefined) return Promise.resolve(this.readyVersion)
    if (this.lastFailure !== null) {
      return Promise.reject(new LightcraftFailedError(this.lastFailure))
    }
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter)
        reject(new LightcraftTimeoutError('O LightCraft demorou demais para iniciar.'))
      }, timeoutMs)
      const waiter = {
        resolve: (version: string | null) => {
          this.timers.clearTimeout(timer)
          resolve(version)
        },
        reject: (error: Error) => {
          this.timers.clearTimeout(timer)
          reject(error)
        },
      }
      this.readyWaiters.push(waiter)
    })
  }

  /**
   * Runs a command; resolves with its `value` text (JSON on success).
   * Rejects with `LightcraftCommandError` on `ok: false`, and with
   * `LightcraftFailedError` / `LightcraftTimeoutError` / `LightcraftClosedError`.
   */
  commandText(id: string, params: Record<string, unknown> = {}): Promise<string> {
    if (this.disposed) return Promise.reject(new LightcraftClosedError())
    if (this.stalled) return Promise.reject(this.stalled)
    return new Promise((resolve, reject) => {
      this.queue.push({ id, params: JSON.stringify(params), resolve, reject })
      this.pump()
    })
  }

  /** Runs a command; resolves with its parsed JSON `value` (the text when it is not JSON). */
  async command(id: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const text = await this.commandText(id, params)
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  /** Posts `lightcraft:open`, transferring `bytes` (it is unusable afterwards). No answer comes. */
  open(name: string, bytes: ArrayBuffer): void {
    if (this.disposed) throw new LightcraftClosedError()
    this.transport.post({ type: 'lightcraft:open', name, bytes }, [bytes])
  }

  /** Hears every `lightcraft:save`; returns an unsubscribe. */
  onSave(listener: (name: string, bytes: ArrayBuffer) => void): () => void {
    this.saveListeners.add(listener)
    return () => this.saveListeners.delete(listener)
  }

  /** Hears every `lightcraft:failed`; returns an unsubscribe. */
  onFailed(listener: (error: string) => void): () => void {
    this.failedListeners.add(listener)
    return () => this.failedListeners.delete(listener)
  }

  /** Stops listening and rejects everything pending. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.rejectAll(new LightcraftClosedError())
    for (const waiter of this.readyWaiters) waiter.reject(new LightcraftClosedError())
    this.readyWaiters = []
    this.saveListeners.clear()
    this.failedListeners.clear()
  }

  private pump(): void {
    if (this.inFlight || this.disposed) return
    const command = this.queue.shift()
    if (!command) return
    const timer = this.timers.setTimeout(() => {
      if (this.inFlight?.command !== command) return
      // The answer may still come later and would then be taken for the
      // next command's: nothing more is sent on this frame.
      this.stalled = new LightcraftTimeoutError(
        `O LightCraft não respondeu ao comando ${command.id}.`,
      )
      this.rejectAll(this.stalled)
    }, this.commandTimeoutMs)
    this.inFlight = { command, timer }
    try {
      this.transport.post({ type: 'lightcraft:cmd', id: command.id, params: command.params })
    } catch (error) {
      this.timers.clearTimeout(timer)
      this.inFlight = null
      command.reject(error instanceof Error ? error : new Error(String(error)))
      this.pump()
    }
  }

  private rejectAll(error: Error): void {
    if (this.inFlight) {
      this.timers.clearTimeout(this.inFlight.timer)
      this.inFlight.command.reject(error)
      this.inFlight = null
    }
    for (const command of this.queue.splice(0)) command.reject(error)
  }

  private receive(message: LightcraftMessage): void {
    if (this.disposed) return
    switch (message.type) {
      case 'lightcraft:ready':
        this.readyVersion = message.version
        for (const waiter of this.readyWaiters) waiter.resolve(message.version)
        this.readyWaiters = []
        break
      case 'lightcraft:failed':
        this.failureCount += 1
        this.lastFailure = message.error
        this.rejectAll(new LightcraftFailedError(message.error))
        for (const waiter of this.readyWaiters) {
          waiter.reject(new LightcraftFailedError(message.error))
        }
        this.readyWaiters = []
        for (const listener of this.failedListeners) listener(message.error)
        break
      case 'lightcraft:save':
        for (const listener of this.saveListeners) listener(message.name, message.bytes)
        break
      case 'lightcraft:response': {
        const current = this.inFlight
        // An answer nobody waits for (after a timeout): ignored.
        if (!current) return
        this.timers.clearTimeout(current.timer)
        this.inFlight = null
        if (message.ok) current.command.resolve(message.value)
        else current.command.reject(new LightcraftCommandError(current.command.id, message.value))
        this.pump()
        break
      }
      case 'lightcraft:dirty':
        // Only "a storage write is pending" upstream; dirty comes from the poll.
        break
    }
  }
}

// --- the open flow ------------------------------------------------------------------

/** Interval of the `develop.get` poll after `lightcraft:open`. */
export const LIGHTCRAFT_OPEN_POLL_MS = 200
/** Longest wait for the opened photo to become active. */
export const LIGHTCRAFT_OPEN_TIMEOUT_MS = 30_000

/** Opening the photo failed (timeout, `lightcraft:failed`, or a command refused). */
export class LightcraftOpenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LightcraftOpenError'
  }
}

function photoIds(value: unknown): Array<number> {
  if (typeof value !== 'object' || value === null) return []
  const photos = (value as { photos?: unknown }).photos
  if (!Array.isArray(photos)) return []
  return photos
    .map((photo) => (typeof photo === 'object' && photo !== null ? (photo as { id?: unknown }).id : null))
    .filter((id): id is number => typeof id === 'number' && Number.isInteger(id))
}

/** The file name `photo.inspect` reports (`file_name`, the catalog's `Photo` serialised). */
export function inspectedFileName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const name = record.file_name ?? record.fileName
  return typeof name === 'string' ? name : null
}

/**
 * Empties the memory library LightCraft seeds with demo photos (one of them
 * selected): `catalog.query` → `photo.deletePermanently {ids}`, or, when that
 * is refused, `library.select {ids: []}`. Failures are not fatal: the open
 * poll still checks that the active photo is the one opened.
 */
export async function clearLightcraftLibrary(bridge: LightcraftBridge): Promise<void> {
  const ids = photoIds(await bridge.command('catalog.query', { limit: 10_000 }))
  if (ids.length === 0) return
  try {
    await bridge.command('photo.deletePermanently', { ids })
  } catch (error) {
    if (!(error instanceof LightcraftCommandError)) throw error
    try {
      await bridge.command('library.select', { ids: [] })
    } catch (inner) {
      if (!(inner instanceof LightcraftCommandError)) throw inner
    }
  }
}

export type OpenLightcraftPhotoInput = {
  /** The original's file name (LightCraft reads the format from its extension). */
  name: string
  /** The original's bytes; transferred to the frame. */
  bytes: ArrayBuffer
  /** The current version's settings (`develop.get` JSON), merged after the import. */
  settings?: unknown
  /** History label of the merge, e.g. "Versão 3". */
  label?: string
  timers?: LightcraftTimers
  pollMs?: number
  timeoutMs?: number
}

/**
 * The open flow, after `lightcraft:ready`: clears the demo library, opens the
 * original, polls `develop.get` until it answers and `photo.inspect` names
 * the opened file, merges the version's settings (if any), and resolves with
 * the clean baseline (`develop.get`'s text). Rejects with
 * `LightcraftOpenError` on timeout, `lightcraft:failed` or a refused command.
 */
export async function openLightcraftPhoto(
  bridge: LightcraftBridge,
  input: OpenLightcraftPhotoInput,
): Promise<string> {
  const timers = input.timers ?? defaultLightcraftTimers
  const pollMs = input.pollMs ?? LIGHTCRAFT_OPEN_POLL_MS
  const timeoutMs = input.timeoutMs ?? LIGHTCRAFT_OPEN_TIMEOUT_MS
  let failure: string | null = null
  const stopFailed = bridge.onFailed((error) => {
    failure = error
  })
  const fail = (cause?: unknown) =>
    new LightcraftOpenError(
      failure
        ? `Não foi possível abrir a foto: ${failure}`
        : cause instanceof LightcraftCommandError
          ? `Não foi possível abrir a foto: ${cause.message}`
          : 'Não foi possível abrir a foto.',
      { cause },
    )
  try {
    try {
      await clearLightcraftLibrary(bridge)
    } catch (error) {
      throw fail(error)
    }
    bridge.open(input.name, input.bytes)
    const deadline = timers.now() + timeoutMs
    for (;;) {
      await sleep(timers, pollMs)
      if (failure !== null) throw fail()
      if (bridge.isDisposed) throw new LightcraftClosedError()
      try {
        await bridge.commandText('develop.get')
        if (inspectedFileName(await bridge.command('photo.inspect')) === input.name) break
      } catch (error) {
        // "no photo" until the import lands; anything else ends the open.
        if (!(error instanceof LightcraftCommandError)) throw fail(error)
      }
      if (timers.now() >= deadline) throw fail()
    }
    try {
      if (input.settings !== undefined && input.settings !== null) {
        await bridge.command('develop.merge', {
          settings: input.settings,
          ...(input.label ? { label: input.label } : {}),
        })
      }
      return await bridge.commandText('develop.get')
    } catch (error) {
      throw fail(error)
    }
  } finally {
    stopFailed()
  }
}

// --- the save flow ------------------------------------------------------------------

/** The name of the preview render; other `lightcraft:save` files are ignored. */
export const LIGHTCRAFT_PREVIEW_NAME = 'preview.jpg'

/** `app.export`'s params for the preview (keys checked against `ExportOptions::validate_as`). */
export const LIGHTCRAFT_PREVIEW_EXPORT = {
  path: LIGHTCRAFT_PREVIEW_NAME,
  format: 'jpeg',
  quality: 85,
  longEdge: 2048,
  dontEnlarge: true,
  metadata: 'none',
} as const

/** Wait before the one retry of an export refused because the original is still loading. */
export const LIGHTCRAFT_EXPORT_RETRY_MS = 1000

export type LightcraftSaveResult = {
  /** `develop.get`'s text: stored as the version's `settings.json`, and the new baseline. */
  settingsText: string
  /** The JPEG preview's bytes. */
  preview: ArrayBuffer
}

function isStillLoading(error: unknown): boolean {
  return error instanceof LightcraftCommandError && /still loading/i.test(error.message)
}

async function exportPreview(bridge: LightcraftBridge): Promise<ArrayBuffer> {
  let captured: ArrayBuffer | null = null
  // The save arrives just before the command's response.
  const stop = bridge.onSave((name, bytes) => {
    if (name === LIGHTCRAFT_PREVIEW_NAME) captured = bytes
  })
  try {
    await bridge.command('app.export', { ...LIGHTCRAFT_PREVIEW_EXPORT })
  } finally {
    stop()
  }
  if (!captured) throw new Error('O LightCraft não entregou a prévia da foto.')
  return captured
}

/**
 * The save flow's LightCraft half: `develop.get`, then `app.export` with the
 * preview params, keeping the `lightcraft:save` named `preview.jpg`. A
 * "still loading" refusal is retried once after ~1 s.
 */
export async function saveLightcraftPhoto(
  bridge: LightcraftBridge,
  options: { timers?: LightcraftTimers; retryMs?: number } = {},
): Promise<LightcraftSaveResult> {
  const timers = options.timers ?? defaultLightcraftTimers
  const settingsText = await bridge.commandText('develop.get')
  let preview: ArrayBuffer
  try {
    preview = await exportPreview(bridge)
  } catch (error) {
    if (!isStillLoading(error)) throw error
    await sleep(timers, options.retryMs ?? LIGHTCRAFT_EXPORT_RETRY_MS)
    preview = await exportPreview(bridge)
  }
  return { settingsText, preview }
}

// --- dirty ----------------------------------------------------------------------------

/** Interval of the dirty poll while the tab is visible. */
export const LIGHTCRAFT_DIRTY_POLL_MS = 1500

/** JSON with object keys sorted at every level, for comparing settings by meaning. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner
    const record = inner as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    )
  })
}

function parseSettings(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Whether two `develop.get` texts hold different settings (key order and spacing ignored). */
export function settingsDiffer(baseline: string, current: string): boolean {
  if (baseline === current) return false
  return canonicalJson(parseSettings(baseline)) !== canonicalJson(parseSettings(current))
}

/**
 * One dirty poll: `develop.get` compared with the baseline. Null when it was
 * skipped (the queue is busy) or LightCraft could not answer.
 */
export async function pollLightcraftDirty(
  bridge: LightcraftBridge,
  baseline: string,
  options: { force?: boolean } = {},
): Promise<boolean | null> {
  if (bridge.isDisposed || (bridge.isBusy && !options.force)) return null
  try {
    return settingsDiffer(baseline, await bridge.commandText('develop.get'))
  } catch {
    return null
  }
}
