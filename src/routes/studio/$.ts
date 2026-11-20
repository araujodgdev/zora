import { createFileRoute } from '@tanstack/react-router'
import { getStudioBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionUser } from '@/lib/session.server'
import { STUDIO_BUNDLE } from '@/lib/studio-hosting'
import { handleBundleRequest } from '@/lib/studio-hosting.server'

// Zora Studio's web build, from R2 `studio/…` (uploaded by
// `pnpm studio:publish`). Signed-in users only, like the media routes; the
// editor page embeds `/studio/?design=<id>` in an iframe. `/studio` redirects
// to `/studio/` first: Studio's index.html loads its files by relative URL.
function handle({ request }: { request: Request }) {
  return handleBundleRequest(STUDIO_BUNDLE, request, {
    isSignedIn: async (headers) => (await findSessionUser(getRequestServices().auth, headers)) !== null,
    bucket: getStudioBucket,
  })
}

export const Route = createFileRoute('/studio/$')({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
    },
  },
})
