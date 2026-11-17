import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore, snapshotRead, type KvStore } from '@lib/blob-store'
import { _setDatabaseForTests, type Query } from '@lib/db/client'
import { PG_STORES } from '@lib/db/pg-stores'
import { pgliteQuery } from '../../helpers-pglite'

/**
 * Kaden, 16 Nov 2026: two simultaneous Netlify Blobs "write only if unchanged"
 * saves could BOTH win (party double-booked in the sandbox run). The money and
 * seat stores now keep their records in Postgres; these run the real SQL.
 */
let query: Query
let pgExec: (sql: string) => Promise<unknown>
beforeAll(async () => {
  const p = await pgliteQuery()
  query = p.query
  pgExec = (sql) => p.pg.exec(sql)
})
beforeEach(async () => {
  await pgExec('DELETE FROM kv_store')
  _setDatabaseForTests(query)
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'pgkv-'))
})
afterEach(() => {
  _setDatabaseForTests(null)
  delete process.env.NETLIFY
})

const fresh = (): KvStore => makeKvStore('seat-ledger', 'seat-ledger')

describe('Postgres-backed store', () => {
  it('the money and seat stores are the Postgres ones', () => {
    for (const s of ['seat-ledger', 'party-book', 'waitlists', 'refund-requests', 'promo-uses', 'class-cancels', 'party-locks']) {
      expect(PG_STORES.has(s)).toBe(true)
    }
    expect(PG_STORES.has('waivers')).toBe(false)
    expect(PG_STORES.has('incidents')).toBe(false)
  })

  it('reads, writes and versions a record in kv_store', async () => {
    const kv = fresh()
    expect(await kv.getWithMeta('a')).toEqual({ value: null, etag: null })
    expect(await kv.setIfMatch('a', '{"n":1}', null, false)).toBe(true)
    const r = await kv.getWithMeta('a')
    expect(r).toEqual({ value: '{"n":1}', etag: '1' })
    expect(await kv.setIfMatch('a', '{"n":2}', r.etag, true)).toBe(true)
    expect(await kv.get('a')).toBe('{"n":2}')
    expect((await query("SELECT version FROM kv_store WHERE key = 'a'"))[0].version).toBe(2)
  })

  it('of two writers that read the same version, exactly one wins', async () => {
    const a = fresh(), b = fresh() // two "servers"
    await a.set('k', '{"holds":[]}')
    const ra = await a.getWithMeta('k')
    const rb = await b.getWithMeta('k')
    const [wa, wb] = await Promise.all([a.setIfMatch('k', '{"holds":["A"]}', ra.etag, true), b.setIfMatch('k', '{"holds":["B"]}', rb.etag, true)])
    expect([wa, wb].filter(Boolean)).toHaveLength(1)
    expect(await a.get('k')).toBe(wa ? '{"holds":["A"]}' : '{"holds":["B"]}')
  })

  it('of two writers creating the same new record, exactly one wins', async () => {
    const a = fresh(), b = fresh()
    const [wa, wb] = await Promise.all([a.setIfMatch('n', '"A"', null, false), b.setIfMatch('n', '"B"', null, false)])
    expect([wa, wb].filter(Boolean)).toHaveLength(1)
  })

  it('50 racing increments: every one lands once, none lost', async () => {
    const stores = Array.from({ length: 5 }, fresh)
    await stores[0].set('c', '0')
    await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      const kv = stores[i % stores.length]
      for (;;) {
        const { value, etag } = await kv.getWithMeta('c')
        if (await kv.setIfMatch('c', String(Number(value) + 1), etag, true)) return
      }
    }))
    expect(await stores[0].get('c')).toBe('50')
  })

  it('refuses a write that claims a value exists but brings no version', async () => {
    const kv = fresh()
    await kv.set('x', '1')
    expect(await kv.setIfMatch('x', '2', null, true)).toBe(false)
    expect(await kv.get('x')).toBe('1')
  })

  it('lists by prefix (with % and _ taken literally) and deletes', async () => {
    const kv = fresh()
    await kv.set('wl-a', '1'); await kv.set('wl-b', '1'); await kv.set('w_l-c', '1'); await kv.set('idx', '1')
    expect(await kv.list('wl-')).toEqual(['wl-a', 'wl-b'])
    expect(await kv.list('w_')).toEqual(['w_l-c'])
    await kv.delete('wl-a')
    expect(await kv.list('wl-')).toEqual(['wl-b'])
  })

  it('keeps stores apart (the store column)', async () => {
    const a = makeKvStore('seat-ledger', 'seat-ledger'), b = makeKvStore('party-book', 'party-book')
    await a.set('same', '"ledger"')
    expect(await b.get('same')).toBeNull()
  })

  it('display reads come from the snapshot copy, kept in step by every write', async () => {
    const kv = fresh()
    await kv.set('s', '"one"')
    const snap = snapshotRead(kv)
    expect(await snap.get('s')).toBe('"one"')
    // The database changes behind the copy's back: display still shows the copy (a moment old is fine)…
    await query("UPDATE kv_store SET value = '\"sneaky\"' WHERE key = 's'")
    expect(await snap.get('s')).toBe('"one"')
    // …and the next write through the store brings it up to date.
    const { etag } = await kv.getWithMeta('s')
    await kv.setIfMatch('s', '"two"', etag, true)
    expect(await snap.get('s')).toBe('"two"')
    expect(await snap.list()).toEqual(['s'])
  })

  it('a display read with no copy yet reads the database once and makes the copy', async () => {
    const kv = fresh()
    await query("INSERT INTO kv_store (store, key, value, version) VALUES ('seat-ledger', 'imported', '\"x\"', 3)")
    expect(await snapshotRead(kv).get('imported')).toBe('"x"')
    await query("DELETE FROM kv_store WHERE key = 'imported'")
    expect(await snapshotRead(kv).get('imported')).toBe('"x"')
  })

  it('on a Netlify deploy with no database, every read and write refuses (fail closed, never the blobs)', async () => {
    _setDatabaseForTests(null)
    delete process.env.DATABASE_URL
    process.env.NETLIFY = 'true'
    const kv = fresh()
    await expect(kv.get('a')).rejects.toThrow(/No database/)
    await expect(kv.getWithMeta('a')).rejects.toThrow(/No database/)
    await expect(kv.setIfMatch('a', '1', null, false)).rejects.toThrow(/No database/)
    await expect(kv.set('a', '1')).rejects.toThrow(/No database/)
  })

  it('off Netlify with no database (local dev, the test suite) it keeps using the files', async () => {
    _setDatabaseForTests(null)
    delete process.env.DATABASE_URL
    const kv = fresh()
    expect(await kv.setIfMatch('f', '"file"', null, false)).toBe(true)
    expect(await kv.get('f')).toBe('"file"')
    expect(await query("SELECT * FROM kv_store WHERE key = 'f'")).toHaveLength(0)
  })
})
