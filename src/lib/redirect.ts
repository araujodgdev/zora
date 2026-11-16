import { z } from 'zod'

export const DEFAULT_SIGNED_IN_PATH = '/calendar'

/**
 * Only same-origin paths may be used as a post-sign-in destination, so the
 * `redirect` search param cannot send users to another site.
 */
export function safeRedirectPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || /^\/[/\\]/.test(value)) {
    return DEFAULT_SIGNED_IN_PATH
  }
  const base = 'http://zora.invalid'
  if (new URL(value, base).origin !== base) return DEFAULT_SIGNED_IN_PATH
  if (value.startsWith('/sign-in') || value.startsWith('/sign-up')) {
    return DEFAULT_SIGNED_IN_PATH
  }
  return value
}

/** Search params of the sign-in and sign-up pages. */
export const authPageSearchSchema = z.object({
  redirect: z.string().optional(),
})
