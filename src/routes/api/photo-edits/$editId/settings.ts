import { createFileRoute } from '@tanstack/react-router'
import { photoEditFileResponse } from '@/lib/content-photo-edits.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// The develop settings of a photo edit version (`?version=<id>`, else the current one).
export const Route = createFileRoute('/api/photo-edits/$editId/settings')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return photoEditFileResponse(
          db,
          getMediaBucket(),
          state.workspace?.id ?? null,
          params.editId,
          'settings',
          new URL(request.url),
        )
      },
    },
  },
})
