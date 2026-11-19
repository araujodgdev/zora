import { describe, expect, it } from 'vitest'
import {
  CHANNEL_TEXT_LIMITS,
  countCharacters,
  hasMarkdownFormatting,
  isMarkdownChannel,
  stripMarkdown,
} from './post-text'

describe('post text', () => {
  it('treats only the blog as Markdown', () => {
    expect(isMarkdownChannel('blog')).toBe(true)
    expect(isMarkdownChannel('x')).toBe(false)
    expect(isMarkdownChannel('tiktok')).toBe(false)
    expect(isMarkdownChannel('youtube')).toBe(false)
    expect(CHANNEL_TEXT_LIMITS.x).toBe(280)
    expect(CHANNEL_TEXT_LIMITS.tiktok).toBe(2200)
    expect(CHANNEL_TEXT_LIMITS.youtube).toBe(5000)
    expect(CHANNEL_TEXT_LIMITS.blog).toBeNull()
  })

  it('counts what people see as one character', () => {
    expect(countCharacters('ação')).toBe(4)
    expect(countCharacters('👍🏽 ok')).toBe(4)
    expect(countCharacters('')).toBe(0)
  })

  it('detects Markdown a network would show literally', () => {
    expect(hasMarkdownFormatting('**Subtítulo:** texto')).toBe(true)
    expect(hasMarkdownFormatting('## Título')).toBe(true)
    expect(hasMarkdownFormatting('veja [o site](https://lume.software)')).toBe(true)
    expect(hasMarkdownFormatting('um *destaque* aqui')).toBe(true)
    expect(hasMarkdownFormatting('Texto simples, 2 * 3 = 6.\n- item')).toBe(false)
    expect(hasMarkdownFormatting('#lançamento #beta')).toBe(false)
  })

  it('strips Markdown and keeps the text and line breaks', () => {
    expect(
      stripMarkdown(
        '## Título\n\n**Subtítulo:** O que a *Signum* faz.\n\n* um\n* dois\n- três\n\nVeja [o site](https://lume.software).',
      ),
    ).toBe(
      'Título\n\nSubtítulo: O que a Signum faz.\n\n• um\n• dois\n- três\n\nVeja o site (https://lume.software).',
    )
    expect(stripMarkdown('#lançamento sem mudanças')).toBe('#lançamento sem mudanças')
  })
})
