import {
  bundleCacheControl,
  bundleContentType,
  bundleObjectKey,
  resolveBundlePath,
} from './studio-hosting'
import type { StudioBundle } from './studio-hosting'

/** The part of an R2 object (with or without a body) this module reads. */
export type BundleObject = {
  body?: ReadableStream
  size: number
  httpEtag: string
}

/** The part of an R2 bucket binding the Studio routes use. */
export type BundleBucket = {
  head(key: string): Promise<BundleObject | null>
  get(key: string, options?: { onlyIf?: Headers }): Promise<BundleObject | null>
}

/**
 * Serves one file of a bundle (Studio or its fonts) from R2, for `GET` and
 * `HEAD`. The caller checks the session first. Answers 404 for unsafe or
 * missing paths, 304 when `If-None-Match` matches, and otherwise streams the
 * object with its type, caching rule and ETag.
 */
export async function serveBundleFile(
  bundle: StudioBundle,
  bucket: BundleBucket,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  const rest = url.pathname.startsWith(bundle.urlPrefix)
    ? url.pathname.slice(bundle.urlPrefix.length)
    : null
  const path = rest === null ? null : resolveBundlePath(bundle, rest)
  if (!path) return notFound()

  const key = bundleObjectKey(bundle, path)
  const object =
    request.method === 'HEAD'
      ? await bucket.head(key)
      : // R2 evaluates If-None-Match / If-Modified-Since itself and leaves
        // the body out when the cached copy is still good.
        await bucket.get(key, { onlyIf: request.headers })
  if (!object) return notFound()

  const headers = new Headers({
    'Content-Type': bundleContentType(path),
    'Cache-Control': bundleCacheControl(path),
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size))
    return new Response(null, { status: 200, headers })
  }
  if (!object.body) return new Response(null, { status: 304, headers })
  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
