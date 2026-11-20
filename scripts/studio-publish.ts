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
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { STUDIO_BUNDLE } from '../src/lib/studio-hosting.ts'
import { collectBundleFiles, formatBytes, publishFiles } from './lib/r2-store.ts'

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

// Only names the route will serve; anything else would be dead weight.
const files = collectBundleFiles(STUDIO_BUNDLE, buildDir)

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
