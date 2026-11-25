/**
 * Operational alert emails sent through Cloudflare Email Sending (`EMAIL`
 * binding). Sends to verified destination addresses on the Cloudflare account
 * are free on every plan (including Workers Free) and do not count toward
 * monthly/daily quotas.
 */
import { CHANNEL_LABELS } from './content'
import type { Channel } from './content'
import { INVITATION_EMAIL_SENDER } from './invitation-email'
import type { Mailer, OutgoingEmail } from './mailer.server'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Parses a comma/semicolon-separated list of recipient email addresses (e.g.
 * `OPS_ALERT_EMAIL`), trimming whitespace, deduplicating and dropping invalid
 * entries so a misconfigured var never crashes the cron.
 */
export function parseAlertRecipients(raw: string | undefined): Array<string> {
  if (!raw) return []
  const seen = new Set<string>()
  const recipients: Array<string> = []
  for (const part of raw.split(/[,;]+/)) {
    const email = part.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    recipients.push(email)
  }
  return recipients
}

const STAGE_LABELS = {
  preflight: 'Validação antes do envio',
  dispatch: 'Envio para a rede social',
  poll: 'Processamento na rede social',
} as const

export type PublishFailureAlertInput = {
  to: string
  itemId: string
  itemTitle: string
  channel: Channel
  errorMessage: string
  stage: keyof typeof STAGE_LABELS
  appUrl?: string
  occurredAt?: Date
}

export function publishFailureAlertEmail(input: PublishFailureAlertInput): OutgoingEmail {
  const { to, itemId, itemTitle, channel, errorMessage, stage, appUrl } = input
  const occurredAt = input.occurredAt ?? new Date()
  const channelLabel = CHANNEL_LABELS[channel]
  const stageLabel = STAGE_LABELS[stage]
  const itemUrl = appUrl ? `${appUrl.replace(/\/+$/, '')}/content/${itemId}` : null
  const timestamp = occurredAt.toISOString()

  const subject = `[Zora] Falha na publicação agendada (${channelLabel}): ${itemTitle}`
  const text = [
    'Uma publicação agendada falhou no Zora.',
    '',
    `Item: ${itemTitle}`,
    `Canal: ${channelLabel}`,
    `Etapa: ${stageLabel}`,
    `Erro: ${errorMessage}`,
    `Horário (UTC): ${timestamp}`,
    ...(itemUrl ? ['', `Abrir no Zora: ${itemUrl}`] : []),
  ].join('\n')

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#f2f2f0;font-family:Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 20px;font-size:22px;font-weight:700;font-style:italic">Zora</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5">
          A publicação agendada de <strong>${escapeHtml(itemTitle)}</strong> em
          <strong>${escapeHtml(channelLabel)}</strong> falhou.
        </p>
        <table role="presentation" width="100%" style="margin:0 0 20px;background:#f7f7f5;border-radius:8px">
          <tr><td style="padding:16px;font-size:14px;line-height:1.5">
            <p style="margin:0 0 8px"><strong>Etapa:</strong> ${escapeHtml(stageLabel)}</p>
            <p style="margin:0 0 8px"><strong>Erro:</strong> ${escapeHtml(errorMessage)}</p>
            <p style="margin:0;color:#555;font-size:12px">Horário (UTC): ${escapeHtml(timestamp)}</p>
          </td></tr>
        </table>
        ${
          itemUrl
            ? `<p style="margin:0 0 16px">
          <a href="${escapeHtml(itemUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#c6f432;color:#111;font-weight:600;text-decoration:none">Abrir item no Zora</a>
        </p>
        <p style="margin:0;font-size:12px;word-break:break-all;color:#555"><a href="${escapeHtml(itemUrl)}" style="color:#111">${escapeHtml(itemUrl)}</a></p>`
            : ''
        }
      </td></tr>
    </table>
  </body>
</html>`

  return { to, from: INVITATION_EMAIL_SENDER, subject, text, html }
}

export type CronErrorAlertInput = {
  to: string
  errorMessage: string
  occurredAt?: Date
}

export function cronErrorAlertEmail(input: CronErrorAlertInput): OutgoingEmail {
  const { to, errorMessage } = input
  const occurredAt = input.occurredAt ?? new Date()
  const timestamp = occurredAt.toISOString()
  const subject = '[Zora] Erro inesperado no cron de publicações'
  const text = [
    'O cron de publicações agendadas do Zora encontrou um erro inesperado.',
    '',
    `Erro: ${errorMessage}`,
    `Horário (UTC): ${timestamp}`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#f2f2f0;font-family:Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 20px;font-size:22px;font-weight:700;font-style:italic">Zora</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5">
          O cron de publicações agendadas encontrou um erro inesperado.
        </p>
        <table role="presentation" width="100%" style="margin:0;background:#f7f7f5;border-radius:8px">
          <tr><td style="padding:16px;font-size:14px;line-height:1.5">
            <p style="margin:0 0 8px"><strong>Erro:</strong> ${escapeHtml(errorMessage)}</p>
            <p style="margin:0;color:#555;font-size:12px">Horário (UTC): ${escapeHtml(timestamp)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { to, from: INVITATION_EMAIL_SENDER, subject, text, html }
}

/**
 * Best-effort alert fan-out: sends to every configured recipient and logs
 * individual failures without throwing so alerts never break the caller.
 */
export async function sendOpsAlert(
  mailer: Mailer | null | undefined,
  recipients: ReadonlyArray<string>,
  buildEmail: (to: string) => OutgoingEmail,
): Promise<{ sent: number; failed: number }> {
  if (!mailer || recipients.length === 0) return { sent: 0, failed: 0 }
  const results = await Promise.allSettled(
    recipients.map((to) => mailer.send(buildEmail(to))),
  )
  let sent = 0
  let failed = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      sent += 1
    } else {
      failed += 1
      console.error('[ops-alert] failed to send alert email:', result.reason)
    }
  }
  return { sent, failed }
}
