import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectBundleFiles } from '../../scripts/lib/r2-store.ts'
import {
  HOSTED_BUNDLES,
  IMMUTABLE_CACHE_CONTROL,
  LIGHTCRAFT_BUNDLE,
  REVALIDATE_CACHE_CONTROL,
  STUDIO_BUNDLE,
  STUDIO_FONTS_BUNDLE,
  bundleContentType,
  bundleFileCacheControl,
  bundleObjectKey,
  bundleUploadEntry,
  isPrecompressedCopy,
  lightcraftEditorUrl,
  parseZoraLightcraftMessage,
  resolveBundlePath,
  validIfNoneMatch,
} from './studio-hosting'
import { handleBundleRequest, serveBundleFile } from './studio-hosting.server'
import type { BundleBucket, BundleObject } from './studio-hosting.server'

// The files `cargo xtask web` writes to `target/web-site/` (xtask/src/web.rs
// in ../zora-lightcraft); the last two only with CRAFT_FONTS_DIR.
const LIGHTCRAFT_FILES = [
  'index.html',
  'worker.js',
  'lightcraft_web.js',
  'lightcraft_web_bg.wasm',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/zora-mark.png',
  'licenses/LICENSE-MIT',
  'licenses/LICENSE-APACHE',
  'licenses/NOTICE',
  'lightcraft_zh_hans.otf',
  'OFL-noto-sans-cjk-sc.txt',
]

describe('the bundle map', () => {
  it('lists every hosted bundle with distinct, non-overlapping prefixes', () => {
    const bundles = Object.values(HOSTED_BUNDLES)
    expect(bundles).toEqual([STUDIO_BUNDLE, STUDIO_FONTS_BUNDLE, LIGHTCRAFT_BUNDLE])
    for (const a of bundles) {
      for (const b of bundles) {
        if (a === b) continue
        expect(a.keyPrefix.startsWith(b.keyPrefix), `${a.keyPrefix} / ${b.keyPrefix}`).toBe(false)
        expect(a.urlPrefix.startsWith(b.urlPrefix), `${a.urlPrefix} / ${b.urlPrefix}`).toBe(false)
      }
    }
  })
})

describe('LightCraft paths', () => {
  it('maps the root to index.html and accepts the build files', () => {
    expect(resolveBundlePath(LIGHTCRAFT_BUNDLE, '')).toBe('index.html')
    for (const path of LIGHTCRAFT_FILES) {
      expect(resolveBundlePath(LIGHTCRAFT_BUNDLE, path)).toBe(path)
    }
    expect(bundleObjectKey(LIGHTCRAFT_BUNDLE, 'lightcraft_web_bg.wasm')).toBe(
      'lightcraft/lightcraft_web_bg.wasm',
    )
  })

  it('refuses traversal into other bundles or R2 keys, and dot-files', () => {
    for (const rest of [
      '..',
      '../studio/index.html',
      '%2e%2e/photo-edits/x/original.cr3',
      '.published.json',
      'a//b.js',
      'a%2Fb.js',
      'a\\b.js',
    ]) {
      expect(resolveBundlePath(LIGHTCRAFT_BUNDLE, rest), rest).toBeNull()
    }
  })
})

describe('LightCraft content types and caching', () => {
  it('names the types the bundle needs', () => {
    expect(bundleContentType('index.html')).toBe('text/html; charset=utf-8')
    expect(bundleContentType('worker.js')).toBe('text/javascript; charset=utf-8')
    expect(bundleContentType('lightcraft_web.js')).toBe('text/javascript; charset=utf-8')
    expect(bundleContentType('lightcraft_web_bg.wasm')).toBe('application/wasm')
    expect(bundleContentType('lightcraft_zh_hans.otf')).toBe('font/otf')
    expect(bundleContentType('OFL-noto-sans-cjk-sc.txt')).toBe('text/plain; charset=utf-8')
  })

  it('revalidates every file, even a name that looks hashed', () => {
    for (const path of [...LIGHTCRAFT_FILES, 'snippets/lightcraft-web-d31a8450ea12dfc1/inline0.js']) {
      expect(bundleFileCacheControl(LIGHTCRAFT_BUNDLE, path), path).toBe(REVALIDATE_CACHE_CONTROL)
    }
  })

  it('keeps Studio hashed names immutable', () => {
    expect(bundleFileCacheControl(STUDIO_BUNDLE, 'vectorcraft-web-c1b3de632dbb07fa_bg.wasm')).toBe(
      IMMUTABLE_CACHE_CONTROL,
    )
    expect(bundleFileCacheControl(STUDIO_BUNDLE, 'index.html')).toBe(REVALIDATE_CACHE_CONTROL)
    expect(bundleFileCacheControl(STUDIO_FONTS_BUNDLE, 'inter/OFL-5b9321a4298cfeb6.txt')).toBe(
      IMMUTABLE_CACHE_CONTROL,
    )
  })
})

