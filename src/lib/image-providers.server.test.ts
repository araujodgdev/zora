import { describe, expect, it } from 'vitest'
import { assetCreditText, withUnsplashUtm } from './content-assets'
import {
  isFalMediaHost,
  isUnsplashImageHost,
  nearestFalAspectRatio,
  sniffImageType,
} from './image-providers.server'

describe('nearestFalAspectRatio', () => {
  it('maps the channel presets to the closest supported ratio', () => {
    expect(nearestFalAspectRatio(1080, 1080)).toBe('1:1')
    expect(nearestFalAspectRatio(1600, 900)).toBe('16:9')
    expect(nearestFalAspectRatio(1200, 627)).toBe('16:9')
    expect(nearestFalAspectRatio(1080, 1350)).toBe('4:5')
    expect(nearestFalAspectRatio(1080, 1920)).toBe('9:16')
    expect(nearestFalAspectRatio(3000, 500)).toBe('4:1')
  })
})

describe('sniffImageType', () => {
  const bytes = (...values: Array<number | string>) =>
    new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])))
  it('recognises the stored image types by their first bytes', () => {
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageType(bytes('GIF89a'))).toBe('image/gif')
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp')
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, 'ftypavif'))).toBe('image/avif')
    expect(sniffImageType(bytes('<svg xmlns='))).toBeNull()
    expect(sniffImageType(bytes('<html>'))).toBeNull()
  })
})

describe('hosts', () => {
  it('accepts only the providers’ own file hosts', () => {
    expect(isUnsplashImageHost('images.unsplash.com')).toBe(true)
    expect(isUnsplashImageHost('images.unsplash.com.evil.example')).toBe(false)
    expect(isFalMediaHost('v3b.fal.media')).toBe(true)
    expect(isFalMediaHost('fal.media')).toBe(true)
    expect(isFalMediaHost('evilfal.media')).toBe(false)
  })
})

describe('credits', () => {
  it('adds the UTM parameters and writes the pt-BR credit', () => {
    expect(withUnsplashUtm('https://unsplash.com/@ana')).toBe('https://unsplash.com/@ana?utm_source=zora&utm_medium=referral')
    expect(
      assetCreditText({ provider: 'unsplash', photoId: 'a', photographer: 'Ana', photographerUrl: '', photoUrl: '' }),
    ).toBe('Foto: Ana / Unsplash')
    expect(assetCreditText({ provider: 'fal', model: 'm', prompt: 'p' })).toBe('Imagem gerada por IA')
    expect(assetCreditText(null)).toBeNull()
  })
})
