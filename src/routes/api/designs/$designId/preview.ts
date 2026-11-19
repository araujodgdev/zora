import { createFileRoute } from '@tanstack/react-router'
import { designFileResponse } from '@/lib/content-designs.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// The preview of a design version (`?version=<id>`, else the current one).
export const Route = createFileRoute('/api/designs/$designId/preview')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return designFileResponse(
          db,
          getMediaBucket(),
          state.workspace?.id ?? null,
          params.designId,
          'preview',
          new URL(request.url),
        )
      },
    },
  },
})
