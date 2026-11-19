import { createFileRoute } from '@tanstack/react-router'
import { designVersionUploadResponse } from '@/lib/content-designs.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// Saves a new version of a design from Zora Studio: multipart `source`,
// `preview` and `baseVersionId`; 409 when the base is no longer current.
export const Route = createFileRoute('/api/designs/$designId/versions')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return designVersionUploadResponse(
          db,
          getMediaBucket(),
          { organizationId: state.workspace?.id ?? null, userId: state.user.id },
          params.designId,
          request,
        )
      },
    },
  },
})
