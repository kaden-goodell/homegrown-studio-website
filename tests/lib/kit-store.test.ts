/**
 * Kit-store persistence: CAS-backed kit orders + the per-(theme, week) claims
 * blobs that make theme-week reservation atomic (LR-1).
 *
 * The last-slot race needs REAL compare-and-swap, which the fs fallback doesn't
 * provide (its setIfMatch writes unconditionally). So we inject an in-memory
 * blob store that honours onlyIfMatch/onlyIfNew exactly like Netlify Blobs, via
 * the same _blobStore hook blob-store.test.ts uses.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import {
  _setKitKvForTests,
  createKitOrder,
  getKitOrder,
  listKitOrders,
  mutateKitOrder,
  claimWeek,
  confirmWeekClaim,
  releaseWeekClaim,
  getWeekClaims,
  claimsKey,
  type KitOrderRecord,
} from '@lib/kit-store'
import type { WeekClaim } from '@lib/kit-ledger'

const THEME = 'gilded' // owns 45 settings, 3 hero sets
const WEEK = '2026-07-16'
const TODAY = '2026-07-11'
const NOW = Date.parse('2026-07-11T12:00:00Z')

/** In-memory blob store with true CAS — set honours onlyIfMatch / onlyIfNew. */
function makeCasBlobStore() {
  const data = new Map<string, { value: string; etag: string }>()
  let seq = 0
  return {
    async get(key: string) {
      return data.get(key)?.value ?? null
    },
    async getWithMetadata(key: string) {
      const e = data.get(key)
      return e ? { data: e.value, etag: e.etag, metadata: {} } : null
    },
    async set(key: string, value: string, opts?: any) {
      const cur = data.get(key)
      if (opts?.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false }
      if (opts?.onlyIfNew && cur) return { modified: false }
      const etag = `e${++seq}`
      data.set(key, { value, etag })
      return { modified: true, etag }
    },
    async list() {
      return { blobs: [...data.keys()].map((key) => ({ key })), directories: [] }
    },
  }
}

let kv: KvStore
beforeEach(() => {
  kv = makeKvStore('kits', 'kits', { _blobStore: makeCasBlobStore() })
  _setKitKvForTests(kv)
})

function orderFixture(overrides: Partial<KitOrderRecord> = {}): KitOrderRecord {
  return {
    orderId: 'ord_1',
    paymentId: 'pay_1',
    reference: 'HG-KIT-1',
    createdAt: '2026-07-11T12:00:00.000Z',
    contact: { name: 'Ada', email: 'ada@example.com', phone: '555-0100', address: '1 Main St, Town' },
    crafts: [{ craftId: 'c1', name: 'Pottery', qty: 15, perHeadCents: 2000 }],
    guests: 15,
    theme: { themeId: 'sweet-sixteen', ledgerThemeId: THEME, serves: 15, packagePriceCents: 10000, depositCents: 7500 },
    partyDate: '2026-07-18',
    pickupDate: WEEK,
    returnBy: '2026-07-22',
    weekKey: WEEK,
    totalChargedCents: 30000,
    status: 'upcoming',
    events: [{ at: '2026-07-11T12:00:00.000Z', action: 'order' }],
    ...overrides,
  }
}

describe('kit order CRUD', () => {
  it('round-trips an order through create/get', async () => {
    await createKitOrder(orderFixture())
    const got = await getKitOrder('ord_1')
    expect(got?.reference).toBe('HG-KIT-1')
    expect(got?.theme?.ledgerThemeId).toBe(THEME)
  })

  it('returns null for an unknown order', async () => {
    expect(await getKitOrder('nope')).toBeNull()
  })

  it('lists created orders', async () => {
    await createKitOrder(orderFixture({ orderId: 'ord_1' }))
    await createKitOrder(orderFixture({ orderId: 'ord_2', createdAt: '2026-07-12T00:00:00.000Z' }))
    const ids = (await listKitOrders()).map((o) => o.orderId)
    expect(ids).toContain('ord_1')
    expect(ids).toContain('ord_2')
  })
})

describe('mutateKitOrder — CAS', () => {
  it('applies and persists a mutation', async () => {
    await createKitOrder(orderFixture())
    await mutateKitOrder('ord_1', (o) => {
      o.status = 'out'
      o.events.push({ at: '2026-07-16T15:00:00.000Z', action: 'pickup' })
    })
    const got = await getKitOrder('ord_1')
    expect(got?.status).toBe('out')
    expect(got?.events.at(-1)?.action).toBe('pickup')
  })

  it('throws when the order does not exist', async () => {
    await expect(mutateKitOrder('ghost', () => {})).rejects.toThrow()
  })

  it('caps the event log at 200 entries', async () => {
    await createKitOrder(orderFixture())
    await mutateKitOrder('ord_1', (o) => {
      for (let i = 0; i < 260; i++) o.events.push({ at: NOW + '', action: 'pickup' })
    })
    const got = await getKitOrder('ord_1')
    expect(got?.events.length).toBe(200)
  })
})

