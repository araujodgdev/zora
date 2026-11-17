import { env as bindings } from 'cloudflare:workers'

/** A message for Cloudflare Email Sending's structured `send()`. */
export type OutgoingEmail = {
  to: string
  from: { email: string; name: string }
  subject: string
  text: string
  html: string
}

/** The part of the `send_email` binding this app uses. */
export type Mailer = {
  send(message: OutgoingEmail): Promise<unknown>
}

/**
 * The `EMAIL` binding (wrangler.jsonc). In `pnpm dev` Wrangler simulates it:
 * nothing is sent, the message is logged to the terminal instead.
 */
export function getMailer(): Mailer {
  return bindings.EMAIL
}
