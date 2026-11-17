import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _setDatabaseForTests } from '@lib/db/client'
import { holdTime, holdsBetween } from '@lib/parties/party-book'
import { pgliteQuery } from '../../helpers-pglite'

/** The party times on Postgres: of many simultaneous holds for one time, one wins (scenario 26, 16 Nov 2026). */
let query: Awaited<ReturnType<typeof pgliteQuery>>['query']
beforeAll(async () => {
  query = (await pgliteQuery()).query
  _setDatabaseForTests(query)
  process.env.BLOB_STORE_FS_DIR = mkdtempSync(join(tmpdir(), 'pbpg-'))
})
afterAll(() => _setDatabaseForTests(null))

describe('party times in Postgres', () => {
  it('ten customers at once for the same 4:00: exactly one hold; the public picker sees it', async () => {
    const start = '2031-03-08T22:00:00.000Z', end = '2031-03-09T00:00:00.000Z'
    const now = new Date('2031-01-01T12:00:00Z')
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => holdTime({ partyId: `pty_race_${i}`, startIso: start, endIso: end, ttlMinutes: 15 }, [], now)),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'taken')).toBe(true)
    const rows = await query("SELECT value FROM kv_store WHERE store = 'party-book'")
    expect(rows).toHaveLength(1)
    expect((JSON.parse(String(rows[0].value)) as { holds: unknown[] }).holds).toHaveLength(1)
    expect(await holdsBetween(start, end, now, { display: true })).toHaveLength(1)
  })
})
