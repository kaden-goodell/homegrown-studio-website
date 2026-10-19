import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockProcessPayment = vi.fn()
const mockFindOrderPayment = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      processPayment: (...a: any[]) => mockProcessPayment(...a),
      findOrderPayment: (...a: any[]) => mockFindOrderPayment(...a),
    },
  },
}))
const mockSendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a) }))

import {
  chargeOrder,
  judgeDrift,
  paidOnOrder,
  tellOwnersOfDrift,
  HOLD_MINUTES,
  PRICE_DRIFT_TOLERANCE_CENTS,
  UNCLEAR_HOLD_HOURS,
} from '@lib/booking-core/charge'
import * as classCheckout from '@lib/classes/checkout'
import { attemptKey } from '@lib/checkout-attempt'
import { siteConfig } from '@config/site.config'

const ATTEMPT = '11111111-2222-4333-8444-555555555555'
const input = { orderId: 'ORDER1', amountCents: 5000, paymentToken: 'cnon:ok', email: 'a@b.co', attemptId: ATTEMPT }
const paidPayment = { id: 'PAY1', orderId: 'ORDER1', amount: 5000, status: 'completed' as const }
const declinedErr = Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] })
const timeoutErr = new Error('socket hang up')

beforeEach(() => {
  mockProcessPayment.mockReset()
  mockFindOrderPayment.mockReset()
  mockSendEmail.mockReset()
})

describe('constants', () => {
  it('are the stage-1 values, and classes re-export the same ones', () => {
    expect(PRICE_DRIFT_TOLERANCE_CENTS).toBe(100)
    expect(HOLD_MINUTES).toBe(10)
    expect(UNCLEAR_HOLD_HOURS).toBe(24)
    expect(classCheckout.PRICE_DRIFT_TOLERANCE_CENTS).toBe(PRICE_DRIFT_TOLERANCE_CENTS)
    expect(classCheckout.HOLD_MINUTES).toBe(HOLD_MINUTES)
    expect(classCheckout.UNCLEAR_HOLD_HOURS).toBe(UNCLEAR_HOLD_HOURS)
  })
})

describe('judgeDrift', () => {
  it('0 → same', () => expect(judgeDrift(1000, 1000)).toEqual({ kind: 'same' }))
  it('+50 → charge-and-tell', () => expect(judgeDrift(1000, 1050)).toEqual({ kind: 'charge-and-tell', driftCents: 50 }))
  it('+100 → charge-and-tell', () => expect(judgeDrift(1000, 1100)).toEqual({ kind: 'charge-and-tell', driftCents: 100 }))
  it('+101 → refuse', () => expect(judgeDrift(1000, 1101)).toEqual({ kind: 'refuse', driftCents: 101 }))
  it('−50 with the default → charge-and-tell', () => expect(judgeDrift(1000, 950)).toEqual({ kind: 'charge-and-tell', driftCents: -50 }))
  it('−1 with the default → charge-and-tell', () => expect(judgeDrift(1000, 999)).toEqual({ kind: 'charge-and-tell', driftCents: -1 }))
  it('−1 with tellBelowCents 1 → same', () => expect(judgeDrift(1000, 999, { tellBelowCents: 1 })).toEqual({ kind: 'same' }))
  it('−2 with tellBelowCents 1 → charge-and-tell', () => expect(judgeDrift(1000, 998, { tellBelowCents: 1 })).toEqual({ kind: 'charge-and-tell', driftCents: -2 }))
  it('far below is never refused (Square lower is charged as Square says)', () => expect(judgeDrift(10000, 100).kind).toBe('charge-and-tell'))
})

describe('tellOwnersOfDrift', () => {
  it('above: emails the owners the difference and both totals', async () => {
    mockSendEmail.mockResolvedValue(true)
    await tellOwnersOfDrift('Class price differed — Pottery', 'booking bkg_1', 17440, 17441, '')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.to).toBe(siteConfig.ownerEmails.join(', '))
    expect(mail.subject).toBe('Class price differed — Pottery')
    expect(mail.text).toBe('Square total differed by $0.01 on booking bkg_1 (quote $174.40, Square $174.41)')
    expect(mail.html).toBe(`<p>${mail.text}</p>`)
  })

  it('below: says how much lower, then the hint', async () => {
    mockSendEmail.mockResolvedValue(true)
    await tellOwnersOfDrift('s', 'party pty_1', 17440, 16000, "Check the class's tax on the POS.")
    expect(mockSendEmail.mock.calls[0][0].text).toBe(
      "Square total was $14.40 lower than the quote on party pty_1 (quote $174.40, Square $160.00). Check the class's tax on the POS.",
    )
  })

  it('above with a hint appends it', async () => {
    mockSendEmail.mockResolvedValue(true)
    await tellOwnersOfDrift('s', 'party pty_1', 1000, 1050, 'Check the party prices.')
    expect(mockSendEmail.mock.calls[0][0].text).toBe('Square total differed by $0.50 on party pty_1 (quote $10.00, Square $10.50). Check the party prices.')
  })

  it('escapes the reference and hint in the HTML, keeps the text plain', async () => {
    mockSendEmail.mockResolvedValue(true)
    await tellOwnersOfDrift('s', 'party <b>Jo & "Al"</b>', 1000, 1050, 'See <i>this</i>')
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail.text).toBe('Square total differed by $0.50 on party <b>Jo & "Al"</b> (quote $10.00, Square $10.50). See <i>this</i>')
    expect(mail.html).toBe(
      '<p>Square total differed by $0.50 on party &lt;b&gt;Jo &amp; &quot;Al&quot;&lt;/b&gt; (quote $10.00, Square $10.50). See &lt;i&gt;this&lt;/i&gt;</p>',
    )
  })

  it('never throws when the email fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'))
    await expect(tellOwnersOfDrift('s', 'r', 1000, 1050, '')).resolves.toBeUndefined()
    mockSendEmail.mockImplementation(() => { throw new Error('sync throw') })
    await expect(tellOwnersOfDrift('s', 'r', 1000, 1050, '')).resolves.toBeUndefined()
  })
})

