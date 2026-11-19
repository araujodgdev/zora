import { describe, expect, it } from 'vitest'
import {
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  STUDIO_BUNDLE,
  STUDIO_FONTS_BUNDLE,
  bundleCacheControl,
  bundleContentType,
  bundleObjectKey,
  isHashedBundlePath,
  parseStudioMessage,
  resolveBundlePath,
  studioEditorUrl,
} from './studio-hosting'
import { serveBundleFile } from './studio-hosting.server'
import type { BundleBucket, BundleObject } from './studio-hosting.server'

describe('resolveBundlePath', () => {
  it('maps the root to index.html for Studio and to nothing for the fonts', () => {
    expect(resolveBundlePath(STUDIO_BUNDLE, '')).toBe('index.html')
    expect(resolveBundlePath(STUDIO_FONTS_BUNDLE, '')).toBeNull()
  })

  it('accepts the files of a Trunk build and the font library', () => {
    for (const path of [
      'index.html',
      'vectorcraft-web-3ee0a15109942011.js',
      'vectorcraft-web-c1b3de632dbb07fa_bg.wasm',
      'snippets/eframe-d31a8450ea12dfc1/inline0.js',
      'icons/favicon-32.png',
      'licenses/LICENSE-APACHE',
      'fonts/0123456789abcdef/Inter.ttf',
    ]) {
      expect(resolveBundlePath(STUDIO_BUNDLE, path)).toBe(path)
    }
    expect(resolveBundlePath(STUDIO_FONTS_BUNDLE, 'inter/Inter-opsz-wght-29160a80ff49ddca.ttf')).toBe(
      'inter/Inter-opsz-wght-29160a80ff49ddca.ttf',
    )
  })

  it('decodes harmless percent-encoding', () => {
    expect(resolveBundlePath(STUDIO_BUNDLE, 'icons/favicon%2D32.png')).toBe('icons/favicon-32.png')
  })

  it('refuses traversal, dot-files, empty segments and odd characters', () => {
    for (const rest of [
      '..',
      '../wrangler.jsonc',
      'icons/../../designs/x/source.vectorcraft',
      '%2e%2e/secret',
      '.published.json',
      '.trunk-lock',
      'icons/.hidden',
      'icons//favicon-32.png',
      'icons/',
      '/index.html',
      'icons%2Ffavicon-32.png',
      'icons\\favicon-32.png',
      'icons%5Cfavicon-32.png',
      'a%00b',
      'a b.js',
      'a%20b.js',
      '%E0%A4%A',
      'x'.repeat(600),
    ]) {
      expect(resolveBundlePath(STUDIO_BUNDLE, rest), rest).toBeNull()
    }
  })

  it('keys files under the bundle prefix', () => {
    expect(bundleObjectKey(STUDIO_BUNDLE, 'index.html')).toBe('studio/index.html')
    expect(bundleObjectKey(STUDIO_FONTS_BUNDLE, 'manifest.json')).toBe('studio-fonts/manifest.json')
  })
})

describe('bundleContentType', () => {
  it('names the types Studio and the fonts need', () => {
    expect(bundleContentType('vectorcraft-web-c1b3de632dbb07fa_bg.wasm')).toBe('application/wasm')
    expect(bundleContentType('vectorcraft-web-3ee0a15109942011.js')).toBe('text/javascript; charset=utf-8')
    expect(bundleContentType('index.html')).toBe('text/html; charset=utf-8')
    expect(bundleContentType('icons/icon-192.png')).toBe('image/png')
    expect(bundleContentType('manifest.json')).toBe('application/json; charset=utf-8')
    expect(bundleContentType('inter/Inter-opsz-wght-29160a80ff49ddca.ttf')).toBe('font/ttf')
    expect(bundleContentType('inter/OFL-5b9321a4298cfeb6.txt')).toBe('text/plain; charset=utf-8')
  })

  it('serves licence files without an extension as plain text', () => {
    expect(bundleContentType('licenses/LICENSE-MIT')).toBe('text/plain; charset=utf-8')
    expect(bundleContentType('licenses/NOTICE')).toBe('text/plain; charset=utf-8')
  })

  it('never serves SVG or unknown types as something a browser renders', () => {
    expect(bundleContentType('icons/logo.svg')).toBe('application/octet-stream')
    expect(bundleContentType('data.bin')).toBe('application/octet-stream')
  })
})

describe('caching', () => {
  it('treats file and folder names with a 16-digit hex hash as immutable', () => {
    for (const path of [
      'vectorcraft-web-3ee0a15109942011.js',
      'vectorcraft-web-c1b3de632dbb07fa_bg.wasm',
      'snippets/eframe-d31a8450ea12dfc1/inline0.js',
      'fonts/0123456789abcdef/Inter.ttf',
      'inter/Inter-opsz-wght-29160a80ff49ddca.ttf',
      'inter/OFL-5b9321a4298cfeb6.txt',
    ]) {
      expect(isHashedBundlePath(path), path).toBe(true)
      expect(bundleCacheControl(path)).toBe(IMMUTABLE_CACHE_CONTROL)
    }
  })

  it('revalidates index.html, the manifest, icons and licences', () => {
    for (const path of [
      'index.html',
      'manifest.json',
      'icons/favicon-32.png',
      'licenses/LICENSE-APACHE',
      // Not a hash: too short, upper case, or not at a name boundary.
      'app-3ee0a1510994201.js',
      'app-3EE0A15109942011.js',
      'app-3ee0a15109942011x.js',
    ]) {
      expect(isHashedBundlePath(path), path).toBe(false)
      expect(bundleCacheControl(path)).toBe(REVALIDATE_CACHE_CONTROL)
    }
  })
})

