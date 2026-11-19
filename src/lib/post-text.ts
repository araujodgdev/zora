/**
 * How each channel takes an item's text (`body`). Client-safe; used by the
 * editor, the MCP tool descriptions and tests.
 *
 * - Blog: Markdown, edited with a rich-text editor and stored as Markdown.
 * - X, LinkedIn, Instagram, TikTok, YouTube: plain text. None of them render
 *   Markdown, so `**bold**` would be posted with its asterisks. The editor
 *   counts characters against the network's limit and offers to strip
 *   formatting.
 */
import type { Channel } from './content'

/** Channels whose text is Markdown; every other channel is plain text. */
export function isMarkdownChannel(channel: Channel): boolean {
  return channel === 'blog'
}

/**
 * Most characters a post may have on each network (`null`: no practical
 * limit). X is the standard post limit; X counts some characters (links,
 * some emoji) differently, so near the limit check there.
 */
export const CHANNEL_TEXT_LIMITS: Record<Channel, number | null> = {
  x: 280,
  linkedin: 3000,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  blog: null,
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })
    : null

/** Characters as people see them: an emoji or an accented letter counts once. */
export function countCharacters(text: string): number {
  if (!segmenter) return Array.from(text).length
  let count = 0
  for (const _segment of segmenter.segment(text)) count++
  return count
}

const MARKDOWN_PATTERNS = [
  /\*\*[^*\n]+\*\*/, // **bold**
  /__[^_\n]+__/, // __bold__
  /(^|[^\w*])\*[^*\s][^*\n]*\*(?!\w)/, // *italic*
  /^#{1,6}\s/m, // # heading
  /\[[^\]\n]+\]\([^)\s]+\)/, // [text](url)
  /^>\s/m, // > quote
  /`[^`\n]+`/, // `code`
]

/** Whether the text contains Markdown that a social network would show literally. */
export function hasMarkdownFormatting(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * The text without Markdown syntax, ready to paste into a social network:
 * markers are dropped, `[text](url)` becomes `text (url)`, `*`/`+` bullets
 * become `•`. Line breaks and plain `-` bullets are kept.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\s*)[*+]\s+/gm, '$1• ')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^\w*])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
}
