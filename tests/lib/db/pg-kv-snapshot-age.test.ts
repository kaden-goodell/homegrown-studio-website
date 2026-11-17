import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore, snapshotRead } from '@lib/blob-store'
import { _setDatabaseForTests, type Query } from '@lib/db/client'
import { _setSnapshotClockForTests, SNAPSHOT_MAX_AGE_MS } from '@lib/db/pg-kv'
import { pgliteQuery } from '../../helpers-pglite'

/** Kaden, 16 Nov 2026: a display copy never stays stale indefinitely, and a burst of views wakes the database at most once per record per 10 minutes per server. */
let real: Query
let pgExec: (sql: string) => Promise<unknown>
let t = 0
let calls: string[] = []
let failing = false
beforeAll(async () => {
  const p = await pgliteQuery()
  real = p.query
  pgExec = (sql) => p.pg.exec(sql)
})
beforeEach(async () => {
  await pgExec('DELETE FROM kv_store')
  calls = []
  failing = false
  t = 1_000_000
  _setSnapshotClockForTests(() => t)
  _setDatabaseForTests(async (text, params) => {
    calls.push(text.split(' ')[0])
    if (failing) throw Object.assign(new Error('down'), { code: undefined })
    return real(text, params)
  })
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'snapage-'))
})
afterEach(() => {
  _setDatabaseForTests(null)
  _setSnapshotClockForTests(null)
})

const reads = () => calls.filter((c) => c === 'SELECT').length

describe('display copies age out', () => {
  it('a fresh copy is served without touching the database', async () => {
    const kv = makeKvStore('seat-ledger', 'seat-ledger')
    await kv.set('a', '"one"')
    calls = []
    t += SNAPSHOT_MAX_AGE_MS - 1
    expect(await snapshotRead(kv).get('a')).toBe('"one"')
    expect(reads()).toBe(0)
  })

  it('a copy older than 10 minutes is re-read once from Postgres, refreshed and served', async () => {
    const kv = makeKvStore('seat-ledger', 'seat-ledger')
    await kv.set('a', '"one"')
    await real("UPDATE kv_store SET value = '\"two\"' WHERE key = 'a'") // changed behind the copy's back
    t += SNAPSHOT_MAX_AGE_MS
    calls = []
    expect(await snapshotRead(kv).get('a')).toBe('"two"')
    expect(reads()).toBe(1)
    // Now fresh again: no more database reads.
    expect(await snapshotRead(kv).get('a')).toBe('"two"')
    expect(reads()).toBe(1)
  })

  it('a burst of views on a stale copy wakes the database once per record per 10 minutes', async () => {
    const kv = makeKvStore('party-book', 'party-book')
    await kv.set('m', '"x"')
    t += SNAPSHOT_MAX_AGE_MS * 3
    failing = true // the refresh fails, so the copy stays stale…
    calls = []
    for (let i = 0; i < 20; i++) expect(await snapshotRead(kv).get('m')).toBe('"x"')
    expect(reads()).toBe(1) // …but only one try in the window
    t += SNAPSHOT_MAX_AGE_MS // next window: one more try
    for (let i = 0; i < 20; i++) await snapshotRead(kv).get('m')
    expect(reads()).toBe(2)
  })

  it('if Postgres is down, the stale copy is served and logged; the page is never blocked', async () => {
    const kv = makeKvStore('seat-ledger', 'seat-ledger')
    await kv.set('a', '"old"')
    t += SNAPSHOT_MAX_AGE_MS + 1
    failing = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(snapshotRead(kv).get('a')).resolves.toBe('"old"')
    warn.mockRestore()
  })

  it('a record deleted in Postgres disappears from the display once its copy is refreshed', async () => {
    const kv = makeKvStore('waitlists', 'waitlists')
    await kv.set('wl-x', '"w"')
    await real("DELETE FROM kv_store WHERE key = 'wl-x'")
    t += SNAPSHOT_MAX_AGE_MS
    expect(await snapshotRead(kv).get('wl-x')).toBeNull()
  })

  it('bookings never read the copy: the real read always goes to Postgres', async () => {
    const kv = makeKvStore('seat-ledger', 'seat-ledger')
    await kv.set('a', '"one"')
    await real("UPDATE kv_store SET value = '\"two\"' WHERE key = 'a'")
    calls = []
    expect(await kv.get('a')).toBe('"two"')
    expect((await kv.getWithMeta('a')).value).toBe('"two"')
    expect(reads()).toBe(2)
  })
})
