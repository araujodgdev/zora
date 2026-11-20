import { createFileRoute } from '@tanstack/react-router'
import { photoEditMetadataResponse } from '@/lib/content-photo-edits.http.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// The metadata the photo editor opens an edit with (see content-photo-edits.http.server.ts).
export const Route = createFileRoute('/api/photo-edits/$editId/')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return photoEditMetadataResponse(db, state.workspace?.id ?? null, params.editId)
      },
    },
  },
})
