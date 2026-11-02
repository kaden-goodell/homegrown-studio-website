// @vitest-environment node
/**
 * Stage 4 Task 11: Charge on the reader, the pure parts — the Square POS app
 * link, the signed state, Square's answer, and the checks an order must pass
 * before a seat is marked paid.
 */
import { describe, it, expect } from 'vitest'
import {
  bookingInNote, checkReaderOrder, parseReaderReturn, posPaymentUrl, posRequestData, readerErrorMessage, readerNote, signState, verifyState,
  READER_NOTE_MAX, READER_STATE_TTL_MS,
} from '@lib/classes/reader'

const NOW = new Date('2026-11-07T21:00:00.000Z')
const SECRET = 'test-secret'
const BKG = 'bkg_abc123DEF_-x'

describe('the Square POS app link', () => {
  const req = { amountCents: 3270, callbackUrl: 'https://ourhometownstudio.com/staff/pos-return', clientId: 'sq0idp-APP', notes: 'Hometown bkg_1 · Clay Camp Sat, Nov 7 · Gia Winner', state: 'S' }

  it('is square-commerce-v1://payment/create with the JSON exactly as Square reads it (no line items)', () => {
    const url = posPaymentUrl(req)
    expect(url.startsWith('square-commerce-v1://payment/create?data=')).toBe(true)
    const data = JSON.parse(decodeURIComponent(url.slice('square-commerce-v1://payment/create?data='.length)))
    expect(data).toEqual({
      amount_money: { amount: 3270, currency_code: 'USD' },
      callback_url: 'https://ourhometownstudio.com/staff/pos-return',
      client_id: 'sq0idp-APP',
      version: '1.3',
      notes: 'Hometown bkg_1 · Clay Camp Sat, Nov 7 · Gia Winner',
      options: { supported_tender_types: ['CREDIT_CARD', 'SQUARE_GIFT_CARD'], clear_default_fees: true, auto_return: true },
      state: 'S',
    })
    expect(data).not.toHaveProperty('line_items')
    expect(posRequestData(req)).toEqual(data)
  })

  it('encodes the whole JSON (no raw spaces, quotes or ampersands in the link)', () => {
    const url = posPaymentUrl({ ...req, notes: 'A & B "quoted" #1 ?x=y' })
    const query = url.split('?data=')[1]
    expect(query).not.toMatch(/[ "&#?]/)
    expect(JSON.parse(decodeURIComponent(query)).notes).toBe('A & B "quoted" #1 ?x=y')
  })

  it('refuses less than $1 (Square’s minimum) or a fraction of a cent', () => {
    expect(() => posPaymentUrl({ ...req, amountCents: 99 })).toThrow(/\$1\.00/)
    expect(() => posPaymentUrl({ ...req, amountCents: 100.5 })).toThrow()
  })

  it('the note names the booking first, then the class, day and person, within 500 characters', () => {
    expect(readerNote(BKG, 'Clay  Camp', 'Sat, Nov 7', ' Gia   Winner ')).toBe(`Hometown ${BKG} · Clay Camp Sat, Nov 7 · Gia Winner`)
    const long = readerNote(BKG, 'x'.repeat(900), 'Sat', 'Gia')
    expect(long.length).toBe(READER_NOTE_MAX)
    expect(bookingInNote(long)).toBe(BKG)
  })

  it('bookingInNote reads our booking id out of a note, or null', () => {
    expect(bookingInNote(`Hometown ${BKG} · Clay`)).toBe(BKG)
    expect(bookingInNote('Coffee and a muffin')).toBeNull()
    expect(bookingInNote(undefined)).toBeNull()
  })
})

describe('the signed state', () => {
  it('round-trips the booking id', () => {
    const s = signState(BKG, SECRET, NOW)
    expect(verifyState(s, SECRET, NOW)).toEqual({ ok: true, bookingId: BKG })
    expect(verifyState(s, SECRET, new Date(NOW.getTime() + READER_STATE_TTL_MS - 1000))).toEqual({ ok: true, bookingId: BKG })
  })

  it('runs out after a day', () => {
    const s = signState(BKG, SECRET, NOW)
    expect(verifyState(s, SECRET, new Date(NOW.getTime() + READER_STATE_TTL_MS + 1000))).toEqual({ ok: false, why: 'expired' })
  })

  it('refuses a forged one: another booking id, a pushed-out expiry, another secret, junk', () => {
    const s = signState(BKG, SECRET, NOW)
    const [id, exp, mac] = s.split('.')
    expect(verifyState(`bkg_someoneelse.${exp}.${mac}`, SECRET, NOW)).toEqual({ ok: false, why: 'forged' })
    expect(verifyState(`${id}.${Number(exp) + 86_400}.${mac}`, SECRET, NOW)).toEqual({ ok: false, why: 'forged' })
    expect(verifyState(s, 'other-secret', NOW)).toEqual({ ok: false, why: 'forged' })
    expect(verifyState('nonsense', SECRET, NOW)).toEqual({ ok: false, why: 'forged' })
    expect(verifyState(undefined, SECRET, NOW)).toEqual({ ok: false, why: 'forged' })
  })
})

describe('what the app sent back', () => {
  it('a payment: transaction id (and client id)', () => {
    expect(parseReaderReturn(JSON.stringify({ status: 'ok', transaction_id: 'ORD1', client_transaction_id: 'C1', state: 'S' })))
      .toEqual({ kind: 'paid', transactionId: 'ORD1', clientTransactionId: 'C1', state: 'S' })
  })
  it('taken offline: only the client transaction id', () => {
    expect(parseReaderReturn(JSON.stringify({ status: 'ok', client_transaction_id: 'C1', state: 'S' })))
      .toEqual({ kind: 'offline', clientTransactionId: 'C1', state: 'S' })
  })
  it('an error, with its code', () => {
    expect(parseReaderReturn(JSON.stringify({ status: 'error', error_code: 'payment_canceled', state: 'S' })))
      .toEqual({ kind: 'error', code: 'payment_canceled', state: 'S' })
    expect(parseReaderReturn(JSON.stringify({ status: 'error', error_code: 'Weird Code!', state: 'S' })))
      .toEqual({ kind: 'error', code: 'unknown', state: 'S' })
  })
  it('anything else is not an answer from Square', () => {
    for (const raw of ['', 'not json', '[]', JSON.stringify({ status: 'ok' }), JSON.stringify({ status: 'ok', transaction_id: 'has spaces' }), JSON.stringify({ status: 'maybe' }), undefined, 42]) {
      expect(parseReaderReturn(raw)).toBeNull()
    }
  })
  it('every error says nothing was charged and the seat was let go', () => {
    for (const code of ['payment_canceled', 'not_logged_in', 'no_network', 'client_not_authorized', 'unknown']) {
      expect(readerErrorMessage(code)).toMatch(/Nothing was charged, and the seat was let go\./)
    }
    expect(readerErrorMessage('not_logged_in')).toMatch(/isn’t signed in/)
    expect(readerErrorMessage('payment_canceled')).toBe('Cancelled on the reader. Nothing was charged, and the seat was let go.')
  })
})

describe('checking the order Square shows', () => {
  const startedAt = NOW.toISOString()
  const expect_ = { locationId: 'LOC1', amountCents: 3270, bookingId: BKG, startedAt }
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'ORD1', location_id: 'LOC1', state: 'COMPLETED', created_at: new Date(NOW.getTime() + 60_000).toISOString(),
    total_money: { amount: 3270, currency: 'USD' }, total_tip_money: { amount: 0 },
    tenders: [{ id: 'PAY1', payment_id: 'PAY1', type: 'CARD', note: `Hometown ${BKG} · Clay Camp` }],
    ...over,
  })

  it('passes ours to the letter', () => {
    expect(checkReaderOrder(order(), expect_)).toEqual({ ok: true, orderId: 'ORD1', paymentId: 'PAY1', paymentIds: ['PAY1'], tipCents: 0 })
  })
  it('a gift card, or a card and a gift card together, is fine', () => {
    expect(checkReaderOrder(order({ tenders: [{ id: 'G', type: 'SQUARE_GIFT_CARD' }, { id: 'C', type: 'CARD' }] }), expect_))
      .toMatchObject({ ok: true, paymentIds: ['G', 'C'] })
  })
  it('a tip on top is allowed and kept apart', () => {
    expect(checkReaderOrder(order({ total_money: { amount: 3770 }, total_tip_money: { amount: 500 } }), expect_)).toMatchObject({ ok: true, tipCents: 500 })
  })
  it('wrong amount → refused (more or less)', () => {
    expect(checkReaderOrder(order({ total_money: { amount: 3269 } }), expect_)).toEqual({ ok: false, why: 'amount' })
    expect(checkReaderOrder(order({ total_money: { amount: 3300 } }), expect_)).toEqual({ ok: false, why: 'amount' })
  })
  it('another location → refused', () => {
    expect(checkReaderOrder(order({ location_id: 'LOC2' }), expect_)).toEqual({ ok: false, why: 'location' })
  })
  it('an OPEN (unfinished) order → not yet', () => {
    expect(checkReaderOrder(order({ state: 'OPEN' }), expect_)).toEqual({ ok: false, why: 'not-completed' })
  })
  it('an order from before the sale started (or a day after) → refused', () => {
    expect(checkReaderOrder(order({ created_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() }), expect_)).toEqual({ ok: false, why: 'old' })
    expect(checkReaderOrder(order({ created_at: new Date(NOW.getTime() + READER_STATE_TTL_MS + 60_000).toISOString() }), expect_)).toEqual({ ok: false, why: 'old' })
    expect(checkReaderOrder(order({ created_at: undefined }), expect_)).toEqual({ ok: false, why: 'old' })
  })
  it('cash (or any other tender) → refused (OWNER-S4-9)', () => {
    expect(checkReaderOrder(order({ tenders: [{ id: 'X', type: 'CASH' }] }), expect_)).toEqual({ ok: false, why: 'tender' })
    expect(checkReaderOrder(order({ tenders: [{ id: 'X', type: 'CARD' }, { id: 'Y', type: 'CASH' }] }), expect_)).toEqual({ ok: false, why: 'tender' })
    expect(checkReaderOrder(order({ tenders: [] }), expect_)).toEqual({ ok: false, why: 'tender' })
  })
  it('a note naming another booking → not this sale’s', () => {
    expect(checkReaderOrder(order({ tenders: [{ id: 'P', type: 'CARD', note: 'Hometown bkg_other · Clay' }] }), expect_)).toEqual({ ok: false, why: 'not-ours' })
  })
})
