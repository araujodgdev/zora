import { describe, expect, it, vi } from 'vitest'
import {
  SocialPublishingError,
  TregApiError,
  TregNotConfiguredError,
  createTregClient,
  requireTregClient,
} from './treg.server'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('createTregClient', () => {
  it('returns null when token is empty and throws TregNotConfiguredError on require', () => {
    expect(createTregClient({ token: '' })).toBeNull()
    expect(createTregClient({ token: '   ' })).toBeNull()
    expect(() => requireTregClient(null)).toThrow(TregNotConfiguredError)
  })

  it('attaches X-Treg-Token, X-Treg-Meta workspace tag and Idempotency-Key', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { data: { id: 'tweet-1' } },
        201,
        { 'X-Treg-Call-Id': 'call-123', 'X-Treg-Cost-Micro': '15000' },
      ),
    )

    const client = createTregClient({
      token: 'treg_secret_key',
      baseUrl: 'https://treg.to/',
      fetch: mockFetch,
    })!

    const res = await client.callTool<{ data: { id: string } }>({
      organizationId: 'org-signum',
      toolName: 'zora-x-123',
      path: '/2/tweets',
      method: 'POST',
      body: { text: 'Olá mundo' },
      idempotencyKey: 'job-1-x-0',
    })

    expect(res.data.data.id).toBe('tweet-1')
    expect(res.callId).toBe('call-123')
    expect(res.costMicro).toBe(15000)

    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://treg.to/call/zora-x-123/2/tweets')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-treg-token')).toBe('treg_secret_key')
    expect(headers.get('x-treg-meta')).toBe('workspace=org-signum')
    expect(headers.get('idempotency-key')).toBe('job-1-x-0')
  })

  it('never leaks treg team balance or top-up URLs on 402/429 errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: 'insufficient_balance',
          balance_micro: 0,
          topup_url: 'https://treg.to/billing/secret-topup',
        },
        402,
        { 'X-Treg-Error': '1' },
      ),
    )

    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    try {
      await client.callTool({
        organizationId: 'org-1',
        toolName: 'zora-x-1',
        path: '/2/tweets',
        method: 'POST',
        body: { text: 'Oi' },
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TregApiError)
      expect((error as TregApiError).message).not.toContain('secret-topup')
      expect((error as TregApiError).message).not.toContain('balance_micro')
      expect((error as TregApiError).message).toContain('limite de saldo')
    } finally {
      spy.mockRestore()
    }
  })

  it('surfaces X-Treg-Review-Pending scope guidance clearly', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { code: 10, message: 'Application does not have permission' } },
        403,
        { 'X-Treg-Review-Pending': 'instagram_business_content_publish' },
      ),
    )

    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    await expect(
      client.callTool({
        organizationId: 'org-1',
        toolName: 'zora-ig-1',
        path: '/123/media_publish',
        method: 'POST',
      }),
    ).rejects.toThrow(/instagram_business_content_publish/)
  })

  it('maps 428 missing grant to a reconnect prompt', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'missing_grant' }, 428, { 'X-Treg-Error': '1' }),
    )
    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    await expect(
      client.callTool({
        organizationId: 'org-1',
        toolName: 'zora-x-1',
        path: '/2/tweets',
        method: 'POST',
      }),
    ).rejects.toThrow(/reconectada/i)
  })

  it('uploads raw bytes to /media and returns the hosted public URL', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        url: 'https://treg.to/m/abc123.jpg',
        token: 'abc123',
        content_type: 'image/jpeg',
        size: 3,
        expires_at: '2026-11-26T00:00:00Z',
      }),
    )
    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    const hosted = await client.uploadHostedMedia('org-1', {
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    })
    expect(hosted.url).toBe('https://treg.to/m/abc123.jpg')
    expect(hosted.token).toBe('abc123')
  })

  it('starts OAuth and polls status + lists resources', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          state: 'st-1',
          consent_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=st-1',
          redirect_uri: 'https://treg.to/oauth/callback',
          connect_guidance: 'Escolha o canal.',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 'done', secret_id: 42, detail: null, name: 'zora-youtube-abc' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ resources: [{ id: 'UC123', name: 'Canal Zora' }] }),
      )

    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    const started = await client.startOAuth({
      organizationId: 'org-1',
      provider: 'youtube',
      capability: 'post',
      name: 'zora-youtube-abc',
    })
    expect(started.consentUrl).toContain('accounts.google.com')
    const status = await client.getOAuthStatus({ organizationId: 'org-1', state: 'st-1' })
    expect(status).toEqual({
      status: 'done',
      secretId: 42,
      detail: null,
      name: 'zora-youtube-abc',
    })
    const resources = await client.listConnectionResources('org-1', 42)
    expect(resources).toEqual([{ id: 'UC123', name: 'Canal Zora' }])
  })

  it('wraps network failures in SocialPublishingError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'))
    const client = createTregClient({ token: 'treg_abc', fetch: mockFetch })!
    try {
      await expect(client.listConnections('org-1')).rejects.toThrow(SocialPublishingError)
    } finally {
      spy.mockRestore()
    }
  })
})
