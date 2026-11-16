import { z } from 'zod'

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  ALLOWED_SIGNUP_EMAILS: z.string().default(''),
})

export type ServerEnv = z.output<typeof serverEnvSchema>

/**
 * Reads and validates server configuration.
 *
 * Call this per request (inside handlers and middleware), never at module
 * scope: on Cloudflare Workers the environment is only reliably available
 * while handling a request.
 */
export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse(process.env)
}
