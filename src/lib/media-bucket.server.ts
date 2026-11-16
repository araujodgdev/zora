import { env } from 'cloudflare:workers'
import type { MediaBucket } from './content-assets.server'

/**
 * The R2 bucket for uploaded media (binding `MEDIA` in wrangler.jsonc; a local
 * simulation under `.wrangler/state` during `pnpm dev`). Call it per request.
 */
export function getMediaBucket(): MediaBucket {
  return env.MEDIA
}
