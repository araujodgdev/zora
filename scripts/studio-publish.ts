// pnpm studio:publish [--remote] [--dir <path>]
//
// Uploads Zora Studio's web build (Trunk's `dist/web`) to the `MEDIA` R2
// bucket under `studio/`, where `/studio/*` serves it (see
// `src/lib/studio-hosting.ts`). Every file of the folder is uploaded
// (dot-files such as `.trunk-lock` are skipped), `index.html` last, and
// `studio/` objects of older builds are deleted afterwards.
//
//   --dir <path>  the build folder (default: ../zora-vector/dist/web)
//   --remote      the production bucket instead of the local simulation
//                 (`.wrangler/state`, read by `pnpm dev`). Owner's step: needs
//                 `wrangler login`; agents never run it.
//
// Stop `pnpm dev` first, or restart it afterwards: it may keep serving what
// it had already read.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import {
  STUDIO_BUNDLE,
  bundleCacheControl,
  bundleContentType,
  resolveBundlePath,
} from '../src/lib/studio-hosting.ts'
import { formatBytes, publishFiles } from './lib/r2-store.ts'
import type { UploadFile } from './lib/r2-store.ts'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const dirFlag = args.indexOf('--dir')
const projectRoot = resolve(import.meta.dirname, '..')
const buildDir = resolve(
  dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1]! : join(projectRoot, '../zora-vector/dist/web'),
)

if (!existsSync(join(buildDir, 'index.html'))) {
  console.error(`No Studio build in ${buildDir} (index.html missing). Build it with Trunk, or pass --dir.`)
  process.exit(1)
}

function walk(dir: string): Array<string> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : []
  })
}

const files: Array<UploadFile> = walk(buildDir).map((source) => {
  const path = relative(buildDir, source).split(sep).join('/')
  // Only names the route will serve; anything else would be dead weight.
  if (resolveBundlePath(STUDIO_BUNDLE, path.split('/').map(encodeURIComponent).join('/')) !== path) {
    throw new Error(`${path}: the /studio/ route would not serve this name`)
  }
  return {
    path,
    source,
    contentType: bundleContentType(path),
    cacheControl: bundleCacheControl(path),
  }
})

const total = files.reduce((sum, file) => sum + statSync(file.source).size, 0)
console.log(
  `Publishing ${files.length} files (${formatBytes(total)}) from ${buildDir} to ${remote ? 'REMOTE' : 'local'} R2 ${STUDIO_BUNDLE.keyPrefix}`,
)
const result = await publishFiles({
  prefix: STUDIO_BUNDLE.keyPrefix,
  files,
  last: ['index.html'],
  remote,
})
console.log(
  `Done: ${result.uploaded} files, ${formatBytes(result.bytes)}; ${result.deleted.length} stale objects deleted.`,
)
