/**
 * Zora Studio's font library: the curated families, the manifest format
 * served at `/studio-fonts/manifest.json`, and the pure parts of
 * `pnpm fonts:sync` (reading Google Fonts' `METADATA.pb`, naming files,
 * building the manifest). Client-safe and dependency-free (the sync script
 * imports it with Node). Contract: docs/STUDIO-PLAN.md, "Font library".
 */

/** google/fonts, pinned: the sync always downloads this exact tree. */
export const GOOGLE_FONTS_REPO = 'google/fonts'
export const GOOGLE_FONTS_COMMIT = '7af0d90b4d532ffa4b041937b560c6df4e7b1e95'

/**
 * The curated families (docs/STUDIO-PLAN.md). Only families under `ofl/` in
 * google/fonts are synced; others (a different licence) are skipped and
 * reported by the script. At the pinned commit, Permanent Marker and Satisfy
 * are Apache-2.0 (`apache/`), so they are skipped.
 */
export const STUDIO_FONT_FAMILIES = [
  'Inter',
  'Figtree',
  'Fraunces',
  'Poppins',
  'Montserrat',
  'Roboto',
  'Open Sans',
  'Lato',
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Playfair Display',
  'DM Sans',
  'DM Serif Display',
  'Space Grotesk',
  'Sora',
  'Outfit',
  'Manrope',
  'Syne',
  'Work Sans',
  'Rubik',
  'Nunito',
  'Raleway',
  'Merriweather',
  'Lora',
  'Abril Fatface',
  'Lobster',
  'Pacifico',
  'Caveat',
  'Permanent Marker',
  'Dancing Script',
  'Satisfy',
  'Righteous',
  'Bangers',
  'Shrikhand',
  'Bricolage Grotesque',
  'Instrument Serif',
  'Unbounded',
  'Big Shoulders Display',
] as const

// --- manifest ---------------------------------------------------------------------

export type FontAxis = { tag: string; min: number; max: number }

export type FontManifestFile = {
  /** Subfamily name, e.g. "Regular", "Bold Italic". */
  style: string
  /** CSS weight (for a variable file: its default instance). */
  weight: number
  italic: boolean
  /** Same-origin URL, e.g. `/studio-fonts/inter/Inter-opsz-wght-<sha16>.ttf`. */
  url: string
  /** Hex SHA-256 of the file. */
  sha256: string
  size: number
  /** Whether the file is a variable font (its axes are the family's `axes`). */
  variable: boolean
}

export type FontManifestFamily = {
  family: string
  /** Google Fonts category: SANS_SERIF, SERIF, DISPLAY, HANDWRITING, MONOSPACE. */
  category: string
  license: 'OFL-1.1'
  /** The family's OFL.txt, served beside its fonts. */
  licenseUrl: string
  /** Variable axes, empty for static families. */
  axes: Array<FontAxis>
  files: Array<FontManifestFile>
}

export type FontManifest = {
  /** Changes whenever any file changes (a hash of the files' hashes). */
  version: string
  source: { repo: string; commit: string }
  families: Array<FontManifestFamily>
}

// --- METADATA.pb (protobuf text format) -----------------------------------------------

/** A parsed text-format message: every field is a list (fields may repeat). */
export type TextProtoMessage = { [field: string]: Array<string | number | TextProtoMessage> }

/**
 * Parses the protobuf text format Google Fonts uses for `METADATA.pb`
 * (`name: "Inter"`, `weight: 400`, `fonts { ... }`, `# comments`). Enough of
 * the format for those files; throws on anything it does not understand.
 */
