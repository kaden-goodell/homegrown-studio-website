import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore } from '@lib/blob-store'

describe('KvStore.delete', () => {
  it('removes a key on disk and is quiet when it is already gone', async () => {
    const kv = makeKvStore('t', 't', { fsDirOverride: mkdtempSync(join(tmpdir(), 'kv-del-')) })
    await kv.set('a', '"x"')
    await kv.delete('a')
    expect(await kv.get('a')).toBeNull()
    await expect(kv.delete('a')).resolves.toBeUndefined()
  })
  it('calls the blob store delete', async () => {
    const deleted: string[] = []
    const kv = makeKvStore('t', 't', { _blobStore: { delete: async (k: string) => { deleted.push(k) } } })
    await kv.delete('b')
    expect(deleted).toEqual(['b'])
  })
})

describe('KvStore.list(prefix)', () => {
  it('filters on disk', async () => {
    const kv = makeKvStore('t', 't', { fsDirOverride: mkdtempSync(join(tmpdir(), 'kv-pre-')) })
    await kv.set('p-a-1', '1'); await kv.set('p-b-1', '1'); await kv.set('order-x', '1')
    expect((await kv.list('p-a-')).sort()).toEqual(['p-a-1'])
    expect((await kv.list()).length).toBe(3)
  })
  it('passes the prefix to the blob store', async () => {
    let seen: unknown
    const kv = makeKvStore('t', 't', { _blobStore: { list: async (opts: unknown) => { seen = opts; return { blobs: [{ key: 'p-a-1' }] } } } })
    expect(await kv.list('p-a-')).toEqual(['p-a-1'])
    expect(seen).toEqual({ prefix: 'p-a-' })
  })
})
