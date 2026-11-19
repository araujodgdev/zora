/**
 * Workspace social-account connections. Server-only and independent of
 * TanStack Start so it can be tested directly against D1 with a mock treg
 * client. Every operation is strictly scoped to `organizationId`.
 */
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.server'
import { socialConnection } from '../db/schema'
import {
  SOCIAL_CHANNEL_INFO,
  buildTregConnectionName,
} from './social'
import type {
  SocialChannel,
  SocialConnection,
  SocialConnectionMeta,
  SocialResourceOption,
} from './social'
import {
  SocialPublishingError,
  TregApiError,
  requireTregClient,
} from './treg.server'
import type { TregClient, TregConnectionSummary } from './treg.server'

type ConnectionRow = typeof socialConnection.$inferSelect

function toConnection(row: ConnectionRow): SocialConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    provider: row.provider,
    externalSecretId: row.externalSecretId,
    externalToolName: row.externalToolName,
    status: row.status,
    accountId: row.accountId,
    accountName: row.accountName,
    accountMeta: row.accountMeta,
    connectedById: row.connectedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function findConnectionRow(
  db: Database,
  organizationId: string,
  channel: SocialChannel,
): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(socialConnection)
    .where(
      and(
        eq(socialConnection.organizationId, organizationId),
        eq(socialConnection.channel, channel),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Lists every social connection saved for the workspace (no upstream calls). */
export async function listWorkspaceConnections(
  db: Database,
  organizationId: string,
): Promise<Array<SocialConnection>> {
  const rows = await db
    .select()
    .from(socialConnection)
    .where(eq(socialConnection.organizationId, organizationId))
    .orderBy(asc(socialConnection.channel))
  return rows.map(toConnection)
}

export async function getWorkspaceConnection(
  db: Database,
  organizationId: string,
  channel: SocialChannel,
): Promise<SocialConnection | null> {
  const row = await findConnectionRow(db, organizationId, channel)
  return row ? toConnection(row) : null
}

export type StartedChannelConnection = {
  connection: SocialConnection
  consentUrl: string
  state: string
  connectGuidance: string | null
}

/**
 * Starts (or reconnects) the OAuth flow for one channel of a workspace.
 * The returned `consentUrl` points directly at the social network's consent
 * screen; Zora users never create or sign in to a treg account.
 */
export async function startChannelConnection(
  db: Database,
  treg: TregClient | null,
  input: {
    organizationId: string
    userId: string
    channel: SocialChannel
    capability?: string
  },
  now: Date = new Date(),
): Promise<StartedChannelConnection> {
  const client = requireTregClient(treg)
  const existing = await findConnectionRow(db, input.organizationId, input.channel)
  const toolName =
    existing?.externalToolName ?? buildTregConnectionName(input.organizationId, input.channel)
  const capability = input.capability ?? SOCIAL_CHANNEL_INFO[input.channel].defaultCapability

  const started = await client.startOAuth({
    organizationId: input.organizationId,
    provider: input.channel,
    capability,
    name: toolName,
    // Reconnect/upgrade the existing treg secret in place when one already exists.
    connectionId: existing?.externalSecretId ?? undefined,
  })

  const meta: SocialConnectionMeta = {
    ...(existing?.accountMeta ?? {}),
    connectGuidance: started.connectGuidance,
    lastError: null,
  }

  let saved: ConnectionRow
  if (existing) {
    const [updated] = await db
      .update(socialConnection)
      .set({
        status: 'pending',
        pendingState: started.state,
        accountMeta: meta,
        connectedById: input.userId,
        updatedAt: now,
      })
      .where(eq(socialConnection.id, existing.id))
      .returning()
    saved = updated!
  } else {
    const [inserted] = await db
      .insert(socialConnection)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        provider: 'treg',
        externalSecretId: null,
        externalToolName: toolName,
        status: 'pending',
        pendingState: started.state,
        accountId: null,
        accountName: null,
        accountMeta: meta,
        connectedById: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    saved = inserted!
  }

  return {
    connection: toConnection(saved),
    consentUrl: started.consentUrl,
    state: started.state,
    connectGuidance: started.connectGuidance,
  }
}

function findMatchingSummary(
  summaries: ReadonlyArray<TregConnectionSummary>,
  secretId: number | null,
  toolName: string,
): TregConnectionSummary | null {
  if (secretId !== null) {
    const byId = summaries.find((item) => item.id === secretId)
    if (byId) return byId
  }
  return summaries.find((item) => item.name === toolName) ?? null
}

function metaFromSummary(
  previous: SocialConnectionMeta,
  summary: TregConnectionSummary | null,
  lastError: string | null = null,
): SocialConnectionMeta {
  if (!summary) return { ...previous, lastError }
  return {
    ...previous,
    capabilities: summary.capabilities,
    scopesInReview: summary.scopesInReview,
    reviewNote: summary.reviewNote,
    authorizationMethod: summary.authorizationMethod,
    health: summary.health,
    expiresAt: summary.expiresAt,
    lastError,
  }
}

export type PolledChannelConnection = {
  done: boolean
  connection: SocialConnection
  resources?: Array<SocialResourceOption>
}

/**
 * Checks whether an in-flight OAuth consent completed. When finished, syncs
 * the upstream metadata and — for providers with resource discovery like
 * YouTube — auto-selects the channel when there is only one or returns the
 * list for the user to pick.
 */
export async function pollChannelConnection(
  db: Database,
  treg: TregClient | null,
  organizationId: string,
  channel: SocialChannel,
  now: Date = new Date(),
): Promise<PolledChannelConnection | null> {
  const client = requireTregClient(treg)
  const existing = await findConnectionRow(db, organizationId, channel)
  if (!existing) return null

  if (existing.status !== 'pending' || !existing.pendingState) {
    return { done: true, connection: toConnection(existing) }
  }

  let oauthStatus
  try {
    oauthStatus = await client.getOAuthStatus({
      organizationId,
      state: existing.pendingState,
    })
  } catch (error) {
    if (error instanceof TregApiError && error.status === 404) {
      const [errored] = await db
        .update(socialConnection)
        .set({
          status: 'error',
          pendingState: null,
          accountMeta: {
            ...existing.accountMeta,
            lastError: 'O link de autorização expirou. Clique em Conectar para tentar de novo.',
          },
          updatedAt: now,
        })
        .where(eq(socialConnection.id, existing.id))
        .returning()
      return { done: true, connection: toConnection(errored!) }
    }
    throw error
  }

  if (oauthStatus.status === 'pending') {
    return { done: false, connection: toConnection(existing) }
  }

  if (oauthStatus.status === 'error') {
    const [errored] = await db
      .update(socialConnection)
      .set({
        status: 'error',
        pendingState: null,
        accountMeta: {
          ...existing.accountMeta,
          lastError: oauthStatus.detail ?? 'A autorização foi cancelada ou falhou.',
        },
        updatedAt: now,
      })
      .where(eq(socialConnection.id, existing.id))
      .returning()
    return { done: true, connection: toConnection(errored!) }
  }

  // OAuth succeeded upstream: inspect the newly minted treg connection.
  const summaries = await client.listConnections(organizationId)
  const summary = findMatchingSummary(
    summaries,
    oauthStatus.secretId,
    oauthStatus.name || existing.externalToolName,
  )
  const secretId = summary?.id ?? oauthStatus.secretId ?? existing.externalSecretId
  const toolName = summary?.name ?? (oauthStatus.name || existing.externalToolName)

  let accountId = summary?.resourceRef ?? existing.accountId
  let accountName = summary?.resourceName ?? existing.accountName
  let nextStatus: SocialConnection['status'] = 'connected'
  let lastError: string | null = null
  let resources: Array<SocialResourceOption> | undefined

  if (summary?.health === 'setup_required' && !SOCIAL_CHANNEL_INFO[channel].supportsResourcePicker) {
    nextStatus = 'error'
    lastError =
      channel === 'instagram'
        ? 'Nenhuma conta Profissional (Business ou Creator) foi encontrada nesse login do Instagram.'
        : 'A conta autorizada não concluiu a configuração exigida pela rede social.'
  } else if (
    !accountId &&
    SOCIAL_CHANNEL_INFO[channel].supportsResourcePicker &&
    secretId !== null
  ) {
    resources = await client.listConnectionResources(organizationId, secretId)
    if (resources.length === 1) {
      const only = resources[0]!
      await client.selectConnectionResource(organizationId, secretId, only.id, only.name)
      accountId = only.id
      accountName = only.name
      nextStatus = 'connected'
    } else if (resources.length > 1) {
      nextStatus = 'needs_resource'
    } else {
      nextStatus = 'error'
      lastError = 'Nenhum canal disponível foi encontrado nessa conta.'
    }
  }

  const [updated] = await db
    .update(socialConnection)
    .set({
      externalSecretId: secretId,
      externalToolName: toolName,
      status: nextStatus,
      pendingState: null,
      accountId,
      accountName,
      accountMeta: metaFromSummary(existing.accountMeta, summary, lastError),
      updatedAt: now,
    })
    .where(eq(socialConnection.id, existing.id))
    .returning()

  return { done: true, connection: toConnection(updated!), resources }
}

/** Refreshes health/expiry/metadata for every saved connection in the workspace. */
export async function syncWorkspaceConnections(
  db: Database,
  treg: TregClient | null,
  organizationId: string,
  now: Date = new Date(),
): Promise<Array<SocialConnection>> {
  const client = requireTregClient(treg)
  const rows = await db
    .select()
    .from(socialConnection)
    .where(eq(socialConnection.organizationId, organizationId))
    .orderBy(asc(socialConnection.channel))
  if (rows.length === 0) return []

  const summaries = await client.listConnections(organizationId)
  const synced: Array<SocialConnection> = []

  for (const row of rows) {
    if (row.status === 'pending') {
      synced.push(toConnection(row))
      continue
    }
    const summary = findMatchingSummary(summaries, row.externalSecretId, row.externalToolName)
    if (!summary) {
      const [updated] = await db
        .update(socialConnection)
        .set({
          status: 'error',
          accountMeta: {
            ...row.accountMeta,
            health: 'missing',
            lastError: 'Conexão não encontrada no provedor. Reconecte a conta.',
          },
          updatedAt: now,
        })
        .where(eq(socialConnection.id, row.id))
        .returning()
      synced.push(toConnection(updated!))
      continue
    }

    const unhealthy = summary.health === 'invalid' || summary.health === 'expired'
    const nextStatus: SocialConnection['status'] = unhealthy
      ? 'error'
      : !summary.resourceRef &&
          !row.accountId &&
          SOCIAL_CHANNEL_INFO[row.channel].supportsResourcePicker
        ? 'needs_resource'
        : 'connected'

    const [updated] = await db
      .update(socialConnection)
      .set({
        externalSecretId: summary.id,
        externalToolName: summary.name,
        status: nextStatus,
        accountId: summary.resourceRef ?? row.accountId,
        accountName: summary.resourceName ?? row.accountName,
        accountMeta: metaFromSummary(
          row.accountMeta,
          summary,
          unhealthy ? 'A autorização expirou ou foi revogada. Reconecte a conta.' : null,
        ),
        updatedAt: now,
      })
      .where(eq(socialConnection.id, row.id))
      .returning()
    synced.push(toConnection(updated!))
  }

  return synced
}

/** Lists selectable upstream resources (e.g. YouTube channels) for a connection. */
export async function listChannelResources(
  db: Database,
  treg: TregClient | null,
  organizationId: string,
  channel: SocialChannel,
): Promise<Array<SocialResourceOption>> {
  const client = requireTregClient(treg)
  const existing = await findConnectionRow(db, organizationId, channel)
  if (!existing || existing.externalSecretId === null) {
    throw new SocialPublishingError('Conecte a conta antes de escolher o canal.')
  }
  return client.listConnectionResources(organizationId, existing.externalSecretId)
}

/** Pins a selected upstream resource (e.g. YouTube channel) onto the connection. */
export async function selectChannelResource(
  db: Database,
  treg: TregClient | null,
  input: {
    organizationId: string
    channel: SocialChannel
    resourceRef: string
    resourceName?: string
  },
  now: Date = new Date(),
): Promise<SocialConnection> {
  const client = requireTregClient(treg)
  const existing = await findConnectionRow(db, input.organizationId, input.channel)
  if (!existing || existing.externalSecretId === null) {
    throw new SocialPublishingError('Conexão não encontrada para este canal.')
  }
  await client.selectConnectionResource(
    input.organizationId,
    existing.externalSecretId,
    input.resourceRef,
    input.resourceName,
  )
  const [updated] = await db
    .update(socialConnection)
    .set({
      status: 'connected',
      accountId: input.resourceRef,
      accountName: input.resourceName?.trim() || input.resourceRef,
      accountMeta: { ...existing.accountMeta, lastError: null },
      updatedAt: now,
    })
    .where(eq(socialConnection.id, existing.id))
    .returning()
  return toConnection(updated!)
}

/** Disconnects a workspace's social account locally and revokes it in treg. */
export async function disconnectChannel(
  db: Database,
  treg: TregClient | null,
  organizationId: string,
  channel: SocialChannel,
): Promise<boolean> {
  const existing = await findConnectionRow(db, organizationId, channel)
  if (!existing) return false

  if (existing.externalSecretId !== null && treg) {
    try {
      await treg.revokeConnection(organizationId, existing.externalSecretId)
    } catch (error) {
      // Already deleted upstream is fine; surface other transport/auth errors.
      if (!(error instanceof TregApiError && error.status === 404)) {
        throw error
      }
    }
  }

  await db.delete(socialConnection).where(eq(socialConnection.id, existing.id))
  return true
}