export function parseTextProto(text: string): TextProtoMessage {
  const tokens = tokenize(text)
  let index = 0

  function parseMessage(closing: boolean): TextProtoMessage {
    const message: TextProtoMessage = {}
    while (index < tokens.length) {
      const token = tokens[index]!
      if (token.kind === 'punct' && token.value === '}') {
        if (!closing) throw new Error('Unexpected "}" in text proto')
        index += 1
        return message
      }
      if (token.kind !== 'ident') throw new Error(`Expected a field name, got ${token.value}`)
      index += 1
      const field = String(token.value)
      let next = tokens[index]
      if (next?.kind === 'punct' && next.value === ':') {
        index += 1
        next = tokens[index]
      }
      let value: string | number | TextProtoMessage
      if (next?.kind === 'punct' && next.value === '{') {
        index += 1
        value = parseMessage(true)
      } else if (next && (next.kind === 'string' || next.kind === 'number' || next.kind === 'ident')) {
        index += 1
        value = next.value
        // Adjacent string literals concatenate.
        while (next.kind === 'string' && tokens[index]?.kind === 'string') {
          value = `${value}${tokens[index]!.value}`
          index += 1
        }
      } else {
        throw new Error(`Expected a value for ${field}`)
      }
      ;(message[field] ??= []).push(value)
    }
    if (closing) throw new Error('Missing "}" in text proto')
    return message
  }

  return parseMessage(false)
}

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'punct'; value: string }

function tokenize(text: string): Array<Token> {
  const tokens: Array<Token> = []
  let i = 0
  while (i < text.length) {
    const char = text[i]!
    if (/\s/.test(char)) {
      i += 1
    } else if (char === '#') {
      while (i < text.length && text[i] !== '\n') i += 1
    } else if (char === '{' || char === '}' || char === ':') {
      tokens.push({ kind: 'punct', value: char })
      i += 1
    } else if (char === '"' || char === "'") {
      let value = ''
      i += 1
      while (i < text.length && text[i] !== char) {
        if (text[i] === '\\') {
          const escaped = text[i + 1]
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : (escaped ?? '')
          i += 2
        } else {
          value += text[i]
          i += 1
        }
      }
      if (i >= text.length) throw new Error('Unterminated string in text proto')
      i += 1
      tokens.push({ kind: 'string', value })
    } else {
      const match = /^[A-Za-z0-9_.+-]+/.exec(text.slice(i))
      if (!match) throw new Error(`Unexpected character ${JSON.stringify(char)} in text proto`)
      const raw = match[0]
      const number = Number(raw)
      tokens.push(
        /^[-+]?(\d|\.\d)/.test(raw) && Number.isFinite(number)
          ? { kind: 'number', value: number }
          : { kind: 'ident', value: raw },
      )
      i += raw.length
    }
  }
  return tokens
}

function scalar(message: TextProtoMessage, field: string): string | number | undefined {
  const value = message[field]?.[0]
  return typeof value === 'object' ? undefined : value
}

function messages(message: TextProtoMessage, field: string): Array<TextProtoMessage> {
  return (message[field] ?? []).filter(
    (value): value is TextProtoMessage => typeof value === 'object',
  )
}

/** One font file of a family, as `METADATA.pb` describes it. */
export type FamilyFontEntry = {
  filename: string
  weight: number
  italic: boolean
  /** e.g. "Inter Bold Italic". */
  fullName: string
}

/** What the sync needs from a family's `METADATA.pb`. */
export type FamilyMetadata = {
  name: string
  /** `OFL`, `APACHE2`, `UFL`. */
  license: string
  category: string
  fonts: Array<FamilyFontEntry>
  axes: Array<FontAxis>
}

export function readFamilyMetadata(text: string): FamilyMetadata {
  const root = parseTextProto(text)
  const name = scalar(root, 'name')
  if (typeof name !== 'string') throw new Error('METADATA.pb has no name')
  const fonts = messages(root, 'fonts').map((font): FamilyFontEntry => {
    const filename = scalar(font, 'filename')
    if (typeof filename !== 'string') throw new Error(`A font of ${name} has no filename`)
    const weight = scalar(font, 'weight')
    return {
      filename,
      weight: typeof weight === 'number' ? weight : 400,
      italic: scalar(font, 'style') === 'italic',
      fullName: String(scalar(font, 'full_name') ?? ''),
    }
  })
  const axes = messages(root, 'axes').map((axis) => ({
    tag: String(scalar(axis, 'tag')),
    min: Number(scalar(axis, 'min_value')),
    max: Number(scalar(axis, 'max_value')),
  }))
  return {
    name,
    license: String(scalar(root, 'license') ?? ''),
    // Older files repeat `category`; the first is the primary one.
    category: String(scalar(root, 'category') ?? 'SANS_SERIF'),
    fonts,
    axes,
  }
}

// --- names ------------------------------------------------------------------------

