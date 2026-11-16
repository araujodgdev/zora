import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  assetObjectKey,
  buildAssetResponse,
  getContentAsset,
} from '@/lib/content-assets.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getRequestServices } from '@/lib/services.server'
import { findSessionUser } from '@/lib/session.server'

// Serves an uploaded file to signed-in users, for `<img>`, `<video>` and links
// (the session cookie goes along with those requests).
export const Route = createFileRoute('/api/assets/$assetId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { auth, db } = getRequestServices()
        if (!(await findSessionUser(auth, request.headers))) {
          return new Response('Unauthorized', { status: 401 })
        }
        const id = z.uuid().safeParse(params.assetId)
        const asset = id.success ? await getContentAsset(db, id.data) : null
        if (!asset) return new Response('Not found', { status: 404 })

        const ranged = request.headers.has('range')
        const object = await getMediaBucket().get(
          assetObjectKey(asset.contentItemId, asset.id),
          ranged ? { range: request.headers } : undefined,
        )
        if (!object) return new Response('Not found', { status: 404 })
        return buildAssetResponse(asset, object, ranged)
      },
    },
  },
})
