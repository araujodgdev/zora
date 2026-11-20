// pnpm lightcraft:publish [--remote] [--dir <path>]
//
// Uploads LightCraft's web build (`cargo xtask web` in ../zora-lightcraft,
// which writes `target/web-site/`) to the `MEDIA` R2 bucket under
// `lightcraft/`, where `/lightcraft/*` serves it (see
// `src/lib/studio-hosting.ts`). Every file of the folder is uploaded except
// dot-files and the `.gz`/`.br` precompressed copies (the route streams the
// raw file and Cloudflare compresses it on the way out), `index.html` last,
// and `lightcraft/` objects of older builds are deleted afterwards. The file
// names are the same in every LightCraft version, so all are `no-cache`.
//
//   --dir <path>  the build folder (default: ../zora-lightcraft/target/web-site)
//   --remote      the production bucket instead of the local simulation
//                 (`.wrangler/state`, read by `pnpm dev`). Owner's step: needs
//                 `wrangler login`; agents never run it.
//
// Stop `pnpm dev` first, or restart it afterwards: it may keep serving what
// it had already read.
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LIGHTCRAFT_BUNDLE } from '../src/lib/studio-hosting.ts'
import { collectBundleFiles, formatBytes, publishFiles } from './lib/r2-store.ts'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const dirFlag = args.indexOf('--dir')
const projectRoot = resolve(import.meta.dirname, '..')
const buildDir = resolve(
  dirFlag >= 0 && args[dirFlag + 1]
    ? args[dirFlag + 1]!
    : join(projectRoot, '../zora-lightcraft/target/web-site'),
)

for (const required of ['index.html', 'lightcraft_web.js', 'lightcraft_web_bg.wasm']) {
  if (!existsSync(join(buildDir, required))) {
    console.error(
      `No LightCraft build in ${buildDir} (${required} missing). Build it with \`cargo xtask web\` in ../zora-lightcraft, or pass --dir.`,
    )
    process.exit(1)
  }
}

// Only names the route will serve; anything else would be dead weight.
const files = collectBundleFiles(LIGHTCRAFT_BUNDLE, buildDir)

const total = files.reduce((sum, file) => sum + statSync(file.source).size, 0)
console.log(
  `Publishing ${files.length} files (${formatBytes(total)}) from ${buildDir} to ${remote ? 'REMOTE' : 'local'} R2 ${LIGHTCRAFT_BUNDLE.keyPrefix}`,
)
const result = await publishFiles({
  prefix: LIGHTCRAFT_BUNDLE.keyPrefix,
  files,
  last: ['index.html'],
  remote,
})
console.log(
  `Done: ${result.uploaded} files, ${formatBytes(result.bytes)}; ${result.deleted.length} stale objects deleted.`,
)
