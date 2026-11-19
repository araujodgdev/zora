import { createFileRoute } from '@tanstack/react-router'
import { getStudioBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionUser } from '@/lib/session.server'
import { STUDIO_BUNDLE } from '@/lib/studio-hosting'
import { serveBundleFile } from '@/lib/studio-hosting.server'

// Zora Studio's web build, from R2 `studio/…` (uploaded by
// `pnpm studio:publish`). Signed-in users only, like the media routes; the
// editor page embeds `/studio/?design=<id>` in an iframe.
async function handle({ request }: { request: Request }) {
  const url = new URL(request.url)
  // Studio's index.html loads its files with relative URLs: `/studio` must
  // become `/studio/` before anything is served.
  if (url.pathname === STUDIO_BUNDLE.urlPrefix.slice(0, -1)) {
    url.pathname = STUDIO_BUNDLE.urlPrefix
    return Response.redirect(url.toString(), 308)
  }
  const { auth } = getRequestServices()
  const user = await findSessionUser(auth, request.headers)
  if (!user) return new Response('Unauthorized', { status: 401 })
  return serveBundleFile(STUDIO_BUNDLE, getStudioBucket(), request)
}

export const Route = createFileRoute('/studio/$')({
  server: {
    handlers: {
      GET: handle,
      HEAD: handle,
    },
  },
})
