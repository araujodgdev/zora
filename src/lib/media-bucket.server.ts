import { env } from 'cloudflare:workers'
import type { MediaBucket } from './content-assets.server'
import type { BundleBucket } from './studio-hosting.server'

/**
 * The R2 bucket for uploaded media (binding `MEDIA` in wrangler.jsonc; a local
 * simulation under `.wrangler/state` during `pnpm dev`). Call it per request.
 */
export function getMediaBucket(): MediaBucket {
  return env.MEDIA
}

/**
 * The same bucket, typed for serving Studio and its fonts (`studio/`,
 * `studio-fonts/`; see `@/lib/studio-hosting`). Call it per request.
 */
export function getStudioBucket(): BundleBucket {
  return env.MEDIA
}