/** The folder of a family in google/fonts: lowercase letters and digits only. */
export function familyFolder(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A file name carrying the first 16 hex digits of its SHA-256, safe in a URL:
 * `Inter[opsz,wght].ttf` -> `Inter-opsz-wght-<sha16>.ttf`,
 * `OFL.txt` -> `OFL-<sha16>.txt`.
 */
export function hashedFileName(filename: string, sha256: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
  const safeBase = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file'
  const hash = sha256.slice(0, 16).toLowerCase()
  return extension ? `${safeBase}-${hash}.${extension}` : `${safeBase}-${hash}`
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

/**
 * The subfamily name: the full name without the family (`Lato Bold Italic`
 * -> `Bold Italic`), else derived from weight and italic.
 */
export function fontStyleName(family: string, font: FamilyFontEntry): string {
  if (font.fullName.startsWith(`${family} `)) {
    const rest = font.fullName.slice(family.length + 1).trim()
    if (rest) return rest
  }
  const weight = WEIGHT_NAMES[font.weight] ?? String(font.weight)
  if (!font.italic) return weight
  return weight === 'Regular' ? 'Italic' : `${weight} Italic`
}

// --- building the manifest ------------------------------------------------------------

/** A downloaded file: its hash and size (the bytes stay with the script). */
export type DownloadedFile = { sha256: string; size: number }

/** One family ready for the manifest: metadata and its downloaded files. */
export type SyncedFamily = {
  metadata: FamilyMetadata
  folder: string
  /** By original file name (each `fonts[].filename`, plus `OFL.txt`). */
  files: Record<string, DownloadedFile>
}

/** The object key (under `studio-fonts/`) and URL path of a family file. */
export function familyFilePath(folder: string, filename: string, file: DownloadedFile): string {
  return `${folder}/${hashedFileName(filename, file.sha256)}`
}

/**
 * The manifest entry of a family. `urlPrefix` is where the fonts bundle is
 * served (`/studio-fonts/`).
 */
export function buildFamilyEntry(family: SyncedFamily, urlPrefix: string): FontManifestFamily {
  const { metadata, folder, files } = family
  const license = files['OFL.txt']
  if (!license) throw new Error(`${metadata.name}: OFL.txt is missing`)
  const entries = metadata.fonts.map((font): FontManifestFile => {
    const file = files[font.filename]
    if (!file) throw new Error(`${metadata.name}: ${font.filename} was not downloaded`)
    // Google Fonts names variable files by their axes in brackets.
    const variable = font.filename.includes('[')
    return {
      // A variable file covers every weight; its full name in METADATA.pb
      // sometimes names the default instance ("Thin"), which would mislead.
      style: variable ? (font.italic ? 'Italic' : 'Regular') : fontStyleName(metadata.name, font),
      weight: font.weight,
      italic: font.italic,
      url: `${urlPrefix}${familyFilePath(folder, font.filename, file)}`,
      sha256: file.sha256,
      size: file.size,
      variable,
    }
  })
  entries.sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight)
  return {
    family: metadata.name,
    category: metadata.category,
    license: 'OFL-1.1',
    licenseUrl: `${urlPrefix}${familyFilePath(folder, 'OFL.txt', license)}`,
    axes: metadata.axes,
    files: entries,
  }
}

/**
 * The whole manifest. `hashHex` hashes a string to hex (SHA-256 in the
 * script); the version is its first 16 digits over every file hash, so it
 * changes exactly when a file does.
 */
export function buildFontManifest(
  families: Array<SyncedFamily>,
  options: { urlPrefix: string; commit: string; hashHex: (text: string) => string },
): FontManifest {
  const entries = families
    .map((family) => buildFamilyEntry(family, options.urlPrefix))
    .sort((a, b) => a.family.localeCompare(b.family, 'en'))
  const fingerprint = entries
    .flatMap((family) => [family.licenseUrl, ...family.files.map((file) => file.url)])
    .join('\n')
  return {
    version: options.hashHex(fingerprint).slice(0, 16),
    source: { repo: GOOGLE_FONTS_REPO, commit: options.commit },
    families: entries,
  }
}

/** Whether a family's metadata says OFL (the only licence the library takes). */
export function isOflFamily(metadata: FamilyMetadata): boolean {
  return metadata.license === 'OFL'
}
