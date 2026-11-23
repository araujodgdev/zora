import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SIDECARS,
  editorBuildArgs,
  executableName,
  isInstallerFile,
  packageProfile,
  parseHostTriple,
  parsePackageArgs,
  sidecarFileName,
  tauriBuildArgs,
} from '../../scripts/lib/desktop-package.ts'

const RUSTC_VV = `rustc 1.99.1 (58cf8f9c3 2026-10-13)
binary: rustc
commit-hash: 58cf8f9c35b355199727627d07ae34a4e2846d67
commit-date: 2026-10-13
host: x86_64-pc-windows-msvc
release: 1.99.1
LLVM version: 23.1.1
`

describe('parseHostTriple', () => {
  it('reads the host line of rustc -vV', () => {
    expect(parseHostTriple(RUSTC_VV)).toBe('x86_64-pc-windows-msvc')
    expect(parseHostTriple(RUSTC_VV.replaceAll('\n', '\r\n'))).toBe('x86_64-pc-windows-msvc')
    expect(parseHostTriple('host: aarch64-apple-darwin\n')).toBe('aarch64-apple-darwin')
  })

  it('throws without a host line', () => {
    expect(() => parseHostTriple('rustc 1.99.1\nrelease: 1.99.1\n')).toThrow(/host/)
  })
})

describe('sidecar names', () => {
  it('adds .exe only on Windows', () => {
    expect(executableName('vectorcraft', 'x86_64-pc-windows-msvc')).toBe('vectorcraft.exe')
    expect(executableName('vectorcraft', 'x86_64-unknown-linux-gnu')).toBe('vectorcraft')
  })

  it('builds the externalBin file names Tauri expects', () => {
    expect(sidecarFileName('zora-studio', 'x86_64-pc-windows-msvc')).toBe(
      'zora-studio-x86_64-pc-windows-msvc.exe',
    )
    expect(sidecarFileName('zora-lightcraft', 'aarch64-apple-darwin')).toBe(
      'zora-lightcraft-aarch64-apple-darwin',
    )
  })

  it('lists Studio before LightCraft (built sequentially in that order)', () => {
    expect(DESKTOP_SIDECARS.map((sidecar) => sidecar.cargoPackage)).toEqual([
      'vectorcraft',
      'lightcraft',
    ])
  })
})

describe('parsePackageArgs', () => {
  it('defaults to a full release package', () => {
    const options = parsePackageArgs([])
    expect(options).toMatchObject({
      debug: false,
      skipEditors: false,
      stageOnly: false,
      dryRun: false,
      studioDir: null,
      lightcraftDir: null,
      bundles: null,
    })
    expect(packageProfile(options)).toBe('release')
  })

  it('parses flags and values (separate and inline)', () => {
    const options = parsePackageArgs([
      '--debug',
      '--skip-editors',
      '--stage-only',
      '--dry-run',
      '--studio-dir',
      '../vec',
      '--lightcraft-dir=../lc',
      '--bundles',
      'nsis',
    ])
    expect(options).toMatchObject({
      debug: true,
      skipEditors: true,
      stageOnly: true,
      dryRun: true,
      studioDir: '../vec',
      lightcraftDir: '../lc',
      bundles: 'nsis',
    })
    expect(packageProfile(options)).toBe('debug')
  })

  it('rejects unknown options and missing values', () => {
    expect(() => parsePackageArgs(['--release'])).toThrow(/Unknown option/)
    expect(() => parsePackageArgs(['--studio-dir'])).toThrow(/needs a value/)
    expect(() => parsePackageArgs(['--bundles', '--debug'])).toThrow(/needs a value/)
    expect(() => parsePackageArgs(['--bundles='])).toThrow(/needs a value/)
  })
})

describe('commands', () => {
  it('builds one editor binary per cargo call', () => {
    expect(editorBuildArgs('vectorcraft', 'release')).toEqual([
      'build',
      '-p',
      'vectorcraft',
      '--bin',
      'vectorcraft',
      '--release',
    ])
    expect(editorBuildArgs('lightcraft', 'debug')).toEqual([
      'build',
      '-p',
      'lightcraft',
      '--bin',
      'lightcraft',
    ])
  })

  it('passes the bundle overlay, --debug and --bundles to tauri build', () => {
    expect(tauriBuildArgs('conf.json', { debug: false, bundles: null })).toEqual([
      'build',
      '--config',
      'conf.json',
    ])
    expect(tauriBuildArgs('conf.json', { debug: true, bundles: 'nsis' })).toEqual([
      'build',
      '--config',
      'conf.json',
      '--debug',
      '--bundles',
      'nsis',
    ])
  })

  it('recognizes installer files', () => {
    expect(isInstallerFile('bundle/nsis/Zora_0.1.0_x64-setup.exe')).toBe(true)
    expect(isInstallerFile('bundle/msi/Zora_0.1.0_x64_en-US.msi')).toBe(true)
    expect(isInstallerFile('bundle/nsis/installer.nsi')).toBe(false)
  })
})
