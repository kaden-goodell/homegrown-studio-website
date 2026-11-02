/** Stage 4 Task 8: saved cards through the payment provider (Cards API + seller-initiated CreatePayment), raw REST mocked. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const squareFetch = vi.fn()
vi.mock('../../../src/lib/classes/square-api', () => ({ squareFetch: (...a: any[]) => squareFetch(...a) }))
const sdkPaymentsCreate = vi.fn()
vi.mock('square', () => ({
  SquareClient: class { payments = { create: sdkPaymentsCreate }; constructor(_o: any) {} },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
}))

import { SquarePaymentProvider } from '../../../src/providers/square/payment'
import { MockPaymentProvider } from '../../../src/providers/mock/payment'
import { chargeOutcomeOf, squareErrorCodes } from '../../../src/lib/checkout-attempt'
import { cardTroubleOf, CHARGE_TROUBLE_WORDS, SAVE_CARD_MESSAGES } from '../../../src/lib/saved-cards'

const cfg = { accessToken: 't', environment: 'sandbox', locationId: 'LOC1', applicationId: 'a' } as any
/** What squareFetch throws on a non-2xx answer. */
const refusal = (status: number, code: string, detail = code, category = 'PAYMENT_METHOD_ERROR') =>
  Object.assign(new Error(`Square said: ${detail}`), { status, errors: [{ code, detail, category }] })
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
const CARD_FIELDS = /card_number|cardNumber|\bpan\b|cvv|cvc|security_code/i

const saveInput = { customerId: 'CUST1', sourceToken: 'cnon:card-nonce-ok', verificationToken: 'verf:1', idempotencyKey: 'wl:wle_1:1:card', referenceId: 'wle_1' }
const chargeInput = { orderId: 'ORD1', cardId: 'ccof:abc', customerId: 'CUST1', amount: 2180, idempotencyKey: 'wl:wle_1:1:pay', buyerEmailAddress: 'jane@example.com', note: 'Waitlist: Potholder Looms Sat Oct 24 10 AM' }

