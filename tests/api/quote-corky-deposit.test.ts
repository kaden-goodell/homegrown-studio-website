/**
 * POST /api/quote/corky-deposit.json: the $1,500 deposit on Jessyca's quote
 * page. Square (orders and payments), the owners' texts and emails are fakes;
 * the real chargeOrder runs on top of the fake Square, so the amount checked
 * is the one that would reach Square.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  alert: vi.fn(),
  sendEmail: vi.fn(),
  bypass: { on: false },
  testSite: null as string | null,
}))

vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
    },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => m.sendEmail(...a) }))
vi.mock('@lib/notify-settings', () => ({ emailsFor: async () => 'owners@example.com' }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => m.bypass.on }))
vi.mock('@lib/classes/test-site-guard', () => ({ classWritesRefusal: () => m.testSite }))

import { POST, DEPOSIT_CENTS, DEPOSIT_LINE, DECLINED_MESSAGE } from '@pages/api/quote/corky-deposit.json'

let ip = 0
const post = async (b: unknown, address?: string) => {
  const res = (await POST({
    request: new Request('http://localhost/api/quote/corky-deposit.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) }),
    clientAddress: address ?? `10.9.0.${++ip}`,
  } as any)) as Response
  return { status: res.status, json: await res.json() }
}
const body = (over: Record<string, unknown> = {}) => ({
  attemptId: randomUUID(), paymentToken: 'cnon:ok', sourceKind: 'card',
  firstName: 'Jessyca', lastName: 'Test', email: 'jessyca@example.com', phone: '(256) 555-0100', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.bypass.on = false
  m.testSite = null
  m.createOrder.mockImplementation(async (req: any) => ({
    id: `ord-${req.idempotencyKey}`, totalAmount: req.lineItems.reduce((t: number, l: any) => t + l.quantity * l.pricePerUnit, 0),
  }))
  m.findOrderPayment.mockResolvedValue(null)
  m.processPayment.mockImplementation(async (p: any) => ({ id: 'pay-1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://squareup.com/receipt/1' }))
  m.alert.mockResolvedValue({ attempted: 1, sent: 1 })
  m.sendEmail.mockResolvedValue({ sent: true })
})

describe('POST /api/quote/corky-deposit.json', () => {
  it('always charges $1,500, whatever the page sends', async () => {
    const res = await post(body({ amount: 1, amountCents: 100, expectedCents: 5, total: '1.00' }))
    expect(res.status).toBe(200)
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    const order = m.createOrder.mock.calls[0][0]
    expect(order.lineItems).toEqual([expect.objectContaining({ name: DEPOSIT_LINE, quantity: 1, pricePerUnit: 150000 })])
    expect(order.idempotencyKey).toMatch(/:order$/)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    const charge = m.processPayment.mock.calls[0][0]
    expect(charge.amount).toBe(150000)
    expect(DEPOSIT_CENTS).toBe(150000)
    expect(charge.buyerEmailAddress).toBe('jessyca@example.com')
    expect(charge.idempotencyKey).toMatch(/:pay$/)
  })

  it('paid → 200 with the receipt, one owner text and the owners’ email', async () => {
    const res = await post(body({ verificationToken: 'verf-1' }))
    expect(res).toEqual({ status: 200, json: { data: { paid: true, receiptUrl: 'https://squareup.com/receipt/1' } } })
    expect(m.processPayment.mock.calls[0][0].verificationToken).toBe('verf-1')
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert).toHaveBeenCalledWith('Deposit paid: Corky Child Care Collective, Dec 12, $1,500 (Jessyca Test, (256) 555-0100)', 'booking-alerts')
    expect(m.sendEmail).toHaveBeenCalledTimes(1)
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'owners@example.com', subject: expect.stringContaining('Deposit paid') })
  })

  it('a retry whose order is already paid is not charged again', async () => {
    m.findOrderPayment.mockResolvedValue({ id: 'pay-0', orderId: 'x', amount: 150000, status: 'completed', receiptUrl: 'https://r/0' })
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(res.json.data.receiptUrl).toBe('https://r/0')
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('declined → 402 with the plain message, no alert', async () => {
    m.processPayment.mockRejectedValue(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const res = await post(body())
    expect(res.status).toBe(402)
    expect(res.json).toMatchObject({ code: 'card_declined', detail: DECLINED_MESSAGE })
    expect(m.alert).not.toHaveBeenCalled()
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it('no answer from Square → 202 checking, and the owners are told it is unclear', async () => {
    m.processPayment.mockRejectedValue(new Error('socket hang up'))
    const res = await post(body())
    expect(res.status).toBe(202)
    expect(res.json).toMatchObject({ why: 'checking' })
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/^Deposit unclear: Corky Child Care Collective, Dec 12, \$1,500 \(Jessyca Test, \(256\) 555-0100\)\. Check Square/)
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{nope'],
    ['no attempt id', body({ attemptId: 'abc' })],
    ['no first name', body({ firstName: ' ' })],
    ['no last name', body({ lastName: '' })],
    ['a bad email', body({ email: 'jessyca@' })],
    ['a short phone', body({ phone: '555-0100' })],
    ['no payment token', body({ paymentToken: '' })],
  ])('bad body (%s) → 400, nothing reaches Square', async (_name, b) => {
    const res = await post(b)
    expect(res.status).toBe(400)
    expect(res.json.code).toBe('invalid')
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('rate limit → 429 after 5 tries a minute from one address', async () => {
    const address = '10.99.99.99'
    for (let i = 0; i < 5; i++) expect((await post(body({ firstName: '' }), address)).status).toBe(400)
    const res = await post(body(), address)
    expect(res.status).toBe(429)
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('payment bypass → simulated paid, no Square, no texts', async () => {
    m.bypass.on = true
    const res = await post(body({ paymentToken: 'mock-payment-token' }))
    expect(res).toEqual({ status: 200, json: { data: { paid: true, simulated: true } } })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(m.alert).not.toHaveBeenCalled()
  })

  it('a test site sharing the live Square refuses before any order', async () => {
    m.testSite = 'This test site has no store of its own. Set STORE_NAMESPACE first.'
    const res = await post(body())
    expect(res.status).toBe(503)
    expect(m.createOrder).not.toHaveBeenCalled()
  })
})
