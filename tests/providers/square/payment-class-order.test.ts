import { describe, it, expect, vi, beforeEach } from 'vitest'

const squareFetch = vi.fn()
vi.mock('../../../src/lib/classes/square-api', () => ({ squareFetch: (...a: any[]) => squareFetch(...a) }))
vi.mock('square', () => ({
  SquareClient: class { constructor(_o: any) {} },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
}))

import { SquarePaymentProvider } from '../../../src/providers/square/payment'
import { MockPaymentProvider } from '../../../src/providers/mock/payment'

const cfg = { accessToken: 't', environment: 'sandbox', locationId: 'L', applicationId: 'a' } as any

const squareOrder = {
  order: {
    id: 'ord-1',
    total_money: { amount: 2180, currency: 'USD' },
    line_items: [
      { uid: 'l0', total_money: { amount: 1090 }, total_tax_money: { amount: 90 } },
      { uid: 'l1', total_money: { amount: 1090 }, total_tax_money: { amount: 90 } },
    ],
  },
}
const base = {
  locationId: 'L',
  customerId: 'C1' as string | null,
  idempotencyKey: 'idem-1',
  referenceId: 'bk-1',
  lines: [
    { catalogObjectId: 'V1', quantity: 1 as const, note: 'Ann' },
    { catalogObjectId: 'V2', quantity: 1 as const, note: 'x'.repeat(600) },
  ],
}

