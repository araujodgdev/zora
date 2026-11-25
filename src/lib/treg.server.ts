/**
 * HTTP client for treg.to (https://treg.to/integrate.md). Server-only, free
 * of TanStack Start / Cloudflare runtime imports, and accepts an injectable
 * `fetch` so every call path can be unit-tested without hitting the network.
 *
 * Every request goes through `request()` so `X-Treg-Token` and
 * `X-Treg-Meta: workspace=<organizationId>` are always attached and treg's
 * own account-level errors (402 balance, 429 platform cap, 403 funds_required)
 * are never leaked to end users.
 */
import type { SocialChannel, SocialResourceOption } from './social'

export const DEFAULT_TREG_BASE_URL = 'https://treg.to'
const DEFAULT_TIMEOUT_MS = 45_000
const UPLOAD_TIMEOUT_MS = 90_000

/** Base error for social connections and publishing; its message is safe to show users. */
export class SocialPublishingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocialPublishingError'
  }
}

export class TregNotConfiguredError extends SocialPublishingError {
  constructor() {
    super('A publicação em redes sociais não está configurada neste servidor.')
    this.name = 'TregNotConfiguredError'
  }
}

export class TregApiError extends SocialPublishingError {
  readonly status: number
  readonly isTregError: boolean
  readonly code: string | null
  readonly reviewPendingScopes: Array<string>

  constructor(
    message: string,
    info: {
      status: number
      isTregError: boolean
      code?: string | null
      reviewPendingScopes?: Array<string>
    },
  ) {
    super(message)
    this.name = 'TregApiError'
    this.status = info.status
    this.isTregError = info.isTregError
    this.code = info.code ?? null
    this.reviewPendingScopes = info.reviewPendingScopes ?? []
  }
}

export type TregStartOAuthResult = {
  state: string
  consentUrl: string
  redirectUri: string
  connectGuidance: string | null
}

export type TregOAuthStatusResult = {
  status: 'pending' | 'done' | 'error'
  secretId: number | null
  detail: string | null
  name: string
}

export type TregConnectionSummary = {
  id: number
  name: string
  provider: string
  health: string | null
  expiresAt: string | null
  resourceRef: string | null
  resourceName: string | null
  capabilities: Array<string>
  scopesInReview: Array<string>
  reviewNote: string | null
  authorizationMethod: string | null
}

export type TregHostedMedia = {
  url: string
  token: string
  contentType: string
  size: number
  expiresAt: string
}

export type TregToolCallResult<T = unknown> = {
  status: number
  headers: Headers
  data: T
  callId: string | null
  costMicro: number
  reviewPendingScopes: Array<string>
}

export type TregClientConfig = {
  token?: string
  baseUrl?: string
  fetch?: typeof fetch
}

export type TregClient = {
  readonly baseUrl: string
  startOAuth(input: {
    organizationId: string
    provider: SocialChannel
    capability: string
    name: string
    connectionId?: number | null
  }): Promise<TregStartOAuthResult>
  getOAuthStatus(input: {
    organizationId: string
    state: string
  }): Promise<TregOAuthStatusResult>
  listConnections(organizationId: string): Promise<Array<TregConnectionSummary>>
  listConnectionResources(
    organizationId: string,
    secretId: number,
  ): Promise<Array<SocialResourceOption>>
  selectConnectionResource(
    organizationId: string,
    secretId: number,
    resourceRef: string,
    resourceName?: string,
  ): Promise<void>
  revokeConnection(organizationId: string, secretId: number): Promise<void>
  uploadHostedMedia(
    organizationId: string,
    input: { body: Uint8Array; contentType: string },
  ): Promise<TregHostedMedia>
  callTool<T = unknown>(input: {
    organizationId: string
    toolName: string
    path: string
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    query?: Record<string, string | number | boolean | undefined | null>
    headers?: Record<string, string>
    body?: BodyInit | Record<string, unknown> | null
    idempotencyKey?: string
    timeoutMs?: number
  }): Promise<TregToolCallResult<T>>
}

const TEAM_BILLING_ERROR_CODES = new Set([
  'insufficient_balance',
  'platform_daily_cap_reached',
  'funds_required',
  'member_spend_cap_reached',
  'trial_allowance_reached',
])