describe('the publish file filter', () => {
  it('recognises precompressed copies', () => {
    expect(isPrecompressedCopy('lightcraft_web_bg.wasm.br')).toBe(true)
    expect(isPrecompressedCopy('index.html.gz')).toBe(true)
    expect(isPrecompressedCopy('lightcraft_web_bg.wasm')).toBe(false)
    expect(isPrecompressedCopy('brand.js')).toBe(false)
  })

  it('skips .gz/.br copies and dot-files for LightCraft, with no-cache for the rest', () => {
    expect(bundleUploadEntry(LIGHTCRAFT_BUNDLE, 'lightcraft_web_bg.wasm.br')).toBeNull()
    expect(bundleUploadEntry(LIGHTCRAFT_BUNDLE, 'index.html.gz')).toBeNull()
    expect(bundleUploadEntry(LIGHTCRAFT_BUNDLE, '.published.json')).toBeNull()
    expect(bundleUploadEntry(LIGHTCRAFT_BUNDLE, 'lightcraft_web_bg.wasm')).toEqual({
      contentType: 'application/wasm',
      cacheControl: REVALIDATE_CACHE_CONTROL,
    })
  })

  it('keeps Studio uploading everything but dot-files, with its cache rules', () => {
    expect(bundleUploadEntry(STUDIO_BUNDLE, '.trunk-lock')).toBeNull()
    expect(bundleUploadEntry(STUDIO_BUNDLE, 'vectorcraft-web-c1b3de632dbb07fa_bg.wasm')).toEqual({
      contentType: 'application/wasm',
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    })
    expect(bundleUploadEntry(STUDIO_BUNDLE, 'data.bin.gz')).toEqual({
      contentType: 'application/octet-stream',
      cacheControl: REVALIDATE_CACHE_CONTROL,
    })
  })

  it('refuses a name the route would not serve', () => {
    expect(() => bundleUploadEntry(LIGHTCRAFT_BUNDLE, 'a b.js')).toThrow(
      'a b.js: the /lightcraft/ route would not serve this name',
    )
  })

  describe('collectBundleFiles', () => {
    let dir: string | null = null
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
      dir = null
    })

    function buildFolder(paths: Array<string>): string {
      const root = mkdtempSync(join(tmpdir(), 'zora-bundle-build-'))
      for (const path of paths) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), path)
      }
      return root
    }

    it('walks a LightCraft build without the precompressed copies', () => {
      dir = buildFolder([
        ...LIGHTCRAFT_FILES,
        ...LIGHTCRAFT_FILES.slice(0, 5).flatMap((file) => [`${file}.gz`, `${file}.br`]),
        '.DS_Store',
        '.cache/x.js',
      ])
      const files = collectBundleFiles(LIGHTCRAFT_BUNDLE, dir)
      expect(files.map((file) => file.path).sort()).toEqual([...LIGHTCRAFT_FILES].sort())
      expect(new Set(files.map((file) => file.cacheControl))).toEqual(new Set([REVALIDATE_CACHE_CONTROL]))
      expect(files.find((file) => file.path === 'lightcraft_web_bg.wasm')).toMatchObject({
        source: join(dir, 'lightcraft_web_bg.wasm'),
        contentType: 'application/wasm',
      })
    })

    it('walks nested folders of a Studio build with forward slashes', () => {
      dir = buildFolder(['index.html', 'snippets/eframe-d31a8450ea12dfc1/inline0.js', '.trunk-lock'])
      const files = collectBundleFiles(STUDIO_BUNDLE, dir)
      expect(files.map((file) => [file.path, file.cacheControl]).sort()).toEqual([
        ['index.html', REVALIDATE_CACHE_CONTROL],
        ['snippets/eframe-d31a8450ea12dfc1/inline0.js', IMMUTABLE_CACHE_CONTROL],
      ])
    })
  })
})