describe('SquarePaymentProvider.createClassOrder', () => {
  let p: SquarePaymentProvider
  beforeEach(() => { squareFetch.mockReset(); squareFetch.mockResolvedValue(squareOrder); p = new SquarePaymentProvider(cfg) })

  it('posts catalog lines with auto-applied tax and no explicit taxes', async () => {
    await p.createClassOrder(base)
    const [path, init] = squareFetch.mock.calls[0]
    expect(path).toBe('/orders')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.idempotency_key).toBe('idem-1')
    expect(body.order.pricing_options).toEqual({ auto_apply_taxes: true })
    expect(body.order).not.toHaveProperty('taxes')
    expect(body.order.location_id).toBe('L')
    expect(body.order.customer_id).toBe('C1')
    expect(body.order.reference_id).toBe('bk-1')
    expect(body.order.line_items[0]).toEqual({ uid: 'l0', catalog_object_id: 'V1', quantity: '1', note: 'Ann' })
    expect(body.order.line_items[1].note).toHaveLength(500)
    expect(body.order).not.toHaveProperty('discounts')
  })

  it('omits customer_id when null', async () => {
    await p.createClassOrder({ ...base, customerId: null })
    const body = JSON.parse(squareFetch.mock.calls[0][1].body)
    expect(body.order).not.toHaveProperty('customer_id')
  })

  it('line discounts body: one LINE_ITEM fixed amount per discount per line, applied only to its line', async () => {
    const three = { ...base, lines: [...base.lines, { catalogObjectId: 'V3', quantity: 1 as const, note: 'Cy' }] }
    squareFetch.mockResolvedValue({ order: { ...squareOrder.order, line_items: [...squareOrder.order.line_items, { uid: 'l2', total_money: { amount: 1 }, total_tax_money: { amount: 0 } }] } })
    await p.createClassOrder({
      ...three,
      lineDiscounts: [
        { line: 0, name: 'Early-bird', cents: 500 },
        { line: 0, name: 'Code FALLFRIENDS', cents: 167 },
        { line: 2, name: 'Code FALLFRIENDS', cents: 166 },
      ],
    })
    const body = JSON.parse(squareFetch.mock.calls[0][1].body)
    expect(body.order.discounts).toEqual([
      { uid: 'd0-0', name: 'Early-bird', type: 'FIXED_AMOUNT', amount_money: { amount: 500, currency: 'USD' }, scope: 'LINE_ITEM' },
      { uid: 'd0-1', name: 'Code FALLFRIENDS', type: 'FIXED_AMOUNT', amount_money: { amount: 167, currency: 'USD' }, scope: 'LINE_ITEM' },
      { uid: 'd2-0', name: 'Code FALLFRIENDS', type: 'FIXED_AMOUNT', amount_money: { amount: 166, currency: 'USD' }, scope: 'LINE_ITEM' },
    ])
    expect(new Set(body.order.discounts.map((d: any) => d.uid)).size).toBe(3)
    expect(body.order.discounts.some((d: any) => d.scope === 'ORDER')).toBe(false)
    expect(body.order.line_items[0].applied_discounts).toEqual([{ discount_uid: 'd0-0' }, { discount_uid: 'd0-1' }])
    expect(body.order.line_items[1]).not.toHaveProperty('applied_discounts')
    expect(body.order.line_items[2].applied_discounts).toEqual([{ discount_uid: 'd2-0' }])
    // Square still adds the catalog tax itself, on the discounted line.
    expect(body.order.pricing_options).toEqual({ auto_apply_taxes: true })
    expect(body.order).not.toHaveProperty('taxes')
  })

  it('no discounts → no discounts key and no applied_discounts; a zero discount is left out; a bad line index throws before Square', async () => {
    await p.createClassOrder({ ...base, lineDiscounts: [] })
    let body = JSON.parse(squareFetch.mock.calls[0][1].body)
    expect(body.order).not.toHaveProperty('discounts')
    expect(body.order.line_items.every((l: any) => !('applied_discounts' in l))).toBe(true)
    await p.createClassOrder({ ...base, lineDiscounts: [{ line: 1, name: 'Early-bird', cents: 0 }] })
    body = JSON.parse(squareFetch.mock.calls[1][1].body)
    expect(body.order).not.toHaveProperty('discounts')
    squareFetch.mockClear()
    await expect(p.createClassOrder({ ...base, lineDiscounts: [{ line: 5, name: 'X', cents: 100 }] })).rejects.toThrow('order line 5')
    expect(squareFetch).not.toHaveBeenCalled()
  })

  it('reads lineTotals from each line\'s total_money / total_tax_money (discounted lines too)', async () => {
    squareFetch.mockResolvedValue({ order: { id: 'ord-2', total_money: { amount: 1453 }, line_items: [
      { uid: 'l0', total_money: { amount: 1145 }, total_tax_money: { amount: 95 }, total_discount_money: { amount: 450 } },
      { uid: 'l1', total_money: { amount: 308 }, total_tax_money: { amount: 25 } },
    ] } })
    const r = await p.createClassOrder({ ...base, lineDiscounts: [{ line: 0, name: 'Code X', cents: 450 }] })
    expect(r.totalCents).toBe(1453)
    expect(r.lineTotals).toEqual([{ uid: 'l0', totalCents: 1145, taxCents: 95 }, { uid: 'l1', totalCents: 308, taxCents: 25 }])
  })

  it('returns id, total, uids in order and per-line totals', async () => {
    const r = await p.createClassOrder(base)
    expect(r.orderId).toBe('ord-1')
    expect(r.totalCents).toBe(2180)
    expect(r.lineUids).toEqual(['l0', 'l1'])
    expect(r.lineTotals).toEqual([{ uid: 'l0', totalCents: 1090, taxCents: 90 }, { uid: 'l1', totalCents: 1090, taxCents: 90 }])
  })

  it('maps a reordered response back by uid', async () => {
    squareFetch.mockResolvedValue({ order: { ...squareOrder.order, line_items: [
      { uid: 'l1', total_money: { amount: 200 }, total_tax_money: { amount: 20 } },
      { uid: 'l0', total_money: { amount: 100 }, total_tax_money: { amount: 10 } },
    ] } })
    const r = await p.createClassOrder(base)
    expect(r.lineTotals).toEqual([{ uid: 'l0', totalCents: 100, taxCents: 10 }, { uid: 'l1', totalCents: 200, taxCents: 20 }])
  })

  it('throws on short, unknown-uid or missing-id responses', async () => {
    squareFetch.mockResolvedValue({ order: { ...squareOrder.order, line_items: [] } })
    await expect(p.createClassOrder(base)).rejects.toThrow()
    squareFetch.mockResolvedValue({ order: { ...squareOrder.order, line_items: [{ uid: 'l0' }, { uid: 'zz' }] } })
    await expect(p.createClassOrder(base)).rejects.toThrow('missing line')
    squareFetch.mockResolvedValue({ order: { ...squareOrder.order, id: undefined } })
    await expect(p.createClassOrder(base)).rejects.toThrow('without an id')
  })

  it('lets Square errors through', async () => {
    squareFetch.mockRejectedValue(new Error('Square said: nope'))
    await expect(p.createClassOrder(base)).rejects.toThrow('nope')
  })
})

