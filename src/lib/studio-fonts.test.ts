import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_FONTS_COMMIT,
  STUDIO_FONT_FAMILIES,
  buildFontManifest,
  familyFolder,
  fontStyleName,
  hashedFileName,
  isOflFamily,
  parseTextProto,
  readFamilyMetadata,
} from './studio-fonts'
import type { SyncedFamily } from './studio-fonts'
import { STUDIO_BUNDLE, STUDIO_FONTS_BUNDLE, isHashedBundlePath, resolveBundlePath } from './studio-hosting'

// Shortened from ofl/inter/METADATA.pb and ofl/lato/METADATA.pb.
const INTER = `
name: "Inter"
designer: "Rasmus Andersson"
license: "OFL"
category: "SANS_SERIF"
date_added: "2020-01-24"
fonts {
  name: "Inter"
  style: "normal"
  weight: 400
  filename: "Inter[opsz,wght].ttf"
  post_script_name: "Inter-Regular"
  full_name: "Inter Regular"
  copyright: "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)"
}
fonts {
  name: "Inter"
  style: "italic"
  weight: 400
  filename: "Inter-Italic[opsz,wght].ttf"
  full_name: "Inter Italic"
}
subsets: "latin"
subsets: "latin-ext"
axes {
  tag: "opsz"
  min_value: 14.0
  max_value: 32.0
}
axes {
  tag: "wght"
  min_value: 100.0
  max_value: 900.0
}
source {
  repository_url: "https://www.github.com/rsms/inter"
  files {
    source_file: "Inter[opsz,wght].ttf"
    dest_file: "Inter[opsz,wght].ttf"
  }
}
`

const LATO = `
# A comment
name: "Lato"
license: "OFL"
category: "SANS_SERIF"
fonts {
  style: "italic"
  weight: 700
  filename: "Lato-BoldItalic.ttf"
  full_name: "Lato Bold Italic"
}
fonts {
  style: "normal"
  weight: 400
  filename: "Lato-Regular.ttf"
  full_name: "Lato Regular"
}
`

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('parseTextProto', () => {
  it('reads scalars, repeated fields, nested messages and comments', () => {
    const parsed = parseTextProto('a: "x" # note\nb: 4\nb: 5.5\nc { d: "y" e { f: true } }\ng: "con" "cat"')
    expect(parsed).toEqual({
      a: ['x'],
      b: [4, 5.5],
      c: [{ d: ['y'], e: [{ f: ['true'] }] }],
      g: ['concat'],
    })
  })

  it('handles escapes in strings', () => {
    expect(parseTextProto('a: "say \\"hi\\""')).toEqual({ a: ['say "hi"'] })
  })

  it('throws on malformed input', () => {
    expect(() => parseTextProto('a { b: 1')).toThrow()
    expect(() => parseTextProto('}')).toThrow()
    expect(() => parseTextProto('a: "open')).toThrow()
  })
})

describe('readFamilyMetadata', () => {
  it('reads a variable family', () => {
    const metadata = readFamilyMetadata(INTER)
    expect(metadata).toMatchObject({ name: 'Inter', license: 'OFL', category: 'SANS_SERIF' })
    expect(metadata.fonts).toEqual([
      { filename: 'Inter[opsz,wght].ttf', weight: 400, italic: false, fullName: 'Inter Regular' },
      { filename: 'Inter-Italic[opsz,wght].ttf', weight: 400, italic: true, fullName: 'Inter Italic' },
    ])
    expect(metadata.axes).toEqual([
      { tag: 'opsz', min: 14, max: 32 },
      { tag: 'wght', min: 100, max: 900 },
    ])
    expect(isOflFamily(metadata)).toBe(true)
  })

  it('tells OFL from other licences', () => {
    expect(isOflFamily(readFamilyMetadata('name: "Satisfy"\nlicense: "APACHE2"'))).toBe(false)
  })
})

describe('names', () => {
  it('finds the google/fonts folder of a family', () => {
    expect(familyFolder('Open Sans')).toBe('opensans')
    expect(familyFolder('DM Serif Display')).toBe('dmserifdisplay')
    expect(familyFolder('Big Shoulders Display')).toBe('bigshouldersdisplay')
  })

  it('writes URL-safe names with the hash, which the routes cache as immutable', () => {
    const hash = sha('x')
    const name = hashedFileName('Inter-Italic[opsz,wght].ttf', hash)
    expect(name).toBe(`Inter-Italic-opsz-wght-${hash.slice(0, 16)}.ttf`)
    expect(hashedFileName('OFL.txt', hash)).toBe(`OFL-${hash.slice(0, 16)}.txt`)
    expect(resolveBundlePath(STUDIO_FONTS_BUNDLE, `inter/${name}`)).toBe(`inter/${name}`)
    expect(isHashedBundlePath(`inter/${name}`)).toBe(true)
  })

  it('names styles from the full name, else from weight and italic', () => {
    const font = { filename: 'a.ttf', weight: 700, italic: true, fullName: 'Lato Bold Italic' }
    expect(fontStyleName('Lato', font)).toBe('Bold Italic')
    expect(fontStyleName('Lato', { ...font, fullName: '' })).toBe('Bold Italic')
    expect(fontStyleName('Lato', { ...font, weight: 400, fullName: '' })).toBe('Italic')
    expect(fontStyleName('Lato', { ...font, weight: 400, italic: false, fullName: '' })).toBe('Regular')
  })
})