describe('studioEditorUrl', () => {
  it('opens Studio on the design in the given theme', () => {
    expect(studioEditorUrl('d1', 'light')).toBe('/studio/?design=d1&theme=light')
  })
})

describe('parseStudioMessage', () => {
  it('reads the four events for the open design', () => {
    expect(parseStudioMessage({ type: 'zora-studio:ready', designId: 'd1' }, 'd1')).toEqual({
      type: 'zora-studio:ready',
      designId: 'd1',
    })
    expect(
      parseStudioMessage({ type: 'zora-studio:dirty', designId: 'd1', dirty: true }, 'd1'),
    ).toEqual({ type: 'zora-studio:dirty', designId: 'd1', dirty: true })
    expect(
      parseStudioMessage(
        { type: 'zora-studio:saved', designId: 'd1', versionId: 'v1', number: 3 },
        'd1',
      ),
    ).toEqual({ type: 'zora-studio:saved', designId: 'd1', versionId: 'v1', number: 3 })
    expect(parseStudioMessage({ type: 'zora-studio:back', designId: 'd1' }, 'd1')).toEqual({
      type: 'zora-studio:back',
      designId: 'd1',
    })
  })

  it('ignores other designs, other messages and malformed fields', () => {
    expect(parseStudioMessage({ type: 'zora-studio:ready', designId: 'd2' }, 'd1')).toBeNull()
    expect(parseStudioMessage({ type: 'zora-studio:back', designId: 'd2' }, 'd1')).toBeNull()
    expect(parseStudioMessage({ type: 'zora-studio:back' }, 'd1')).toBeNull()
    expect(parseStudioMessage({ type: 'something-else', designId: 'd1' }, 'd1')).toBeNull()
    expect(parseStudioMessage({ type: 'zora-studio:dirty', designId: 'd1', dirty: 'yes' }, 'd1')).toBeNull()
    expect(
      parseStudioMessage({ type: 'zora-studio:saved', designId: 'd1', versionId: 'v1', number: 1.5 }, 'd1'),
    ).toBeNull()
    expect(parseStudioMessage('zora-studio:ready', 'd1')).toBeNull()
    expect(parseStudioMessage(null, 'd1')).toBeNull()
  })
})

// --- serveBundleFile ---------------------------------------------------------------

function fakeBucket(objects: Record<string, string>): BundleBucket & { calls: Array<string> } {
  const calls: Array<string> = []
  function find(key: string): { text: string; etag: string } | null {
    const text = objects[key]
    return text === undefined ? null : { text, etag: `"etag-${key}"` }
  }
  return {
    calls,
    async head(key) {
      calls.push(`head ${key}`)
      const found = find(key)
      return found ? { size: found.text.length, httpEtag: found.etag } : null
    },
    async get(key, options) {
      calls.push(`get ${key}`)
      const found = find(key)
      if (!found) return null
      const object: BundleObject = { size: found.text.length, httpEtag: found.etag }
      // Like R2: a matching If-None-Match leaves the body out.
      if (options?.onlyIf?.get('if-none-match') === found.etag) return object
      return { ...object, body: new Response(found.text).body! }
    },
  }
}

const files = {
  'studio/index.html': '<!doctype html>',
  'studio/vectorcraft-web-c1b3de632dbb07fa_bg.wasm': 'wasm-bytes',
  'studio-fonts/manifest.json': '{}',
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost:3000${path}`, init)
}

describe('serveBundleFile', () => {
  it('serves index.html for /studio/ with no-cache and its ETag', async () => {
    const bucket = fakeBucket(files)
    const response = await serveBundleFile(STUDIO_BUNDLE, bucket, request('/studio/?design=x&theme=dark'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('etag')).toBe('"etag-studio/index.html"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-length')).toBe(String(files['studio/index.html'].length))
    expect(await response.text()).toBe(files['studio/index.html'])
  })

  it('serves the wasm as application/wasm, cached for a year', async () => {
    const response = await serveBundleFile(
      STUDIO_BUNDLE,
      fakeBucket(files),
      request('/studio/vectorcraft-web-c1b3de632dbb07fa_bg.wasm'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/wasm')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await response.text()).toBe('wasm-bytes')
  })

  it('answers 304 when the ETag matches', async () => {
    const response = await serveBundleFile(
      STUDIO_BUNDLE,
      fakeBucket(files),
      request('/studio/', { headers: { 'If-None-Match': '"etag-studio/index.html"' } }),
    )
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"etag-studio/index.html"')
    expect(await response.text()).toBe('')
  })

  it('answers HEAD from the object metadata, without reading the body', async () => {
    const bucket = fakeBucket(files)
    const response = await serveBundleFile(STUDIO_BUNDLE, bucket, request('/studio/', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(files['studio/index.html'].length))
    expect(bucket.calls).toEqual(['head studio/index.html'])
  })

  it('serves the font manifest from studio-fonts/', async () => {
    const response = await serveBundleFile(
      STUDIO_FONTS_BUNDLE,
      fakeBucket(files),
      request('/studio-fonts/manifest.json'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.json()).toEqual({})
  })

  it('answers 404 for missing files and never asks R2 for unsafe paths', async () => {
    const bucket = fakeBucket(files)
    expect((await serveBundleFile(STUDIO_BUNDLE, bucket, request('/studio/missing.js'))).status).toBe(404)
    for (const path of ['/studio/%2e%2e/designs/x', '/studio/.published.json', '/studio/icons/']) {
      expect((await serveBundleFile(STUDIO_BUNDLE, bucket, request(path))).status, path).toBe(404)
    }
    expect((await serveBundleFile(STUDIO_FONTS_BUNDLE, bucket, request('/studio-fonts/'))).status).toBe(404)
    expect(bucket.calls).toEqual(['get studio/missing.js'])
  })
})
