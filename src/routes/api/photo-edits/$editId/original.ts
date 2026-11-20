import { createFileRoute } from '@tanstack/react-router'
import { photoEditOriginalResponse } from '@/lib/content-photo-edits.http.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// The edit's own copy of its original photo (download only).
export const Route = createFileRoute('/api/photo-edits/$editId/original')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return photoEditOriginalResponse(
          db,
          getMediaBucket(),
          state.workspace?.id ?? null,
          params.editId,
        )
      },
    },
  },
})
