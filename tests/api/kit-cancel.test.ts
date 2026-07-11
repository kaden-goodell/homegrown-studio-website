import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { KitOrderRecord } from '@lib/kit-store'

let authed = true
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockRefund = vi.fn()
vi.mock('@config/providers', () => ({
  providers: { payment: { refundPayment: (...a: any[]) => mockRefund(...a) } },
}))

let record: KitOrderRecord
const mockGetKitOrder = vi.fn(async (..._a: any[]) => record)
const mockMutate = vi.fn(async (_id: string, fn: (o: KitOrderRecord) => void | Promise<void>) => {
  await fn(record)
  return record
})
const mockRelease = vi.fn(async (..._a: any[]) => {})
vi.mock('@lib/kit-store', () => ({
  getKitOrder: (...a: any[]) => mockGetKitOrder(...a),
  mutateKitOrder: (...a: any[]) => (mockMutate as any)(...a),
  releaseWeekClaim: (...a: any[]) => mockRelease(...a),
}))

function makeOrder(overrides: Partial<KitOrderRecord> = {}): KitOrderRecord {
  return {
    orderId: 'ord_1',
    paymentId: 'pay_1',
    reference: 'HG-KIT-1',
    createdAt: '2026-06-20T12:00:00.000Z',
    contact: { name: 'Ada', email: 'ada@example.com', phone: '555-0100', address: '1 Main St, Town' },
    crafts: [{ craftId: 'c1', name: 'Pottery', qty: 15, perHeadCents: 2000 }],
    guests: 15,
    theme: { themeId: 'sweet-sixteen', ledgerThemeId: 'gilded', serves: 15, packagePriceCents: 10000, depositCents: 7500 },
    partyDate: '2026-07-18',
    pickupDate: '2026-07-16',
    returnBy: '2026-07-22',
    weekKey: '2026-07-16',
    totalChargedCents: 30000,
    status: 'upcoming',
    events: [{ at: '2026-06-20T12:00:00.000Z', action: 'order' }],
    ...overrides,
  }
}

function ctx(body: any) {
  const request = new Request('http://localhost/api/staff/kit-cancel.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = true
  mockRefund.mockResolvedValue({ id: 'ref-1', paymentId: 'pay_1', amountCents: 0, status: 'COMPLETED' })
  POST = (await import('@pages/api/staff/kit-cancel.json')).POST
})
afterEach(() => vi.useRealTimers())

describe('POST /api/staff/kit-cancel.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = false
    record = makeOrder()
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(401)
  })

  it('404 for an unknown order', async () => {
    mockGetKitOrder.mockResolvedValueOnce(null as any)
    expect((await POST(ctx({ orderId: 'nope' }))).status).toBe(404)
  })

  for (const status of ['out', 'returned', 'forfeited', 'cancelled'] as const) {
    it(`rejects cancelling a ${status} order with 409 and never refunds`, async () => {
      record = makeOrder({ status })
      const res = await POST(ctx({ orderId: 'ord_1' }))
      expect(res.status).toBe(409)
      expect(mockRefund).not.toHaveBeenCalled()
      expect(mockRelease).not.toHaveBeenCalled()
    })
  }

  it('≥7 days out → full refund, releases the ledger week, marks cancelled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z')) // pickup 07-16, cutoff 07-09 → free
    record = makeOrder({ status: 'upcoming' })
    const res = await POST(ctx({ orderId: 'ord_1' }))
    const payload = JSON.parse(await res.text())
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 30000, idempotencyKey: 'kitcancel-ord_1' }),
    )
    expect(mockRelease).toHaveBeenCalledWith('gilded', '2026-07-16', 'HG-KIT-1')
    expect(record.status).toBe('cancelled')
    expect(payload.data.refundCents).toBe(30000)
    expect(payload.data.assemblyWithheld).toBe(false)
  })

  it('inside 7 days → refund minus the assembly fee', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z')) // past the 07-09 cutoff
    record = makeOrder({ status: 'upcoming' })
    const res = await POST(ctx({ orderId: 'ord_1' }))
    const payload = JSON.parse(await res.text())
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 25000 })) // 30000 − 5000 assembly
    expect(payload.data.assemblyWithheld).toBe(true)
    expect(record.status).toBe('cancelled')
  })

  it('crafts-only cancel refunds but does not touch the ledger', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
    record = makeOrder({ status: 'upcoming', theme: undefined, totalChargedCents: 20000 })
    const res = await POST(ctx({ orderId: 'ord_1' }))
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 20000 }))
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('double-submit is money-safe: the second cancel sees cancelled and 409s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
    record = makeOrder({ status: 'upcoming' })
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(200)
    // record is now 'cancelled' (mutate applied) — a re-submit is rejected.
    const res2 = await POST(ctx({ orderId: 'ord_1' }))
    expect(res2.status).toBe(409)
    expect(mockRefund).toHaveBeenCalledTimes(1)
  })
})