function parseReviewScopes(header: string | null): Array<string> {
  if (!header) return []
  return header
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringField(record: Record<string, unknown> | null, ...keys: Array<string>): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function extractErrorCodeAndMessage(body: unknown): { code: string | null; detail: string | null } {
  if (typeof body === 'string') {
    const trimmed = body.trim()
    return { code: null, detail: trimmed ? trimmed.slice(0, 400) : null }
  }
  const obj = asRecord(body)
  if (!obj) return { code: null, detail: null }

  // Nested provider shapes: Meta `{ error: { message, code } }`, TikTok `{ error: { code, message } }`,
  // YouTube `{ error: { message, errors: [...] } }`, FastAPI `{ detail: ... }`.
  const nestedError = asRecord(obj.error)
  if (nestedError) {
    const code =
      stringField(nestedError, 'code', 'type', 'status') ??
      (typeof nestedError.code === 'number' ? String(nestedError.code) : null)
    const detail = stringField(
      nestedError,
      'error_user_msg',
      'message',
      'error_description',
      'detail',
    )
    return { code, detail }
  }

  const nestedDetail = asRecord(obj.detail)
  if (nestedDetail) {
    return {
      code: stringField(nestedDetail, 'error', 'code'),
      detail: stringField(nestedDetail, 'message', 'detail'),
    }
  }

  return {
    code: stringField(obj, 'error', 'code', 'title'),
    detail: stringField(obj, 'message', 'detail', 'error_description'),
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/**
 * Turns a failed treg or upstream HTTP response into a user-safe pt-BR error.
 * Team-level balance/cap errors from treg are logged server-side and masked.
 */
function buildTregError(response: Response, body: unknown): TregApiError {
  const isTregError = response.headers.get('x-treg-error') === '1'
  const reviewPendingScopes = parseReviewScopes(response.headers.get('x-treg-review-pending'))
  const { code, detail } = extractErrorCodeAndMessage(body)

  if (isTregError || response.status === 402 || response.status === 428) {
    if (
      (code && TEAM_BILLING_ERROR_CODES.has(code)) ||
      (isTregError && response.status === 402)
    ) {
      console.error('[treg] team billing/limit error:', response.status, code, detail)
      return new TregApiError(
        'O serviço de publicação atingiu o limite de saldo ou cota da conta. Avise o administrador do Zora.',
        { status: response.status, isTregError: true, code, reviewPendingScopes },
      )
    }
    if (response.status === 428) {
      return new TregApiError(
        'A conta desta rede social precisa ser reconectada ou autorizada com permissão de publicação em Conexões.',
        { status: response.status, isTregError: true, code, reviewPendingScopes },
      )
    }
    if (isTregError && response.status === 401) {
      console.error('[treg] authentication failed:', code, detail)
      return new TregApiError(
        'A credencial do serviço de publicação é inválida ou foi revogada. Avise o administrador do Zora.',
        { status: response.status, isTregError: true, code, reviewPendingScopes },
      )
    }
    if (isTregError && response.status === 403 && code === 'provider_paused') {
      return new TregApiError(
        'Este canal está temporariamente pausado no provedor de integração. Tente novamente mais tarde.',
        { status: response.status, isTregError: true, code, reviewPendingScopes },
      )
    }
  }

  if (reviewPendingScopes.length > 0) {
    return new TregApiError(
      `A plataforma ainda aguarda aprovação de permissão (${reviewPendingScopes.join(', ')}). Reconectar não resolve enquanto a revisão estiver pendente.`,
      { status: response.status, isTregError, code, reviewPendingScopes },
    )
  }

  if (response.status === 401) {
    return new TregApiError(
      'A autorização da conta expirou. Reconecte a rede social em Conexões e tente novamente.',
      { status: response.status, isTregError, code, reviewPendingScopes },
    )
  }

  if (response.status === 429) {
    return new TregApiError(
      'Limite de requisições da rede social atingido no momento. Aguarde alguns instantes e tente de novo.',
      { status: response.status, isTregError, code, reviewPendingScopes },
    )
  }

  const suffix = detail ? `: ${detail}` : ` (HTTP ${response.status}).`
  return new TregApiError(`A rede social recusou a operação${suffix}`, {
    status: response.status,
    isTregError,
    code,
    reviewPendingScopes,
  })
}

function normalizeConnectionSummary(raw: unknown): TregConnectionSummary | null {
  const row = asRecord(raw)
  if (!row || typeof row.id !== 'number' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    name: row.name,
    provider: typeof row.provider === 'string' ? row.provider : '',
    health: typeof row.health === 'string' ? row.health : null,
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    resourceRef: typeof row.resource_ref === 'string' && row.resource_ref ? row.resource_ref : null,
    resourceName:
      typeof row.resource_name === 'string' && row.resource_name ? row.resource_name : null,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    scopesInReview: Array.isArray(row.scopes_in_review)
      ? row.scopes_in_review.filter((item): item is string => typeof item === 'string')
      : [],
    reviewNote: typeof row.review_note === 'string' && row.review_note ? row.review_note : null,
    authorizationMethod:
      typeof row.authorization_method === 'string' && row.authorization_method
        ? row.authorization_method
        : null,
  }
}

function normalizeResources(raw: unknown): Array<SocialResourceOption> {
  const list = Array.isArray(raw)
    ? raw
    : asRecord(raw)?.resources && Array.isArray(asRecord(raw)?.resources)
      ? (asRecord(raw)?.resources as Array<unknown>)
      : asRecord(raw)?.items && Array.isArray(asRecord(raw)?.items)
        ? (asRecord(raw)?.items as Array<unknown>)
        : []

  const options: Array<SocialResourceOption> = []
  for (const entry of list) {
    const row = asRecord(entry)
    if (!row) continue
    const id = stringField(row, 'id', 'resource_ref', 'ref')
    if (!id) continue
    const name = stringField(row, 'name', 'label', 'title', 'resource_name') ?? id
    options.push({ id, name })
  }
  return options
}

/** Creates a treg HTTP client, or `null` when `TREG_TOKEN` is unset. */
export function createTregClient(config: TregClientConfig): TregClient | null {
  const token = config.token?.trim()
  if (!token) return null
  const baseUrl = (config.baseUrl?.trim() || DEFAULT_TREG_BASE_URL).replace(/\/+$/, '')
  const fetchImpl = config.fetch ?? globalThis.fetch

  async function send(
    path: string,
    init: {
      organizationId: string
      method?: string
      headers?: Record<string, string>
      body?: BodyInit | null
      idempotencyKey?: string
      timeoutMs?: number
    },
  ): Promise<{ response: Response; data: unknown }> {
    const headers = new Headers(init.headers)
    headers.set('X-Treg-Token', token!)
    headers.set('X-Treg-Meta', `workspace=${init.organizationId}`)
    if (init.idempotencyKey) {
      headers.set('Idempotency-Key', init.idempotencyKey)
    }

    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body,
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    } catch (error) {
      console.error('[treg] transport error:', path, error)
      throw new SocialPublishingError(
        'Não foi possível se comunicar com o serviço de publicação agora. Tente novamente.',
      )
    }

    const data = await readResponseBody(response)
    if (!response.ok) {
      throw buildTregError(response, data)
    }
    return { response, data }
  }

  return {
    baseUrl,

    async startOAuth({ organizationId, provider, capability, name, connectionId }) {
      const payload: Record<string, unknown> = {
        provider,
        capability,
        name,
      }
      if (connectionId != null) {
        payload.connection_id = connectionId
      }
      const { data } = await send('/oauth/start', {
        organizationId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const obj = asRecord(data)
      const state = stringField(obj, 'state')
      const consentUrl = stringField(obj, 'consent_url')
      const redirectUri = stringField(obj, 'redirect_uri') ?? `${baseUrl}/oauth/callback`
      if (!state || !consentUrl) {
        throw new SocialPublishingError('Resposta inesperada ao iniciar a conexão OAuth.')
      }
      return {
        state,
        consentUrl,
        redirectUri,
        connectGuidance: stringField(obj, 'connect_guidance'),
      }
    },

    async getOAuthStatus({ organizationId, state }) {
      const { data } = await send(`/oauth/status/${encodeURIComponent(state)}`, {
        organizationId,
      })
      const obj = asRecord(data)
      const rawStatus = stringField(obj, 'status') ?? 'pending'
      const status: TregOAuthStatusResult['status'] =
        rawStatus === 'done' || rawStatus === 'error' ? rawStatus : 'pending'
      return {
        status,
        secretId: typeof obj?.secret_id === 'number' ? obj.secret_id : null,
        detail: stringField(obj, 'detail'),
        name: stringField(obj, 'name') ?? '',
      }
    },

    async listConnections(organizationId) {
      const { data } = await send('/connections', { organizationId })
      if (!Array.isArray(data)) return []
      return data
        .map(normalizeConnectionSummary)
        .filter((row): row is TregConnectionSummary => row !== null)
    },

    async listConnectionResources(organizationId, secretId) {
      const { data } = await send(`/connections/${secretId}/resources`, { organizationId })
      return normalizeResources(data)
    },

    async selectConnectionResource(organizationId, secretId, resourceRef, resourceName) {
      await send(`/connections/${secretId}/resource`, {
        organizationId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_ref: resourceRef,
          resource_name: resourceName ?? '',
        }),
      })
    },

    async revokeConnection(organizationId, secretId) {
      await send(`/connections/${secretId}`, {
        organizationId,
        method: 'DELETE',
      })
    },

    async uploadHostedMedia(organizationId, { body, contentType }) {
      // Pass an ArrayBuffer slice so BodyInit stays compatible across DOM and workerd types.
      const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
      const { data } = await send('/media', {
        organizationId,
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: buffer,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      })
      const obj = asRecord(data)
      const url = stringField(obj, 'url')
      const mediaToken = stringField(obj, 'token')
      if (!url || !mediaToken) {
        throw new SocialPublishingError(
          'Não foi possível hospedar a mídia temporária para envio à rede social.',
        )
      }
      return {
        url,
        token: mediaToken,
        contentType: stringField(obj, 'content_type') ?? contentType,
        size: typeof obj?.size === 'number' ? obj.size : body.byteLength,
        expiresAt: stringField(obj, 'expires_at') ?? '',
      }
    },

    async callTool<T = unknown>({
      organizationId,
      toolName,
      path,
      method = 'GET',
      query,
      headers: extraHeaders,
      body,
      idempotencyKey,
      timeoutMs,
    }: {
      organizationId: string
      toolName: string
      path: string
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      query?: Record<string, string | number | boolean | undefined | null>
      headers?: Record<string, string>
      body?: BodyInit | Record<string, unknown> | null
      idempotencyKey?: string
      timeoutMs?: number
    }): Promise<TregToolCallResult<T>> {
      const cleanPath = path.replace(/^\/+/, '')
      const url = new URL(`${baseUrl}/call/${encodeURIComponent(toolName)}/${cleanPath}`)
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value))
          }
        }
      }

      const headers: Record<string, string> = { ...extraHeaders }
      let encodedBody: BodyInit | null | undefined = undefined
      if (body !== undefined && body !== null) {
        if (
          typeof body === 'string' ||
          body instanceof ArrayBuffer ||
          body instanceof Uint8Array ||
          body instanceof Blob ||
          body instanceof FormData ||
          body instanceof URLSearchParams ||
          body instanceof ReadableStream
        ) {
          encodedBody = body as BodyInit
        } else {
          headers['Content-Type'] ??= 'application/json'
          encodedBody = JSON.stringify(body)
        }
      }

      const { response, data } = await send(`${url.pathname}${url.search}`, {
        organizationId,
        method,
        headers,
        body: encodedBody,
        idempotencyKey,
        timeoutMs,
      })

      const costRaw = Number(response.headers.get('x-treg-cost-micro') ?? '0')
      return {
        status: response.status,
        headers: response.headers,
        data: data as T,
        callId: response.headers.get('x-treg-call-id'),
        costMicro: Number.isFinite(costRaw) && costRaw > 0 ? costRaw : 0,
        reviewPendingScopes: parseReviewScopes(response.headers.get('x-treg-review-pending')),
      }
    },
  }
}

export function requireTregClient(client: TregClient | null | undefined): TregClient {
  if (!client) throw new TregNotConfiguredError()
  return client
}
