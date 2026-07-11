import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KitOrderRecord } from '@lib/kit-store'

// --- Module mocks (hoisted) ---
let authed = true
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockRefund = vi.fn()
vi.mock('@config/providers', () => ({
  providers: { payment: { refundPayment: (...a: any[]) => mockRefund(...a) } },
}))

// getKitOrder returns the shared record; mutateKitOrder applies the callback to
// it and returns it — so the endpoint's mutations are observable on `record`.
let record: KitOrderRecord
const mockGetKitOrder = vi.fn(async (..._a: any[]) => record)
const mockMutate = vi.fn(async (_id: string, fn: (o: KitOrderRecord) => void | Promise<void>) => {
  await fn(record)
  return record
})
vi.mock('@lib/kit-store', () => ({
  getKitOrder: (...a: any[]) => mockGetKitOrder(...a),
  mutateKitOrder: (...a: any[]) => (mockMutate as any)(...a),
}))

function makeOrder(overrides: Partial<KitOrderRecord> = {}): KitOrderRecord {
  return {
    orderId: 'ord_1',
    paymentId: 'pay_1',
    reference: 'HG-KIT-1',
    createdAt: '2026-07-11T12:00:00.000Z',
    contact: { name: 'Ada', email: 'ada@example.com', phone: '555-0100', address: '1 Main St, Town' },
    crafts: [{ craftId: 'c1', name: 'Pottery', qty: 15, perHeadCents: 2000 }],
    guests: 15,
    theme: { themeId: 'sweet-sixteen', ledgerThemeId: 'gilded', serves: 15, packagePriceCents: 10000, depositCents: 7500 },
    partyDate: '2026-07-18',
    pickupDate: '2026-07-16',
    returnBy: '2026-07-22',
    weekKey: '2026-07-16',
    totalChargedCents: 30000,
    status: 'out',
    events: [{ at: '2026-07-11T12:00:00.000Z', action: 'order' }],
    ...overrides,
  }
}

function ctx(body: any) {
  const request = new Request('http://localhost/api/staff/kit-return.json', {
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
  POST = (await import('@pages/api/staff/kit-return.json')).POST
})

describe('POST /api/staff/kit-return.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = false
    record = makeOrder()
    const res = await POST(ctx({ orderId: 'ord_1', action: 'complete' }))
    expect(res.status).toBe(401)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('complete → refunds the full deposit and marks returned', async () => {
    record = makeOrder({ status: 'out' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'complete' }))
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_1', amountCents: 7500, idempotencyKey: 'kitret-ord_1' }),
    )
    expect(record.status).toBe('returned')
    expect(record.depositRefund).toMatchObject({ amountCents: 7500, refundId: 'ref-1' })
    expect(record.events.at(-1)?.action).toBe('return-complete')
  })

  it('partial → refunds deposit minus the withheld amount and records the note', async () => {
    record = makeOrder({ status: 'out' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'partial', withheldCents: 2000, note: 'chipped plate' }))
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 5500 }))
    expect(record.status).toBe('returned')
    expect(record.depositRefund?.amountCents).toBe(5500)
    const ev = record.events.at(-1)
    expect(ev?.action).toBe('return-partial')
    expect(ev?.note).toBe('chipped plate')
  })

  it('partial → 400 and no refund when the note is missing', async () => {
    record = makeOrder({ status: 'out' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'partial', withheldCents: 2000 }))
    expect(res.status).toBe(400)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('partial → 400 when withholding more than the deposit', async () => {
    record = makeOrder({ status: 'out' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'partial', withheldCents: 9999, note: 'lots' }))
    expect(res.status).toBe(400)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('forfeit → no refund, status forfeited', async () => {
    record = makeOrder({ status: 'out' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'forfeit', note: 'never returned' }))
    expect(res.status).toBe(200)
    expect(mockRefund).not.toHaveBeenCalled()
    expect(record.status).toBe('forfeited')
    expect(record.events.at(-1)?.action).toBe('forfeit')
  })

  it('pickup on a themed order → out (starts the return clock), no refund', async () => {
    record = makeOrder({ status: 'upcoming' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'pickup' }))
    expect(res.status).toBe(200)
    expect(record.status).toBe('out')
    expect(mockRefund).not.toHaveBeenCalled()
    expect(record.events.at(-1)?.action).toBe('pickup')
  })

  it('LR-4: pickup on a crafts-only order settles it directly, never refunds', async () => {
    record = makeOrder({ status: 'upcoming', theme: undefined })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'pickup' }))
    expect(res.status).toBe(200)
    expect(record.status).toBe('returned')
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('undo before any refund reverts a forfeit back to out', async () => {
    record = makeOrder({ status: 'forfeited' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'undo' }))
    expect(res.status).toBe(200)
    expect(record.status).toBe('out')
    expect(record.events.at(-1)?.action).toBe('undo')
  })

  it('undo after a refund was sent → 409 with dashboard instructions', async () => {
    record = makeOrder({ status: 'returned', depositRefund: { amountCents: 7500, refundId: 'ref-1', at: '2026-07-22T00:00:00.000Z' } })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'undo' }))
    expect(res.status).toBe(409)
    expect(record.status).toBe('returned') // untouched
  })

  it('complete on a crafts-only order → 400 (no deposit)', async () => {
    record = makeOrder({ status: 'out', theme: undefined })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'complete' }))
    expect(res.status).toBe(400)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('complete when the order is not out → 409', async () => {
    record = makeOrder({ status: 'upcoming' })
    const res = await POST(ctx({ orderId: 'ord_1', action: 'complete' }))
    expect(res.status).toBe(409)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it('404 for an unknown order', async () => {
    record = undefined as any
    mockGetKitOrder.mockResolvedValueOnce(null as any)
    const res = await POST(ctx({ orderId: 'nope', action: 'complete' }))
    expect(res.status).toBe(404)
  })
})
