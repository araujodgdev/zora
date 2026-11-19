import { createFileRoute } from '@tanstack/react-router'
import { designMetadataResponse } from '@/lib/content-designs.http.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

// The metadata Zora Studio opens a design with (see content-designs.http.server.ts).
export const Route = createFileRoute('/api/designs/$designId/')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) {
          return Response.json({ error: 'Não autorizado: entre para continuar.' }, { status: 401 })
        }
        return designMetadataResponse(db, state.workspace?.id ?? null, params.designId)
      },
    },
  },
})