describe('listKitOrders — key filtering', () => {
  it('excludes claims__ and __probe__ keys', async () => {
    await createKitOrder(orderFixture())
    await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'x', today: TODAY, now: NOW })
    await kv.set('__probe__', 'x')
    const ids = (await listKitOrders()).map((o) => o.orderId)
    expect(ids).toEqual(['ord_1'])
  })
})

describe('claimWeek / confirm / release', () => {
  it('places a pending claim, confirms it, then releases it', async () => {
    expect(await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'r1', today: TODAY, now: NOW })).toBe('ok')
    let claims = await getWeekClaims(THEME, WEEK)
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ ref: 'r1', status: 'pending', serves: 10 })

    expect(await confirmWeekClaim({ ledgerThemeId: THEME, weekKey: WEEK, ref: 'r1', serves: 10, kind: 'kit' })).toBe('ok')
    claims = await getWeekClaims(THEME, WEEK)
    expect(claims[0].status).toBe('confirmed')

    await releaseWeekClaim(THEME, WEEK, 'r1')
    expect(await getWeekClaims(THEME, WEEK)).toHaveLength(0)
  })

  it('reinstates a confirmed claim when the pending one expired during a slow payment', async () => {
    // An order places a pending claim…
    await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 15, kind: 'kit', ref: 'slow', today: TODAY, now: NOW })
    // …16 minutes later another order's claimWeek prunes the stale pending while
    // the first order's payment is still processing.
    const later = NOW + 16 * 60 * 1000
    await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'other', today: TODAY, now: later })
    expect((await getWeekClaims(THEME, WEEK)).map((c) => c.ref)).toEqual(['other']) // 'slow' pruned

    // The slow payment finally succeeds — confirm must reinstate, not vanish.
    const outcome = await confirmWeekClaim({ ledgerThemeId: THEME, weekKey: WEEK, ref: 'slow', serves: 15, kind: 'kit', now: later })
    expect(outcome).toBe('reinstated')
    expect((await getWeekClaims(THEME, WEEK)).find((c) => c.ref === 'slow')).toMatchObject({
      status: 'confirmed',
      serves: 15,
      kind: 'kit',
    })
  })

  it('is idempotent on ref (a retry does not double-claim)', async () => {
    await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'dup', today: TODAY, now: NOW })
    const second = await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'dup', today: TODAY, now: NOW })
    expect(second).toBe('ok')
    expect(await getWeekClaims(THEME, WEEK)).toHaveLength(1)
  })

  it('returns full when the theme-week has no capacity left', async () => {
    // Seed three confirmed claims → all 3 hero sets gone.
    const seed: WeekClaim[] = [1, 2, 3].map((n) => ({ ref: `s${n}`, kind: 'kit', serves: 10, status: 'confirmed', at: new Date(NOW).toISOString() }))
    await kv.set(claimsKey(THEME, WEEK), JSON.stringify(seed))
    expect(await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'late', today: TODAY, now: NOW })).toBe('full')
  })
})

describe('claimWeek — last-slot race', () => {
  it('gives the final slot to exactly one of two concurrent writers', async () => {
    // Pre-fill two hero sets so exactly one remains.
    const seed: WeekClaim[] = [1, 2].map((n) => ({ ref: `p${n}`, kind: 'kit', serves: 10, status: 'confirmed', at: new Date(NOW).toISOString() }))
    await kv.set(claimsKey(THEME, WEEK), JSON.stringify(seed))

    const [a, b] = await Promise.all([
      claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'race-a', today: TODAY, now: NOW }),
      claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'race-b', today: TODAY, now: NOW }),
    ])

    expect([a, b].sort()).toEqual(['full', 'ok'])
    // Exactly one new claim landed on top of the two seeded ones.
    expect(await getWeekClaims(THEME, WEEK)).toHaveLength(3)
  })
})

describe('claimWeek — pending TTL', () => {
  it('ignores pending claims older than 15 minutes and prunes them on write', async () => {
    // Three stale pending claims placed at NOW; all three hero sets "held".
    const seed: WeekClaim[] = [1, 2, 3].map((n) => ({ ref: `old${n}`, kind: 'kit', serves: 10, status: 'pending', at: new Date(NOW).toISOString() }))
    await kv.set(claimsKey(THEME, WEEK), JSON.stringify(seed))

    // At NOW the week is full…
    expect(await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'now', today: TODAY, now: NOW })).toBe('full')

    // …but 16 minutes later the stale pending claims no longer count.
    const later = NOW + 16 * 60 * 1000
    expect(await claimWeek({ ledgerThemeId: THEME, weekKey: WEEK, serves: 10, kind: 'kit', ref: 'fresh', today: TODAY, now: later })).toBe('ok')

    // The three stale pending were pruned; only the fresh claim survives.
    const claims = await getWeekClaims(THEME, WEEK)
    expect(claims.map((c) => c.ref)).toEqual(['fresh'])
  })
})
