import { createFileRoute } from '@tanstack/react-router'
import { getRequestServices } from '@/lib/services.server'

// OAuth discovery for MCP clients, outside Better Auth's /api/auth base path:
// `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728, from the MCP plugin)
// and `/.well-known/oauth-authorization-server/api/auth` (RFC 8414). Better
// Auth answers both from its request hooks; anything else is a 404 from it.
export const Route = createFileRoute('/.well-known/$')({
  server: {
    handlers: {
      GET: ({ request }) => getRequestServices().auth.handler(request),
    },
  },
})