describe('SquarePaymentProvider saved cards', () => {
  let p: SquarePaymentProvider
  beforeEach(() => { squareFetch.mockReset(); sdkPaymentsCreate.mockReset(); p = new SquarePaymentProvider(cfg) })

  it('saveCard: POST /cards with exactly the idempotency key, the token, the STORE verification token and the customer + reference; keeps only the card face', async () => {
    squareFetch.mockResolvedValue({ card: { id: 'ccof:abc', card_brand: 'VISA', last_4: '4242', exp_month: 11, exp_year: 2029, fingerprint: 'fp', bin: '411111', enabled: true, customer_id: 'CUST1' } })
    const card = await p.saveCard(saveInput)
    const [path, init] = squareFetch.mock.calls[0]
    expect(path).toBe('/cards')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ idempotency_key: 'wl:wle_1:1:card', source_id: 'cnon:card-nonce-ok', verification_token: 'verf:1', card: { customer_id: 'CUST1', reference_id: 'wle_1' } })
    expect(init.body).not.toMatch(CARD_FIELDS)
    expect(card).toEqual({ cardId: 'ccof:abc', brand: 'VISA', last4: '4242', expMonth: 11, expYear: 2029 })
  })

  it('saveCard leaves verification_token out when there is none', async () => {
    squareFetch.mockResolvedValue({ card: { id: 'ccof:x', card_brand: 'MASTERCARD', last_4: '5100', exp_month: 1, exp_year: 2030 } })
    await p.saveCard({ ...saveInput, verificationToken: null })
    expect(JSON.parse(squareFetch.mock.calls[0][1].body)).not.toHaveProperty('verification_token')
  })

  it('saveCard refusal comes back as a Square error chargeOutcomeOf reads (4xx → not charged, codes kept)', async () => {
    squareFetch.mockRejectedValue(refusal(400, 'CARD_DECLINED'))
    const err = await p.saveCard(saveInput).catch((e) => e)
    expect(err.statusCode).toBe(400)
    expect(chargeOutcomeOf(err)).toBe('not_charged')
    expect(squareErrorCodes(err)).toEqual(['CARD_DECLINED'])
    expect(SAVE_CARD_MESSAGES[cardTroubleOf(err)]).toBe('Your bank didn’t accept that card. Nothing was charged. Try another card.')
  })

  it('refuses an idempotency key Square would reject before calling it', async () => {
    await expect(p.saveCard({ ...saveInput, idempotencyKey: 'x'.repeat(46) })).rejects.toThrow(/1 to 45/)
    expect(squareFetch).not.toHaveBeenCalled()
  })

  it('disableCard: POST /cards/{id}/disable; already gone (404) or already disabled resolves; other failures throw', async () => {
    squareFetch.mockResolvedValueOnce({ card: { id: 'ccof:abc', enabled: false } })
    await p.disableCard('ccof:abc')
    expect(squareFetch.mock.calls[0][0]).toBe('/cards/ccof%3Aabc/disable')
    expect(squareFetch.mock.calls[0][1].method).toBe('POST')
    squareFetch.mockRejectedValueOnce(refusal(404, 'NOT_FOUND'))
    await expect(p.disableCard('ccof:gone')).resolves.toBeUndefined()
    squareFetch.mockRejectedValueOnce(refusal(400, 'INVALID_REQUEST_ERROR', 'Card is already disabled'))
    await expect(p.disableCard('ccof:off')).resolves.toBeUndefined()
    squareFetch.mockRejectedValueOnce(refusal(500, 'INTERNAL_SERVER_ERROR'))
    await expect(p.disableCard('ccof:abc')).rejects.toThrow()
    squareFetch.mockRejectedValueOnce(timeout())
    await expect(p.disableCard('ccof:abc')).rejects.toThrow()
  })

  it('chargeSavedCard: POST /payments seller-initiated with the card id, customer, order, autocomplete, note and the key; no card fields', async () => {
    squareFetch.mockResolvedValue({ payment: { id: 'PAY1', status: 'COMPLETED', amount_money: { amount: 2180, currency: 'USD' }, receipt_url: 'https://squareup.com/receipt/PAY1' } })
    const pay = await p.chargeSavedCard(chargeInput)
    const [path, init] = squareFetch.mock.calls[0]
    expect(path).toBe('/payments')
    expect(JSON.parse(init.body)).toEqual({
      idempotency_key: 'wl:wle_1:1:pay',
      source_id: 'ccof:abc',
      customer_id: 'CUST1',
      order_id: 'ORD1',
      amount_money: { amount: 2180, currency: 'USD' },
      autocomplete: true,
      location_id: 'LOC1',
      note: 'Waitlist: Potholder Looms Sat Oct 24 10 AM',
      customer_details: { customer_initiated: false, seller_keyed_in: false },
      buyer_email_address: 'jane@example.com',
    })
    expect(init.body).not.toMatch(CARD_FIELDS)
    expect(pay).toEqual({ id: 'PAY1', orderId: 'ORD1', amount: 2180, status: 'completed', receiptUrl: 'https://squareup.com/receipt/PAY1' })
    expect(sdkPaymentsCreate).not.toHaveBeenCalled()
  })

  it('chargeSavedCard refuses a non-positive or fractional amount without calling Square', async () => {
    await expect(p.chargeSavedCard({ ...chargeInput, amount: 0 })).rejects.toThrow()
    await expect(p.chargeSavedCard({ ...chargeInput, amount: 10.5 })).rejects.toThrow()
    expect(squareFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['CARD_DECLINED', 400, 'declined'],
    ['INSUFFICIENT_FUNDS', 400, 'no-funds'],
    ['CARD_EXPIRED', 400, 'expired'],
    ['CARD_DECLINED_VERIFICATION_REQUIRED', 400, 'verify'],
    ['CARD_NOT_FOUND', 400, 'card-gone'],
  ])('decline mapping: %s → not charged (never retried as unknown), %s', async (code, status, trouble) => {
    squareFetch.mockRejectedValue(refusal(status, code))
    const err = await p.chargeSavedCard(chargeInput).catch((e) => e)
    expect(chargeOutcomeOf(err)).toBe('not_charged')
    expect(cardTroubleOf(err)).toBe(trouble)
    expect(CHARGE_TROUBLE_WORDS[cardTroubleOf(err)]).toEqual(expect.any(String))
  })

  it('fix3 review: NOT_FOUND naming the card (detail or field) is card-gone; any other NOT_FOUND is setup', async () => {
    const nf = (detail: string, field?: string) => Object.assign(new Error(`Square said: ${detail}`), {
      status: 404, errors: [{ code: 'NOT_FOUND', detail, category: 'INVALID_REQUEST_ERROR', ...(field ? { field } : {}) }],
    })
    for (const [err, want] of [
      [nf('Card not found.'), 'card-gone'],
      [nf('Resource not found.', 'source_id'), 'card-gone'],
      [nf('Order not found.', 'order_id'), 'setup'],
      [nf('Location not found.', 'location_id'), 'setup'],
      [nf('Customer not found.', 'customer_id'), 'setup'],
      [Object.assign(new Error('x'), { status: 404 }), 'setup'],
    ] as const) {
      squareFetch.mockRejectedValueOnce(err)
      const e = await p.chargeSavedCard(chargeInput).catch((x) => x)
      expect(chargeOutcomeOf(e)).toBe('not_charged')
      expect(cardTroubleOf(e)).toBe(want)
    }
  })

  it.each([
    [401, 'ACCESS_TOKEN_EXPIRED', 'AUTHENTICATION_ERROR'],
    [401, 'UNAUTHORIZED', 'AUTHENTICATION_ERROR'],
    [403, 'INSUFFICIENT_SCOPES', 'AUTHENTICATION_ERROR'],
    [429, 'RATE_LIMITED', 'RATE_LIMIT_ERROR'],
    [400, 'INVALID_VALUE', 'INVALID_REQUEST_ERROR'], // e.g. customer_details or location_id refused
    [400, 'BAD_REQUEST', 'INVALID_REQUEST_ERROR'],
  ])('I3: a setup refusal (%s %s) is "setup", never "declined": nobody charged, no card blamed', async (status, code, category) => {
    squareFetch.mockRejectedValue(refusal(status, code, code, category))
    const err = await p.chargeSavedCard(chargeInput).catch((e) => e)
    expect(chargeOutcomeOf(err)).toBe('not_charged')
    expect(cardTroubleOf(err)).toBe('setup')
    expect(CHARGE_TROUBLE_WORDS.setup).toBe('Square refused the request (a setup problem), so nobody was charged')
    squareFetch.mockRejectedValue(refusal(status, code, code, category))
    const saveErr = await p.saveCard(saveInput).catch((e) => e)
    expect(SAVE_CARD_MESSAGES[cardTroubleOf(saveErr)]).toBe('We couldn’t save your card just now. Nothing was charged. Try again in a few minutes.')
  })

  it('I3: an unfamiliar code in Square\'s card category is still the card (declined)', async () => {
    squareFetch.mockRejectedValue(refusal(400, 'SOME_NEW_CARD_CODE', 'x', 'PAYMENT_METHOD_ERROR'))
    expect(cardTroubleOf(await p.chargeSavedCard(chargeInput).catch((e) => e))).toBe('declined')
  })

  it('customer_details is one constant: what is sent is exactly SAVED_CARD_CUSTOMER_DETAILS', async () => {
    const { SAVED_CARD_CUSTOMER_DETAILS } = await import('../../../src/providers/square/payment')
    squareFetch.mockResolvedValue({ payment: { id: 'P', status: 'COMPLETED', amount_money: { amount: 2180 } } })
    await p.chargeSavedCard(chargeInput)
    expect(JSON.parse(squareFetch.mock.calls[0][1].body).customer_details).toEqual(SAVED_CARD_CUSTOMER_DETAILS)
  })

  it('a timeout, a 5xx or IDEMPOTENCY_KEY_REUSED is unknown, never not charged', async () => {
    squareFetch.mockRejectedValueOnce(timeout())
    const t = await p.chargeSavedCard(chargeInput).catch((e) => e)
    expect(chargeOutcomeOf(t)).toBe('unknown')
    expect(cardTroubleOf(t)).toBe('unknown')
    squareFetch.mockRejectedValueOnce(refusal(502, 'BAD_GATEWAY'))
    expect(chargeOutcomeOf(await p.chargeSavedCard(chargeInput).catch((e) => e))).toBe('unknown')
    squareFetch.mockRejectedValueOnce(refusal(400, 'IDEMPOTENCY_KEY_REUSED'))
    expect(chargeOutcomeOf(await p.chargeSavedCard(chargeInput).catch((e) => e))).toBe('unknown')
  })

  it('processPayment sends customer_id and verification_token only when given (stage-1 deferred minor)', async () => {
    sdkPaymentsCreate.mockResolvedValue({ payment: { id: 'P', status: 'COMPLETED' } })
    await p.processPayment({ orderId: 'O', paymentToken: 'cnon:x', amount: 100, currency: 'USD', idempotencyKey: 'k' })
    expect(sdkPaymentsCreate.mock.calls[0][0]).not.toHaveProperty('customerId')
    expect(sdkPaymentsCreate.mock.calls[0][0]).not.toHaveProperty('verificationToken')
    await p.processPayment({ orderId: 'O', paymentToken: 'cnon:x', amount: 100, currency: 'USD', idempotencyKey: 'k2', customerId: 'C', verificationToken: 'verf:2' })
    expect(sdkPaymentsCreate.mock.calls[1][0]).toMatchObject({ customerId: 'C', verificationToken: 'verf:2' })
  })
})

