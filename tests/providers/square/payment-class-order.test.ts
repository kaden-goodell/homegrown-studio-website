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
      { uid: 'u1', total_money: { amount: 1090 }, total_tax_money: { amount: 90 } },
      { uid: 'u2', total_money: { amount: 1090 }, total_tax_money: { amount: 90 } },
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
    expect(body.order.line_items[0]).toEqual({ catalog_object_id: 'V1', quantity: '1', note: 'Ann' })
    expect(body.order.line_items[1].note).toHaveLength(500)
    expect(body.order).not.toHaveProperty('discounts')
  })

  it('omits customer_id when null; adds an order-scoped fixed discount', async () => {
    await p.createClassOrder({ ...base, customerId: null, discount: { name: 'PROMO', cents: 500 } })
    const body = JSON.parse(squareFetch.mock.calls[0][1].body)
    expect(body.order).not.toHaveProperty('customer_id')
    expect(body.order.discounts).toEqual([{ name: 'PROMO', amount_money: { amount: 500, currency: 'USD' }, scope: 'ORDER' }])
  })

  it('returns id, total, uids in order and per-line totals', async () => {
    const r = await p.createClassOrder(base)
    expect(r.orderId).toBe('ord-1')
    expect(r.totalCents).toBe(2180)
    expect(r.lineUids).toEqual(['u1', 'u2'])
    expect(r.lineTotals).toEqual([{ uid: 'u1', totalCents: 1090, taxCents: 90 }, { uid: 'u2', totalCents: 1090, taxCents: 90 }])
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
  it('applies a discount to the total', async () => {
    const m = new MockPaymentProvider()
    m.prices = { V1: 1000, V2: 1000 }
    const r = await m.createClassOrder({ ...base, discount: { name: 'P', cents: 500 } })
    expect(r.totalCents).toBe(2180 - 500)
  })
})
