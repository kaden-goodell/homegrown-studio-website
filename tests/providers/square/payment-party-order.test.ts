import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOrdersCreate = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    orders = { create: mockOrdersCreate }
    payments = { create: vi.fn() }
    constructor(_opts: any) {}
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
}))

import { SquarePaymentProvider } from '../../../src/providers/square/payment'
import { orderLineItems } from '../../../src/lib/parties/pricing'

const provider = () => new SquarePaymentProvider({ accessToken: 't', environment: 'sandbox', locationId: 'L', applicationId: 'a' })

beforeEach(() => {
  mockOrdersCreate.mockReset().mockResolvedValue({ order: { id: 'O1', version: 1, state: 'OPEN', totalMoney: { amount: 32500n, currency: 'USD' } } })
})

describe('the party order Square receives', () => {
  it('carries the party id as reference_id and each line its note, untaxed: no pricing_options, no taxes', async () => {
    const lines = orderLineItems(
      [
        { kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000 },
        { kind: 'addon', refId: 'add_time', label: 'Extra half hour', qty: 1, unitCents: 2500 },
      ],
      'Whole studio', 'pkg_whole',
    )
    const order = await provider().createOrder({ locationId: 'L', customerId: 'C', lineItems: lines, idempotencyKey: 'k:order', referenceId: 'pty_0123456789abcdef' })
    expect(order.totalAmount).toBe(32500)
    const body = mockOrdersCreate.mock.calls[0][0]
    expect(body.idempotencyKey).toBe('k:order')
    expect(body.order.referenceId).toBe('pty_0123456789abcdef')
    expect(body.order.customerId).toBe('C')
    expect(body.order.lineItems).toEqual([
      { name: 'Whole Studio Party — studio fee', quantity: '1', basePriceMoney: { amount: 30000n, currency: 'USD' }, note: 'pkg_whole' },
      { name: 'Whole Studio Party — Extra half hour', quantity: '1', basePriceMoney: { amount: 2500n, currency: 'USD' }, note: 'add_time' },
    ])
    expect(body.order).not.toHaveProperty('pricingOptions')
    expect(body.order).not.toHaveProperty('taxes')
    expect(body.order.discounts).toBeUndefined()
    expect(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toMatch(/pricing_?options|auto_?apply|taxes/i)
  })

  it('leaves the customer off when the lookup failed, and the reference off when none is given', async () => {
    await provider().createOrder({ locationId: 'L', customerId: null, lineItems: [{ name: 'X', quantity: 1, pricePerUnit: 100 }] })
    const body = mockOrdersCreate.mock.calls[0][0]
    expect(body.order).not.toHaveProperty('customerId')
    expect(body.order).not.toHaveProperty('referenceId')
    expect(body.order.lineItems[0]).not.toHaveProperty('note')
  })
})
