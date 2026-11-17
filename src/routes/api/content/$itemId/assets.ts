import { createFileRoute } from '@tanstack/react-router'
import { MAX_ASSET_BYTES } from '@/lib/content-assets'
import {
  AssetUploadError,
  createContentAsset,
} from '@/lib/content-assets.server'
import { contentItemIdSchema } from '@/lib/content'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionState } from '@/lib/session.server'

function problem(status: number, error: string) {
  return Response.json({ error }, { status })
}

/** The file name from `?filename=`, without any directory part. */
function uploadedFilename(url: URL): string {
  const raw = url.searchParams.get('filename') ?? ''
  return raw.split(/[/\\]/).pop()!.trim().slice(0, 255) || 'file'
}

// Uploads a file of an item: `POST /api/content/<itemId>/assets?filename=x.png`
// with the file as the raw body and its type as `Content-Type`. A raw body
// (not multipart) is streamed straight into R2, so a large video never has to
// fit in the Worker's memory. The browser sets `Content-Length` for a file.
export const Route = createFileRoute('/api/content/$itemId/assets')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        const state = await findSessionState(auth, db, request.headers)
        if (!state) return problem(401, 'Não autorizado: entre para continuar.')
        const { user, workspace } = state
        if (!workspace) return problem(404, 'Item de conteúdo não encontrado.')

        const id = contentItemIdSchema.safeParse({ id: params.itemId })
        if (!id.success) return problem(404, 'Item de conteúdo não encontrado.')

        const size = Number(request.headers.get('content-length'))
        if (!request.body || !Number.isInteger(size)) {
          return problem(411, 'Envie o arquivo no corpo da requisição.')
        }
        if (size > MAX_ASSET_BYTES) return problem(413, 'O arquivo é grande demais.')

        try {
          const asset = await createContentAsset(db, getMediaBucket(), {
            organizationId: workspace.id,
            contentItemId: id.data.id,
            createdById: user.id,
            file: {
              name: uploadedFilename(new URL(request.url)),
              type: (request.headers.get('content-type') ?? '')
                .split(';')[0]!
                .trim()
                .toLowerCase(),
              size,
            },
            body: request.body,
          })
          if (!asset) return problem(404, 'Item de conteúdo não encontrado.')
          return Response.json({ asset }, { status: 201 })
        } catch (error) {
          if (error instanceof AssetUploadError) {
            return problem(422, error.message)
          }
          throw error
        }
      },
    },
  },
})
