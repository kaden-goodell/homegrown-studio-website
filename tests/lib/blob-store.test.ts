/**
 * Tests for makeKvStore — shared blob-store helper.
 *
 * In test (non-Netlify) environment the probe throws → fs fallback is used.
 * We also inject a fake blob store via the internal test hook to exercise the
 * conditional-write (setIfMatch) semantics without a live Netlify connection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore } from '@lib/blob-store'

// ─── fs-mode (no Netlify) tests ────────────────────────────────────────────

describe('makeKvStore (fs mode)', () => {
  let tmpDir: string
  let store: ReturnType<typeof makeKvStore>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'blob-store-test-'))
    // No blob store injected → the probe runs and fails (not on Netlify) → fs
    // mode. fsDirOverride points the fs layer at tmpDir instead of .data/.
    store = makeKvStore('test-things', 'things', { fsDirOverride: tmpDir })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('round-trips a value via set then get', async () => {
    await store.set('hello', JSON.stringify({ x: 1 }))
    const result = await store.get('hello')
    expect(result).toBe(JSON.stringify({ x: 1 }))
  })

  it('returns null for a missing key', async () => {
    const result = await store.get('does-not-exist')
    expect(result).toBeNull()
  })

  it('list() returns written keys', async () => {
    await store.set('alpha', '{}')
    await store.set('beta', '{}')
    const keys = await store.list()
    expect(keys).toContain('alpha')
    expect(keys).toContain('beta')
    expect(keys.length).toBe(2)
  })

  it('getWithMeta returns value and null etag in fs mode', async () => {
    await store.set('doc', '"hello"')
    const { value, etag } = await store.getWithMeta('doc')
    expect(value).toBe('"hello"')
    expect(etag).toBeNull()
  })

  it('setIfMatch in fs mode writes unconditionally and returns true', async () => {
    const ok = await store.setIfMatch('mykey', '"val"', null)
    expect(ok).toBe(true)
    expect(await store.get('mykey')).toBe('"val"')
  })
})

// ─── blob-mode tests via fake store injection ──────────────────────────────

describe('makeKvStore (blob mode via injection)', () => {
  it('setIfMatch returns false when blob store reports modified=false (lost race)', async () => {
    const fakeStore = makeFakeStore()
    fakeStore._nextModified = false

    const store = makeKvStore('test', 'test', { _blobStore: fakeStore })
    const result = await store.setIfMatch('key', '{}', 'etag-abc')
    expect(result).toBe(false)
  })

  it('setIfMatch returns true when blob store reports modified=true', async () => {
    const fakeStore = makeFakeStore()
    fakeStore._nextModified = true

    const store = makeKvStore('test', 'test', { _blobStore: fakeStore })
    const result = await store.setIfMatch('key', '{}', 'etag-abc')
    expect(result).toBe(true)
  })

  it('get delegates to the blob store when injected', async () => {
    const fakeStore = makeFakeStore()
    fakeStore._data['mykey'] = 'stored-value'

    const store = makeKvStore('test', 'test', { _blobStore: fakeStore })
    const result = await store.get('mykey')
    expect(result).toBe('stored-value')
  })

  it('list delegates to the blob store when injected', async () => {
    const fakeStore = makeFakeStore()
    fakeStore._data['k1'] = 'a'
    fakeStore._data['k2'] = 'b'

    const store = makeKvStore('test', 'test', { _blobStore: fakeStore })
    const keys = await store.list()
    expect(keys.sort()).toEqual(['k1', 'k2'])
  })

  it('getWithMeta returns data and etag from blob store', async () => {
    const fakeStore = makeFakeStore()
    fakeStore._data['doc'] = '"hello"'
    fakeStore._etags['doc'] = 'etag-xyz'

    const store = makeKvStore('test', 'test', { _blobStore: fakeStore })
    const { value, etag } = await store.getWithMeta('doc')
    expect(value).toBe('"hello"')
    expect(etag).toBe('etag-xyz')
  })
})

// ─── Fake blob store ────────────────────────────────────────────────────────

function makeFakeStore() {
  return {
    _data: {} as Record<string, string>,
    _etags: {} as Record<string, string>,
    _nextModified: true as boolean,

    async get(key: string, _opts?: unknown): Promise<string | null> {
      return this._data[key] ?? null
    },

    async getWithMetadata(key: string, _opts?: unknown) {
      const data = this._data[key]
      if (data === undefined) return null
      return { data, etag: this._etags[key] ?? undefined, metadata: {} }
    },

    async set(key: string, data: string, _opts?: unknown) {
      this._data[key] = data
      return { modified: this._nextModified, etag: this._nextModified ? 'new-etag' : undefined }
    },

    async list() {
      const blobs = Object.keys(this._data).map((key) => ({ key, etag: 'etag' }))
      return { blobs, directories: [] }
    },
  }
}
