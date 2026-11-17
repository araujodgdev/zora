import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { authMiddleware } from './auth-middleware'
import { loadConsentRequest } from './oauth-consent.server'
import { getRequestServices } from './services.server'

/** The verified consent request for `/consent` (null when the link is invalid). */
export const getConsentRequest = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ search: z.string().max(8192) }))
  .handler(({ data }) =>
    loadConsentRequest(
      getRequestServices().auth,
      new Headers(getRequestHeaders()),
      data.search,
    ),
  )
