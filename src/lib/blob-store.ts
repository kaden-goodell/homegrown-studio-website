/**
 * Shared KV persistence: Netlify Blobs in prod, `.data/<dir>/` on disk in dev.
 *
 * Error semantics matter here: "Blobs unavailable" (probe fails — we're not on
 * Netlify) falls back to fs, but a read/write that fails AFTER a successful
 * probe is a transient outage and MUST throw — proceeding on empty state and
 * writing it back destroys real data.
 *
 * API notes (verified against node_modules/@netlify/blobs/dist/main.d.ts v10):
 * - getWithMetadata returns `{ data: string, etag?: string, metadata } | null`
 *   (etag is optional in the result; we coerce to string | null in our interface)
 * - set returns `Promise<WriteResult>` where WriteResult = `{ modified: boolean, etag?: string }`
 * - Conditional set uses `{ onlyIfMatch: string }` or `{ onlyIfNew: true }` as SetOptions
 * - A conditional write that loses the race resolves normally with `{ modified: false }` —
 *   it does NOT throw. We detect the lost race from the return value; genuine transient
 *   errors surface as thrown exceptions.
 */
import { createLogger } from '@lib/logger'

export interface KvStore {
  get(key: string): Promise<string | null>
  set(key: string, json: string): Promise<void>
  /** getWithMetadata → { value, etag } when Blobs; fs mode returns etag null. */
  getWithMeta(key: string): Promise<{ value: string | null; etag: string | null }>
  /** Conditional write. Returns false when the etag didn't match (Blobs only). */
  setIfMatch(key: string, json: string, etag: string | null): Promise<boolean>
  list(): Promise<string[]>
}

/**
 * Test-only injection options — never pass in production code.
 * @internal
 */
export interface _KvStoreTestOptions {
  /** Inject a fully-resolved blob store, skipping the probe. */
  _blobStore?: any
  /** Override the fs directory (absolute path string) used in dev/test mode. */
  fsDirOverride?: string
}

export function makeKvStore(
  storeName: string,
  fsDirName: string,
  _testOpts?: _KvStoreTestOptions,
): KvStore {
  const logger = createLogger(`kv:${storeName}`)

  // undefined = not yet probed; null = unavailable (use fs); object = available
  let blobStore: any | null | undefined = _testOpts?._blobStore !== undefined
    ? _testOpts._blobStore  // injected — skip probe
    : undefined

  async function resolveBlobStore(): Promise<any | null> {
    if (blobStore !== undefined) return blobStore
    try {
      const { getStore } = await import('@netlify/blobs')
      const store = getStore(storeName)
      await store.get('__probe__') // throws outside Netlify → fs fallback
      blobStore = store
    } catch {
      blobStore = null
    }
    return blobStore
  }

  async function fsDir(): Promise<URL> {
    if (_testOpts?.fsDirOverride) {
      const { pathToFileURL } = await import('node:url')
      const p = _testOpts.fsDirOverride
      return pathToFileURL(p.endsWith('/') ? p : `${p}/`)
    }
    // Resolve relative to this module file: src/lib → ../../.data/<fsDirName>/
    return new URL(`../../.data/${fsDirName}/`, import.meta.url)
  }

  async function fsRead(key: string): Promise<string | null> {
    try {
      const { readFile } = await import('node:fs/promises')
      return await readFile(new URL(`${key}.json`, await fsDir()), 'utf8')
    } catch {
      return null
    }
  }

  async function fsWrite(key: string, json: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const dir = await fsDir()
    await mkdir(dir, { recursive: true })
    await writeFile(new URL(`${key}.json`, dir), json, 'utf8')
  }

  return {
    async get(key) {
      const store = await resolveBlobStore()
      if (!store) return fsRead(key)
      // NOTE: no fs fallback here — a throw after a successful probe is a
      // transient Blobs error and must surface to the caller.
      return (await store.get(key, { type: 'text' })) ?? null
    },

    async set(key, json) {
      const store = await resolveBlobStore()
      if (!store) return fsWrite(key, json)
      await store.set(key, json)
      logger.info('kv set', { key })
    },

    async getWithMeta(key) {
      const store = await resolveBlobStore()
      if (!store) return { value: await fsRead(key), etag: null }
      const res = await store.getWithMetadata(key, { type: 'text' })
      // res?.etag is optional in @netlify/blobs v10 (etag?: string) — coerce to null
      return { value: res?.data ?? null, etag: res?.etag ?? null }
    },

    async setIfMatch(key, json, etag) {
      const store = await resolveBlobStore()
      if (!store) {
        await fsWrite(key, json)
        return true
      }
      // @netlify/blobs v10: a conditional set that loses the race resolves
      // NORMALLY with { modified: false } — it does NOT throw. Detect the
      // lost race from the return value; let genuine transient errors throw.
      const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true as const }
      const res = await store.set(key, json, opts)
      return res?.modified === true
    },

    async list() {
      const store = await resolveBlobStore()
      if (store) {
        const { blobs } = await store.list()
        return blobs.map((b: { key: string }) => b.key)
      }
      try {
        const { readdir } = await import('node:fs/promises')
        const files = await readdir(await fsDir())
        return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
      } catch {
        return []
      }
    },
  }
}