// --- If-None-Match parsing -----------------------------------------------------------

describe('validIfNoneMatch', () => {
  it('accepts *, strong and weak tags and lists of them', () => {
    expect(validIfNoneMatch('*')).toBe('*')
    expect(validIfNoneMatch('"abc"')).toBe('"abc"')
    expect(validIfNoneMatch('W/"abc"')).toBe('W/"abc"')
    expect(validIfNoneMatch('""')).toBe('""')
    expect(validIfNoneMatch('"a", W/"b",\t"c"')).toBe('"a", W/"b",\t"c"')
    expect(validIfNoneMatch(', "a",, "b" ,')).toBe(', "a",, "b" ,')
    expect(validIfNoneMatch('"a,b"')).toBe('"a,b"')
  })

  it('refuses everything else', () => {
    for (const value of [
      null,
      '',
      ' , ',
      'invalid-tag',
      'abc',
      'w/"abc"',
      'W/abc',
      '"abc',
      'abc"',
      '"a"b"',
      '"a" "b"',
      '"a", *',
      '"a b"',
      '"a", bare',
    ]) {
      expect(validIfNoneMatch(value), String(value)).toBeNull()
    }
  })
})

// --- serveBundleFile for /lightcraft/ ----------------------------------------------------

function fakeBucket(objects: Record<string, string>): BundleBucket & { calls: Array<string> } {
  const calls: Array<string> = []
  return {
    calls,
    async head(key) {
      calls.push(`head ${key}`)
      const text = objects[key]
      return text === undefined ? null : { size: text.length, httpEtag: `"etag-${key}"` }
    },
    async get(key, options) {
      calls.push(`get ${key}`)
      const text = objects[key]
      if (text === undefined) return null
      const object: BundleObject = { size: text.length, httpEtag: `"etag-${key}"` }
      // Like R2: a malformed If-None-Match throws ("Invalid ETag in
      // if-none-match header"); a match (weak comparison, `*`, any list
      // member) leaves the body out.
      const ifNoneMatch = options?.onlyIf?.get('if-none-match')
      if (ifNoneMatch != null) {
        const tags = ifNoneMatch.split(',').map((tag) => tag.trim()).filter(Boolean)
        if (tags.some((tag) => tag !== '*' && !/^(?:W\/)?".*"$/.test(tag))) {
          throw new Error('Invalid ETag in if-none-match header')
        }
        if (tags.some((tag) => tag === '*' || tag.replace(/^W\//, '') === object.httpEtag)) return object
      }
      return { ...object, body: new Response(text).body! }
    },
  }
}

const objects = {
  'lightcraft/index.html': '<!doctype html>',
  'lightcraft/lightcraft_web_bg.wasm': 'wasm-bytes',
  'studio/index.html': '<!doctype html><title>studio</title>',
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost:3000${path}`, init)
}

describe('serveBundleFile for LightCraft', () => {
  it('serves index.html for /lightcraft/ with its query, no-cache and nosniff', async () => {
    const response = await serveBundleFile(
      LIGHTCRAFT_BUNDLE,
      fakeBucket(objects),
      request('/lightcraft/?host=parent&store=memory'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('etag')).toBe('"etag-lightcraft/index.html"')
    expect(await response.text()).toBe(objects['lightcraft/index.html'])
  })

  it('streams the wasm as application/wasm with no-cache', async () => {
    const response = await serveBundleFile(
      LIGHTCRAFT_BUNDLE,
      fakeBucket(objects),
      request('/lightcraft/lightcraft_web_bg.wasm'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/wasm')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('content-length')).toBe(String('wasm-bytes'.length))
    expect(await response.text()).toBe('wasm-bytes')
  })

  it('answers 304 when the ETag matches', async () => {
    const response = await serveBundleFile(
      LIGHTCRAFT_BUNDLE,
      fakeBucket(objects),
      request('/lightcraft/lightcraft_web_bg.wasm', {
        headers: { 'If-None-Match': '"etag-lightcraft/lightcraft_web_bg.wasm"' },
      }),
    )
    expect(response.status).toBe(304)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe('')
  })

  it('answers 304 for a weak ETag and for a list holding the ETag', async () => {
    for (const value of [
      'W/"etag-lightcraft/index.html"',
      '"other", W/"etag-lightcraft/index.html"',
      '*',
    ]) {
      const response = await serveBundleFile(
        LIGHTCRAFT_BUNDLE,
        fakeBucket(objects),
        request('/lightcraft/index.html', { headers: { 'If-None-Match': value } }),
      )
      expect(response.status, value).toBe(304)
      expect(response.headers.get('etag'), value).toBe('"etag-lightcraft/index.html"')
    }
  })

  it('serves 200 for a non-matching ETag list', async () => {
    const response = await serveBundleFile(
      LIGHTCRAFT_BUNDLE,
      fakeBucket(objects),
      request('/lightcraft/index.html', { headers: { 'If-None-Match': '"a", W/"b"' } }),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(objects['lightcraft/index.html'])
  })

  it('ignores a malformed If-None-Match and serves the file (R2 would throw on it)', async () => {
    for (const value of ['invalid-tag', '"etag-lightcraft/index.html", bare', 'W/bare', '"unterminated']) {
      const response = await serveBundleFile(
        LIGHTCRAFT_BUNDLE,
        fakeBucket(objects),
        request('/lightcraft/index.html', { headers: { 'If-None-Match': value } }),
      )
      expect(response.status, value).toBe(200)
      expect(response.headers.get('etag'), value).toBe('"etag-lightcraft/index.html"')
      expect(await response.text(), value).toBe(objects['lightcraft/index.html'])
    }
  })

  it('serves dot segments collapsed by URL parsing inside the same bundle only', async () => {
    const bucket = fakeBucket(objects)
    // `new URL` collapses `..` and `%2e%2e` before the handler sees the path
    // (what `curl --path-as-is` sends), so these are `/lightcraft/index.html`.
    for (const path of ['/lightcraft/snippets/../index.html', '/lightcraft/a/%2e%2e/index.html']) {
      const response = await serveBundleFile(LIGHTCRAFT_BUNDLE, bucket, request(path))
      expect(response.status, path).toBe(200)
      expect(await response.text(), path).toBe(objects['lightcraft/index.html'])
    }
    // Climbing above the prefix leaves the bundle's URL space: 404, no read.
    const escaped = await serveBundleFile(LIGHTCRAFT_BUNDLE, bucket, request('/lightcraft/../studio/index.html'))
    expect(escaped.status).toBe(404)
    expect(bucket.calls).toEqual(['get lightcraft/index.html', 'get lightcraft/index.html'])
  })

  it('answers HEAD from the metadata only', async () => {
    const bucket = fakeBucket(objects)
    const response = await serveBundleFile(LIGHTCRAFT_BUNDLE, bucket, request('/lightcraft/', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(objects['lightcraft/index.html'].length))
    expect(bucket.calls).toEqual(['head lightcraft/index.html'])
  })

  it('answers 404 for missing files and unsafe paths, never reading other bundles', async () => {
    const bucket = fakeBucket(objects)
    expect((await serveBundleFile(LIGHTCRAFT_BUNDLE, bucket, request('/lightcraft/worker.js'))).status).toBe(404)
    for (const path of [
      '/lightcraft/%2e%2e/studio/index.html',
      '/lightcraft/.published.json',
      '/lightcraft/a/',
      '/studio/index.html',
    ]) {
      expect((await serveBundleFile(LIGHTCRAFT_BUNDLE, bucket, request(path))).status, path).toBe(404)
    }
    expect(bucket.calls).toEqual(['get lightcraft/worker.js'])
  })
})

describe('handleBundleRequest', () => {
  function deps(signedIn: boolean, bucket = fakeBucket(objects)) {
    const sessions: Array<string | null> = []
    return {
      bucket,
      sessions,
      deps: {
        isSignedIn: async (headers: Headers) => {
          sessions.push(headers.get('cookie'))
          return signedIn
        },
        bucket: () => bucket,
      },
    }
  }

  it('redirects /lightcraft to /lightcraft/ (308) keeping the query, before any session check', async () => {
    const { deps: d, sessions } = deps(false)
    const response = await handleBundleRequest(
      LIGHTCRAFT_BUNDLE,
      request('/lightcraft?host=parent&store=memory'),
      d,
    )
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('http://localhost:3000/lightcraft/?host=parent&store=memory')
    expect(sessions).toEqual([])
  })

  it('answers 401 without a session and never reads R2', async () => {
    const { deps: d, bucket } = deps(false)
    for (const method of ['GET', 'HEAD']) {
      const response = await handleBundleRequest(LIGHTCRAFT_BUNDLE, request('/lightcraft/', { method }), d)
      expect(response.status, method).toBe(401)
    }
    expect(bucket.calls).toEqual([])
  })

  it('serves the bundle with a session, passing the request cookies to the check', async () => {
    const { deps: d, sessions } = deps(true)
    const response = await handleBundleRequest(
      LIGHTCRAFT_BUNDLE,
      request('/lightcraft/lightcraft_web_bg.wasm', { headers: { cookie: 'session=1' } }),
      d,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/wasm')
    expect(sessions).toEqual(['session=1'])
  })

  it('keeps Studio behaving as before: /studio redirects, the fonts bundle has no index', async () => {
    const studio = await handleBundleRequest(STUDIO_BUNDLE, request('/studio?design=d1'), deps(false).deps)
    expect(studio.status).toBe(308)
    expect(studio.headers.get('location')).toBe('http://localhost:3000/studio/?design=d1')
    const fonts = await handleBundleRequest(STUDIO_FONTS_BUNDLE, request('/studio-fonts'), deps(true).deps)
    expect(fonts.status).toBe(404)
    expect((await handleBundleRequest(STUDIO_FONTS_BUNDLE, request('/studio-fonts'), deps(false).deps)).status).toBe(401)
  })
})

describe('lightcraftEditorUrl', () => {
  it('opens Zora LightCraft on the photo edit in the given theme', () => {
    expect(lightcraftEditorUrl('e1', 'dark')).toBe('/lightcraft/?photo=e1&theme=dark')
    expect(lightcraftEditorUrl('e1', 'light')).toBe('/lightcraft/?photo=e1&theme=light')
  })
})

describe('parseZoraLightcraftMessage', () => {
  it('reads the four events for the open photo edit', () => {
    expect(parseZoraLightcraftMessage({ type: 'zora-lightcraft:ready', editId: 'e1' }, 'e1')).toEqual({
      type: 'zora-lightcraft:ready',
      editId: 'e1',
    })
    expect(
      parseZoraLightcraftMessage({ type: 'zora-lightcraft:dirty', editId: 'e1', dirty: true }, 'e1'),
    ).toEqual({ type: 'zora-lightcraft:dirty', editId: 'e1', dirty: true })
    expect(
      parseZoraLightcraftMessage(
        { type: 'zora-lightcraft:saved', editId: 'e1', versionId: 'v1', number: 2 },
        'e1',
      ),
    ).toEqual({ type: 'zora-lightcraft:saved', editId: 'e1', versionId: 'v1', number: 2 })
    expect(parseZoraLightcraftMessage({ type: 'zora-lightcraft:back', editId: 'e1' }, 'e1')).toEqual({
      type: 'zora-lightcraft:back',
      editId: 'e1',
    })
  })

  it('ignores other photo edits, other messages and malformed fields', () => {
    expect(parseZoraLightcraftMessage({ type: 'zora-lightcraft:ready', editId: 'e2' }, 'e1')).toBeNull()
    expect(parseZoraLightcraftMessage({ type: 'zora-lightcraft:back', editId: 'e2' }, 'e1')).toBeNull()
    expect(parseZoraLightcraftMessage({ type: 'zora-lightcraft:back' }, 'e1')).toBeNull()
    expect(parseZoraLightcraftMessage({ type: 'zora-studio:ready', editId: 'e1' }, 'e1')).toBeNull()
    expect(
      parseZoraLightcraftMessage({ type: 'zora-lightcraft:dirty', editId: 'e1', dirty: 'yes' }, 'e1'),
    ).toBeNull()
    expect(
      parseZoraLightcraftMessage(
        { type: 'zora-lightcraft:saved', editId: 'e1', versionId: 'v1', number: 1.5 },
        'e1',
      ),
    ).toBeNull()
    expect(parseZoraLightcraftMessage('zora-lightcraft:ready', 'e1')).toBeNull()
    expect(parseZoraLightcraftMessage(null, 'e1')).toBeNull()
  })
})
