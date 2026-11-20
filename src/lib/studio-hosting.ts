/**
 * Sibling web apps hosted by Zora from R2 (Zora Studio, its font library and
 * LightCraft): where their files live and how they are served, and the
 * messages the embedded Studio posts to the editor page. Client-safe and
 * dependency-free (the publish scripts in `scripts/` import it with Node).
 *
 * Studio's web build is too big for Workers static assets (the wasm is about
 * 73 MB; the limit is 25 MiB a file), so `pnpm studio:publish` uploads it to
 * the `MEDIA` R2 bucket under `studio/`, and `/studio/*` serves it from there
 * (same origin as Zora, so the iframe shares the session). The font library
 * (`pnpm fonts:sync`) lives under `studio-fonts/` and is served at
 * `/studio-fonts/*`. See docs/STUDIO-PLAN.md, "Studio in Zora" and "Font
 * library". LightCraft's web build (`pnpm lightcraft:publish`) lives under
 * `lightcraft/` and is served at `/lightcraft/*` the same way
 * (docs/LIGHTCRAFT-PLAN.md, D1 and Z1).
 */

/** A bundle served from R2: the URL prefix and the R2 key prefix. */
export type HostedBundle = {
  /** URL path prefix, with both slashes, e.g. `/studio/`. */
  urlPrefix: string
  /** R2 key prefix, e.g. `studio/`. */
  keyPrefix: string
  /** The file served for the bundle's root URL, or null for none. */
  index: string | null
  /**
   * Whether a 16-digit hex hash in a name means the file never changes under
   * that name (Trunk's and the font sync's names), so it may be cached for a
   * year. False for builds whose names stay the same across versions
   * (LightCraft): every file is then revalidated.
   */
  hashedNames: boolean
  /**
   * Whether the publish script leaves out precompressed copies (`*.gz`,
   * `*.br`) of the build: the route streams the raw file and Cloudflare
   * compresses it on the way out.
   */
  skipPrecompressed: boolean
}

/** The older name of `HostedBundle`, from when only Studio was hosted. */
export type StudioBundle = HostedBundle

export const STUDIO_BUNDLE = {
  urlPrefix: '/studio/',
  keyPrefix: 'studio/',
  index: 'index.html',
  hashedNames: true,
  skipPrecompressed: false,
} as const satisfies HostedBundle

export const STUDIO_FONTS_BUNDLE = {
  urlPrefix: '/studio-fonts/',
  keyPrefix: 'studio-fonts/',
  index: null,
  hashedNames: true,
  skipPrecompressed: false,
} as const satisfies HostedBundle

/**
 * LightCraft's web build (`cargo xtask web` -> `target/web-site/`: index.html,
 * worker.js, lightcraft_web.js, lightcraft_web_bg.wasm, optionally
 * lightcraft_zh_hans.otf and its OFL text). Its file names carry no content
 * hash, so everything is `no-cache`.
 */
export const LIGHTCRAFT_BUNDLE = {
  urlPrefix: '/lightcraft/',
  keyPrefix: 'lightcraft/',
  index: 'index.html',
  hashedNames: false,
  skipPrecompressed: true,
} as const satisfies HostedBundle

/** Every bundle Zora hosts, by name. Their key prefixes never overlap. */
export const HOSTED_BUNDLES = {
  studio: STUDIO_BUNDLE,
  'studio-fonts': STUDIO_FONTS_BUNDLE,
  lightcraft: LIGHTCRAFT_BUNDLE,
} as const satisfies Record<string, HostedBundle>

/** The font library's manifest, relative to the fonts bundle. */
export const STUDIO_FONTS_MANIFEST = 'manifest.json'

/**
 * Bookkeeping object the publish scripts keep beside a bundle (the keys they
 * uploaded, so a later publish can remove stale ones on remote R2, where the
 * scripts cannot list). Never served: dot-files are refused by
 * `resolveBundlePath`.
 */
export const PUBLISH_INDEX_FILE = '.published.json'

/** The embedded Studio for a design, in Zora's theme. */
export function studioEditorUrl(designId: string, theme: 'dark' | 'light'): string {
  const search = new URLSearchParams({ design: designId, theme })
  return `${STUDIO_BUNDLE.urlPrefix}?${search.toString()}`
}

// --- paths ----------------------------------------------------------------------

const MAX_BUNDLE_PATH_LENGTH = 512
// Letters, digits and a few punctuation marks; no slashes, backslashes,
// percent signs, quotes or control characters.
const SAFE_SEGMENT = /^[A-Za-z0-9._@+~-]+$/

/**
 * The file a request path names inside a bundle, relative to it (e.g.
 * `snippets/eframe-d31a8450ea12dfc1/inline0.js`), or null when the path is
 * not safe to map to an R2 key. `rest` is the URL path after the bundle
 * prefix, still percent-encoded. An empty `rest` is the bundle's index.
 *
 * Refused: `.`/`..` and dot-files, empty segments (`a//b`, a trailing
 * slash), backslashes, encoded slashes, control characters, and anything
 * outside a conservative character set.
 */