describe('chargeOrder', () => {
  it('paid: charges the amount with the attempt’s pay key', async () => {
    mockProcessPayment.mockResolvedValue(paidPayment)
    const r = await chargeOrder(input)
    expect(r).toMatchObject({ kind: 'paid', payment: paidPayment })
    expect(mockProcessPayment).toHaveBeenCalledWith({
      orderId: 'ORDER1', paymentToken: 'cnon:ok', amount: 5000, currency: 'USD', buyerEmailAddress: 'a@b.co',
      idempotencyKey: attemptKey(ATTEMPT, 'pay'),
    })
    expect(mockFindOrderPayment).not.toHaveBeenCalled()
  })

  it('uses the given step for the key', async () => {
    mockProcessPayment.mockResolvedValue(paidPayment)
    await chargeOrder({ ...input, step: 'pay-2' })
    expect(mockProcessPayment.mock.calls[0][0].idempotencyKey).toBe(attemptKey(ATTEMPT, 'pay-2'))
  })

  it('declined: a 4xx refusal is not charged, with Square’s codes, and the order is not asked', async () => {
    mockProcessPayment.mockRejectedValue(declinedErr)
    const r = await chargeOrder(input)
    expect(r).toMatchObject({ kind: 'declined', reason: 'declined', codes: ['CARD_DECLINED'], error: declinedErr })
    expect(r).not.toHaveProperty('paymentId')
    expect(mockFindOrderPayment).not.toHaveBeenCalled()
  })

  it('a direct charge is not marked recovered', async () => {
    mockProcessPayment.mockResolvedValue(paidPayment)
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'paid', payment: paidPayment })
  })

  it('unclear charge asks the order: paid there → paid', async () => {
    mockProcessPayment.mockRejectedValue(timeoutErr)
    mockFindOrderPayment.mockResolvedValue(paidPayment)
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'paid', payment: paidPayment, recovered: true })
    expect(mockFindOrderPayment).toHaveBeenCalledWith('ORDER1')
  })

  it('unclear charge, the order shows a failed payment → declined (failed) with its id, not recovered', async () => {
    mockProcessPayment.mockRejectedValue(timeoutErr)
    mockFindOrderPayment.mockResolvedValue({ ...paidPayment, id: 'PAY_FAILED', status: 'failed' })
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'declined', reason: 'failed', codes: [], paymentId: 'PAY_FAILED' })
  })

  it('IDEMPOTENCY_KEY_REUSED is unclear, never declined', async () => {
    mockProcessPayment.mockRejectedValue(Object.assign(new Error('reused'), { statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] }))
    mockFindOrderPayment.mockResolvedValue(null)
    const r = await chargeOrder(input)
    expect(r.kind).toBe('unknown')
    expect(mockFindOrderPayment).toHaveBeenCalledWith('ORDER1')
  })

  it('unclear and the order shows no payment → unknown, with the original error', async () => {
    mockProcessPayment.mockRejectedValue(timeoutErr)
    mockFindOrderPayment.mockResolvedValue(null)
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'unknown', error: timeoutErr })
  })

  it('unclear and the lookup throws → unknown', async () => {
    mockProcessPayment.mockRejectedValue(timeoutErr)
    mockFindOrderPayment.mockRejectedValue(new Error('also down'))
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'unknown', error: timeoutErr })
  })

  it('status failed → declined', async () => {
    mockProcessPayment.mockResolvedValue({ ...paidPayment, status: 'failed' })
    const r = await chargeOrder(input)
    expect(r).toEqual({ kind: 'declined', reason: 'failed', codes: [], paymentId: 'PAY1' })
  })

  it('no payment returned → unknown', async () => {
    mockProcessPayment.mockResolvedValue(null)
    const r = await chargeOrder(input)
    expect(r.kind).toBe('unknown')
  })
})

describe('paidOnOrder', () => {
  const order = { orderId: 'ORDER1', totalCents: 5000 }

  it('paid earlier: the same order shows a completed payment → paid', async () => {
    mockFindOrderPayment.mockResolvedValue(paidPayment)
    const makeOrder = vi.fn().mockResolvedValue(order)
    const r = await paidOnOrder(makeOrder)
    expect(r).toEqual({ kind: 'paid', payment: paidPayment, order })
    expect(makeOrder).toHaveBeenCalledTimes(1)
    expect(mockFindOrderPayment).toHaveBeenCalledWith('ORDER1')
  })

  it('no payment → unpaid', async () => {
    mockFindOrderPayment.mockResolvedValue(null)
    expect(await paidOnOrder(async () => order)).toEqual({ kind: 'unpaid' })
  })

  it('a payment not completed → unpaid', async () => {
    mockFindOrderPayment.mockResolvedValue({ ...paidPayment, status: 'pending' })
    expect(await paidOnOrder(async () => order)).toEqual({ kind: 'unpaid' })
  })

  it('order create throws → unknown', async () => {
    const r = await paidOnOrder(async () => { throw new Error('square down') })
    expect(r.kind).toBe('unknown')
    expect(mockFindOrderPayment).not.toHaveBeenCalled()
  })

  it('the lookup throws → unknown', async () => {
    mockFindOrderPayment.mockRejectedValue(new Error('square down'))
    expect((await paidOnOrder(async () => order)).kind).toBe('unknown')
  })
})
