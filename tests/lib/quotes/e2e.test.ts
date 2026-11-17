// @vitest-environment node
/**
 * A quote from start to finish through the real libraries: menu, request,
 * draft, owner edit, send (holding the date), the customer's view and pick,
 * the deposit, then the balance through the party pay link. And the withdraw
 * path giving the date back. Stores are the real ones (temp dir); only Square,
 * texts, emails and owner alerts are fakes.
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
  quoteLinkEmail: vi.fn(),
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
vi.mock('@config/site.config', async (orig) => {
  const real: any = await orig()
  return { ...real, siteConfig: { ...real.siteConfig, providers: { booking: { config: { locationId: 'test-location' } } } } }
})
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', async (orig) => ({
  ...(await orig<any>()),
  sendPartyConfirmationEmail: (...a: any[]) => m.confirmEmail(...a),
  sendPartyPaidEmail: (...a: any[]) => m.paidEmail(...a),
  sendPartyPaymentLinkEmail: vi.fn(async () => ({ sent: true })),
  sendQuoteLinkEmail: (...a: any[]) => m.quoteLinkEmail(...a),
  sendEmail: (...a: any[]) => m.sendEmail(...a),
}))
vi.mock('@lib/quo', async (orig) => ({ ...(await orig<any>()), quoConfigured: () => false, sendQuoText: (...a: any[]) => m.quo(...a) }))
vi.mock('@lib/booking-alert', () => ({ announceBooking: vi.fn() }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: async () => undefined }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => false }))

import { draftQuote, saveQuote, sendQuote, quoteAction } from '@lib/quotes/admin-quotes'
import { saveMenuItems } from '@lib/quotes/menu-store'
import { publicView, pickTier } from '@lib/quotes/public-view'
import { payQuote } from '@lib/quotes/pay'
import { getQuote } from '@lib/quotes/quote-store'
import type { MenuItem, Quote } from '@lib/quotes/types'
import { checkRequest, getRequest, saveRequest } from '@lib/event-requests'
import { getPartyRecord } from '@lib/party-store'
import { holdsBetween } from '@lib/parties/party-book'
import { payBalance } from '@lib/parties/pay-balance'
import { dueCents } from '@lib/parties/money'
import { localToUtcISO } from '@lib/parties/party-times'
import { goodBody } from '../../fixtures/event-request'

const NOW = new Date()
const ORIGIN = 'https://ourhometownstudio.com'
const BY = 'kaden'
const URL_ = 'http://localhost/api/quote/pay.json'
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const dayOf = (ymd: string) => [at(ymd, '00:00'), at(ymd, '23:59')] as const
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)
const card = { paymentToken: 'cnon:ok', sourceKind: 'card' as const }

const item = (id: string, cents: number, tags: string[] = []): MenuItem =>
  ({ id, source: 'own', name: id, photoUrl: null, cents, per: 'person', costCents: null, tags, hidden: false, updatedAt: '' })

/** A studio request, 25 adults, 2 hours, 6 pm on the given day. */
async function request(ymd: string) {
  const base = goodBody()
  const body = goodBody({
    event: { ...base.event, date: ymd, startTime: '18:00', guests: '25', length: '2 hours', crafters: 'adults' },
    where: { ...base.where, place: 'studio', address: '' },
    budget: '1000-2500',
  })
  const c = checkRequest(body, NOW)
  if (!c.ok) throw new Error(`fixture refused: ${c.error}`)
  return saveRequest(c.value, c.photos, NOW)
}

const holdsFor = async (q: Quote, ymd: string) => (await holdsBetween(...dayOf(ymd), NOW)).filter((h) => h.partyId === q.partyId)

beforeEach(async () => {
  m.paid.clear()
  m.alert.mockReset().mockResolvedValue({ attempted: 1, sent: 1 })
  m.confirmEmail.mockReset().mockResolvedValue({ sent: true })
  m.paidEmail.mockReset().mockResolvedValue({ sent: true })
  m.sendEmail.mockReset().mockResolvedValue({ sent: true })
  m.quoteLinkEmail.mockReset().mockResolvedValue({ sent: true })
  m.quo.mockReset().mockResolvedValue(undefined)
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
  await saveMenuItems(() => [item('terr', 4500, ['adults']), item('ear', 3000, ['adults']), item('felt', 800), item('big', 20000)])
})

