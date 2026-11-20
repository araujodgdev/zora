import { createFileRoute } from '@tanstack/react-router'
import { photoEditOriginalUploadResponse } from '@/lib/content-photo-edits.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// Starts a photo edit of an item from an uploaded original:
// `POST /api/content/<itemId>/photo-edits?filename=photo.cr3[&name=...]` with
// the file as the raw body, streamed into R2 (like media uploads), so a large
// raw never has to fit in the Worker's memory.
export const Route = createFileRoute('/api/content/$itemId/photo-edits')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return photoEditOriginalUploadResponse(
          db,
          getMediaBucket(),
          { organizationId: state.workspace?.id ?? null, userId: state.user.id },
          params.itemId,
          request,
        )
      },
    },
  },
})
