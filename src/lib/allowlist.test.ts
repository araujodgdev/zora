import { describe, expect, it } from 'vitest'
import { isEmailAllowed, parseAllowlist } from './allowlist'
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from './redirect'

describe('sign-up allowlist', () => {
  it('parses a comma-separated list, trimming and lowercasing', () => {
    expect([...parseAllowlist(' Alice@Example.com, ,bob@example.com ')]).toEqual([
      'alice@example.com',
      'bob@example.com',
    ])
  })

  it('compares case-insensitively', () => {
    const allowlist = parseAllowlist('Alice@Example.com')
    expect(isEmailAllowed('ALICE@example.COM', allowlist)).toBe(true)
    expect(isEmailAllowed(' alice@example.com ', allowlist)).toBe(true)
    expect(isEmailAllowed('mallory@example.com', allowlist)).toBe(false)
  })

  it('allows nobody when empty or unset', () => {
    expect(isEmailAllowed('alice@example.com', parseAllowlist(''))).toBe(false)
    expect(isEmailAllowed('alice@example.com', parseAllowlist(undefined))).toBe(
      false,
    )
  })
})

describe('safeRedirectPath', () => {
  it('keeps same-origin paths with search and hash', () => {
    expect(safeRedirectPath('/content?x=1#top')).toBe('/content?x=1#top')
  })

  it('falls back for missing, external or auth-page targets', () => {
    for (const value of [
      undefined,
      '',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'calendar',
      '/sign-in?redirect=/x',
    ]) {
      expect(safeRedirectPath(value)).toBe(DEFAULT_SIGNED_IN_PATH)
    }
  })
})
