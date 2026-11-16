import { createFileRoute } from '@tanstack/react-router'
import { getRequestServices } from '@/lib/services.server'

// Better Auth's HTTP API (sign-up, sign-in, sign-out, session, ...).
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => getRequestServices().auth.handler(request),
      POST: ({ request }) => getRequestServices().auth.handler(request),
    },
  },
})
