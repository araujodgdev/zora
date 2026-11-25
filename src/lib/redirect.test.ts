import { describe, expect, it } from 'vitest'
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from './redirect'

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
