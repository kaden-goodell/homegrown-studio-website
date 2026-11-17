// @vitest-environment node
/**
 * The deposit payment (pay.json's core): a sent quote becomes a booked party
 * of ours through the pay-link core. Party records, the party book, quotes and
 * requests are the real stores (temp dir); Square, emails and texts are fakes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  refund: vi.fn(),
  alert: vi.fn(),
  confirmEmail: vi.fn(),
  paidEmail: vi.fn(),
  sendEmail: vi.fn(),
  quo: vi.fn(),
  paid: new Map<string, any>(),
}))

vi.mock('@config/providers', () => ({
  providers: {
    booking: { createBooking: vi.fn(), listBookings: async () => [] },
    workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] },
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
      refundPayment: (...a: any[]) => m.refund(...a),
    },
    customer: { findOrCreate: async () => ({ id: 'cust-1' }) },
    giftcard: { fromNonce: vi.fn() },
  },
}))
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({
  sendPartyConfirmationEmail: (...a: any[]) => m.confirmEmail(...a),
  sendPartyPaidEmail: (...a: any[]) => m.paidEmail(...a),
  sendPartyPaymentLinkEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: (...a: any[]) => m.sendEmail(...a),
}))
vi.mock('@lib/quo', () => ({ quoConfigured: () => false, sendQuoText: (...a: any[]) => m.quo(...a) }))
vi.mock('@lib/booking-alert', () => ({ announceBooking: vi.fn() }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: async () => undefined }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => false }))

import { payQuote } from '@lib/quotes/pay'
import { createQuote, getQuote, newQuoteId, newToken, partyIdForQuote } from '@lib/quotes/quote-store'
import { priceKey } from '@lib/quotes/price-key'
import type { Quote, Tier } from '@lib/quotes/types'
import { checkRequest, getRequest, saveRequest } from '@lib/event-requests'
import { createPartyRecord, deletePartyRecord, getPartyRecord, updatePartyRecord } from '@lib/party-store'
import { holdsBetween, holdTime } from '@lib/parties/party-book'
import { payBalance } from '@lib/parties/pay-balance'
import { localToUtcISO } from '@lib/parties/party-times'
import { goodBody } from '../../fixtures/event-request'

const NOW = new Date()
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const dayOf = (ymd: string) => [at(ymd, '00:00'), at(ymd, '23:59')] as const
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)
const URL_ = 'http://localhost/api/quote/pay.json'

const tier = (over: Partial<Tier> = {}): Tier => ({
  id: 'tr_pick', key: 'pick', name: 'Our pick', photoUrl: null, hidden: false, priceCents: 7500,
  lines: [
    { itemId: 'i1', label: 'Wood sign', photoUrl: null, cents: 6000, per: 'person', costCents: 900 },
    { itemId: 'i2', label: 'Hot cocoa', photoUrl: null, cents: 3000, per: 'person', costCents: 300 },
  ],
  ...over,
})

async function requestId(): Promise<string> {
  const c = checkRequest(goodBody(), new Date('2026-10-17T17:00:00Z'))
  if (!c.ok) throw new Error('bad fixture')
  return (await saveRequest(c.value, [])).id
}

/** A sent studio quote, 30 guests at $75, deposit 50%: total $2,250, deposit $1,125. Each on its own day. */
async function makeQuote(ymd: string, over: Partial<Quote> = {}): Promise<Quote> {
  const id = newQuoteId()
  const q: Quote = {
    id, requestId: await requestId(), partyId: partyIdForQuote(id), token: newToken(), version: 2, priceKey: '',
    status: 'sent', place: 'studio', address: '', startIso: at(ymd, '18:00'), endIso: at(ymd, '20:00'), guests: 30, crafters: 'adults',
    targetCents: 7500, note: '', depositPct: 50, expiresAt: days(14),
    tiers: [tier({ id: 'tr_simple', key: 'simple', name: 'Simple', priceCents: 6000 }), tier(), tier({ id: 'tr_all', key: 'all', name: 'All out', hidden: true, priceCents: 9800 })],
    held: true, sentAt: NOW.toISOString(), sentBy: 'Kaden', views: 0,
    history: [{ at: NOW.toISOString(), by: 'Kaden', what: 'drafted' }],
    ...over,
  }
  q.priceKey = over.priceKey ?? priceKey(q)
  await createQuote(q)
  if (q.held && q.place === 'studio' && q.startIso && q.endIso && q.status !== 'draft') {
    const r = await holdTime({ partyId: q.partyId, startIso: q.startIso, endIso: q.endIso, ttlMinutes: 14 * 24 * 60 }, [], NOW)
    if (!r.ok) throw new Error(r.message)
  }
  return q
}

