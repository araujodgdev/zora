import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { mcp } from '@better-auth/mcp'
import { betterAuth } from 'better-auth/minimal'
import { jwt, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import * as authSchema from '../db/auth-schema'
import type { Database } from '../db/client.server'
import type { ServerEnv } from './env.server'
import type { Mailer } from './mailer.server'
import { passwordResetEmail } from './password-reset-email'
import { initialWorkspaceId } from './workspace.server'

/**
 * The MCP endpoint (`src/routes/mcp.ts`) as an OAuth protected resource: MCP
 * access tokens are issued for, and only accepted at, this URL.
 */
export function mcpResourceUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`
}

/** How long an invitation link works (the email says 7 days). */
export const INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

export type AuthEnv = Pick<
  ServerEnv,
  'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL'
>

export type CreateAuthOptions = {
  mailer?: Mailer
}

/**
 * Builds the Better Auth instance for one database client.
 *
 * The app calls this once per request through `getRequestServices()`.
 */
export function createAuth(db: Database, env: AuthEnv, options?: CreateAuthOptions) {
  return betterAuth({
    appName: 'Zora',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        if (!options?.mailer) {
          console.warn('[auth] sendResetPassword called without a configured mailer')
          return
        }
        try {
          await options.mailer.send(
            passwordResetEmail({
              to: user.email,
              name: user.name,
              url,
            }),
          )
        } catch (error) {
          // Log server-side without revealing whether an account exists.
          console.error('[auth] failed to send password reset email:', error)
        }
      },
    },
    // Every server function opens the session. Without this each one read it
    // from D1 first, a round trip to the database's region (ENAM) on every
    // call. The signed `session_data` cookie (including the active workspace)
    // is trusted for 5 minutes, so a session revoked on another device stays
    // usable there that long. Workspace membership is still read from D1 on
    // every call (`resolveWorkspace`), so removing a member takes effect at
    // once.
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      // Workers do not set X-Forwarded-For; Cloudflare sends the client IP here.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    // Per-request auth instances must not reset the counters. D1 shares them
    // across Worker instances; especially important for anonymous registration.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/oauth2/register': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A new session opens the user's oldest workspace. Switching later
          // goes through `organization.setActive`.
          before: async (session) => {
            if (session.activeOrganizationId) return { data: session }
            const activeOrganizationId = await initialWorkspaceId(db, session.userId)
            return { data: { ...session, activeOrganizationId } }
          },
        },
      },
    },
    // The JWT plugin's own `/token` endpoint would hand out session JWTs signed
    // with the same key as MCP access tokens; OAuth clients use /oauth2/token.
    disabledPaths: ['/token'],
    plugins: [
      // Signing keys (stored in the `jwks` table) for OAuth access tokens.
      jwt({ disableSettingJwtHeader: true }),
      // Workspaces: every content item belongs to one organization; members
      // join through invitations (`/invite/<id>`). Owners and admins invite
      // (the plugin's default permissions). The invitation email is sent by
      // `inviteToWorkspace` (invitations.server.ts), not `sendInvitationEmail`:
      // Better Auth only logs that hook's errors, and the inviter must know
      // when the email did not go out.
      organization({
        // Deleting would orphan the media of its items in R2; not offered.
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
      }),
      // Zora as the OAuth 2.1 authorization server for MCP clients (Claude,
      // ChatGPT, editors): they send the user through /sign-in and /consent,
      // then call /mcp with an access token bound to that user.
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        signup: { page: '/sign-up' },
        resource: mcpResourceUrl(env.BETTER_AUTH_URL),
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        clientRegistrationDefaultScopes: ['openid', 'profile', 'email', 'offline_access'],
      }),
      // Must stay last: lets auth.api calls set cookies through TanStack Start.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>
