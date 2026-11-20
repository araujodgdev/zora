import { createFileRoute } from '@tanstack/react-router'
import { photoEditVersionUploadResponse } from '@/lib/content-photo-edits.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// Saves a new version of a photo edit: multipart `settings`, `preview` and
// `baseVersionId`; 409 when the base is no longer current.
export const Route = createFileRoute('/api/photo-edits/$editId/versions')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return photoEditVersionUploadResponse(
          db,
          getMediaBucket(),
          { organizationId: state.workspace?.id ?? null, userId: state.user.id },
          params.editId,
          request,
        )
      },
    },
  },
})