describe('buildFontManifest', () => {
  function synced(text: string, folder: string, filenames: Array<string>): SyncedFamily {
    const files = Object.fromEntries(
      [...filenames, 'OFL.txt'].map((name) => [name, { sha256: sha(`${folder}/${name}`), size: name.length }]),
    )
    return { metadata: readFamilyMetadata(text), folder, files }
  }

  const families = [
    synced(LATO, 'lato', ['Lato-BoldItalic.ttf', 'Lato-Regular.ttf']),
    synced(INTER, 'inter', ['Inter[opsz,wght].ttf', 'Inter-Italic[opsz,wght].ttf']),
  ]
  const manifest = buildFontManifest(families, {
    urlPrefix: STUDIO_FONTS_BUNDLE.urlPrefix,
    commit: GOOGLE_FONTS_COMMIT,
    hashHex: sha,
  })

  it('follows the contract, families sorted by name', () => {
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/)
    expect(manifest.source).toEqual({ repo: 'google/fonts', commit: GOOGLE_FONTS_COMMIT })
    expect(manifest.families.map((family) => family.family)).toEqual(['Inter', 'Lato'])
    const inter = manifest.families[0]!
    expect(inter).toMatchObject({ category: 'SANS_SERIF', license: 'OFL-1.1' })
    expect(inter.licenseUrl).toBe(`/studio-fonts/inter/OFL-${sha('inter/OFL.txt').slice(0, 16)}.txt`)
    expect(inter.files[0]).toEqual({
      style: 'Regular',
      weight: 400,
      italic: false,
      url: `/studio-fonts/inter/Inter-opsz-wght-${sha('inter/Inter[opsz,wght].ttf').slice(0, 16)}.ttf`,
      sha256: sha('inter/Inter[opsz,wght].ttf'),
      size: 'Inter[opsz,wght].ttf'.length,
      variable: true,
    })
  })

  it('orders files upright first, then by weight', () => {
    const lato = manifest.families[1]!
    expect(lato.axes).toEqual([])
    expect(lato.files.map((file) => [file.style, file.weight, file.italic, file.variable])).toEqual([
      ['Regular', 400, false, false],
      ['Bold Italic', 700, true, false],
    ])
  })

  it('gives every URL a path the fonts route serves', () => {
    for (const family of manifest.families) {
      for (const url of [family.licenseUrl, ...family.files.map((file) => file.url)]) {
        const rest = url.slice(STUDIO_FONTS_BUNDLE.urlPrefix.length)
        expect(url.startsWith(STUDIO_FONTS_BUNDLE.urlPrefix)).toBe(true)
        expect(resolveBundlePath(STUDIO_FONTS_BUNDLE, rest)).toBe(rest)
      }
    }
    // Studio's prefix is unrelated.
    expect(STUDIO_BUNDLE.keyPrefix).not.toBe(STUDIO_FONTS_BUNDLE.keyPrefix)
  })

  it('changes the version exactly when a file changes', () => {
    const again = buildFontManifest(families, {
      urlPrefix: STUDIO_FONTS_BUNDLE.urlPrefix,
      commit: GOOGLE_FONTS_COMMIT,
      hashHex: sha,
    })
    expect(again.version).toBe(manifest.version)
    const changed = structuredClone(families)
    changed[0]!.files['Lato-Regular.ttf'] = { sha256: sha('other'), size: 1 }
    expect(
      buildFontManifest(changed, { urlPrefix: '/studio-fonts/', commit: GOOGLE_FONTS_COMMIT, hashHex: sha })
        .version,
    ).not.toBe(manifest.version)
  })

  it('refuses a family whose files or licence were not downloaded', () => {
    const broken = synced(LATO, 'lato', ['Lato-Regular.ttf'])
    expect(() =>
      buildFontManifest([broken], { urlPrefix: '/studio-fonts/', commit: 'c', hashHex: sha }),
    ).toThrow(/Lato-BoldItalic.ttf/)
    const noLicence = synced(LATO, 'lato', ['Lato-Regular.ttf', 'Lato-BoldItalic.ttf'])
    delete noLicence.files['OFL.txt']
    expect(() =>
      buildFontManifest([noLicence], { urlPrefix: '/studio-fonts/', commit: 'c', hashHex: sha }),
    ).toThrow(/OFL.txt/)
  })

  it('lists the curated families once each', () => {
    expect(new Set(STUDIO_FONT_FAMILIES).size).toBe(STUDIO_FONT_FAMILIES.length)
    expect(STUDIO_FONT_FAMILIES.length).toBe(40)
  })
})