const card = { paymentToken: 'cnon:ok', sourceKind: 'card' as const }
const payIt = (q: Quote, over: Record<string, unknown> = {}) =>
  payQuote({ token: q.token, tierId: 'tr_pick', priceKey: q.priceKey, attemptId: randomUUID(), pay: card, requestUrl: URL_, now: NOW, ...over } as any)
const mine = async (q: Quote, ymd: string) => (await holdsBetween(...dayOf(ymd), NOW)).filter((h) => h.partyId === q.partyId)

beforeEach(() => {
  m.paid.clear()
  m.alert.mockReset().mockResolvedValue({ attempted: 1, sent: 1 })
  m.confirmEmail.mockReset().mockResolvedValue({ sent: true })
  m.paidEmail.mockReset().mockResolvedValue({ sent: true })
  m.sendEmail.mockReset().mockResolvedValue({ sent: true })
  m.refund.mockReset()
  m.createOrder.mockReset().mockImplementation(async (p: any) => ({
    id: `ord-${p.idempotencyKey}`, version: 1, lineItems: p.lineItems, discounts: [], totalAmount: sumLines(p.lineItems), currency: 'USD', status: 'open',
  }))
  m.processPayment.mockReset().mockImplementation(async (p: any) => {
    const payment = { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://r/q' }
    m.paid.set(p.orderId, payment)
    return payment
  })
  m.findOrderPayment.mockReset().mockImplementation(async (orderId: string) => m.paid.get(orderId) ?? null)
})

describe('payQuote: paid', () => {
  it('books the party: deposit paid, balance due, one booked entry, quote paid, request booked, owners told once', async () => {
    const ymd = '2032-01-06'
    const q = await makeQuote(ymd)
    const out = await payIt(q)
    expect(out).toEqual({ ok: true, partyId: q.partyId })

    const rec = (await getPartyRecord(q.partyId))!
    expect(rec).toMatchObject({
      origin: 'quote', source: 'ours', status: 'booked', craftName: 'Our pick', title: 'Dana’s private event', dropOff: false,
      guestCount: 30, durationMinutes: 120, endIso: q.endIso, startIso: q.startIso, place: 'studio',
      hostName: 'Dana Planner', hostEmail: 'dana@example.com',
      quote: { quoteId: q.id, tierName: 'Our pick', lines: ['Wood sign', 'Hot cocoa'], guests: 30, pricePerPersonCents: 7500 },
    })
    expect(rec.payToken).toBeTruthy()
    expect(rec.hostToken).toBeTruthy()
    expect(rec.payToken).not.toBe(rec.hostToken)
    const quoteItems = rec.items!.filter((it) => it.kind === 'quote')
    expect(quoteItems).toHaveLength(2)
    expect(quoteItems[0]).toMatchObject({ cents: 112500, chargeId: expect.any(String) })
    expect(quoteItems[1]).toMatchObject({ cents: 112500, chargeId: null })
    expect(rec.charges).toHaveLength(1)
    expect(rec.charges![0].cents).toBe(112500)

    const h = await mine(q, ymd)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ state: 'booked', holdExpiresAt: null })
    expect(rec.overlap).toBeUndefined()

    const after = (await getQuote(q.id))!
    expect(after.status).toBe('paid')
    expect(after.paidAt).toBeTruthy()
    expect((await getRequest(q.requestId))!.status).toBe('booked')

    const booked = m.alert.mock.calls.filter(([t]) => String(t).startsWith('Private event booked'))
    expect(booked).toHaveLength(1)
    expect(booked[0][0]).toMatch(/^Private event booked: Dana Planner, .+, deposit \$1,125/)
    // No "Party paid"/"Private event paid" text on top of it.
    expect(m.alert.mock.calls.filter(([t]) => /paid/i.test(String(t)) && !String(t).startsWith('Private event booked'))).toHaveLength(0)
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
  })

  it('a repeat after success returns the same party and charges nothing', async () => {
    const q = await makeQuote('2032-01-07')
    const first = await payIt(q)
    const again = await payIt(q)
    expect(again).toEqual(first)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls.filter(([t]) => String(t).startsWith('Private event booked'))).toHaveLength(1)
  })

  it('after paid, the pay link charges only the balance', async () => {
    const q = await makeQuote('2032-01-08')
    await payIt(q)
    const rec = (await getPartyRecord(q.partyId))!
    const out = await payBalance({ partyId: q.partyId, key: rec.payToken!, attemptId: randomUUID(), expectedCents: 112500, pay: { kind: 'card', paymentToken: 'cnon:ok' }, requestUrl: URL_ }, NOW)
    expect(out.kind).toBe('paid')
    expect(m.processPayment).toHaveBeenCalledTimes(2)
    expect(m.processPayment.mock.calls[1][0].amount).toBe(112500)
    const done = (await getPartyRecord(q.partyId))!
    expect(done.items!.every((it) => it.chargeId !== null)).toBe(true)
    expect(done.charges).toHaveLength(2)
  })

  it('an away quote books with the address and holds nothing in the studio', async () => {
    const ymd = '2032-01-09'
    const q = await makeQuote(ymd, { place: 'away', address: '100 Main St, Huntsville, AL', held: false })
    expect(await payIt(q)).toEqual({ ok: true, partyId: q.partyId })
    expect(await getPartyRecord(q.partyId)).toMatchObject({ place: 'away', address: '100 Main St, Huntsville, AL' })
    expect(await mine(q, ymd)).toHaveLength(0)
  })

  it('a quote sent without a hold holds the time first, then books it', async () => {
    const ymd = '2032-01-10'
    const q = await makeQuote(ymd, { held: false })
    expect(await payIt(q)).toEqual({ ok: true, partyId: q.partyId })
    expect(await mine(q, ymd)).toEqual([expect.objectContaining({ state: 'booked' })])
  })
})