describe('MockPaymentProvider saved cards (parity)', () => {
  it('saves, replays the same key, charges once per key, and a disabled card is declined', async () => {
    const m = new MockPaymentProvider()
    const a = await m.saveCard(saveInput)
    expect(await m.saveCard(saveInput)).toEqual(a)
    expect(m.savedCards.size).toBe(1)
    expect(a).toEqual({ cardId: expect.stringMatching(/^mock-card-/), brand: 'VISA', last4: '4242', expMonth: 12, expYear: expect.any(Number) })
    const p1 = await m.chargeSavedCard({ ...chargeInput, cardId: a.cardId })
    const p2 = await m.chargeSavedCard({ ...chargeInput, cardId: a.cardId })
    expect(p2).toEqual(p1)
    expect(await m.findOrderPayment('ORD1')).toEqual(p1)
    await m.disableCard(a.cardId)
    await m.disableCard(a.cardId)
    const err = await m.chargeSavedCard({ ...chargeInput, cardId: a.cardId, idempotencyKey: 'other' }).catch((e) => e)
    expect(chargeOutcomeOf(err)).toBe('not_charged')
  })

  it('steering tokens: FAIL refuses the save; DECLINE_LATER / NO_FUNDS_LATER decline later; TIMEOUT_LATER is unknown; a wrong customer is card-gone', async () => {
    const m = new MockPaymentProvider()
    expect(cardTroubleOf(await m.saveCard({ ...saveInput, sourceToken: 'FAIL', idempotencyKey: 'k1' }).catch((e) => e))).toBe('declined')
    const d = await m.saveCard({ ...saveInput, sourceToken: 'DECLINE_LATER', idempotencyKey: 'k2' })
    expect(cardTroubleOf(await m.chargeSavedCard({ ...chargeInput, cardId: d.cardId }).catch((e) => e))).toBe('declined')
    const f = await m.saveCard({ ...saveInput, sourceToken: 'NO_FUNDS_LATER', idempotencyKey: 'k3' })
    expect(cardTroubleOf(await m.chargeSavedCard({ ...chargeInput, cardId: f.cardId }).catch((e) => e))).toBe('no-funds')
    const t = await m.saveCard({ ...saveInput, sourceToken: 'TIMEOUT_LATER', idempotencyKey: 'k4' })
    expect(chargeOutcomeOf(await m.chargeSavedCard({ ...chargeInput, cardId: t.cardId }).catch((e) => e))).toBe('unknown')
    const ok = await m.saveCard({ ...saveInput, idempotencyKey: 'k5' })
    expect(cardTroubleOf(await m.chargeSavedCard({ ...chargeInput, cardId: ok.cardId, customerId: 'SOMEONE_ELSE' }).catch((e) => e))).toBe('card-gone')
  })

  it('M7: LOST_REPLY_LATER charges but loses the reply; the same key returns that payment, and the order shows paid', async () => {
    const m = new MockPaymentProvider()
    const c = await m.saveCard({ ...saveInput, sourceToken: 'LOST_REPLY_LATER', idempotencyKey: 'k6' })
    const lost = await m.chargeSavedCard({ ...chargeInput, cardId: c.cardId }).catch((e) => e)
    expect(chargeOutcomeOf(lost)).toBe('unknown')
    const found = await m.findOrderPayment('ORD1')
    expect(found).toMatchObject({ orderId: 'ORD1', amount: 2180, status: 'completed' })
    expect(await m.chargeSavedCard({ ...chargeInput, cardId: c.cardId })).toEqual(found)
  })

  it('I3 parity: SETUP refuses the save and SETUP_LATER the charge as a setup problem', async () => {
    const m = new MockPaymentProvider()
    expect(cardTroubleOf(await m.saveCard({ ...saveInput, sourceToken: 'SETUP', idempotencyKey: 'k7' }).catch((e) => e))).toBe('setup')
    const c = await m.saveCard({ ...saveInput, sourceToken: 'SETUP_LATER', idempotencyKey: 'k8' })
    expect(cardTroubleOf(await m.chargeSavedCard({ ...chargeInput, cardId: c.cardId }).catch((e) => e))).toBe('setup')
  })
})

