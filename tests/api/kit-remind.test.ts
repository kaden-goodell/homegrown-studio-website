import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { KitOrderRecord } from '@lib/kit-store'

let authed = true
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

let configured = true
const mockSend = vi.fn()
vi.mock('@lib/quo', () => ({
  quoConfigured: () => configured,
  sendQuoText: (...a: any[]) => mockSend(...a),
}))

let record: KitOrderRecord | null
const mockMutate = vi.fn(async (_id: string, fn: (o: KitOrderRecord) => void) => {
  fn(record!)
  return record!
})
vi.mock('@lib/kit-store', () => ({
  getKitOrder: async () => record,
  mutateKitOrder: (...a: any[]) => (mockMutate as any)(...a),
}))

function makeOrder(overrides: Partial<KitOrderRecord> = {}): KitOrderRecord {
  return {
    orderId: 'ord_1',
    paymentId: 'pay_1',
    reference: 'KIT-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    contact: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '(256) 555-0123', address: '1 Main St' },
    crafts: [{ craftId: 'c1', name: 'Pottery', qty: 10, perHeadCents: 2000 }],
    guests: 10,
    theme: { themeId: 'gilded', ledgerThemeId: 'gilded', serves: 10, packagePriceCents: 12500, depositCents: 5000 },
    partyDate: '2026-07-18',
    pickupDate: '2026-07-16',
    returnBy: '2026-07-22',
    weekKey: '2026-07-16',
    totalChargedCents: 5000,
    status: 'out',
    events: [{ at: '2026-07-01T00:00:00.000Z', action: 'order' }],
    ...overrides,
  }
}

function ctx(body: any) {
  return {
    request: new Request('http://localhost/api/staff/kit-remind.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = true
  configured = true
  record = makeOrder()
  mockSend.mockResolvedValue(undefined)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-21T18:00:00.000Z'))
  POST = (await import('@pages/api/staff/kit-remind.json')).POST
})
afterEach(() => vi.useRealTimers())

describe('POST /api/staff/kit-remind.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = false
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(401)
  })

  it('503 with a clear message when Quo is not configured — no send attempted', async () => {
    configured = false
    const res = await POST(ctx({ orderId: 'ord_1' }))
    expect(res.status).toBe(503)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends the reminder with name, return day, and window, and logs the event', async () => {
    const res = await POST(ctx({ orderId: 'ord_1', byStaff: 'catherine' }))
    expect(res.status).toBe(200)
    const { to, content } = mockSend.mock.calls[0][0]
    expect(to).toBe('(256) 555-0123')
    expect(content).toContain('Hi Ada!')
    expect(content).toContain('Wednesday, July 22')
    expect(content).toContain('4–6 PM')
    const last = record!.events.at(-1)!
    expect(last.action).toBe('reminder')
    expect(last.byStaff).toBe('catherine')
  })

  it('rejects a non-checked-out order with 409', async () => {
    record = makeOrder({ status: 'upcoming' })
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(409)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('cooldown: a reminder within 20h blocks a repeat, an older one does not', async () => {
    record = makeOrder({
      events: [
        { at: '2026-07-01T00:00:00.000Z', action: 'order' },
        { at: '2026-07-21T10:00:00.000Z', action: 'reminder' }, // 8h ago
      ],
    })
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(409)
    expect(mockSend).not.toHaveBeenCalled()

    record = makeOrder({
      events: [
        { at: '2026-07-01T00:00:00.000Z', action: 'order' },
        { at: '2026-07-20T10:00:00.000Z', action: 'reminder' }, // 32h ago
      ],
    })
    expect((await POST(ctx({ orderId: 'ord_1' }))).status).toBe(200)
    expect(mockSend).toHaveBeenCalledOnce()
  })

  it('a failed Quo send returns 502 and does NOT log a reminder event', async () => {
    mockSend.mockRejectedValue(new Error('Quo API 500'))
    const res = await POST(ctx({ orderId: 'ord_1' }))
    expect(res.status).toBe(502)
    expect(record!.events.at(-1)!.action).toBe('order')
  })
})
