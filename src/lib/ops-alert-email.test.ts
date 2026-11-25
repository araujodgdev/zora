import { describe, expect, it, vi } from 'vitest'
import type { Mailer } from './mailer.server'
import {
  cronErrorAlertEmail,
  parseAlertRecipients,
  publishFailureAlertEmail,
  sendOpsAlert,
} from './ops-alert-email'

describe('parseAlertRecipients', () => {
  it('returns empty array for blank or invalid values', () => {
    expect(parseAlertRecipients(undefined)).toEqual([])
    expect(parseAlertRecipients('   ')).toEqual([])
    expect(parseAlertRecipients('not-an-email, @bad')).toEqual([])
  })

  it('splits, trims and deduplicates valid emails', () => {
    expect(
      parseAlertRecipients(' ops@lume.software, dev@lume.software ; OPS@lume.software , invalid '),
    ).toEqual(['ops@lume.software', 'dev@lume.software'])
  })
})

describe('publishFailureAlertEmail', () => {
  it('formats subject, plain text and escaped HTML with item link', () => {
    const email = publishFailureAlertEmail({
      to: 'ops@lume.software',
      itemId: 'item-123',
      itemTitle: 'Post <Especial> & Novo',
      channel: 'instagram',
      errorMessage: 'Token expirado',
      stage: 'dispatch',
      appUrl: 'https://zora.lume.software/',
      occurredAt: new Date('2026-11-25T15:00:00Z'),
    })

    expect(email.to).toBe('ops@lume.software')
    expect(email.from.email).toBe('zora@notify.lume.software')
    expect(email.subject).toContain('Instagram')
    expect(email.subject).toContain('Post <Especial> & Novo')
    expect(email.text).toContain('Token expirado')
    expect(email.text).toContain('https://zora.lume.software/content/item-123')
    expect(email.html).toContain('Post &lt;Especial&gt; &amp; Novo')
    expect(email.html).toContain('https://zora.lume.software/content/item-123')
  })
})

describe('cronErrorAlertEmail', () => {
  it('formats cron error alert in pt-BR', () => {
    const email = cronErrorAlertEmail({
      to: 'ops@lume.software',
      errorMessage: 'D1 unavailable',
      occurredAt: new Date('2026-11-25T15:00:00Z'),
    })

    expect(email.subject).toContain('cron')
    expect(email.text).toContain('D1 unavailable')
    expect(email.html).toContain('D1 unavailable')
  })
})

describe('sendOpsAlert', () => {
  it('no-ops without mailer or recipients', async () => {
    const mailer: Mailer = { send: vi.fn() }
    expect(await sendOpsAlert(null, ['ops@lume.software'], (to) => cronErrorAlertEmail({ to, errorMessage: 'x' }))).toEqual({
      sent: 0,
      failed: 0,
    })
    expect(await sendOpsAlert(mailer, [], (to) => cronErrorAlertEmail({ to, errorMessage: 'x' }))).toEqual({
      sent: 0,
      failed: 0,
    })
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('fans out to all recipients and never throws on partial failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mailer: Mailer = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ id: 'ok' })
        .mockRejectedValueOnce(new Error('unverified destination')),
    }

    const result = await sendOpsAlert(mailer, ['a@lume.software', 'b@lume.software'], (to) =>
      cronErrorAlertEmail({ to, errorMessage: 'boom' }),
    )

    expect(result).toEqual({ sent: 1, failed: 1 })
    expect(mailer.send).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })
})