describe('SquarePaymentProvider orderPaymentStatus (waitlist I1, read only)', () => {
  let p: SquarePaymentProvider
  beforeEach(() => { squareFetch.mockReset(); p = new SquarePaymentProvider(cfg) })
  const route = (answers: Record<string, unknown>) => squareFetch.mockImplementation(async (path: string, init?: any) => {
    if (init?.method && init.method !== 'GET') throw new Error('orderPaymentStatus must only read')
    const key = Object.keys(answers).find((k) => path.startsWith(k))
    if (!key) throw new Error(`unexpected ${path}`)
    return answers[key]
  })

  it('a COMPLETED tender → paid, with the payment', async () => {
    route({ '/orders/ORD1': { order: { id: 'ORD1', tenders: [{ id: 'T1', payment_id: 'PAY1' }] } }, '/payments/PAY1': { payment: { id: 'PAY1', status: 'COMPLETED', amount_money: { amount: 2180 }, created_at: '2026-11-02T21:05:00Z', receipt_url: 'https://r' } } })
    expect(await p.orderPaymentStatus({ orderId: 'ORD1', since: '2026-11-02T21:00:00Z', last4: '4242' })).toEqual({
      state: 'paid', payment: { id: 'PAY1', orderId: 'ORD1', amount: 2180, status: 'completed', receiptUrl: 'https://r', createdAt: '2026-11-02T21:05:00Z' },
    })
  })

  it('APPROVED or PENDING → still going through', async () => {
    route({ '/orders/ORD1': { order: { tenders: [{ payment_id: 'PAY1' }] } }, '/payments/PAY1': { payment: { id: 'PAY1', status: 'APPROVED', amount_money: { amount: 2180 } } } })
    expect((await p.orderPaymentStatus({ orderId: 'ORD1' })).state).toBe('going-through')
  })

  it('no tender: lists the payments since the try (location, last 4) and keeps the ones on this order; FAILED/CANCELED → failed', async () => {
    route({
      '/orders/ORD1': { order: { id: 'ORD1' } },
      '/payments?': { payments: [{ id: 'P0', order_id: 'OTHER', status: 'COMPLETED' }, { id: 'P1', order_id: 'ORD1', status: 'FAILED', amount_money: { amount: 2180 } }] },
    })
    expect(await p.orderPaymentStatus({ orderId: 'ORD1', since: '2026-11-02T21:00:00Z', last4: '4242' })).toMatchObject({ state: 'failed', payment: { id: 'P1', status: 'failed' } })
    const listPath = squareFetch.mock.calls.find(([path]: any[]) => String(path).startsWith('/payments?'))![0]
    const q = new URLSearchParams(String(listPath).split('?')[1])
    expect(Object.fromEntries(q)).toEqual({ begin_time: '2026-11-02T21:00:00Z', location_id: 'LOC1', sort_order: 'ASC', limit: '100', last_4: '4242' })
  })

  it('nothing anywhere → none; a paid payment beats a failed one', async () => {
    route({ '/orders/ORD1': { order: {} }, '/payments?': { payments: [] } })
    expect(await p.orderPaymentStatus({ orderId: 'ORD1', since: 'x' })).toEqual({ state: 'none' })
    squareFetch.mockReset()
    route({ '/orders/ORD1': { order: {} }, '/payments?': { payments: [{ id: 'P1', order_id: 'ORD1', status: 'FAILED' }, { id: 'P2', order_id: 'ORD1', status: 'COMPLETED', amount_money: { amount: 2180 } }] } })
    expect((await p.orderPaymentStatus({ orderId: 'ORD1', since: 'x' })).state).toBe('paid')
  })

  it('Square can\'t be asked → throws (the caller keeps the seat held)', async () => {
    squareFetch.mockRejectedValue(timeout())
    await expect(p.orderPaymentStatus({ orderId: 'ORD1' })).rejects.toThrow(/timeout/)
  })

  it('a saved-card charge answered CANCELED is a final "not charged" (failed), never unknown', async () => {
    squareFetch.mockReset()
    squareFetch.mockResolvedValue({ payment: { id: 'PAYX', status: 'CANCELED', amount_money: { amount: 2180 } } })
    expect((await p.chargeSavedCard(chargeInput)).status).toBe('failed')
  })
})
