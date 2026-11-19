// Writes a folder of files to the `MEDIA` R2 bucket under a prefix, for
// `pnpm studio:publish` and `pnpm fonts:sync`.
//
// - Local (default): the simulated bucket under `.wrangler/state/v3`, the one
//   `pnpm dev` reads, through Wrangler's `getPlatformProxy` (one workerd for
//   the whole run, and it can list, so stale objects are found directly).
// - `--remote`: the production bucket, through `wrangler r2 object put/get/
//   delete --remote` (needs `wrangler login`). Remote R2 cannot be listed
//   with Wrangler, so each publish also writes `<prefix>.published.json`
//   (the keys it uploaded) and deletes the keys of the previous one that are
//   gone. Owner's step only; agents never run it (docs/STUDIO-PLAN.md).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { PUBLISH_INDEX_FILE } from '../../src/lib/studio-hosting.ts'

export type UploadFile = {
  /** Key relative to the prefix, e.g. `index.html`. */
  path: string
  /** Absolute path of the file on disk. */
  source: string
  contentType: string
  cacheControl: string
}

type Store = {
  /** Keys under the prefix (relative), as far as the store can tell. */
  existing(prefix: string): Promise<Array<string>>
  put(key: string, file: UploadFile): Promise<void>
  putText(key: string, text: string, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  close(): Promise<void>
}

const projectRoot = resolve(import.meta.dirname, '../..')
const configPath = join(projectRoot, 'wrangler.jsonc')

/** The bucket bound as `MEDIA` in wrangler.jsonc. */
function mediaBucketName(): string {
  const config = readFileSync(configPath, 'utf8')
  const binding = /"binding"\s*:\s*"MEDIA"\s*,\s*"bucket_name"\s*:\s*"([^"]+)"/.exec(config)
  if (!binding?.[1]) throw new Error('No MEDIA R2 bucket in wrangler.jsonc')
  return binding[1]
}

type LocalBucket = {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>
    truncated: boolean
    cursor?: string
  }>
  put(
    key: string,
    value: ArrayBuffer | string,
    options: { httpMetadata: { contentType: string; cacheControl?: string } },
  ): Promise<unknown>
  delete(key: string): Promise<void>
}

async function openLocalStore(): Promise<Store> {
  const platform = await getPlatformProxy<{ MEDIA: LocalBucket }>({
    configPath,
    // `.wrangler/state/v3`, shared with `pnpm dev` and `wrangler --local`.
    persist: true,
    remoteBindings: false,
  })
  const bucket = platform.env.MEDIA
  return {
    async existing(prefix) {
      const keys: Array<string> = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor })
        keys.push(...page.objects.map((object) => object.key.slice(prefix.length)))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return keys
    },
    async put(key, file) {
      const bytes = await readFile(file.source)
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      await bucket.put(key, body as ArrayBuffer, {
        httpMetadata: { contentType: file.contentType, cacheControl: file.cacheControl },
      })
    },
    async putText(key, text, contentType) {
      await bucket.put(key, text, { httpMetadata: { contentType } })
    },
    delete: (key) => bucket.delete(key),
    close: () => platform.dispose(),
  }
}

function wrangler(args: Array<string>, input?: string): string {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed`)
  return result.stdout
}

async function openRemoteStore(): Promise<Store> {
  const bucket = mediaBucketName()
  const scratch = await mkdtemp(join(tmpdir(), 'zora-r2-'))
  return {
    async existing(prefix) {
      // The keys the previous publish wrote, if it left an index.
      const target = join(scratch, 'previous.json')
      try {
        wrangler(['r2', 'object', 'get', `${bucket}/${prefix}${PUBLISH_INDEX_FILE}`, '--remote', '--file', target])
        const index = JSON.parse(await readFile(target, 'utf8')) as { keys?: Array<string> }
        return Array.isArray(index.keys) ? index.keys : []
      } catch {
        return []
      }
    },
    async put(key, file) {
      wrangler([
        'r2', 'object', 'put', `${bucket}/${key}`, '--remote',
        '--file', file.source,
        '--content-type', file.contentType,
        '--cache-control', file.cacheControl,
      ])
    },
    async putText(key, text, contentType) {
      wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--pipe', '--content-type', contentType], text)
    },
    async delete(key) {
      wrangler(['r2', 'object', 'delete', `${bucket}/${key}`, '--remote'])
    },
    close: () => rm(scratch, { recursive: true, force: true }),
  }
}

/**
 * Uploads `files` under `prefix` (e.g. `studio/`), the ones in `last` after
 * all others (so the entry point never names a file that is not there yet),
 * then deletes the keys under `prefix` that are not in this upload.
 */
export async function publishFiles(options: {
  prefix: string
  files: Array<UploadFile>
  last?: Array<string>
  remote: boolean
  log?: (line: string) => void
}): Promise<{ uploaded: number; bytes: number; deleted: Array<string> }> {
  const { prefix, remote } = options
  const log = options.log ?? ((line: string) => console.log(line))
  const store = remote ? await openRemoteStore() : await openLocalStore()
  try {
    const previous = await store.existing(prefix)
    const last = new Set(options.last ?? [])
    const ordered = [
      ...options.files.filter((file) => !last.has(file.path)),
      ...options.files.filter((file) => last.has(file.path)),
    ]
    let bytes = 0
    for (const file of ordered) {
      const { size } = await stat(file.source)
      bytes += size
      log(`  put ${prefix}${file.path} (${formatBytes(size)})`)
      await store.put(`${prefix}${file.path}`, file)
    }
    const keys = options.files.map((file) => file.path)
    await store.putText(
      `${prefix}${PUBLISH_INDEX_FILE}`,
      JSON.stringify({ publishedAt: new Date().toISOString(), keys }, null, 2),
      'application/json',
    )
    const current = new Set([...keys, PUBLISH_INDEX_FILE])
    const stale = previous.filter((key) => !current.has(key))
    for (const key of stale) {
      log(`  delete ${prefix}${key}`)
      await store.delete(`${prefix}${key}`)
    }
    return { uploaded: ordered.length, bytes, deleted: stale }
  } finally {
    await store.close()
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
