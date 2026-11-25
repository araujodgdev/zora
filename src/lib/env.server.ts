import { z } from 'zod'

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

const serverEnvSchema = z.object({
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  // Image providers for the MCP image tools (optional: without a key the
  // tool says which secret is missing). Empty values count as unset.
  UNSPLASH_ACCESS_KEY: optionalSecret,
  FAL_KEY: optionalSecret,
  // Design engine over plain HTTP (development: the engine binary run
  // natively). When set it wins over the STUDIO_ENGINE container binding.
  STUDIO_ENGINE_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.url({ protocol: /^https?$/ }).optional()),
  // Photo engine (LightCraft) over plain HTTP (development: the engine binary
  // run natively). When set it wins over the LIGHTCRAFT_ENGINE container binding.
  LIGHTCRAFT_ENGINE_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.url({ protocol: /^https?$/ }).optional()),
  // Social publishing via treg.to (optional: without a token, social
  // connections and publishing stay disabled with a clear message).
  TREG_TOKEN: optionalSecret,
  TREG_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(z.url({ protocol: /^https?$/ }).optional()),
  // Optional operational alert recipient(s) for cron/publish failures
  // (comma-separated verified addresses on Cloudflare Email Sending).
  OPS_ALERT_EMAIL: optionalSecret,
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
