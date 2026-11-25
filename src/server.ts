// Worker entry (wrangler.jsonc `main`): Start's fetch handler, the scheduled
// Cron Trigger for automated social publishing, and exported Durable Objects.
// See Cloudflare's TanStack Start guide ("Custom entrypoints").
import handler from '@tanstack/react-start/server-entry'
import { env as bindings } from 'cloudflare:workers'
import { createDb } from './db/client.server'
import {
  cronErrorAlertEmail,
  parseAlertRecipients,
  publishFailureAlertEmail,
  sendOpsAlert,
} from './lib/ops-alert-email'
import {
  resolvePublishFailureRecipients,
  runScheduledPublishes,
} from './lib/social-publish.server'
import { runScheduledMetricsSync } from './lib/social-metrics.server'
import { createTregClient } from './lib/treg.server'

export { StudioEngine } from './lib/studio-engine-container.server'
export { LightcraftEngine } from './lib/lightcraft-engine-container.server'

type ScheduledController = {
  readonly cron: string
  readonly scheduledTime: number
}

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void
}

type CronEnv = {
  BETTER_AUTH_URL?: string
  TREG_TOKEN?: string
  TREG_BASE_URL?: string
  OPS_ALERT_EMAIL?: string
}

export default {
  fetch(request: Request, opts?: unknown) {
    return (handler.fetch as (req: Request, o?: unknown) => Promise<Response>)(request, opts)
  },
  scheduled(controller: ScheduledController, workerEnv: CronEnv | undefined, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const alertRecipients = parseAlertRecipients(
          workerEnv?.OPS_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL,
        )
        const appUrl = workerEnv?.BETTER_AUTH_URL?.trim() || process.env.BETTER_AUTH_URL?.trim()
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
        if (summary.failures.length > 0) {
          for (const failure of summary.failures) {
            const recipients = await resolvePublishFailureRecipients(
              db,
              failure.organizationId,
              failure.assigneeId,
              alertRecipients,
            )
            await sendOpsAlert(bindings.EMAIL, recipients, (to) =>
              publishFailureAlertEmail({
                to,
                itemId: failure.contentItemId,
                itemTitle: failure.itemTitle,
                channel: failure.channel,
                errorMessage: failure.errorMessage,
                stage: failure.stage,
                appUrl,
              }),
            )
          }
        }

        // Refresh social engagement snapshots every 15 minutes (isolated so it
        // can never affect scheduled publishing).
        const scheduledDate = new Date(controller.scheduledTime)
        if (scheduledDate.getUTCMinutes() % 15 === 0) {
          try {
            const metricsSummary = await runScheduledMetricsSync({ db, treg }, scheduledDate)
            if (metricsSummary.checked > 0) {
              console.log('[cron] social metrics:', JSON.stringify(metricsSummary))
            }
          } catch (metricsError) {
            console.error('[cron] social metrics sync failed:', metricsError)
          }
        }
      })().catch(async (error: unknown) => {
        console.error('[cron] social publishes failed:', error)
        const alertRecipients = parseAlertRecipients(
          workerEnv?.OPS_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL,
        )
        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'Erro desconhecido no cron de publicações.'
        await sendOpsAlert(bindings.EMAIL, alertRecipients, (to) =>
          cronErrorAlertEmail({ to, errorMessage: message }),
        )
      }),
    )
  },
}
