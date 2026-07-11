import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { KitOrderRecord } from '@lib/kit-store'

let authed = true
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

// Keep the real kitOrderToLedgerRecord; only stub listKitOrders (no real kv).
const mockList = vi.fn<() => Promise<KitOrderRecord[]>>()
vi.mock('@lib/kit-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/kit-store')>()),
  listKitOrders: () => mockList(),
}))

function makeOrder(o: Partial<KitOrderRecord>): KitOrderRecord {
  return {
    orderId: 'o' + Math.random(),
    paymentId: 'pay',
    reference: 'HG-KIT',
    createdAt: '2026-07-01T00:00:00.000Z',
    contact: { name: 'Ada', email: 'a@e.com', phone: '555', address: '1 Main St' },
    crafts: [],
    guests: 20,
    theme: { themeId: 'gilded', ledgerThemeId: 'gilded', serves: 20, packagePriceCents: 12500, depositCents: 10000 },
    partyDate: '2026-07-18',
    pickupDate: '2026-07-16',
    returnBy: '2026-07-22',
    weekKey: '2026-07-16',
    totalChargedCents: 40000,
    status: 'upcoming',
    events: [{ at: '2026-07-01T00:00:00.000Z', action: 'order' }],
    ...o,
  }
}

function ctx() {
  return { request: new Request('http://localhost/api/staff/kits.json') } as any
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = true
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z')) // studio today = 2026-07-16
  GET = (await import('@pages/api/staff/kits.json')).GET
})
afterEach(() => vi.useRealTimers())

describe('GET /api/staff/kits.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = false
    mockList.mockResolvedValue([])
    expect((await GET(ctx())).status).toBe(401)
  })

  it('sorts orders into operational buckets', async () => {
    mockList.mockResolvedValue([
      makeOrder({ status: 'upcoming', pickupDate: '2026-07-16' }), // pickup today
      makeOrder({ status: 'upcoming', pickupDate: '2026-07-30' }), // awaiting
      makeOrder({ status: 'upcoming', pickupDate: '2026-07-09' }), // missed pickup
      makeOrder({ status: 'out', returnBy: '2026-07-22' }), // out
      makeOrder({ status: 'out', returnBy: '2026-07-16' }), // due back today
      makeOrder({ status: 'out', returnBy: '2026-07-09' }), // overdue
      makeOrder({ status: 'returned', events: [{ at: '2026-07-10T00:00:00.000Z', action: 'return-complete' }] }), // recently settled
      makeOrder({ status: 'returned', events: [{ at: '2026-06-01T00:00:00.000Z', action: 'return-complete' }] }), // settled long ago → excluded
    ])
    const res = await GET(ctx())
    const { buckets } = JSON.parse(await res.text()).data
    expect(buckets.pickupToday).toHaveLength(1)
    expect(buckets.awaiting).toHaveLength(1)
    expect(buckets.missedPickup).toHaveLength(1)
    expect(buckets.out).toHaveLength(1)
    expect(buckets.dueBackToday).toHaveLength(1)
    expect(buckets.overdue).toHaveLength(1)
    expect(buckets.recentlySettled).toHaveLength(1) // the 2026-06-01 one is dropped
    // paymentId must never leak to the staff client.
    expect(buckets.pickupToday[0].paymentId).toBeUndefined()
  })

  it('flags an over-committed theme-week in the radar', async () => {
    mockList.mockResolvedValue([
      makeOrder({ status: 'upcoming', weekKey: '2026-07-23', pickupDate: '2026-07-23' }),
      makeOrder({ status: 'upcoming', weekKey: '2026-07-23', pickupDate: '2026-07-23' }),
      makeOrder({ status: 'upcoming', weekKey: '2026-07-23', pickupDate: '2026-07-23' }),
    ])
    const res = await GET(ctx())
    const { radar } = JSON.parse(await res.text()).data
    expect(radar).toEqual([{ themeId: 'gilded', weekKey: '2026-07-23', committed: 60, owned: 45 }])
  })
})
