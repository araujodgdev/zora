import { createServerFn } from '@tanstack/react-start'
import { mcpResourceUrl } from './auth.server'
import { getServerEnv } from './env.server'

/**
 * The public URL of Zora's MCP server, for the `/connect` page. Public on
 * purpose: the URL is no secret, and signed-out visitors read the page too.
 */
export const getMcpServerUrl = createServerFn({ method: 'GET' }).handler(() =>
  mcpResourceUrl(getServerEnv().BETTER_AUTH_URL),
)
