// pnpm fonts:sync [--remote]
//
// Builds Zora Studio's font library and uploads it to the `MEDIA` R2 bucket
// under `studio-fonts/`, where `/studio-fonts/*` serves it.
//
// 1. For each family in STUDIO_FONT_FAMILIES (`src/lib/studio-fonts.ts`), reads
//    `ofl/<folder>/METADATA.pb` from google/fonts at the pinned commit
//    (GOOGLE_FONTS_COMMIT). Families not under `ofl/` (another licence) are
//    skipped and reported.
// 2. Downloads the font files METADATA.pb lists (static TTFs where the family
//    has them, else its variable TTFs; Google Fonts keeps one or the other)
//    and the family's OFL.txt, into `.cache/fonts/<commit>/` (git-ignored;
//    later runs reuse it).
// 3. Uploads them with hashed names (`<folder>/<name>-<sha16>.<ext>`) and
//    `manifest.json` last, then deletes `studio-fonts/` objects no longer
//    listed.
//
//   --remote  the production bucket instead of the local simulation. Owner's
//             step: needs `wrangler login`; agents never run it.
//
// To change the library, edit the family list or bump the commit (resolve
// the current one with `git ls-remote https://github.com/google/fonts main`).
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  GOOGLE_FONTS_COMMIT,
  GOOGLE_FONTS_REPO,
  STUDIO_FONT_FAMILIES,
  buildFontManifest,
  familyFilePath,
  familyFolder,
  isOflFamily,
  readFamilyMetadata,
} from '../src/lib/studio-fonts.ts'
import type { DownloadedFile, SyncedFamily } from '../src/lib/studio-fonts.ts'
import {
  STUDIO_FONTS_BUNDLE,
  STUDIO_FONTS_MANIFEST,
  bundleCacheControl,
  bundleContentType,
} from '../src/lib/studio-hosting.ts'
import { formatBytes, publishFiles } from './lib/r2-store.ts'
import type { UploadFile } from './lib/r2-store.ts'

const remote = process.argv.slice(2).includes('--remote')
const projectRoot = resolve(import.meta.dirname, '..')
const cacheDir = join(projectRoot, '.cache/fonts', GOOGLE_FONTS_COMMIT)
const rawBase = `https://raw.githubusercontent.com/${GOOGLE_FONTS_REPO}/${GOOGLE_FONTS_COMMIT}`

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A repo file, from the cache or downloaded into it. `null` on 404. */
async function fetchRepoFile(path: string): Promise<{ bytes: Buffer; local: string } | null> {
  const local = join(cacheDir, path)
  if (existsSync(local)) return { bytes: await readFile(local), local }
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${rawBase}/${path.split('/').map(encodeURIComponent).join('/')}`)
    if (response.status === 404) return null
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      await mkdir(dirname(local), { recursive: true })
      await writeFile(local, bytes)
      return { bytes, local }
    }
    if (attempt >= 3) throw new Error(`GET ${path}: HTTP ${response.status}`)
    await new Promise((done) => setTimeout(done, 1000 * attempt))
  }
}

/** Where a missing OFL family lives instead, for the report. */
async function otherLicenceFolder(folder: string): Promise<string | null> {
  for (const licence of ['apache', 'ufl']) {
    const response = await fetch(`${rawBase}/${licence}/${folder}/METADATA.pb`, { method: 'HEAD' })
    if (response.ok) return `${licence}/${folder}`
  }
  return null
}

const synced: Array<SyncedFamily> = []
const uploads: Array<UploadFile> = []
const skipped: Array<string> = []

console.log(`Font library from ${GOOGLE_FONTS_REPO}@${GOOGLE_FONTS_COMMIT.slice(0, 12)} (cache ${cacheDir})`)
for (const family of STUDIO_FONT_FAMILIES) {
  const folder = familyFolder(family)
  const metadataFile = await fetchRepoFile(`ofl/${folder}/METADATA.pb`)
  if (!metadataFile) {
    const elsewhere = await otherLicenceFolder(folder)
    skipped.push(`${family}: not in ofl/ (${elsewhere ? `found in ${elsewhere}` : 'not found'})`)
    continue
  }
  const metadata = readFamilyMetadata(metadataFile.bytes.toString('utf8'))
  if (!isOflFamily(metadata)) {
    skipped.push(`${family}: METADATA.pb says license ${metadata.license}`)
    continue
  }
  const names = [...new Set([...metadata.fonts.map((font) => font.filename), 'OFL.txt'])]
  const files: Record<string, DownloadedFile> = {}
  const downloads = await Promise.all(names.map((name) => fetchRepoFile(`ofl/${folder}/${name}`)))
  names.forEach((name, index) => {
    const download = downloads[index]
    if (!download) throw new Error(`${family}: ofl/${folder}/${name} is missing at the pinned commit`)
    const file = { sha256: sha256(download.bytes), size: download.bytes.byteLength }
    files[name] = file
    const path = familyFilePath(folder, name, file)
    uploads.push({
      path,
      source: download.local,
      contentType: bundleContentType(path),
      cacheControl: bundleCacheControl(path),
    })
  })
  synced.push({ metadata, folder, files })
  const bytes = Object.values(files).reduce((sum, file) => sum + file.size, 0)
  console.log(`  ${metadata.name}: ${metadata.fonts.length} fonts, ${formatBytes(bytes)}`)
}

const manifest = buildFontManifest(synced, {
  urlPrefix: STUDIO_FONTS_BUNDLE.urlPrefix,
  commit: GOOGLE_FONTS_COMMIT,
  hashHex: sha256,
})
const manifestPath = join(cacheDir, STUDIO_FONTS_MANIFEST)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
uploads.push({
  path: STUDIO_FONTS_MANIFEST,
  source: manifestPath,
  contentType: bundleContentType(STUDIO_FONTS_MANIFEST),
  cacheControl: bundleCacheControl(STUDIO_FONTS_MANIFEST),
})

console.log(
  `Manifest ${manifest.version}: ${manifest.families.length} families, ${uploads.length - 1} files.`,
)
if (skipped.length > 0) console.log(`Skipped:\n${skipped.map((line) => `  ${line}`).join('\n')}`)
console.log(`Uploading to ${remote ? 'REMOTE' : 'local'} R2 ${STUDIO_FONTS_BUNDLE.keyPrefix}`)
const result = await publishFiles({
  prefix: STUDIO_FONTS_BUNDLE.keyPrefix,
  files: uploads,
  last: [STUDIO_FONTS_MANIFEST],
  remote,
  log: () => {},
})
console.log(
  `Done: ${result.uploaded} files, ${formatBytes(result.bytes)}; ${result.deleted.length} stale objects deleted.`,
)
