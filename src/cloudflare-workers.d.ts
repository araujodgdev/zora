// The bindings declared in wrangler.jsonc, as far as this app uses them.
// (Not generated with `wrangler types`: its runtime types clash with the DOM
// types the client code needs.)
declare module 'cloudflare:workers' {
  export const env: {
    /** D1 database. Typed loosely by drizzle-orm when Workers types are absent. */
    DB: import('drizzle-orm/d1').AnyD1Database
    /** R2 bucket for uploaded media, design files and the hosted Studio. */
    MEDIA: import('./lib/content-assets.server').MediaBucket &
      import('./lib/studio-hosting.server').BundleBucket
    /** Cloudflare Email Sending, for invitation emails. */
    EMAIL: import('./lib/mailer.server').Mailer
    /** The design engine's Durable Object (`StudioEngine`); absent in tests. */
    STUDIO_ENGINE?: DurableObjectNamespace
  }

  /** The parts of a Durable Object namespace this app uses. */
  export interface DurableObjectNamespace {
    getByName(name: string): { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
  }

  /** `ctx.container` (Durable Object Container API, `durable_object` scheduling policy). */
  export interface DurableObjectContainer {
    readonly running: boolean
    readonly images?: Record<string, string>
    start(options: {
      image: string
      instance?: string
      enableInternet: boolean
      env?: Record<string, string>
    }): void
    monitor(): Promise<void>
    setInactivityTimeout(durationMs: number): Promise<void>
    getTcpPort(port: number): { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
  }

  export interface DurableObjectState {
    readonly container?: DurableObjectContainer
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
    waitUntil(promise: Promise<unknown>): void
  }

  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState
    protected env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }
}
