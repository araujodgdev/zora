import { createFileRoute } from '@tanstack/react-router'
import { getStudioBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionUser } from '@/lib/session.server'
import { STUDIO_FONTS_BUNDLE } from '@/lib/studio-hosting'
import { handleBundleRequest } from '@/lib/studio-hosting.server'

// Studio's font library, from R2 `studio-fonts/…` (uploaded by
// `pnpm fonts:sync`): `manifest.json` (revalidated) and the font and licence
// files it lists (hashed names, cached for a year). Signed-in users only.
function handle({ request }: { request: Request }) {
  return handleBundleRequest(STUDIO_FONTS_BUNDLE, request, {
    isSignedIn: async (headers) => (await findSessionUser(getRequestServices().auth, headers)) !== null,
    bucket: getStudioBucket,
  })
}

export const Route = createFileRoute('/studio-fonts/$')({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
    },
  },
})
