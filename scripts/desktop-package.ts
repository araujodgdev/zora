// pnpm desktop:package [--debug] [--skip-editors] [--stage-only] [--dry-run]
//                      [--studio-dir <path>] [--lightcraft-dir <path>] [--bundles <list>]
//
// Builds the single Zora Desktop installer: the Tauri v2 shell plus the two
// native editors as `externalBin` sidecars (see docs/DESKTOP-PLAN.md).
//
//   1. Reads the host target triple from `rustc -vV`.
//   2. Unless --skip-editors: builds `vectorcraft` (../zora-vector), THEN
//      `lightcraft` (../zora-lightcraft), strictly one Rust build at a time,
//      with CARGO_INCREMENTAL=0 and CARGO_BUILD_JOBS=2 (~15 GB RAM budget).
//   3. Stages them as desktop/src-tauri/binaries/zora-studio-<triple>[.exe]
//      and zora-lightcraft-<triple>[.exe].
//   4. Unless --stage-only: runs the local @tauri-apps/cli
//      `tauri build --config src-tauri/tauri.bundle.conf.json` in desktop/
//      (the overlay adds `externalBin`, so plain `cargo check`/`cargo test`
//      never need the staged binaries).
//   5. Prints the installers under desktop/src-tauri/target/<profile>/bundle/.
//
// --debug packages debug-profile binaries (fast local installer test);
// --dry-run prints the resolved plan and exits without changing anything.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DESKTOP_SIDECARS,
  LOW_MEMORY_CARGO_ENV,
  PACKAGE_USAGE,
  editorBuildArgs,
  executableName,
  formatMiB,
  isInstallerFile,
  packageProfile,
  parseHostTriple,
  parsePackageArgs,
  sidecarFileName,
  tauriBuildArgs,
} from './lib/desktop-package.ts'
import type { PackageOptions } from './lib/desktop-package.ts'

let options: PackageOptions
try {
  options = parsePackageArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(PACKAGE_USAGE)
  process.exit(1)
}
if (options.help) {
  console.log(PACKAGE_USAGE)
  process.exit(0)
}

const projectRoot = resolve(import.meta.dirname, '..')
const desktopDir = join(projectRoot, 'desktop')
const tauriDir = join(desktopDir, 'src-tauri')
const binariesDir = join(tauriDir, 'binaries')
const bundleConfig = join(tauriDir, 'tauri.bundle.conf.json')
const tauriCli = join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const profile = packageProfile(options)
const buildEnv = { ...process.env, ...LOW_MEMORY_CARGO_ENV }

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n> ${[command, ...args].join(' ')}  (in ${cwd})`)
  // Direct executables only (no shell, no pnpm.cmd shims).
  const result = spawnSync(command, args, { cwd, env: buildEnv, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}.`)
    process.exit(result.status ?? 1)
  }
}

function fileSize(path: string): number | null {
  return existsSync(path) && statSync(path).isFile() ? statSync(path).size : null
}

// 1. Host target triple.
const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
if (rustc.error || rustc.status !== 0) {
  console.error('Could not run `rustc -vV`. Is the Rust toolchain installed and on PATH?')
  process.exit(1)
}
const triple = parseHostTriple(rustc.stdout)

const plan = DESKTOP_SIDECARS.map((sidecar) => {
  const override = sidecar.sidecar === 'zora-studio' ? options.studioDir : options.lightcraftDir
  const repoDir = resolve(override ?? join(projectRoot, sidecar.defaultDir))
  return {
    ...sidecar,
    repoDir,
    source: join(repoDir, 'target', profile, executableName(sidecar.cargoPackage, triple)),
    destination: join(binariesDir, sidecarFileName(sidecar.sidecar, triple)),
    buildArgs: editorBuildArgs(sidecar.cargoPackage, profile),
  }
})
const tauriArgs = [tauriCli, ...tauriBuildArgs(bundleConfig, options)]
const bundleDir = join(tauriDir, 'target', profile, 'bundle')

console.log(`Zora Desktop packager`)
console.log(`  target triple : ${triple}`)
console.log(`  profile       : ${profile}`)
console.log(`  bundle config : ${bundleConfig}`)

if (options.dryRun) {
  console.log('\nDry run: nothing is built, copied or removed.')
  for (const step of plan) {
    const size = fileSize(step.source)
    console.log(`\n[${step.label}]`)
    console.log(`  repo        : ${step.repoDir}${existsSync(step.repoDir) ? '' : '  (MISSING)'}`)
    console.log(
      options.skipEditors
        ? `  build       : skipped (--skip-editors)`
        : `  build       : cargo ${step.buildArgs.join(' ')}  (in ${step.repoDir}; CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2)`,
    )
    console.log(
      `  source      : ${step.source}  (${size === null ? (options.skipEditors ? 'MISSING' : 'built by the step above') : `found, ${formatMiB(size)}`})`,
    )
    console.log(`  staged as   : ${step.destination}`)
  }
  console.log(
    options.stageOnly
      ? '\nTauri build: skipped (--stage-only)'
      : `\nTauri build: ${process.execPath} ${tauriArgs.join(' ')}  (in ${desktopDir})`,
  )
  if (!existsSync(tauriCli)) console.log('  (local @tauri-apps/cli is NOT installed: run pnpm install)')
  console.log(`Installers   : ${bundleDir}`)
  const missing = options.skipEditors ? plan.filter((step) => fileSize(step.source) === null) : []
  if (missing.length > 0) {
    console.log(
      `\nWarning: ${missing.map((step) => step.label).join(' and ')} not built for the ${profile} profile yet.`,
    )
  }
  process.exit(0)
}

// 2. Build the editors, strictly one at a time.
if (!options.skipEditors) {
  for (const step of plan) {
    if (!existsSync(step.repoDir)) {
      console.error(`${step.label} repo not found: ${step.repoDir}`)
      process.exit(1)
    }
    run('cargo', step.buildArgs, step.repoDir)
  }
}

// 3. Stage the sidecars.
mkdirSync(binariesDir, { recursive: true })
console.log('')
for (const step of plan) {
  if (fileSize(step.source) === null) {
    console.error(
      `${step.label} binary not found: ${step.source}. Build it first or drop --skip-editors.`,
    )
    process.exit(1)
  }
  copyFileSync(step.source, step.destination)
  const size = fileSize(step.destination)
  if (size === null) {
    console.error(`Staging failed: ${step.destination}`)
    process.exit(1)
  }
  console.log(`Staged ${step.label}: ${step.destination} (${formatMiB(size)})`)
}

if (options.stageOnly) {
  console.log('\n--stage-only: skipping tauri build.')
  process.exit(0)
}

// 4. The single installer.
if (!existsSync(tauriCli)) {
  console.error(`Local Tauri CLI not found at ${tauriCli}. Run pnpm install.`)
  process.exit(1)
}
run(process.execPath, tauriArgs, desktopDir)

// 5. Report the installers.
const installers = existsSync(bundleDir)
  ? readdirSync(bundleDir, { recursive: true, encoding: 'utf8' })
      .map((entry) => join(bundleDir, entry))
      .filter((path) => isInstallerFile(path) && statSync(path).isFile())
  : []
if (installers.length === 0) {
  console.log(`\nNo installers found under ${bundleDir}.`)
} else {
  console.log('\nInstallers:')
  for (const path of installers) console.log(`  ${path} (${formatMiB(statSync(path).size)})`)
}