export function resolveBundlePath(bundle: HostedBundle, rest: string): string | null {
  if (rest === '') return bundle.index
  if (rest.length > MAX_BUNDLE_PATH_LENGTH) return null
  const segments = rest.split('/')
  const decoded: Array<string> = []
  for (const segment of segments) {
    let value: string
    try {
      value = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (value === '' || value.startsWith('.') || !SAFE_SEGMENT.test(value)) return null
    decoded.push(value)
  }
  return decoded.join('/')
}

/** The R2 key of a bundle file (`path` from `resolveBundlePath`). */
export function bundleObjectKey(bundle: HostedBundle, path: string): string {
  return `${bundle.keyPrefix}${path}`
}

// --- content types and caching ------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
}

/**
 * The Content-Type of a bundle file, by extension. Files without one (the
 * licence files `LICENSE-MIT`, `NOTICE`, `OFL`) are plain text; unknown
 * extensions are `application/octet-stream`. SVG is deliberately unknown.
 */
export function bundleContentType(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'text/plain; charset=utf-8'
  return CONTENT_TYPES[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

// A 16-digit lowercase hex hash, as Trunk and the font sync write them:
// `vectorcraft-web-3ee0a15109942011.js`, `-c1b3de632dbb07fa_bg.wasm`,
// `snippets/eframe-d31a8450ea12dfc1/`, `fonts/<sha16>/`,
// `Inter-opsz-wght-<sha16>.ttf`.
const HASHED_SEGMENT = /(?:^|-)[0-9a-f]{16}(?=$|[._])/

/** Whether a bundle path carries a content hash in a file or folder name. */
export function isHashedBundlePath(path: string): boolean {
  return path.split('/').some((segment) => HASHED_SEGMENT.test(segment))
}

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE_CONTROL = 'no-cache'

/**
 * Hashed files never change under their name: cache them for a year. The
 * rest (index.html, the manifest, icons, licences) is revalidated on every
 * use (`no-cache`, answered with 304 while the ETag matches).
 */
export function bundleCacheControl(path: string): string {
  return isHashedBundlePath(path) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL
}

/**
 * The caching rule of a file of `bundle`: `bundleCacheControl` for bundles
 * with hashed names, always `no-cache` for the others.
 */
export function bundleFileCacheControl(bundle: HostedBundle, path: string): string {
  return bundle.hashedNames ? bundleCacheControl(path) : REVALIDATE_CACHE_CONTROL
}

// --- publishing -----------------------------------------------------------------------

/** A precompressed copy of another build file (`lightcraft_web_bg.wasm.br`). */
export function isPrecompressedCopy(path: string): boolean {
  return /\.(?:gz|br)$/i.test(path)
}

/**
 * What the publish scripts do with a file of a build folder (`path` relative
 * to it, `/`-separated): leave it out (dot-files and dot-folders such as
 * `.trunk-lock`; precompressed copies when the bundle skips them), or upload
 * it with its type and caching rule. Throws for a name the bundle's route
 * would not serve: uploading it would be dead weight, and a build that needs
 * it would break.
 */
export function bundleUploadEntry(
  bundle: HostedBundle,
  path: string,
): { contentType: string; cacheControl: string } | null {
  const segments = path.split('/')
  if (segments.some((segment) => segment.startsWith('.'))) return null
  if (bundle.skipPrecompressed && isPrecompressedCopy(path)) return null
  if (resolveBundlePath(bundle, segments.map(encodeURIComponent).join('/')) !== path) {
    throw new Error(`${path}: the ${bundle.urlPrefix} route would not serve this name`)
  }
  return { contentType: bundleContentType(path), cacheControl: bundleFileCacheControl(bundle, path) }
}

// --- messages from the embedded Studio -------------------------------------------------

/** What Studio posts to the page that embeds it (docs/STUDIO-PLAN.md). */
export type StudioMessage =
  | { type: 'zora-studio:ready'; designId: string }
  | { type: 'zora-studio:dirty'; designId: string; dirty: boolean }
  | { type: 'zora-studio:saved'; designId: string; versionId: string; number: number }
  /** The person pressed "Voltar ao item" in Studio. */
  | { type: 'zora-studio:back'; designId: string }

/**
 * The Studio message in `data`, when it is one and about `designId`; null for
 * anything else (other messages, other designs, malformed fields). Check
 * `event.origin` and `event.source` before calling this.
 */
export function parseStudioMessage(data: unknown, designId: string): StudioMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (message.designId !== designId) return null
  switch (message.type) {
    case 'zora-studio:ready':
    case 'zora-studio:back':
      return { type: message.type, designId }
    case 'zora-studio:dirty':
      return typeof message.dirty === 'boolean'
        ? { type: message.type, designId, dirty: message.dirty }
        : null
    case 'zora-studio:saved':
      return typeof message.versionId === 'string' &&
        typeof message.number === 'number' &&
        Number.isInteger(message.number)
        ? { type: message.type, designId, versionId: message.versionId, number: message.number }
        : null
    default:
      return null
  }
}
