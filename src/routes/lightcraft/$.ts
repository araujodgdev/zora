import { createFileRoute } from '@tanstack/react-router'
import { getBundleBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionUser } from '@/lib/session.server'
import { LIGHTCRAFT_BUNDLE } from '@/lib/studio-hosting'
import { handleBundleRequest } from '@/lib/studio-hosting.server'

// LightCraft's web build, from R2 `lightcraft/…` (uploaded by
// `pnpm lightcraft:publish`). Signed-in users only, like the media routes; the
// photo editor page embeds `/lightcraft/?host=parent&store=memory` in an
// iframe (docs/LIGHTCRAFT-PLAN.md). `/lightcraft` redirects to `/lightcraft/`
// first: LightCraft's index.html loads its files by relative URL.
function handle({ request }: { request: Request }) {
  return handleBundleRequest(LIGHTCRAFT_BUNDLE, request, {
    isSignedIn: async (headers) => (await findSessionUser(getRequestServices().auth, headers)) !== null,
    bucket: getBundleBucket,
  })
}

export const Route = createFileRoute('/lightcraft/$')({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
    },
  },
})
