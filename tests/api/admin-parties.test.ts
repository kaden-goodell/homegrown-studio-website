/**
 * Owners run parties from /admin (stage 2 Task 11): book (send a payment link
 * or take a card), move, cancel, add and take off extras, send the link,
 * change details, take a card for what is due, the free times, and Parties
 * setup. The party records live in an in-memory store with real etags (real
 * compare-and-set); the party book, payments index, refund requests and
 * settings are the real stores (temp dir). Square, emails and texts are fakes:
 * nothing leaves the machine.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  refundPayment: vi.fn(),
  alert: vi.fn(),
  audit: vi.fn(),
  linkEmail: vi.fn(),
  paidEmail: vi.fn(),
  confirmEmail: vi.fn(),
  refundEmail: vi.fn(),
  text: vi.fn(),
  legacy: vi.fn(),
  bypass: { on: false },
  paid: new Map<string, any>(),
  data: new Map<string, { value: string; etag: string }>(),
  n: 0,
}))

vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  const put = (k: string, v: string) => m.data.set(k, { value: v, etag: `e${++m.n}` })
  const mem = {
    async get(k: string) { return m.data.get(k)?.value ?? null },
    async set(k: string, v: string) { put(k, v) },
    async getWithMeta(k: string) { const h = m.data.get(k); return { value: h?.value ?? null, etag: h?.etag ?? null } },
    async setIfMatch(k: string, v: string, etag: string | null, exists: boolean) {
      await new Promise((r) => setTimeout(r, 0))
      const cur = m.data.get(k)
      if (!exists ? cur : cur?.etag !== etag) return false
      put(k, v)
      return true
    },
    async list() { return [...m.data.keys()] },
  }
  return { ...real, makeKvStore: (name: string, dir: string, o?: any) => (name === 'parties' ? mem : real.makeKvStore(name, dir, o)) }
})
vi.mock('@config/providers', () => ({
  providers: {
    booking: { createBooking: vi.fn(), listBookings: async () => [] },
    workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] },
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
      refundPayment: (...a: any[]) => m.refundPayment(...a),
    },
    customer: { findOrCreate: async () => ({ id: 'cust-1' }) },
    giftcard: { fromNonce: vi.fn() },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => m.audit(...a) }))
vi.mock('@lib/email', async (orig) => ({
  ...(await orig<typeof import('@lib/email')>()),
  sendPartyConfirmationEmail: (...a: any[]) => m.confirmEmail(...a),
  sendPartyPaidEmail: (...a: any[]) => m.paidEmail(...a),
  sendPartyPaymentLinkEmail: (...a: any[]) => m.linkEmail(...a),
  sendRefundEmail: (...a: any[]) => m.refundEmail(...a),
  sendEmail: async () => ({ sent: true }),
}))
vi.mock('@lib/quo', async (orig) => ({ ...(await orig<typeof import('@lib/quo')>()), sendQuoText: (...a: any[]) => m.text(...a) }))
vi.mock('@lib/booking-alert', () => ({ announceBooking: vi.fn() }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: async () => undefined }))
vi.mock('@lib/dev-flags', async (orig) => ({ ...(await orig<typeof import('@lib/dev-flags')>()), paymentBypassEnabled: () => m.bypass.on }))
vi.mock('@lib/craft-catalog', async (orig) => ({
  ...(await orig<typeof import('@lib/craft-catalog')>()),
  findPartyCraft: async (id: string) => (
    id === 'craft-1' ? { id, name: 'Tote Bags', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null }
      : id === 'craft-2' ? { id, name: 'Clay Pots', perHeadCents: 2500, perHeadMaxCents: 2500, description: '', imageUrl: null }
        : null),
}))
vi.mock('@lib/parties/legacy-square', async (orig) => ({
  ...(await orig<typeof import('@lib/parties/legacy-square')>()),
  legacyRemaining: (...a: any[]) => m.legacy(...a),
  legacyPartyBusy: async () => [],
}))

import * as bookRoute from '@pages/api/admin/parties/book.json'
import * as actionsRoute from '@pages/api/admin/parties/actions.json'
import * as settingsRoute from '@pages/api/admin/parties/settings.json'
import * as timesRoute from '@pages/api/admin/parties/times.json'
import * as refundRoute from '@pages/api/admin/parties/refund.json'
import { adminCookie } from '@lib/admin-auth'
import { createPartyRecord, getPartyRecord, updatePartyRecord, type PartyRecord } from '@lib/party-store'
import { holdsBetween } from '@lib/parties/party-book'
import { localToUtcISO } from '@lib/parties/party-times'
import { configPartySettings } from '@lib/parties/party-times'
import { resetPartySettingsCache, savePartySettings } from '@lib/parties/settings-store'
import { dueCents } from '@lib/parties/money'
import { partyIdFor } from '@lib/parties/checkout'
import {
  LEGACY_PARTY, NOTHING_REFUNDED, PAID_EXTRA, PAYMENT_GOING_THROUGH,
} from '@lib/parties/admin-actions'
import { STILL_BOOKED } from '@pages/api/admin/parties/settings.json'

const NOW = new Date('2027-02-01T15:00:00.000Z') // Mon, Feb 1 2027
const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)
const HALF = { id: 'add_half', label: 'Extra half hour', priceCents: 5000, per: 'party' as const, extraMinutes: 30 as const, maxQty: 1, online: true, archived: false }
const BAGS = { id: 'add_bags', label: 'Goodie bags', priceCents: 500, per: 'guest' as const, extraMinutes: 0 as const, maxQty: 1, online: false, archived: false }

// Each test its own weekend: Sat 2:00 and 4:30, Sun 1:00 and 3:30.
let week = 0
function weekend() {
  const sat = new Date(Date.UTC(2027, 1, 6 + 7 * week++))
  const satYmd = sat.toISOString().slice(0, 10)
  const sunYmd = new Date(sat.getTime() + 86_400_000).toISOString().slice(0, 10)
  return {
    satYmd, sunYmd,
    sat2: localToUtcISO(satYmd, '14:00'), sat430: localToUtcISO(satYmd, '16:30'),
    sun1: localToUtcISO(sunYmd, '13:00'), sun330: localToUtcISO(sunYmd, '15:30'),
  }
}

const cookie = () => adminCookie().split(';')[0]
async function call(route: any, method: 'GET' | 'POST', path: string, body?: unknown, signedIn = true) {
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-who': 'Kaden', ...(signedIn ? { cookie: cookie() } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  })
  const res: Response = await route[method]({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const host = { firstName: 'Stefanie', lastName: 'Justice', email: 'stef@example.com', phone: '(256) 555-0100' }
const book = (b: Record<string, unknown>, signedIn = true) => call(bookRoute, 'POST', '/api/admin/parties/book.json', b, signedIn)
const act = (b: Record<string, unknown>, signedIn = true) => call(actionsRoute, 'POST', '/api/admin/parties/actions.json', b, signedIn)
const linkBody = (startIso: string, over: Record<string, unknown> = {}) => ({
  createKey: `ck_${randomUUID()}`, startIso, guests: 10, craftId: 'craft-1', host, pay: { kind: 'link' }, ...over,
})
const cardBody = (startIso: string, over: Record<string, unknown> = {}) => ({
  startIso, guests: 10, craftId: 'craft-1', host, pay: { kind: 'card', attemptId: randomUUID(), paymentToken: 'cnon:ok' }, ...over,
})
async function linkParty(startIso: string, over: Record<string, unknown> = {}) {
  const r = await book(linkBody(startIso, over))
  expect(r.status).toBe(200)
  return r.body.data.party.bookingId as string
}
const holdsOf = async (id: string) => (await holdsBetween('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z', NOW)).filter((h) => h.partyId === id)
const audits = (action: string) => m.audit.mock.calls.map(([e]) => e).filter((e: any) => e.action === action)

async function legacyParty(startIso: string): Promise<string> {
  const id = `sq_${randomUUID().slice(0, 8)}`
  await createPartyRecord({
    bookingId: id, hostToken: 'tok', craftName: 'Pails', startIso, durationMinutes: 90, hostName: 'Old Host', hostEmail: 'old@example.com',
    hostPhone: '2565550199', guestCount: 12, title: null, dropOff: false, createdAt: '2026-10-01T00:00:00.000Z',
  } as PartyRecord)
  return id
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  resetPartySettingsCache()
  const base = configPartySettings()
  await savePartySettings(
    { times: base.times, packages: base.packages, addOns: [HALF, BAGS], readSquareBookings: true },
    { expectedUpdatedAt: null, by: KADEN, now: NOW },
  )
})
afterAll(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
beforeEach(() => {
  vi.setSystemTime(NOW)
  m.paid.clear()
  m.bypass.on = false
  m.alert.mockReset().mockResolvedValue(undefined)
  m.audit.mockReset().mockResolvedValue(undefined)
  m.linkEmail.mockReset().mockResolvedValue({ sent: true })
  m.paidEmail.mockReset().mockResolvedValue({ sent: true })
  m.confirmEmail.mockReset().mockResolvedValue({ sent: true })
  m.refundEmail.mockReset().mockResolvedValue({ sent: true })
  m.text.mockReset().mockResolvedValue(undefined)
  m.legacy.mockReset().mockResolvedValue([])
  m.createOrder.mockReset().mockImplementation(async (p: any) => ({
    id: `ord-${p.idempotencyKey}`, version: 1, lineItems: p.lineItems, discounts: [], totalAmount: sumLines(p.lineItems), currency: 'USD', status: 'open',
  }))
  m.processPayment.mockReset().mockImplementation(async (p: any) => {
    const payment = { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://r/admin' }
    m.paid.set(p.orderId, payment)
    return payment
  })
  m.findOrderPayment.mockReset().mockImplementation(async (orderId: string) => m.paid.get(orderId) ?? null)
  m.refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: `rf_${randomUUID().slice(0, 8)}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
})

describe('sign-in', () => {
  it('401 without the passcode, on every route', async () => {
    const w = weekend()
    expect((await book(linkBody(w.sat2), false)).status).toBe(401)
    expect((await act({ id: 'pty_x', action: 'cancel' }, false)).status).toBe(401)
    expect((await call(settingsRoute, 'GET', '/api/admin/parties/settings.json', undefined, false)).status).toBe(401)
    expect((await call(settingsRoute, 'POST', '/api/admin/parties/settings.json', {}, false)).status).toBe(401)
    expect((await call(timesRoute, 'GET', `/api/admin/parties/times.json?from=${w.satYmd}`, undefined, false)).status).toBe(401)
    expect(m.createOrder).not.toHaveBeenCalled()
  })
})

describe('book', () => {
  it('book / link: a due record, a booked hold with no expiry, and one link by email and text that names the studio fee', async () => {
    const w = weekend()
    const r = await book(linkBody(w.sat2))
    expect(r.status).toBe(200)
    const id = r.body.data.party.bookingId
    expect(id).toMatch(/^pty_[0-9a-f]{16}$/)
    expect(r.body.data.party).toMatchObject({ status: 'booked', legacy: false, dueCents: 30000, paymentState: 'waiting', hostName: 'Stefanie Justice' })
    expect(r.body.data.link).toMatchObject({ email: true, text: true })
    expect(r.body.data.message).toMatch(/studio fee/)
    const rec = (await getPartyRecord(id))!
    expect(rec).toMatchObject({ source: 'ours', status: 'booked', craftId: 'craft-1', craftName: 'Tote Bags' })
    expect(dueCents(rec)).toBe(30000)
    expect(rec.charges ?? []).toHaveLength(0)
    expect(rec.linkSent).toHaveLength(1)
    const holds = await holdsOf(id)
    expect(holds).toHaveLength(1)
    expect(holds[0].holdExpiresAt).toBeNull()
    expect(m.linkEmail).toHaveBeenCalledTimes(1)
    expect(m.text).toHaveBeenCalledTimes(1)
    expect(m.text.mock.calls[0][0].content).toContain('studio fee')
    expect(m.text.mock.calls[0][0].content).not.toMatch(/balance/i)
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(audits('party-book')).toHaveLength(1)
    expect(audits('party-book')[0]).toMatchObject({ by: { ...KADEN, role: 'owner' }, target: { kind: 'party', id } })
    expect(rec.history!.some((h) => h.by?.name === 'Kaden')).toBe(true)
  })

  it('R35: the same createKey again answers the same party (replay): no second record, hold or link', async () => {
    const w = weekend()
    const body = linkBody(w.sat2)
    const first = await book(body)
    const again = await book(body)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ replay: true, link: null })
    expect(again.body.data.party.bookingId).toBe(first.body.data.party.bookingId)
    expect(m.linkEmail).toHaveBeenCalledTimes(1)
    expect(m.text).toHaveBeenCalledTimes(1)
    expect(await holdsOf(first.body.data.party.bookingId)).toHaveLength(1)
    expect(audits('party-book')).toHaveLength(1)
  })

  it('a replay whose first try never sent the link sends it then', async () => {
    const w = weekend()
    const body = linkBody(w.sat2)
    m.linkEmail.mockRejectedValueOnce(new Error('smtp down'))
    m.text.mockRejectedValueOnce(new Error('quo down'))
    const first = await book(body)
    expect(first.body.warning).toMatch(/didn’t go out/)
    const again = await book(body)
    expect(again.body.data.link).toMatchObject({ email: true, text: true })
  })

  it('book / card: charged once with a card only, recorded admin-card, confirmation email to the host', async () => {
    const w = weekend()
    const body = cardBody(w.sat2)
    const r = await book(body)
    expect(r.status).toBe(200)
    expect(r.body.data.charge).toMatchObject({ cents: 30000 })
    const rec = (await getPartyRecord(r.body.data.party.bookingId))!
    expect(rec.charges).toHaveLength(1)
    expect(rec.charges![0]).toMatchObject({ via: 'admin-card', cents: 30000 })
    expect(dueCents(rec)).toBe(0)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
    expect(m.linkEmail).not.toHaveBeenCalled()
    // The same attempt again never charges twice.
    const again = await book(body)
    expect(again.body.data.replay).toBe(true)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
  })

  it('book refuses a clash and names it, and refuses a past start (R37)', async () => {
    const w = weekend()
    await linkParty(w.sat2)
    const clash = await book(linkBody(localToUtcISO(w.satYmd, '15:00'), { host: { ...host, firstName: 'Ann', lastName: 'Other', email: 'ann@example.com' } }))
    expect(clash.status).toBe(409)
    expect(clash.body.error).toMatch(/^Clashes with .*Justice/)
    const past = await book(linkBody('2027-01-30T20:00:00.000Z'))
    expect(past.status).toBe(409)
    expect(past.body.error).toBe('That time has already passed. Pick a later time.')
    expect(m.linkEmail).toHaveBeenCalledTimes(1)
  })

  it('book ignores the 7-day notice and the booking window, and allows another time (OWNER-3)', async () => {
    // Saturday Feb 6 is 5 days away (inside the notice); far ahead is outside the 90-day window; a Tuesday has no party times.
    expect((await book(linkBody(localToUtcISO('2027-02-06', '14:00')))).status).toBe(200)
    expect((await book(linkBody(localToUtcISO('2027-08-07', '14:00')))).status).toBe(200)
    expect((await book(linkBody(localToUtcISO('2027-02-09', '11:00')))).status).toBe(200)
  })

  it('book refuses a date before the first party day, and a party that runs past midnight', async () => {
    resetPartySettingsCache()
    const s = await call(settingsRoute, 'GET', '/api/admin/parties/settings.json')
    const later = { ...s.body.data.settings, times: { ...s.body.data.settings.times, opensDate: '2027-12-01' } }
    const saved = await call(settingsRoute, 'POST', '/api/admin/parties/settings.json', { ...later, expectedUpdatedAt: s.body.data.settings.updatedAt })
    expect(saved.status).toBe(200)
    try {
      const r = await book(linkBody(localToUtcISO('2027-11-06', '14:00')))
      expect(r.status).toBe(409)
      expect(r.body.error).toMatch(/Parties start on/)
    } finally {
      const cur = saved.body.data.settings
      await call(settingsRoute, 'POST', '/api/admin/parties/settings.json', { ...cur, times: { ...cur.times, opensDate: s.body.data.settings.times.opensDate }, expectedUpdatedAt: cur.updatedAt })
    }
    const late = await book(linkBody(localToUtcISO('2027-02-09', '22:00')))
    expect(late.status).toBe(409)
    expect(late.body.error).toMatch(/midnight/)
  })
})

describe('move', () => {
  it('to a free time frees the old one; money untouched; the host is named, nothing is sent', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.linkEmail.mockClear(); m.text.mockClear()
    const r = await act({ id, action: 'move', startIso: w.sun1 })
    expect(r.status).toBe(200)
    expect(r.body.data.hostToTell).toEqual({ name: 'Stefanie Justice', phone: '(256) 555-0100', email: 'stef@example.com' })
    expect(r.body.data.message).toMatch(/Nothing was sent to Stefanie/)
    const holds = await holdsOf(id)
    expect(holds.map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
    const rec = (await getPartyRecord(id))!
    expect(rec.startIso).toBe(new Date(w.sun1).toISOString())
    expect(Date.parse(rec.endIso!) - Date.parse(rec.startIso)).toBe(90 * 60_000)
    expect(dueCents(rec)).toBe(30000)
    expect(m.linkEmail).not.toHaveBeenCalled()
    expect(m.text).not.toHaveBeenCalled()
    expect(audits('party-move')).toHaveLength(1)
    // The old time is free again for someone else.
    expect((await book(linkBody(w.sat2))).status).toBe(200)
  })

  it('onto a taken time is refused naming it; the party stays put', async () => {
    const w = weekend()
    const a = await linkParty(w.sat2)
    await linkParty(w.sat430, { host: { ...host, firstName: 'Ann', lastName: 'Other' } })
    const r = await act({ id: a, action: 'move', startIso: w.sat430 })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/Clashes with .*Other/)
    expect((await getPartyRecord(a))!.startIso).toBe(new Date(w.sat2).toISOString())
    expect((await holdsOf(a)).map((h) => h.startIso)).toEqual([new Date(w.sat2).toISOString()])
  })

  it('across months', async () => {
    const id = await linkParty(localToUtcISO('2027-09-25', '14:00'))
    const to = localToUtcISO('2027-10-02', '14:00')
    expect((await act({ id, action: 'move', startIso: to })).status).toBe(200)
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(to).toISOString()])
  })

  it('never to the past (R37)', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'move', startIso: '2027-01-30T20:00:00.000Z' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('That time has already passed. Pick a later time.')
  })

  it('move refused while paying', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await updatePartyRecord(id, (r) => ({ ...r, paying: { attemptId: randomUUID(), until: new Date(NOW.getTime() + 10 * 60_000).toISOString(), via: 'link', state: 'charging' } }), 'Payment started (link)', null)
    const r = await act({ id, action: 'move', startIso: w.sun1 })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(PAYMENT_GOING_THROUGH)
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sat2).toISOString()])
    const c = await act({ id, action: 'cancel' })
    expect(c.status).toBe(409)
    expect(c.body.error).toBe(PAYMENT_GOING_THROUGH)
  })
})

describe('cancel', () => {
  it('cancel never refunds: the time is let go, nothing refunded, no message, the host named', async () => {
    const w = weekend()
    const r0 = await book(cardBody(w.sat2))
    const id = r0.body.data.party.bookingId
    m.confirmEmail.mockClear(); m.linkEmail.mockClear(); m.text.mockClear(); m.paidEmail.mockClear()
    const r = await act({ id, action: 'cancel', note: 'They called' })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toBe('Cancelled. Nothing was refunded. Nothing was sent to Stefanie, so let them know. To give money back, use Refund on the Payments tab.')
    expect(r.body.data.hostToTell).toMatchObject({ name: 'Stefanie Justice', email: 'stef@example.com' })
    expect(r.body.data.party).toMatchObject({ status: 'cancelled', paymentState: 'cancelled' })
    expect(await holdsOf(id)).toHaveLength(0)
    expect(m.refundPayment).not.toHaveBeenCalled()
    expect(m.confirmEmail).not.toHaveBeenCalled()
    expect(m.linkEmail).not.toHaveBeenCalled()
    expect(m.text).not.toHaveBeenCalled()
    expect(m.refundEmail).not.toHaveBeenCalled()
    expect((await getPartyRecord(id))!.charges).toHaveLength(1)
    expect(audits('party-cancel')[0]).toMatchObject({ details: expect.objectContaining({ refunded: false }) })
    // Cancelling again is a plain answer, not an error.
    const again = await act({ id, action: 'cancel' })
    expect(again.status).toBe(200)
    expect(again.body.data.message).toContain(NOTHING_REFUNDED)
    // Nothing else changes on a cancelled party.
    expect((await act({ id, action: 'move', startIso: w.sun1 })).status).toBe(409)
    expect((await act({ id, action: 'send-link' })).status).toBe(409)
  })

  it('refund after cancel still works through the refund route', async () => {
    const w = weekend()
    const id = (await book(cardBody(w.sat2))).body.data.party.bookingId
    await act({ id, action: 'cancel' })
    const rec = (await getPartyRecord(id))!
    const r = await call(refundRoute, 'POST', '/api/admin/parties/refund.json', { partyId: id, chargeId: rec.charges![0].id, cents: 30000, reason: 'Cancelled', attempt: `tok_${randomUUID()}` })
    expect(r.status).toBe(200)
    expect(m.refundPayment).toHaveBeenCalledTimes(1)
    expect(m.refundPayment.mock.calls[0][0]).toMatchObject({ amountCents: 30000 })
    expect((await getPartyRecord(id))!.status).toBe('cancelled')
  })
})

describe('extras', () => {
  it('add extra half hour extends the hold; refused when the next party is too close', async () => {
    const w = weekend()
    const a = await linkParty(w.sun1)
    const key1 = `x_${randomUUID()}`
    const r = await act({ id: a, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: key1 })
    expect(r.status).toBe(200)
    expect(r.body.data.item).toMatchObject({ label: 'Extra half hour', cents: 5000, chargeId: null })
    expect(r.body.data.message).toBe('Added Extra half hour ($50). It’s due: send the payment link or take a card on the Payments tab.')
    const rec = (await getPartyRecord(a))!
    expect(Date.parse(rec.endIso!) - Date.parse(rec.startIso)).toBe(120 * 60_000)
    expect(dueCents(rec)).toBe(35000)
    expect((await holdsOf(a))[0].endIso).toBe(rec.endIso)
    expect(audits('party-extra')).toHaveLength(1)
    // The same key again: the same item, nothing added.
    expect((await act({ id: a, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: key1 })).body.data.replay).toBe(true)
    expect((await getPartyRecord(a))!.items).toHaveLength(2)

    // Saturday: 2:00 and 4:30 both booked; half an hour more on 2:00 runs into 4:30's time.
    const b = await linkParty(w.sat2)
    await linkParty(w.sat430, { host: { ...host, firstName: 'Ann', lastName: 'Other' } })
    const clash = await act({ id: b, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toMatch(/Other/)
    const bRec = (await getPartyRecord(b))!
    expect(bRec.items).toHaveLength(1)
    expect((await holdsOf(b))[0].endIso).toBe(bRec.endIso)
  })

  it('per guest: priced for every guest; a top-up covers only the new guests (S2-R4a)', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'add-extra', addOnId: 'add_bags', count: 1, createKey: `x_${randomUUID()}` })
    expect(r.body.data.item).toMatchObject({ qty: 10, cents: 5000 })
    const more = await act({ id, action: 'edit-details', guests: 12 })
    expect(more.status).toBe(200)
    expect(more.body.data.party.guestCount).toBe(12)
    expect(more.body.warning).toMatch(/Goodie bags/)
    const top = await act({ id, action: 'add-extra', addOnId: 'add_bags', count: 1, forGuests: 2, createKey: `x_${randomUUID()}` })
    expect(top.body.data.item).toMatchObject({ qty: 2, cents: 1000 })
    const over = await act({ id, action: 'add-extra', addOnId: 'add_bags', count: 1, forGuests: 1, createKey: `x_${randomUUID()}` })
    expect(over.status).toBe(400)
    expect(over.body.error).toBe('Every guest already has Goodie bags.')
  })

  it('removing an unpaid extra shrinks the hold; removing a paid extra is refused', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const added = await act({ id, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` })
    const itemId = added.body.data.item.id
    const off = await act({ id, action: 'remove-extra', itemId })
    expect(off.status).toBe(200)
    const rec = (await getPartyRecord(id))!
    expect(Date.parse(rec.endIso!) - Date.parse(rec.startIso)).toBe(90 * 60_000)
    expect((await holdsOf(id))[0].endIso).toBe(rec.endIso)

    const paidOne = await act({ id, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` })
    await updatePartyRecord(id, (r) => ({ ...r, items: r.items!.map((it) => (it.id === paidOne.body.data.item.id ? { ...it, chargeId: 'chg_paid' } : it)) }), 'paid', null)
    const refused = await act({ id, action: 'remove-extra', itemId: paidOne.body.data.item.id })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe(PAID_EXTRA)
  })
})

describe('details, link and card', () => {
  it('edit details: host, guests within the package range (prices kept), craft from the catalog', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'edit-details', hostName: 'Stef Justice', hostPhone: '256-555-0111', hostEmail: 'stef2@example.com', guests: 20, craftId: 'craft-2' })
    expect(r.status).toBe(200)
    expect(r.body.data.party).toMatchObject({ hostName: 'Stef Justice', hostPhone: '256-555-0111', hostEmail: 'stef2@example.com', guestCount: 20, craftName: 'Clay Pots', dueCents: 30000 })
    expect((await act({ id, action: 'edit-details', guests: 31 })).body.error).toBe('Parties are for 10 to 30 guests.')
    expect((await act({ id, action: 'edit-details', craftId: 'gone' })).status).toBe(404)
  })

  it('send-link sends the link again and notes it; nothing due → refused', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'send-link' })
    expect(r.status).toBe(200)
    expect(r.body.data.party.linkSent).toHaveLength(2)
    expect(audits('party-link')).toHaveLength(1)
    const paid = (await book(cardBody(w.sun1))).body.data.party.bookingId
    const none = await act({ id: paid, action: 'send-link' })
    expect(none.status).toBe(409)
    expect(none.body.error).toBe('Nothing is due on this party.')
  })

  it('take-card pays what is due with the one-payment-at-a-time claim; the host gets the confirmation', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.confirmEmail.mockClear()
    const r = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ paidCents: 30000 })
    expect(r.body.data.message).toBe('Charged $300 for the studio fee. Stefanie gets the booking confirmation by email. Crafts are paid at the studio after the party.')
    const rec = (await getPartyRecord(id))!
    expect(rec.charges![0]).toMatchObject({ via: 'admin-card', by: KADEN })
    expect(dueCents(rec)).toBe(0)
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
    expect(m.paidEmail).not.toHaveBeenCalled()
    // An owner who took the card isn't texted about it.
    expect(m.alert.mock.calls.some(([t]) => /paid/i.test(String(t)))).toBe(false)

    // While a link payment is going through, the owner's card waits.
    const id2 = await linkParty(w.sun1)
    await updatePartyRecord(id2, (r2) => ({ ...r2, paying: { attemptId: randomUUID(), until: new Date(NOW.getTime() + 10 * 60_000).toISOString(), via: 'link', state: 'charging' } }), 'Payment started (link)', null)
    const busy = await act({ id: id2, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(busy.status).toBe(409)
  })
})

describe('legacy (Square) parties', () => {
  it('legacy writes refused: every action says to change it in Square', async () => {
    const w = weekend()
    const id = await legacyParty(w.sat2)
    for (const b of [
      { action: 'move', startIso: w.sun1 }, { action: 'cancel' }, { action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` },
      { action: 'remove-extra', itemId: 'itm_x' }, { action: 'send-link' }, { action: 'edit-details', guests: 12 },
      { action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 },
    ]) {
      const r = await act({ id, ...b })
      expect(r.status, b.action).toBe(409)
      expect(r.body.error, b.action).toBe(LEGACY_PARTY)
    }
    expect(m.createOrder).not.toHaveBeenCalled()
  })
})

describe('times', () => {
  it('lists the day’s party times and which are free; a moving party does not block itself', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await call(timesRoute, 'GET', `/api/admin/parties/times.json?from=${w.satYmd}&to=${w.sunYmd}`)
    expect(r.status).toBe(200)
    const iso = (s: string) => new Date(s).toISOString()
    expect(r.body.data.offered).toEqual([iso(w.sat2), iso(w.sat430), iso(w.sun1), iso(w.sun330)])
    expect(r.body.data.open).toEqual([iso(w.sat430), iso(w.sun1), iso(w.sun330)])
    const moving = await call(timesRoute, 'GET', `/api/admin/parties/times.json?from=${w.satYmd}&to=${w.satYmd}&exclude=${id}`)
    expect(moving.body.data.open).toEqual([iso(w.sat2), iso(w.sat430)])
  })

  it('ignores the notice (this weekend shows) and never shows a past time', async () => {
    vi.setSystemTime(new Date(localToUtcISO('2027-02-06', '15:00')))
    const r = await call(timesRoute, 'GET', '/api/admin/parties/times.json?from=2027-02-06&to=2027-02-07')
    expect(r.body.data.offered).toEqual([localToUtcISO('2027-02-06', '16:30'), localToUtcISO('2027-02-07', '13:00'), localToUtcISO('2027-02-07', '15:30')].map((s) => new Date(s).toISOString()))
  })
})

describe('Parties setup', () => {
  const get = () => call(settingsRoute, 'GET', '/api/admin/parties/settings.json')
  const post = (b: unknown) => call(settingsRoute, 'POST', '/api/admin/parties/settings.json', b)

  it('GET answers the settings and the parties still booked in Square', async () => {
    m.legacy.mockResolvedValue([{ kind: 'party', id: 'sq1', label: 'x', startIso: '2027-03-01T19:00:00.000Z', endIso: '2027-03-01T20:30:00.000Z' }])
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.body.data.settings.addOns.map((a: any) => a.id)).toEqual(['add_half', 'add_bags'])
    expect(r.body.data.legacyRemaining).toEqual({ count: 1, lastIso: '2027-03-01T19:00:00.000Z' })
  })

  it('a stale save → 409 with what is saved now', async () => {
    const cur = (await get()).body.data.settings
    const r = await post({ ...cur, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
    expect(r.status).toBe(409)
    expect(r.body.current.updatedAt).toBe(cur.updatedAt)
  })

  it('a refusal names its field', async () => {
    const cur = (await get()).body.data.settings
    const r = await post({ ...cur, times: { ...cur.times, weekly: { ...cur.times.weekly, 6: ['14:00', '15:00'] } }, expectedUpdatedAt: cur.updatedAt })
    expect(r.status).toBe(400)
    expect(r.body.field).toBe('times.weekly.6')
  })

  it('a save that removes a booked start lists it: anything already booked stays booked', async () => {
    const w = weekend()
    const id = await linkParty(w.sat430)
    const cur = (await get()).body.data.settings
    const r = await post({ ...cur, times: { ...cur.times, dates: { ...cur.times.dates, [w.satYmd]: ['14:00'] } }, expectedUpdatedAt: cur.updatedAt })
    expect(r.status).toBe(200)
    expect(r.body.data.note).toBe(STILL_BOOKED)
    expect(r.body.data.booked).toEqual([expect.objectContaining({ partyId: id, hostName: 'Stefanie Justice' })])
    expect((await getPartyRecord(id))!.status).toBe('booked')
    expect(audits('party-settings')).toHaveLength(1)
  })

  it('switch off refused while some remain', async () => {
    m.legacy.mockResolvedValue([{ kind: 'party', id: 'sq1', label: 'x', startIso: '2027-03-01T19:00:00.000Z', endIso: '2027-03-01T20:30:00.000Z' }])
    const cur = (await get()).body.data.settings
    const r = await post({ ...cur, readSquareBookings: false, expectedUpdatedAt: cur.updatedAt })
    expect(r.status).toBe(409)
    expect(r.body.field).toBe('readSquareBookings')
    expect(r.body.error).toMatch(/1 party booked in Square is still to come/)
    m.legacy.mockResolvedValue([])
    const ok = await post({ ...cur, readSquareBookings: false, expectedUpdatedAt: cur.updatedAt })
    expect(ok.status).toBe(200)
    expect(ok.body.data.settings.readSquareBookings).toBe(false)
    const back = ok.body.data.settings
    await post({ ...back, readSquareBookings: true, expectedUpdatedAt: back.updatedAt })
  })
})

describe('the party id', () => {
  it('comes from the create key (R35)', async () => {
    const w = weekend()
    const body = linkBody(w.sat2)
    const r = await book(body)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.party.bookingId).toBe(partyIdFor(body.createKey))
  })
})
