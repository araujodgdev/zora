import { requireMcpAuth } from '@better-auth/mcp'
import { createFileRoute } from '@tanstack/react-router'
import { mcpResourceUrl } from '@/lib/auth.server'
import { getMediaBucket } from '@/lib/media-bucket.server'
import { getLightcraftEngine } from '@/lib/lightcraft-engine-container.server'
import { getStudioEngine } from '@/lib/studio-engine-container.server'
import { createZoraMcpHandler, findMcpUser } from '@/lib/mcp.server'
import { getRequestServices } from '@/lib/services.server'
import { createTregClient } from '@/lib/treg.server'
import { resolveMcpWorkspace } from '@/lib/workspace.server'

/**
 * The MCP server: `POST /mcp` (Streamable HTTP, stateless). Requests need an
 * OAuth access token issued by Zora for this resource; without one the
 * response is a 401 whose `WWW-Authenticate` header points the client at the
 * discovery documents, which starts the sign-in flow.
 */
async function handle(request: Request): Promise<Response> {
  const { auth, db, env } = getRequestServices()
  const protectedHandler = requireMcpAuth(
    auth,
    async (authorized, claims) => {
      // The token's subject is the Zora user the client acts for.
      const user = claims.sub ? await findMcpUser(db, claims.sub) : null
      if (!user) {
        return Response.json(
          { error: 'The user of this token no longer exists.' },
          { status: 403 },
        )
      }
      const workspace = await resolveMcpWorkspace(db, user.id)
      const handler = createZoraMcpHandler({
        db,
        bucket: getMediaBucket(),
        user,
        workspace,
        appUrl: env.BETTER_AUTH_URL,
        images: { unsplashAccessKey: env.UNSPLASH_ACCESS_KEY, falKey: env.FAL_KEY },
        engine: getStudioEngine(),
        photoEngine: getLightcraftEngine(),
        treg: createTregClient({
          token: env.TREG_TOKEN,
          baseUrl: env.TREG_BASE_URL,
        }),
      })
      return handler.fetch(authorized)
    },
    { resource: mcpResourceUrl(env.BETTER_AUTH_URL) },
  )
  return protectedHandler(request)
}

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      // Stateless server: no standalone SSE stream and no sessions to end.
      GET: () => new Response(null, { status: 405, headers: { Allow: 'POST' } }),
      DELETE: () => new Response(null, { status: 405, headers: { Allow: 'POST' } }),
    },
  },
})