describe('payQuote: refused before any charge', () => {
  it('a wrong price key → price_changed, no Square calls, no record', async () => {
    const q = await makeQuote('2032-01-11')
    const out = await payIt(q, { priceKey: 'stale' })
    expect(out).toMatchObject({ ok: false, why: 'price_changed' })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await getPartyRecord(q.partyId)).toBeNull()
  })

  it('expired, withdrawn, draft and unknown token → closed', async () => {
    const expired = await makeQuote('2032-01-12', { expiresAt: new Date(NOW.getTime() - 60_000).toISOString(), held: false })
    const withdrawn = await makeQuote('2032-01-13', { status: 'withdrawn', held: false })
    const draft = await makeQuote('2032-01-14', { status: 'draft', held: false })
    for (const q of [expired, withdrawn, draft]) {
      expect(await payIt(q)).toMatchObject({ ok: false, why: 'closed' })
      expect(await getPartyRecord(q.partyId)).toBeNull()
    }
    expect(await payQuote({ token: newToken(), tierId: 'tr_pick', priceKey: 'x', attemptId: randomUUID(), pay: card, requestUrl: URL_, now: NOW })).toMatchObject({ ok: false, why: 'closed' })
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('a hidden or unknown tier → tier_unavailable', async () => {
    const q = await makeQuote('2032-01-15')
    expect(await payIt(q, { tierId: 'tr_all' })).toMatchObject({ ok: false, why: 'tier_unavailable' })
    expect(await payIt(q, { tierId: 'tr_nope' })).toMatchObject({ ok: false, why: 'tier_unavailable' })
    expect(await getPartyRecord(q.partyId)).toBeNull()
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('the time taken by another party → time_taken, nothing charged, no record left', async () => {
    const ymd = '2032-01-16'
    // Sent without a hold; another party holds the time meanwhile.
    const q = await makeQuote(ymd, { held: false })
    await holdTime({ partyId: 'pty_someone_else', startIso: at(ymd, '18:30'), endIso: at(ymd, '20:30'), ttlMinutes: 60 }, [], NOW)
    const out = await payIt(q)
    expect(out).toMatchObject({ ok: false, why: 'time_taken' })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await getPartyRecord(q.partyId)).toBeNull()
    expect((await getQuote(q.id))!.status).toBe('picked')
  })
})

describe('payQuote: declined, unclear, busy', () => {
  it('declined → no record left, quote back to picked, the hold kept', async () => {
    const ymd = '2032-01-17'
    const q = await makeQuote(ymd)
    m.processPayment.mockRejectedValueOnce(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const out = await payIt(q)
    expect(out).toMatchObject({ ok: false, why: 'declined' })
    expect(await getPartyRecord(q.partyId)).toBeNull()
    const after = (await getQuote(q.id))!
    expect(after.status).toBe('picked')
    expect(after.pickedTierId).toBe('tr_pick')
    expect(after.paying).toBeUndefined()
    expect(await mine(q, ymd)).toEqual([expect.objectContaining({ state: 'held' })])
    // A new card then pays.
    expect(await payIt(after)).toEqual({ ok: true, partyId: q.partyId })
  })

  it('unclear → checking, quote paying, record kept, nothing refunded; another attempt is busy', async () => {
    const q = await makeQuote('2032-01-18')
    m.processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const out = await payIt(q)
    expect(out).toMatchObject({ ok: false, why: 'checking' })
    expect((await getQuote(q.id))!.status).toBe('paying')
    const rec = (await getPartyRecord(q.partyId))!
    expect(rec.paying).toMatchObject({ state: 'unclear' })
    expect(m.refund).not.toHaveBeenCalled()

    m.createOrder.mockClear(); m.processPayment.mockClear()
    expect(await payIt(q)).toMatchObject({ ok: false, why: 'busy' })
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('unclear, then the same attempt again finds it paid: booked once', async () => {
    const q = await makeQuote('2032-01-19')
    m.processPayment.mockImplementationOnce(async (p: any) => {
      m.paid.set(p.orderId, { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null })
      throw new Error('timeout after charging')
    })
    m.findOrderPayment.mockResolvedValueOnce(null)
    const attemptId = randomUUID()
    expect(await payIt(q, { attemptId })).toMatchObject({ ok: false, why: 'checking' })
    expect(await payIt(q, { attemptId })).toEqual({ ok: true, partyId: q.partyId })
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await getQuote(q.id))!.status).toBe('paid')
    expect(m.alert.mock.calls.filter(([t]) => String(t).startsWith('Private event booked'))).toHaveLength(1)
  })
})

describe('deletePartyRecord', () => {
  it('removes a record with no charges and refuses one with a charge', async () => {
    const base = {
      hostToken: 'h', craftName: 'x', startIso: at('2032-02-01', '18:00'), durationMinutes: 60, hostName: 'A', hostEmail: '', guestCount: 1,
      title: null, dropOff: false, createdAt: NOW.toISOString(), source: 'ours' as const, status: 'booked' as const,
    }
    await createPartyRecord({ ...base, bookingId: 'pty_del_a' })
    expect(await deletePartyRecord('pty_del_a')).toBe(true)
    expect(await getPartyRecord('pty_del_a')).toBeNull()
    expect(await deletePartyRecord('pty_del_a')).toBe(false)

    await createPartyRecord({ ...base, bookingId: 'pty_del_b' })
    await updatePartyRecord('pty_del_b', (r) => ({ ...r, charges: [{ id: 'c', via: 'link', orderId: 'o', paymentId: 'p', cents: 1, quotedCents: 1, itemIds: [], receiptUrl: null, at: '', by: null }] }), 'test', null)
    await expect(deletePartyRecord('pty_del_b')).rejects.toThrow()
    expect(await getPartyRecord('pty_del_b')).not.toBeNull()
  })
})
