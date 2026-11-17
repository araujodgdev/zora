import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import type { Auth } from './auth.server'

/** What the consent page shows about an MCP client asking for access. */
export type ConsentRequest = {
  clientName: string
  /** Host of the client's metadata URL (CIMD clients) or null. */
  clientHost: string | null
  /** Where the browser returns after consent: the host the user should trust. */
  redirectHost: string
  logoUri: string | null
  clientUri: string | null
  scopes: Array<string>
}

const httpsOnly = (value: unknown) =>
  typeof value === 'string' && value.startsWith('https:') ? value : null

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

/**
 * Checks the signed authorization request the consent page was opened with
 * and loads the client it names. Returns null when the query was altered or
 * has expired. Whoever published the client chose its name and logo, so the
 * page also shows the hosts, which they cannot fake.
 */
export async function loadConsentRequest(
  auth: Auth,
  headers: Headers,
  search: string,
): Promise<ConsentRequest | null> {
  const params = new URLSearchParams(search)
  const signed = new Set(['sig', 'ba_param', ...params.getAll('ba_param')])
  const query = new URLSearchParams([...params].filter(([key]) => signed.has(key)))
  const { secret } = await auth.$context
  if (!(await verifyOAuthQueryParams(query.toString(), secret))) return null

  const clientId = query.get('client_id')
  const redirectHost = hostOf(query.get('redirect_uri'))
  if (!clientId || !redirectHost) return null

  const client = await auth.api.getOAuthClientPublic({
    query: { client_id: clientId },
    headers,
  })
  return {
    clientName: client.client_name || clientId,
    clientHost: clientId.startsWith('https:') ? hostOf(clientId) : null,
    redirectHost,
    logoUri: httpsOnly(client.logo_uri),
    clientUri: httpsOnly(client.client_uri),
    scopes: (query.get('scope') ?? '').split(' ').filter(Boolean),
  }
}
