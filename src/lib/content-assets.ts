/**
 * Uploaded media of a content item: types, limits and URLs. Client-safe, and
 * the single place that lists which files may be uploaded.
 *
 * The files live in the R2 bucket bound as `MEDIA`; the database row
 * (`content_asset`) holds the name, type and size.
 */

/** What the browser can show inline, and how each type is previewed. */
export const MEDIA_TYPES = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  // Carousels are often exported as a PDF.
  'application/pdf': 'document',
} as const

export type AssetKind = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES]

/** Value for `<input accept>`. */
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(',')

/** 100 MB: the request body limit of Cloudflare Workers on the Free and Pro plans. */
export const MAX_ASSET_BYTES = 100 * 1024 * 1024

/**
 * Where a file came from, when Zora fetched it from a provider rather than a
 * person uploading it. Stock photos carry the credit their licence asks for.
 */
export type AssetAttribution =
  | {
      provider: 'unsplash'
      photoId: string
      photographer: string
      /** The photographer's Unsplash profile, with UTM parameters. */
      photographerUrl: string
      /** The photo's Unsplash page, with UTM parameters. */
      photoUrl: string
    }
  | {
      provider: 'fal'
      /** fal endpoint id, e.g. `fal-ai/nano-banana-2`. */
      model: string
      prompt: string
    }

/** An uploaded file, as returned by the server. */
export type ContentAsset = {
  id: string
  contentItemId: string
  filename: string
  contentType: string
  size: number
  attribution: AssetAttribution | null
  createdById: string
  createdAt: Date
}

/** The `utm_source` Unsplash asks every link back to carry. */
export const UNSPLASH_UTM_SOURCE = 'zora'

/** Unsplash's home page, with UTM parameters (the "Unsplash" link of a credit). */
export const UNSPLASH_HOME_URL = `https://unsplash.com/?utm_source=${UNSPLASH_UTM_SOURCE}&utm_medium=referral`

/** Appends Unsplash's UTM parameters to a link back to unsplash.com. */
export function withUnsplashUtm(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('utm_source', UNSPLASH_UTM_SOURCE)
  parsed.searchParams.set('utm_medium', 'referral')
  return parsed.toString()
}

/** The credit line shown with a file (pt-BR), or `null` when it needs none. */
export function assetCreditText(attribution: AssetAttribution | null): string | null {
  if (!attribution) return null
  if (attribution.provider === 'unsplash') return `Foto: ${attribution.photographer} / Unsplash`
  return 'Imagem gerada por IA'
}

export function assetKind(contentType: string): AssetKind | null {
  return (MEDIA_TYPES as Record<string, AssetKind>)[contentType] ?? null
}

/** The message for a file that may not be uploaded, or `null` when it is fine. */
export function assetUploadError(file: {
  name: string
  type: string
  size: number
}): string | null {
  if (!assetKind(file.type)) {
    return `${file.name}: só é possível enviar imagens (PNG, JPEG, GIF, WebP, AVIF), vídeos (MP4, WebM, MOV) e PDFs.`
  }
  if (file.size === 0) return `${file.name}: o arquivo está vazio.`
  if (file.size > MAX_ASSET_BYTES) {
    return `${file.name}: os arquivos podem ter no máximo ${formatBytes(MAX_ASSET_BYTES)}.`
  }
  return null
}

/** e.g. "3.4 MB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/** Where the browser loads the file from (inline, with range support). */
export function assetFileUrl(assetId: string): string {
  return `/api/assets/${assetId}`
}

/** Where the browser uploads a file of an item (`POST`, raw body). */
export function assetUploadUrl(itemId: string, filename: string): string {
  return `/api/content/${itemId}/assets?filename=${encodeURIComponent(filename)}`
}
