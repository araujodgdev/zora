// Pure helpers for `scripts/desktop-package.ts` (unit-tested in
// `src/lib/desktop-package.test.ts`): target-triple parsing, sidecar names,
// CLI arguments and the commands the packager runs.

export type PackageProfile = 'debug' | 'release'

export type PackageOptions = {
  /** Package `debug` profile binaries (fast local installer test). */
  debug: boolean
  /** Do not compile the editors; only copy already-built binaries. */
  skipEditors: boolean
  /** Stage the sidecars into `desktop/src-tauri/binaries/` without `tauri build`. */
  stageOnly: boolean
  /** Print what would happen and exit without touching anything. */
  dryRun: boolean
  /** Zora Studio repo (default `../zora-vector`). */
  studioDir: string | null
  /** Zora LightCraft repo (default `../zora-lightcraft`). */
  lightcraftDir: string | null
  /** Pass-through for `tauri build --bundles` (e.g. `nsis`, `nsis,msi`). */
  bundles: string | null
  help: boolean
}

export type DesktopSidecar = {
  /** `externalBin` name, also the installed executable name. */
  sidecar: 'zora-studio' | 'zora-lightcraft'
  label: string
  /** Cargo package and binary built in the editor repo. */
  cargoPackage: 'vectorcraft' | 'lightcraft'
  /** Default editor repo, relative to the Zora project root. */
  defaultDir: string
}

/** Built in this order, strictly one at a time. */
export const DESKTOP_SIDECARS: ReadonlyArray<DesktopSidecar> = [
  {
    sidecar: 'zora-studio',
    label: 'Zora Studio',
    cargoPackage: 'vectorcraft',
    defaultDir: '../zora-vector',
  },
  {
    sidecar: 'zora-lightcraft',
    label: 'Zora LightCraft',
    cargoPackage: 'lightcraft',
    defaultDir: '../zora-lightcraft',
  },
]

/**
 * Environment for every Rust build the packager starts: no incremental cache
 * and two jobs keep a release build within ~15 GB RAM on Windows.
 */
export const LOW_MEMORY_CARGO_ENV = {
  CARGO_INCREMENTAL: '0',
  CARGO_BUILD_JOBS: '2',
} as const

export const PACKAGE_USAGE = `Usage: node scripts/desktop-package.ts [options]

  --debug                 package debug-profile binaries instead of release
  --skip-editors          do not compile vectorcraft/lightcraft; copy existing builds
  --stage-only            stage sidecars into desktop/src-tauri/binaries/ only
  --dry-run               print the plan and exit without changing anything
  --studio-dir <path>     Zora Studio repo (default ../zora-vector)
  --lightcraft-dir <path> Zora LightCraft repo (default ../zora-lightcraft)
  --bundles <list>        pass-through to \`tauri build --bundles\` (e.g. nsis)
  --help                  show this help`

/** The `host:` line of `rustc -vV`. */
export function parseHostTriple(rustcVersionOutput: string): string {
  const match = /^host:\s*(\S+)\s*$/m.exec(rustcVersionOutput)
  if (!match?.[1]) {
    throw new Error('Could not find the "host:" line in `rustc -vV` output.')
  }
  return match[1]
}

export function isWindowsTriple(triple: string): boolean {
  return triple.includes('-windows-')
}

/** `base` with the platform's executable extension. */
export function executableName(base: string, triple: string): string {
  return isWindowsTriple(triple) ? `${base}.exe` : base
}

/** File name Tauri expects for an `externalBin` entry: `<name>-<triple>[.exe]`. */
export function sidecarFileName(sidecar: string, triple: string): string {
  return executableName(`${sidecar}-${triple}`, triple)
}

export function packageProfile(options: Pick<PackageOptions, 'debug'>): PackageProfile {
  return options.debug ? 'debug' : 'release'
}

export function parsePackageArgs(argv: ReadonlyArray<string>): PackageOptions {
  const options: PackageOptions = {
    debug: false,
    skipEditors: false,
    stageOnly: false,
    dryRun: false,
    studioDir: null,
    lightcraftDir: null,
    bundles: null,
    help: false,
  }
  const valueOf = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      throw new Error(`${flag} needs a value.`)
    }
    return value
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    const [flag, inline] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined]
    const takeValue = (): string => {
      if (inline !== undefined) {
        if (inline.trim() === '') throw new Error(`${flag} needs a value.`)
        return inline
      }
      const value = valueOf(flag, index)
      index++
      return value
    }
    switch (flag) {
      case '--debug':
        options.debug = true
        break
      case '--skip-editors':
        options.skipEditors = true
        break
      case '--stage-only':
        options.stageOnly = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--studio-dir':
        options.studioDir = takeValue()
        break
      case '--lightcraft-dir':
        options.lightcraftDir = takeValue()
        break
      case '--bundles':
        options.bundles = takeValue()
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

/** `cargo` arguments that build one editor binary. */
export function editorBuildArgs(cargoPackage: string, profile: PackageProfile): string[] {
  const args = ['build', '-p', cargoPackage, '--bin', cargoPackage]
  if (profile === 'release') args.push('--release')
  return args
}

/** `tauri` CLI arguments that produce the single installer. */
export function tauriBuildArgs(
  bundleConfigPath: string,
  options: Pick<PackageOptions, 'debug' | 'bundles'>,
): string[] {
  const args = ['build', '--config', bundleConfigPath]
  if (options.debug) args.push('--debug')
  if (options.bundles) args.push('--bundles', options.bundles)
  return args
}

/** Installer files among the paths under `target/<profile>/bundle/`. */
export function isInstallerFile(path: string): boolean {
  return /\.(exe|msi|dmg|appimage|deb|rpm)$/i.test(path)
}

export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
