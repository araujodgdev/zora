/**
 * Where the photo engine (Zora LightCraft) runs, per request:
 *
 * 1. `LIGHTCRAFT_ENGINE_URL` (optional env var): an engine reached over plain
 *    HTTP, e.g. the binary run natively on the dev machine
 *    (`http://127.0.0.1:8081`). Wins when set.
 * 2. The `LIGHTCRAFT_ENGINE` Durable Object binding, whose `LightcraftEngine`
 *    class (below) starts the engine's Cloudflare Container and forwards
 *    requests to it. The container is attached only when the `containers` entry
 *    in wrangler.jsonc is switched on (see AGENTS.md, "Photo engine"); without
 *    it the object answers 503 `not-configured`.
 * 3. Neither: `getLightcraftEngine()` returns null and the tools say the photo
 *    engine is not configured.
 *
 * Uses the Durable Object Container API (`ctx.container`, `durable_object`
 * scheduling policy), mirroring `studio-engine-container.server.ts`.
 */
import { DurableObject, env } from 'cloudflare:workers'
import type { DurableObjectState } from 'cloudflare:workers'
import { getServerEnv } from './env.server'
import { urlLightcraftEngineTransport } from './lightcraft-engine.server'
import type { LightcraftEngineTransport } from './lightcraft-engine.server'

/** The port the photo engine's HTTP server listens on (passed to it as `PORT`). */
export const LIGHTCRAFT_ENGINE_PORT = 8080
/** Instance size: 1/2 vCPU, 4 GiB memory, 8 GB disk (raw demosaicing and renders up to 4096 px). */
const LIGHTCRAFT_ENGINE_INSTANCE = 'standard-1'
/** The container sleeps after this long without requests. */
const LIGHTCRAFT_ENGINE_SLEEP_AFTER_MS = 5 * 60 * 1000
/** How long a cold start may take before requests fail. */
const LIGHTCRAFT_ENGINE_START_TIMEOUT_MS = 40_000
/** Durable Object instances requests are spread over (each runs one container). */
const LIGHTCRAFT_ENGINE_POOL_SIZE = 2

function notConfiguredResponse(): Response {
  return Response.json(
    {
      error: 'not-configured',
      message: 'The LightcraftEngine Durable Object has no container (wrangler.jsonc `containers`).',
    },
    { status: 503 },
  )
}

/** One photo engine container, started on the first request and stopped after a quiet period. */
export class LightcraftEngine extends DurableObject {
  private starting: Promise<void> | undefined
  private monitoring: Promise<void> | undefined

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    const container = ctx.container
    if (container?.running) {
      // Restore the sleep timeout and exit monitoring after a restart.
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(LIGHTCRAFT_ENGINE_SLEEP_AFTER_MS),
      )
      this.observeExit()
    }
  }

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container
    if (!container || !container.images?.engine) return notConfiguredResponse()
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined
    })
    try {
      await this.starting
    } catch (error) {
      console.error('LightCraft engine container did not start', error)
      return Response.json(
        { error: 'O contêiner do motor de fotos não iniciou a tempo.' },
        { status: 503 },
      )
    }
    const url = new URL(request.url)
    url.protocol = 'http:'
    url.host = 'container'
    const forwarded = new Request(url, request)
    forwarded.headers.delete('host')
    return container.getTcpPort(LIGHTCRAFT_ENGINE_PORT).fetch(forwarded)
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!
    if (!container.running) {
      container.start({
        image: container.images!.engine!,
        instance: LIGHTCRAFT_ENGINE_INSTANCE,
        // The engine only develops what it is sent: no outbound Internet.
        enableInternet: false,
        env: { PORT: String(LIGHTCRAFT_ENGINE_PORT) },
      })
    }
    this.observeExit()
    await container.setInactivityTimeout(LIGHTCRAFT_ENGINE_SLEEP_AFTER_MS)
    // `running` means startup was requested, not that the server is ready.
    const port = container.getTcpPort(LIGHTCRAFT_ENGINE_PORT)
    const deadline = Date.now() + LIGHTCRAFT_ENGINE_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const response = await port.fetch('http://container/health', {
          signal: AbortSignal.timeout(1000),
        })
        await response.body?.cancel()
        if (response.ok) return
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`LightCraft engine did not answer /health on port ${LIGHTCRAFT_ENGINE_PORT}`)
  }

  private observeExit(): void {
    if (this.monitoring) return
    this.monitoring = this.ctx
      .container!.monitor()
      .catch((error: unknown) => console.error('LightCraft engine container failed:', error))
      .finally(() => {
        this.monitoring = undefined
      })
    this.ctx.waitUntil(this.monitoring)
  }
}

/** The photo engine for this request, or null when none is configured. Call it per request. */
export function getLightcraftEngine(): LightcraftEngineTransport | null {
  const url = getServerEnv().LIGHTCRAFT_ENGINE_URL
  if (url) return urlLightcraftEngineTransport(url)
  const namespace = env.LIGHTCRAFT_ENGINE
  if (!namespace) return null
  return {
    name: 'container',
    fetch: (path, init) => {
      const stub = namespace.getByName(
        `lightcraft-engine-${Math.floor(Math.random() * LIGHTCRAFT_ENGINE_POOL_SIZE)}`,
      )
      return stub.fetch(`http://lightcraft-engine${path}`, init)
    },
  }
}