describe('a quote end to end', () => {
  it('draft → edit → send (held) → view → pick → deposit → booked party → balance → fully paid', async () => {
    const ymd = '2027-03-10'
    const r = await request(ymd)

    // Owner drafts and edits the middle package's price.
    const draft = await draftQuote(r.id, { by: BY, now: NOW })
    expect(draft.status).toBe('draft')
    const pick = draft.tiers.find((t) => !t.hidden && t.key === 'pick') ?? draft.tiers.find((t) => !t.hidden)!
    const tiers = draft.tiers.map((t) => (t.id === pick.id ? { ...t, priceCents: 8000 } : t))
    const saved = await saveQuote({ ...draft, tiers }, draft.version, { by: BY, now: NOW, overCapOk: true })
    expect(saved.tiers.find((t) => t.id === pick.id)!.priceCents).toBe(8000)
    expect(saved.version).toBe(draft.version + 1)

    // Send: studio, holds the time; request is quoted.
    const { quote: sent } = await sendQuote(saved.id, { text: true, email: true, overCapOk: true, by: BY, origin: ORIGIN, now: NOW })
    expect(sent).toMatchObject({ status: 'sent', held: true, place: 'studio' })
    expect(await holdsFor(sent, ymd)).toEqual([expect.objectContaining({ state: 'held' })])
    expect((await getRequest(r.id))!.status).toBe('quoted')

    // The customer opens the link (one view) and picks the edited package.
    const view = await publicView(sent.token, { isOwner: false, origin: ORIGIN, now: NOW })
    expect(view.state).toBe('open')
    if (view.state !== 'open') throw new Error('not open')
    const shown = view.tiers.find((t) => t.id === pick.id)!
    expect(shown.priceCents).toBe(8000)
    expect(shown.totalCents).toBe(8000 * 25)
    expect((await getQuote(sent.id))!.views).toBe(1)
    expect(await pickTier(sent.token, pick.id, NOW)).toEqual({ ok: true })
    expect((await getQuote(sent.id))!.status).toBe('picked')

    // Deposit.
    const current = (await getQuote(sent.id))!
    const out = await payQuote({ token: current.token, tierId: pick.id, priceKey: current.priceKey, attemptId: randomUUID(), pay: card, requestUrl: URL_, now: NOW })
    expect(out).toEqual({ ok: true, partyId: sent.partyId })
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    const deposit = m.processPayment.mock.calls[0][0].amount
    expect(deposit).toBe(shown.depositCents)

    const rec = (await getPartyRecord(sent.partyId))!
    expect(rec).toMatchObject({ origin: 'quote', source: 'ours', status: 'booked', guestCount: 25, startIso: sent.startIso, endIso: sent.endIso })
    const entries = await holdsFor(sent, ymd)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ state: 'booked', holdExpiresAt: null })
    expect((await getQuote(sent.id))!.status).toBe('paid')
    expect((await getRequest(r.id))!.status).toBe('booked')
    const balance = dueCents(rec)
    expect(balance).toBe(8000 * 25 - deposit)
    expect(balance).toBeGreaterThan(0)

    // Balance through the party pay link.
    const bal = await payBalance({ partyId: rec.bookingId, key: rec.payToken!, attemptId: randomUUID(), expectedCents: balance, pay: { kind: 'card', paymentToken: 'cnon:ok' }, requestUrl: URL_ }, NOW)
    expect(bal.kind).toBe('paid')
    expect(m.processPayment).toHaveBeenCalledTimes(2)
    expect(m.processPayment.mock.calls[1][0].amount).toBe(balance)
    const done = (await getPartyRecord(sent.partyId))!
    expect(dueCents(done)).toBe(0)
    expect(done.charges!.reduce((t, c) => t + c.cents, 0)).toBe(8000 * 25)
    expect(await holdsFor(sent, ymd)).toHaveLength(1)
  })

  it('draft → send → withdraw gives the time back and the request returns to new', async () => {
    const ymd = '2027-03-11'
    const r = await request(ymd)
    const draft = await draftQuote(r.id, { by: BY, now: NOW })
    const { quote: sent } = await sendQuote(draft.id, { text: false, email: false, overCapOk: true, by: BY, origin: ORIGIN, now: NOW })
    expect(sent.held).toBe(true)
    expect(await holdsFor(sent, ymd)).toHaveLength(1)
    expect((await getRequest(r.id))!.status).toBe('quoted')

    const gone = await quoteAction(sent.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    expect(gone).toMatchObject({ status: 'withdrawn', held: false })
    expect(await holdsFor(sent, ymd)).toHaveLength(0)
    expect((await getRequest(r.id))!.status).toBe('new')
    expect(m.processPayment).not.toHaveBeenCalled()
  })
})
