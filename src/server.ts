// Worker entry (wrangler.jsonc `main`): Start's fetch handler, the scheduled
// Cron Trigger for automated social publishing, and exported Durable Objects.
// See Cloudflare's TanStack Start guide ("Custom entrypoints").
import handler from '@tanstack/react-start/server-entry'
import { env as bindings } from 'cloudflare:workers'
import { createDb } from './db/client.server'
import { runScheduledPublishes } from './lib/social-publish.server'
import { createTregClient } from './lib/treg.server'

export { StudioEngine } from './lib/studio-engine-container.server'

type ScheduledController = {
  readonly cron: string
  readonly scheduledTime: number
}

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void
}

type CronEnv = {
  TREG_TOKEN?: string
  TREG_BASE_URL?: string
}

export default {
  fetch(request: Request, opts?: unknown) {
    return (handler.fetch as (req: Request, o?: unknown) => Promise<Response>)(request, opts)
  },
  scheduled(_controller: ScheduledController, workerEnv: CronEnv | undefined, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const token = workerEnv?.TREG_TOKEN?.trim() || process.env.TREG_TOKEN?.trim()
        const baseUrl = workerEnv?.TREG_BASE_URL?.trim() || process.env.TREG_BASE_URL?.trim()
        const treg = createTregClient({ token, baseUrl })
        if (!treg) return

        const db = createDb(bindings.DB)
        const summary = await runScheduledPublishes({
          db,
          bucket: bindings.MEDIA,
          treg,
        })
        if (summary.dispatched > 0 || summary.polled > 0) {
          console.log('[cron] social publishes:', JSON.stringify(summary))
        }
      })().catch((error: unknown) => {
        console.error('[cron] social publishes failed:', error)
      }),
    )
  },
}