describe('MockPaymentProvider.createClassOrder', () => {
  it('prices lines from the prices map with 9% tax', async () => {
    const m = new MockPaymentProvider()
    m.prices = { V1: 1000, V2: 2500 }
    const r = await m.createClassOrder(base)
    expect(r.lineUids).toHaveLength(2)
    expect(r.lineTotals.map((l) => l.taxCents)).toEqual([90, 225])
    expect(r.totalCents).toBe(1090 + 2725)
  })
  it('takes line discounts off their own line before its 9%, and its line totals add up to the total', async () => {
    const m = new MockPaymentProvider()
    m.prices = { V1: 1500, V2: 1500 }
    // 30% off $15 = $4.50 off → $10.50, tax 94.5 → 95 (half up, as quote() does).
    const r = await m.createClassOrder({ ...base, lineDiscounts: [{ line: 0, name: 'Code X', cents: 450 }] })
    expect(r.lineTotals.map((l) => [l.totalCents, l.taxCents])).toEqual([[1145, 95], [1635, 135]])
    expect(r.totalCents).toBe(1145 + 1635)
    expect(r.lineTotals.reduce((s, l) => s + l.totalCents, 0)).toBe(r.totalCents)
  })
})

describe('mock order totals match quote() for the discounted cases (Task 3)', () => {
  it('early-bird + a code, $ split over three seats + an add-on, and a $0 line all come out to the cent', async () => {
    const { quote } = await import('../../../src/lib/classes/pricing')
    const { orderLinesFor } = await import('../../../src/lib/classes/checkout')
    const { defaultRules } = await import('../../../src/lib/classes/validate')
    const now = new Date('2026-10-10T17:00:00Z')
    const cls: any = {
      id: 'cls_mockq', libraryId: null, libraryVersion: null, status: 'open',
      content: {
        name: 'Q', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
        ticketTypes: [{ id: 'p', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
        prices: { all: { p: 1500 } }, questions: [], addOns: [{ id: 'glaze', label: 'Glaze', priceCents: 300, maxPerSeat: 2 }],
        defaultCapacity: 10, defaultMinutes: 60, earlyBird: { untilYmd: '2026-10-30', prices: { all: { p: 1200 } } },
      },
      sessions: [{ id: 's1', startIso: '2026-11-20T18:00:00Z', endIso: '2026-11-20T19:00:00Z', capacity: 10 }],
      square: { itemId: 'I', variations: { 'all:p': 'VP', 'addon:glaze': 'VG' } },
      createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [],
    }
    const promo = (over: any): any => ({ code: 'FALL', label: '', off: { kind: 'amount', cents: 500 }, per: 'booking', appliesTo: { kind: 'all' }, includeExtras: false, endsYmd: null, maxUses: null, active: true, createdAt: '', updatedAt: '', by: { id: 'k', name: 'K' }, history: [], ...over })
    const req = { passId: 'all', tickets: { p: 3 }, seats: [{ addOns: { glaze: 1 } }, {}, {}] }
    for (const p of [null, promo({}), promo({ off: { kind: 'percent', percent: 30 } }), promo({ off: { kind: 'amount', cents: 10_000 } }), promo({ includeExtras: true })]) {
      const q = quote(cls, req, now, 9, { promo: p })
      if (!q.ok) throw new Error(q.error)
      const ol = orderLinesFor(cls, q.value, req.seats as any)
      if (!ol.ok) throw new Error(ol.missing)
      const m = new MockPaymentProvider()
      m.prices = { VP: 1500, VG: 300 }
      const r = await m.createClassOrder({ ...base, lines: ol.lines, lineDiscounts: ol.discounts })
      expect(r.totalCents).toBe(q.value.totalCents)
      expect(r.lineTotals.map((l) => l.taxCents)).toEqual(q.value.lines.map((l) => l.taxCents))
    }
  })
})
