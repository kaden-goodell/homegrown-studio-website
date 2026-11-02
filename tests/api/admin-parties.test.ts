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
  testSite: { on: false },
  releaseClaim: vi.fn(),
  /** store faults for the party records: a write that lands then throws; a write that throws without landing; reads that throw */
  fault: { landThenThrow: 0, throwOnSet: 0, getFailsAfterSetThrow: 0, getFails: 0 },
  /** the next party-record write pauses (ms) just before or just after it lands, and says so (`onPause`): to line up two requests */
  pause: { before: 0, after: 0, onPause: null as null | (() => void) },
  paid: new Map<string, any>(),
  data: new Map<string, { value: string; etag: string }>(),
  n: 0,
}))

vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  const put = (k: string, v: string) => m.data.set(k, { value: v, etag: `e${++m.n}` })
  const readFault = () => { if (m.fault.getFails > 0) { m.fault.getFails--; throw new Error('store read timed out') } }
  const mem = {
    async get(k: string) { readFault(); return m.data.get(k)?.value ?? null },
    async set(k: string, v: string) { put(k, v) },
    async getWithMeta(k: string) { readFault(); const h = m.data.get(k); return { value: h?.value ?? null, etag: h?.etag ?? null } },
    async setIfMatch(k: string, v: string, etag: string | null, exists: boolean) {
      await new Promise((r) => setTimeout(r, 0))
      const hold = async (ms: number) => { m.pause.onPause?.(); m.pause.onPause = null; await new Promise((r) => setTimeout(r, ms)) }
      if (m.pause.before > 0) { const ms = m.pause.before; m.pause.before = 0; await hold(ms) }
      const cur = m.data.get(k)
      if (!exists ? cur : cur?.etag !== etag) return false
      if (m.fault.throwOnSet > 0) {
        m.fault.throwOnSet--
        m.fault.getFails += m.fault.getFailsAfterSetThrow
        throw new Error('store write timed out')
      }
      put(k, v)
      if (m.pause.after > 0) { const ms = m.pause.after; m.pause.after = 0; await hold(ms) }
      if (m.fault.landThenThrow > 0) { m.fault.landThenThrow--; throw new Error('store write timed out after landing') }
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
vi.mock('@lib/classes/test-site-guard', async (orig) => {
  const real = await orig<typeof import('@lib/classes/test-site-guard')>()
  return { ...real, classWritesRefusal: (req?: Request) => (m.testSite.on ? real.NO_TEST_STORE : real.classWritesRefusal(req)) }
})
vi.mock('@lib/kit-store', async (orig) => ({
  ...(await orig<typeof import('@lib/kit-store')>()),
  releaseWeekClaim: (...a: any[]) => m.releaseClaim(...a),
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
  LEGACY_PARTY, NOTHING_REFUNDED, PAID_EXTRA, STARTED_NO_MOVE,
} from '@lib/parties/admin-actions'
import { NO_TEST_STORE } from '@lib/classes/test-site-guard'
import { _setPartyLockWaitMs } from '@lib/parties/party-lock'
import { STILL_BOOKED } from '@pages/api/admin/parties/settings.json'

const NOW = new Date('2027-02-01T15:00:00.000Z') // Mon, Feb 1 2027
const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)
const HALF = { id: 'add_half', label: 'Extra half hour', priceCents: 5000, per: 'party' as const, extraMinutes: 30 as const, maxQty: 1, online: true, archived: false }
const BAGS = { id: 'add_bags', label: 'Goodie bags', priceCents: 500, per: 'guest' as const, extraMinutes: 0 as const, maxQty: 1, online: false, archived: false }

// Each test its own weekend: Sat 2:00 and 4:30, Sun 1:00 and 3:30.
let week = 0
// Weekends some tests book by date: never handed out.
const TAKEN = new Set(['2027-08-07', '2027-09-25', '2027-10-02'])
function weekend(): ReturnType<typeof weekendAt> {
  const w = weekendAt(week++)
  return TAKEN.has(w.satYmd) ? weekend() : w
}
function weekendAt(n: number) {
  const sat = new Date(Date.UTC(2027, 1, 6 + 7 * n))
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
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body.data.party.bookingId as string
}
const holdsOf = async (id: string) => (await holdsBetween('2027-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', NOW)).filter((h) => h.partyId === id)
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
  m.testSite.on = false
  Object.assign(m.fault, { landThenThrow: 0, throwOnSet: 0, getFailsAfterSetThrow: 0, getFails: 0 })
  Object.assign(m.pause, { before: 0, after: 0, onPause: null })
  m.releaseClaim.mockReset().mockResolvedValue(undefined)
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
    expect(r.body.error).toBe('Stefanie’s payment by link is going through right now. Wait 10 minutes, then check Payments on this party and try again.')
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sat2).toISOString()])
    const c = await act({ id, action: 'cancel' })
    expect(c.status).toBe(409)
    expect(c.body.error).toBe(r.body.error)
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
    expect(r.body.data.message).toBe('Charged $300 for the studio fee. Stefanie got the booking confirmation by email. Crafts are paid at the studio after the party.')
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
      { action: 'hold-again' }, { action: 'free-time', startIso: w.sat2 },
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

// ── Task 11 fix round 1 ──────────────────────────────────────────────────────

const NO_CUSTOMER_WORDS = /text us|check your email|don’t pay again|\(256\)/i
const unclearCharge = () => m.processPayment.mockImplementationOnce(async () => { throw new Error('socket hang up') })

describe('move: double taps and retries (C1)', () => {
  it('two moves to the same time at once: both answer 200, the party keeps one hold on the new time', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const [a, b] = await Promise.all([
      act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 }),
      act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 }),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect([a.body.data.message, b.body.data.message]).toEqual([
      expect.stringMatching(/^Moved to Sun, .* Nothing was sent to Stefanie, so let them know\.$/), a.body.data.message,
    ])
    expect([a.body.data.replay, b.body.data.replay].filter(Boolean)).toHaveLength(1)
    expect((await getPartyRecord(id))!.startIso).toBe(new Date(w.sun1).toISOString())
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
    expect(audits('party-move')).toHaveLength(1)
  })

  it('a retry after the move went through is the same answer (replay); a retry carrying the old time lets it go', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const first = await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
    const again = await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ replay: true, message: first.body.data.message })
    expect(again.body.data.sendDetails).toEqual({ action: 'send-details', label: 'Email Stefanie the new details' })
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
    expect(audits('party-move')).toHaveLength(1)
  })

  it('the record write lands but the store throws: the new time is kept, the old one let go, a plain success', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.fault.landThenThrow = 1
    const r = await act({ id, action: 'move', startIso: w.sun1 })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toMatch(/^Moved to Sun/)
    expect(r.body.data.replay).toBeUndefined()
    expect(audits('party-move')).toHaveLength(1) // this request's own write landed: audited as its move (M-e)
    expect((await getPartyRecord(id))!.startIso).toBe(new Date(w.sun1).toISOString())
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
  })

  it('the record write fails and the party can’t be re-read: both times stay held, the owners are texted, and Move again finishes it', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.fault.throwOnSet = 1
    m.fault.getFailsAfterSetThrow = 1
    const r = await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/^The move may not have finished, and the party couldn’t be checked just now\. For now both Sat, .* and Sun, .* are held for it, so nobody else can book either\. In a minute, tap Finish the move\. That finishes it either way\.$/)
    expect(r.body.both).toEqual({ from: new Date(w.sat2).toISOString(), to: new Date(w.sun1).toISOString() })
    expect((await holdsOf(id)).map((h) => h.startIso).sort()).toEqual([new Date(w.sat2).toISOString(), new Date(w.sun1).toISOString()].sort())
    expect(m.alert.mock.calls.some(([t]) => /Party move unclear/.test(String(t)))).toBe(true)
    const again = await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
    expect(again.status).toBe(200)
    expect((await getPartyRecord(id))!.startIso).toBe(new Date(w.sun1).toISOString())
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
  })

  it('a record write that fails without landing (the party re-reads on the old time) lets the new time go again', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.fault.throwOnSet = 1
    const r = await act({ id, action: 'move', startIso: w.sun1 })
    expect(r.status).toBe(503)
    expect((await getPartyRecord(id))!.startIso).toBe(new Date(w.sat2).toISOString())
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sat2).toISOString()])
  })

  // N1: every time-changing action on a party runs inside its lock; whatever the order, the party ends with exactly its own time held.
  const heldIsRecord = async (id: string) => {
    const rec = (await getPartyRecord(id))!
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(rec.startIso).toISOString()])
    return rec
  }

  /** Starts `first`; once its party-record write pauses (before or after landing), sends `second`. Both replies. */
  async function lineUp(where: 'before' | 'after', first: () => Promise<any>, second: () => Promise<any>) {
    let paused!: () => void
    const at = new Promise<void>((r) => { paused = r })
    m.pause[where] = 80
    m.pause.onPause = paused
    const one = first()
    await at
    return Promise.all([one, second()])
  }

  it('N1-a: a late retry carrying the old time, sent while a move back to that time is between its hold and its record: the party keeps exactly its own time held', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    expect((await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })).status).toBe(200)
    const [back, retry] = await lineUp('before',
      () => act({ id, action: 'move', startIso: w.sat2, fromIso: w.sun1 }),
      () => act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 }))
    expect(back.status).toBe(200)
    expect([200, 409]).toContain(retry.status)
    await heldIsRecord(id)
  })

  it('N1-b: a double tap where one record save fails: one plain failure, one success, the party on the new time with that time held', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.fault.throwOnSet = 1
    const [a, b] = await Promise.all([1, 2].map(() => act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })))
    expect([a.status, b.status].sort()).toEqual([200, 503])
    const rec = await heldIsRecord(id)
    expect(rec.startIso).toBe(new Date(w.sun1).toISOString())
    expect(audits('party-move')).toHaveLength(1)
  })

  it('N1-c: a move back sent after the first move saved its record but before it let the old time go: the party keeps exactly its own time held', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const [first, back] = await lineUp('after',
      () => act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 }),
      () => act({ id, action: 'move', startIso: w.sat2, fromIso: w.sun1 }))
    expect([first.status, back.status]).toEqual([200, 200])
    const rec = await heldIsRecord(id)
    expect(rec.startIso).toBe(new Date(w.sat2).toISOString())
  })

  it('a move, a cancel and an extra-time change at once never leave a booked party without its time', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await Promise.all([
      act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 }),
      act({ id, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` }),
    ])
    const rec = await heldIsRecord(id)
    expect((await holdsOf(id))[0].endIso).toBe(new Date(rec.endIso!).toISOString())
    const [mv, cx] = await Promise.all([
      act({ id, action: 'move', startIso: w.sun330, fromIso: rec.startIso }),
      act({ id, action: 'cancel' }),
    ])
    expect(cx.status).toBe(200)
    expect([200, 409]).toContain(mv.status)
    expect((await getPartyRecord(id))!.status).toBe('cancelled')
    expect(await holdsOf(id)).toEqual([])
  })

  it('another server changing the same party: refused plainly with nothing changed; a lease that ran out (its server died) frees itself', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const real = await vi.importActual<typeof import('@lib/blob-store')>('@lib/blob-store')
    const locks = real.makeKvStore('party-locks', 'party-locks')
    await locks.set(`lock-${id}`, JSON.stringify({ token: 'other-server', until: Date.now() + 30_000 }))
    _setPartyLockWaitMs(300)
    try {
      const r = await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
      expect(r.status).toBe(409)
      expect(r.body.error).toBe('Someone else is changing this party right now. Wait a moment, then try again. Nothing was changed.')
      expect((await act({ id, action: 'cancel' })).status).toBe(409)
      expect((await getPartyRecord(id))!).toMatchObject({ startIso: new Date(w.sat2).toISOString(), status: 'booked' })
      await heldIsRecord(id)
      await locks.set(`lock-${id}`, JSON.stringify({ token: 'other-server', until: Date.now() - 1 }))
      expect((await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })).status).toBe(200)
      await heldIsRecord(id)
    } finally {
      _setPartyLockWaitMs(6_000)
    }
  })

  it('two owners move it to different times: the second, on a stale sheet, is told where it went and nothing changes (M-f)', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    expect((await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })).status).toBe(200)
    const late = await act({ id, action: 'move', startIso: w.sun330, fromIso: w.sat2 })
    expect(late.status).toBe(409)
    expect(late.body.error).toMatch(/^Someone else moved this party to Sun, .* just now\. Nothing else changed\. Check it, then move it again if it still needs a new time\.$/)
    expect(late.body.startIso).toBe(new Date(w.sun1).toISOString())
    await heldIsRecord(id)
  })

  it('a party that has started can’t be moved (M3)', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    vi.setSystemTime(new Date(Date.parse(w.sat2) + 10 * 60_000))
    const r = await act({ id, action: 'move', startIso: w.sun1 })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(STARTED_NO_MOVE)
  })
})

describe('cancel retry and wording (I3, M2)', () => {
  it('cancelling again after a cancel whose time never got let go lets it go now', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    // The cancel's record write landed, but the reply (and the release) never happened.
    await updatePartyRecord(id, (r) => ({ ...r, status: 'cancelled', cancelled: { at: NOW.toISOString(), by: KADEN, note: '' } }), 'Cancelled', KADEN)
    expect(await holdsOf(id)).toHaveLength(1)
    const again = await act({ id, action: 'cancel' })
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ replay: true, message: 'Already cancelled. Nothing had been paid.' })
    expect(await holdsOf(id)).toHaveLength(0)
    expect(again.body.warning).toBeUndefined()
  })

  it('an unpaid party: the cancel says nothing had been paid and doesn’t mention refunds', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'cancel' })
    expect(r.body.data.message).toBe('Cancelled. Nothing had been paid. Nothing was sent to Stefanie, so let them know.')
  })

  it('a themed table: moving to another week is refused; cancelling (and cancelling again) releases the claim', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await updatePartyRecord(id, (r) => ({ ...r, theme: { themeId: 'gilded', displayName: 'The Gilded Table', serves: 12, claimRef: 'clm_1' } }), 'theme', null)
    const far = await act({ id, action: 'move', startIso: localToUtcISO('2027-09-25', '14:00') })
    expect(far.status).toBe(409)
    expect(far.body.error).toBe('This party has a themed table for its week. Pick a time in the same week.')
    expect((await act({ id, action: 'move', startIso: w.sun1 })).status).toBe(200)
    m.releaseClaim.mockRejectedValueOnce(new Error('kit store down'))
    const c = await act({ id, action: 'cancel' })
    expect(c.status).toBe(200)
    expect(c.body.warning).toMatch(/themed table is still reserved for that week\. Tap Cancel again/)
    const again = await act({ id, action: 'cancel' })
    expect(again.body.warning).toBeUndefined()
    expect(m.releaseClaim).toHaveBeenCalledTimes(2)
    expect(m.releaseClaim.mock.calls[1][2]).toBe('clm_1')
  })
})

describe('take-card (M1, M5) and owner wording (I1, I2)', () => {
  it('the same attemptId twice: one charge, the second answer says nothing more was charged', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const body = { id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 }
    expect((await act(body)).status).toBe(200)
    const again = await act(body)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ replay: true, message: 'That card was already charged $300 for the studio fee. Nothing more was charged.' })
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
  })

  it('Square never answers: 502 in owner words; the party shows the unclear payment; Move and Cancel say what is true', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    unclearCharge()
    const r = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(r.status).toBe(502)
    expect(r.body.code).toBe('unknown_outcome')
    expect(r.body.error).toMatch(/^Square didn’t answer, so we can’t tell yet if Stefanie’s card was charged \$300\. Don’t charge it again\. The party keeps its time\./)
    expect(r.body.error).toMatch(/at most until Tue, Feb 2 at/)
    expect(r.body.error).not.toMatch(NO_CUSTOMER_WORDS)
    const rec = (await getPartyRecord(id))!
    expect(rec.paying).toMatchObject({ state: 'unclear', via: 'admin-card' })
    const view = (await act({ id, action: 'edit-details', guests: 10 })).body.data.party
    expect(view.paymentInFlight).toMatchObject({ state: 'unclear', via: 'admin-card', cents: 30000 })
    const mv = await act({ id, action: 'move', startIso: w.sun1 })
    expect(mv.status).toBe(409)
    expect(mv.body.error).toMatch(/^Square didn’t give a clear answer on Stefanie’s \$300 card payment\. Move, Cancel and new payments on this party wait until that’s settled\. Look in Square under Payments for it\./)
    expect(mv.body.error).toMatch(/this clears on Tue, Feb 2 at/)
    expect(mv.body.error).not.toMatch(/few minutes/)
    expect(view.paymentInFlight.message).toBe(mv.body.error)
    const again = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe(mv.body.error)
  })

  it('a cancelled party: 410, nothing charged, in owner words', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await act({ id, action: 'cancel' })
    const r = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(r.status).toBe(410)
    expect(r.body.error).toBe('This party was cancelled, so nothing was charged. Nothing is due on a cancelled party.')
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('a party that already had its confirmation gets a plain receipt; an email that fails is never claimed', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await act({ id, action: 'add-extra', addOnId: 'add_bags', count: 1, createKey: `x_${randomUUID()}` })
    await updatePartyRecord(id, (r) => ({ ...r, confirmation: { at: NOW.toISOString(), sent: true } }), 'confirmed', null)
    m.paidEmail.mockResolvedValueOnce({ sent: false })
    const r = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 35000 })
    expect(r.status).toBe(200)
    expect(m.confirmEmail).not.toHaveBeenCalled()
    expect(m.paidEmail).toHaveBeenCalledTimes(1)
    expect(r.body.data.message).toBe('Charged $350 for the studio fee and goodie bags. The email to Stefanie didn’t go out. Check the email address on the party. Crafts are paid at the studio after the party.')
  })

  it('the amount changed since the sheet opened, a declined card, and a price mismatch read in owner words', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const changed = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 25000 })
    expect(changed.status).toBe(409)
    expect(changed.body.error).toMatch(/^What’s due changed since you opened this/)
    m.processPayment.mockImplementationOnce(async () => { throw Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }) })
    const declined = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(declined.status).toBe(402)
    expect(declined.body.error).toBe('The card was declined, so nothing was charged. Try another card, or use Send payment link.')
    m.createOrder.mockImplementationOnce(async (p: any) => ({ id: 'ord-x', version: 1, lineItems: p.lineItems, discounts: [], totalAmount: 99999, currency: 'USD', status: 'open' }))
    const mismatch = await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(mismatch.status).toBe(503)
    expect(mismatch.body.error).toMatch(/^Square’s total didn’t match our price, so nothing was charged\. The owners got a text/)
    for (const e of [changed.body.error, declined.body.error, mismatch.body.error]) expect(e).not.toMatch(NO_CUSTOMER_WORDS)
  })

  it('book by card: Square never answers → owner words naming To decide; declined and in-progress too', async () => {
    const w = weekend()
    unclearCharge()
    const r = await book(cardBody(w.sat2))
    expect(r.status).toBe(502)
    expect(r.body.error).toBe('Square didn’t answer, so we can’t tell yet if Stefanie’s card was charged. Don’t charge it again. The time stays held for Stefanie. In a few minutes, look in Square under Payments. The party is also listed in To decide, where you confirm it or say it wasn’t paid.')
    m.processPayment.mockImplementationOnce(async () => { throw Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }) })
    const declined = await book(cardBody(w.sun1))
    expect(declined.status).toBe(402)
    expect(declined.body.error).toBe('The card was declined, so nothing was charged and the time was let go. Try another card, or book with Send payment link.')
    expect(declined.body.error).not.toMatch(NO_CUSTOMER_WORDS)
  })
})

describe('R41: a test site sharing the live stores writes nothing', () => {
  it('book, every action and the settings save are refused; nothing stored, nothing sent', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const before = m.data.get(id)!.value
    m.testSite.on = true
    const b = await book(linkBody(w.sun1))
    expect(b.status).toBe(503)
    expect(b.body.error).toBe(NO_TEST_STORE)
    for (const body of [
      { action: 'move', startIso: w.sun1 }, { action: 'cancel' }, { action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` },
      { action: 'send-link' }, { action: 'edit-details', guests: 12 }, { action: 'send-details', createKey: `d_${randomUUID()}` },
      { action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 },
      { action: 'hold-again' }, { action: 'free-time', startIso: w.sat2 },
    ]) {
      const r = await act({ id, ...body })
      expect(r.status, body.action).toBe(503)
      expect(r.body.error, body.action).toBe(NO_TEST_STORE)
    }
    m.testSite.on = false
    const cur = (await call(settingsRoute, 'GET', '/api/admin/parties/settings.json')).body.data.settings
    m.testSite.on = true
    const s = await call(settingsRoute, 'POST', '/api/admin/parties/settings.json', { ...cur, expectedUpdatedAt: cur.updatedAt })
    expect(s.status).toBe(503)
    expect(m.data.get(id)!.value).toBe(before)
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sat2).toISOString()])
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(m.linkEmail).toHaveBeenCalledTimes(1)
    expect(m.confirmEmail).not.toHaveBeenCalled()
  })
})

describe('other edge cases (M5)', () => {
  it('Parties setup: turning the Square read off while Square can’t be read → 503', async () => {
    m.legacy.mockRejectedValue(new Error('square down'))
    const cur = (await call(settingsRoute, 'GET', '/api/admin/parties/settings.json')).body.data.settings
    const r = await call(settingsRoute, 'POST', '/api/admin/parties/settings.json', { ...cur, readSquareBookings: false, expectedUpdatedAt: cur.updatedAt })
    expect(r.status).toBe(503)
    m.legacy.mockResolvedValue([])
    expect((await call(settingsRoute, 'GET', '/api/admin/parties/settings.json')).body.data.settings.readSquareBookings).toBe(true)
  })

  it('an extra a payment in flight is paying for can’t come off', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const added = await act({ id, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` })
    const itemId = added.body.data.item.id
    await updatePartyRecord(id, (r) => ({ ...r, paying: { attemptId: randomUUID(), until: new Date(NOW.getTime() + 10 * 60_000).toISOString(), via: 'link', state: 'charging', itemIds: [itemId], quotedCents: 35000 } }), 'paying', null)
    const r = await act({ id, action: 'remove-extra', itemId })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('Stefanie’s $350 payment by link is going through right now. Wait 10 minutes, then check Payments on this party and try again.')
    expect((await getPartyRecord(id))!.items!.some((it) => it.id === itemId)).toBe(true)
  })

  it('extra time: a record write that fails shrinks the hold back to the party’s saved end', async () => {
    const w = weekend()
    const id = await linkParty(w.sun1)
    m.fault.throwOnSet = 1
    const r = await act({ id, action: 'add-extra', addOnId: 'add_half', count: 1, createKey: `x_${randomUUID()}` })
    expect(r.status).toBe(503)
    const rec = (await getPartyRecord(id))!
    expect(rec.items).toHaveLength(1)
    expect((await holdsOf(id))[0].endIso).toBe(rec.endIso)
  })
})

describe('“Another time”: 8 AM to 8 PM on any day (DV3)', () => {
  const dayBefore = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
  const GUARD = (clock: string) => `A party booked here has to start between 8 AM and 8 PM. ${clock} is outside that. Check AM and PM.`

  it('private parties aren’t bound to opening hours: Thu 4 PM, Fri 2 PM and Sun 11 AM are booked', async () => {
    const w = weekend()
    for (const [ymd, hhmm] of [[dayBefore(w.satYmd, 2), '16:00'], [dayBefore(w.satYmd, 1), '14:00'], [w.sunYmd, '11:00']] as const) {
      const r = await book(linkBody(localToUtcISO(ymd, hhmm)))
      expect(r.status, `${ymd} ${hhmm}: ${JSON.stringify(r.body)}`).toBe(200)
    }
  })

  it('7:30 AM and 8:30 PM are refused in plain words; 8 AM and 8 PM are fine; a party time always passes; Move is checked the same way', async () => {
    const w = weekend()
    const early = await book(linkBody(localToUtcISO(w.satYmd, '07:30')))
    expect(early.status).toBe(409)
    expect(early.body.error).toBe(GUARD('7:30 AM'))
    const late = await book(linkBody(localToUtcISO(dayBefore(w.satYmd, 3), '20:30')))
    expect(late.status).toBe(409)
    expect(late.body.error).toBe(GUARD('8:30 PM'))
    expect((await book(linkBody(localToUtcISO(dayBefore(w.satYmd, 4), '08:00')))).status).toBe(200)
    expect((await book(linkBody(localToUtcISO(dayBefore(w.satYmd, 3), '20:00')))).status).toBe(200)
    expect((await book(linkBody(w.sun1))).status).toBe(200)
    const id = await linkParty(w.sat2)
    const mv = await act({ id, action: 'move', startIso: localToUtcISO(dayBefore(w.satYmd, 5), '06:00') })
    expect(mv.status).toBe(409)
    expect(mv.body.error).toBe(GUARD('6:00 AM'))
    expect((await getPartyRecord(id))!.startIso).toBe(w.sat2)
  })

  it('still checked against the shared schedule: another party (with its cleanup) is in the way', async () => {
    const w = weekend()
    await linkParty(w.sun1)
    const r = await book(linkBody(localToUtcISO(w.sunYmd, '11:00')))
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/^Clashes with/)
  })
})

describe('Email the host the new details (I4)', () => {
  it('offered after Move and Edit details; sends the confirmation with the current time and a new calendar file, once per tap', async () => {
    const w = weekend()
    const id = (await book(cardBody(w.sat2))).body.data.party.bookingId
    m.confirmEmail.mockClear()
    const mv = await act({ id, action: 'move', startIso: w.sun1 })
    expect(mv.body.data.sendDetails).toEqual({ action: 'send-details', label: 'Email Stefanie the new details' })
    expect(m.confirmEmail).not.toHaveBeenCalled()
    const ed = await act({ id, action: 'edit-details', craftId: 'craft-2' })
    expect(ed.body.data.sendDetails).toEqual({ action: 'send-details', label: 'Email Stefanie the new details' })
    expect(m.confirmEmail).not.toHaveBeenCalled()

    const key = `d_${randomUUID()}`
    const r = await act({ id, action: 'send-details', createKey: key })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ sent: true })
    expect(r.body.data.message).toMatch(/^Emailed Stefanie the party details for Sun, .*, with a new calendar invite\.$/)
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
    const sent = m.confirmEmail.mock.calls[0][0]
    expect(sent).toMatchObject({ to: 'stef@example.com', craftName: 'Clay Pots', updated: { costNote: 'Nothing is due before your party.' } })
    const stamp = new Date(w.sun1).toISOString().replace(/[-:]/g, '').slice(0, 15)
    expect(sent.icsContent).toContain(`DTSTART:${stamp}`)
    // N3: one calendar event per booking (UID from the booking id), SEQUENCE bumped by the move and the edit, so it replaces the old one
    expect(sent.icsContent).toContain(`UID:party-${id}@ourhometownstudio.com`)
    expect(sent.icsContent).toContain('SEQUENCE:2')
    // the email names the time the host was told (the card booking's confirmation) and the new one
    expect(sent.updated.moved).toEqual({ from: expect.stringMatching(/^Sat, .* at 2:00 PM$/), to: expect.stringMatching(/^Sun, .* at 1:00 PM$/) })
    expect(sent.updated.pay).toBeUndefined()
    expect(sent.hostPageUrl).toMatch(new RegExp(`/party/${id}\\?key=`))
    expect(audits('party-details')).toHaveLength(1)
    // The same tap again (a double tap, a retry): the first answer, no second email.
    const again = await act({ id, action: 'send-details', createKey: key })
    expect(again.body.data).toMatchObject({ replay: true, sent: true, message: r.body.data.message })
    expect(m.confirmEmail).toHaveBeenCalledTimes(1)
    const [x, y] = await Promise.all([1, 2].map(() => act({ id, action: 'send-details', createKey: `d_same_${id}` })))
    expect([x.status, y.status]).toEqual([200, 200])
    expect(m.confirmEmail).toHaveBeenCalledTimes(2)
    // told about Sunday now: a later send with no move in between doesn't say it moved
    expect(m.confirmEmail.mock.calls[1][0].updated.moved).toBeUndefined()
  })

  it('the original confirmation is the time the host knows: a move then shows “moved from”; moving back to it says nothing moved', async () => {
    const w = weekend()
    const id = (await book(cardBody(w.sat2))).body.data.party.bookingId
    expect((await getPartyRecord(id))!.confirmation).toMatchObject({ sent: true, startIso: new Date(w.sat2).toISOString() })
    await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })
    await act({ id, action: 'move', startIso: w.sat2, fromIso: w.sun1 })
    m.confirmEmail.mockClear()
    await act({ id, action: 'send-details', createKey: `d_${randomUUID()}` })
    const sent = m.confirmEmail.mock.calls[0][0]
    expect(sent.updated.moved).toBeUndefined()
    expect(sent.icsContent).toContain('SEQUENCE:2')
  })

  it('a phone booking with nothing paid: says what is still to pay (studio fee, never “balance”), and its first payment then sends a receipt', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const view = (await act({ id, action: 'edit-details', guests: 10 })).body.data.party
    expect(view.sendDetails).toEqual({ action: 'send-details', label: 'Email Stefanie the details' })
    const r = await act({ id, action: 'send-details', createKey: `d_${randomUUID()}` })
    expect(r.status).toBe(200)
    const costNote = m.confirmEmail.mock.calls[0][0].updated.costNote
    expect(costNote).toBe('There’s $300 still to pay for the studio fee.')
    expect(costNote).not.toMatch(/balance|:/i)
    // still to pay always comes with the way to pay (M-d)
    expect(m.confirmEmail.mock.calls[0][0].updated.pay).toEqual({ url: expect.stringMatching(new RegExp(`/party/pay/${id}\\?k=`)), label: 'Pay $300' })
    // never told before (a phone booking with no confirmation): nothing “moved”
    expect(m.confirmEmail.mock.calls[0][0].updated.moved).toBeUndefined()
    expect(m.confirmEmail.mock.calls[0][0].totalChargedCents).toBe(0)
    m.confirmEmail.mockClear()
    await act({ id, action: 'take-card', attemptId: randomUUID(), paymentToken: 'cnon:ok', expectedCents: 30000 })
    expect(m.confirmEmail).not.toHaveBeenCalled()
    expect(m.paidEmail).toHaveBeenCalledTimes(1)
  })

  it('an email that fails is said plainly; cancelled and Square-booked parties are refused; a tap key is required', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    m.confirmEmail.mockResolvedValueOnce({ sent: false })
    const r = await act({ id, action: 'send-details', createKey: `d_${randomUUID()}` })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe('The email to Stefanie didn’t go out. Check the email address on the party, then tap Email Stefanie the details again.')
    expect((await act({ id, action: 'send-details' })).status).toBe(400)
    await act({ id, action: 'cancel' })
    expect((await act({ id, action: 'send-details', createKey: `d_${randomUUID()}` })).status).toBe(409)
    const legacy = await legacyParty(w.sun1)
    const l = await act({ id: legacy, action: 'send-details', createKey: `d_${randomUUID()}` })
    expect(l.status).toBe(409)
    expect(l.body.error).toBe(LEGACY_PARTY)
  })
})

describe('move to the same time puts a missing hold back (Task 13 warning “isn’t held on the calendar”)', () => {
  it('a party whose time is gone from the calendar: Move to the same time holds it again', async () => {
    const { releaseTime } = await import('@lib/parties/party-book')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await releaseTime(id, w.sat2)
    expect(await holdsOf(id)).toEqual([])
    const r = await act({ id, action: 'move', startIso: w.sat2, fromIso: w.sat2 })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    const holds = await holdsOf(id)
    expect(holds.map((h) => [h.startIso, h.endIso, h.holdExpiresAt])).toEqual([[new Date(w.sat2).toISOString(), (await getPartyRecord(id))!.endIso, null]])
    expect(audits('party-move').at(-1)).toMatchObject({ details: expect.objectContaining({ heldAgain: true }) })
  })

  it('its extra time not held: the same Move holds the full length again', async () => {
    const { resizeTime } = await import('@lib/parties/party-book')
    const w = weekend()
    const id = await linkParty(w.sat2, { addOns: { add_half: 1 } })
    const rec = (await getPartyRecord(id))!
    await resizeTime(id, w.sat2, new Date(Date.parse(rec.endIso!) - 30 * 60_000).toISOString(), [], NOW)
    await act({ id, action: 'move', startIso: w.sat2, fromIso: w.sat2 })
    expect((await holdsOf(id))[0].endIso).toBe(rec.endIso)
  })

  it('its time was taken meanwhile: nothing written over, the owner is told plainly', async () => {
    const { releaseTime } = await import('@lib/parties/party-book')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await releaseTime(id, w.sat2)
    const other = await linkParty(w.sat2)
    const r = await act({ id, action: 'move', startIso: w.sat2, fromIso: w.sat2 })
    expect(r.status).toBe(200)
    expect(r.body.warning).toMatch(/^This party isn’t held on the calendar, and its time couldn’t be held again\. .* Move the other booking, or move this party to a free time\.$/)
    expect(r.body.warning).not.toMatch(/Kaden/)
    expect(await holdsOf(id)).toEqual([])
    expect((await holdsOf(other)).length).toBe(1)
  })
})

describe('Task 13 fix round: the party sheet’s hold buttons (Hold this time again, Free this time, Free the old time)', () => {
  const NOTHING_TO_HOST = () => {
    expect(m.confirmEmail).not.toHaveBeenCalled()
    expect(m.paidEmail).not.toHaveBeenCalled()
    expect(m.text).not.toHaveBeenCalled()
  }

  it('the same-time Move no longer says "Moved" or offers to email the host when nothing moved', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    const r = await act({ id, action: 'move', startIso: w.sat2, fromIso: w.sat2 })
    expect(r.status).toBe(200)
    expect(r.body.data.sendDetails).toBeNull()
    expect(r.body.data.message).toMatch(/^Stefanie’s party is already on .*\. Nothing changed\.$/)
  })

  it('Hold this time again: the party’s own time back in the book, audited, nothing sent, no "moved" words; twice is the same answer', async () => {
    const { releaseTime } = await import('@lib/parties/party-book')
    const { partyHoldState } = await import('@lib/parties/hold-actions')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await releaseTime(id, w.sat2)
    expect((await partyHoldState((await getPartyRecord(id))!, NOW))!.notHeld).toBe('missing')
    m.confirmEmail.mockClear(); m.paidEmail.mockClear(); m.text.mockClear()
    const r = await act({ id, action: 'hold-again' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.message).toMatch(/is held for Stefanie’s party again\. Nothing was sent to Stefanie\.$/)
    expect(r.body.data.message).not.toMatch(/[Mm]oved/)
    expect(r.body.data.sendDetails).toBeUndefined()
    const rec = (await getPartyRecord(id))!
    expect((await holdsOf(id)).map((h) => [h.startIso, h.endIso])).toEqual([[new Date(w.sat2).toISOString(), rec.endIso]])
    expect(rec.startIso).toBe(new Date(w.sat2).toISOString())
    expect(audits('party-hold-again')).toHaveLength(1)
    expect(audits('party-move')).toHaveLength(0)
    expect((await partyHoldState(rec, NOW))!.notHeld).toBeNull()
    const again = await act({ id, action: 'hold-again' })
    expect(again.body.data.message).toMatch(/is already held for Stefanie’s party\. Nothing changed\.$/)
    expect(audits('party-hold-again')).toHaveLength(1)
    NOTHING_TO_HOST()
  })

  it('Hold this time again: its extra time not held is held again (the "short" state)', async () => {
    const { resizeTime } = await import('@lib/parties/party-book')
    const { partyHoldState } = await import('@lib/parties/hold-actions')
    const w = weekend()
    const id = await linkParty(w.sat2, { addOns: { add_half: 1 } })
    const rec = (await getPartyRecord(id))!
    await resizeTime(id, w.sat2, new Date(Date.parse(rec.endIso!) - 30 * 60_000).toISOString(), [], NOW)
    expect((await partyHoldState(rec, NOW))!.notHeld).toBe('short')
    expect((await act({ id, action: 'hold-again' })).status).toBe(200)
    expect((await holdsOf(id))[0].endIso).toBe(rec.endIso)
  })

  it('Hold this time again: a time taken meanwhile is refused with the clash named; nothing written over', async () => {
    const { releaseTime } = await import('@lib/parties/party-book')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await releaseTime(id, w.sat2)
    const other = await linkParty(w.sat2)
    const r = await act({ id, action: 'hold-again' })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/couldn’t be held for Stefanie’s party: something else is on the calendar then\. .* Move that booking, or move Stefanie’s party to a free time\.$/)
    expect(r.body.error).not.toMatch(/Kaden/)
    expect(await holdsOf(id)).toEqual([])
    expect((await holdsOf(other)).length).toBe(1)
    expect(audits('party-hold-again')).toHaveLength(0)
  })

  it('Hold this time again: refused for a cancelled party and a Square-booked one', async () => {
    const w = weekend()
    const id = await linkParty(w.sat2)
    await act({ id, action: 'cancel' })
    expect((await act({ id, action: 'hold-again' })).status).toBe(409)
    const legacy = await legacyParty(w.sun1)
    const l = await act({ id: legacy, action: 'hold-again' })
    expect(l.status).toBe(409)
    expect(l.body.error).toBe(LEGACY_PARTY)
  })

  it('Free this time: a cancelled party still holding its time lets it go, audited, nothing sent; twice says it is already free', async () => {
    const { holdTime } = await import('@lib/parties/party-book')
    const { partyHoldState } = await import('@lib/parties/hold-actions')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await act({ id, action: 'cancel' })
    const rec = (await getPartyRecord(id))!
    // The cancel's let-go failed (a store blip): the time is still held for it.
    expect((await holdTime({ partyId: id, startIso: w.sat2, endIso: rec.endIso!, ttlMinutes: null }, [], NOW)).ok).toBe(true)
    expect((await partyHoldState(rec, NOW))!.freeable).toEqual([{ startIso: new Date(w.sat2).toISOString(), why: 'cancelled' }])
    m.confirmEmail.mockClear(); m.paidEmail.mockClear(); m.text.mockClear()
    const r = await act({ id, action: 'free-time', startIso: w.sat2 })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.message).toMatch(/is free again, so others can book it\. Nothing was sent to Stefanie and no money moved\.$/)
    expect(await holdsOf(id)).toEqual([])
    expect(audits('party-free-time').at(-1)).toMatchObject({ details: { startIso: new Date(w.sat2).toISOString(), leftover: false } })
    const again = await act({ id, action: 'free-time', startIso: w.sat2 })
    expect(again.body.data.message).toBe('That time is already free.')
    expect(audits('party-free-time')).toHaveLength(1)
    NOTHING_TO_HOST()
  })

  it('Free the old time: a leftover hold after a move goes; the time the party is on never does', async () => {
    const { holdTime, confirmTime } = await import('@lib/parties/party-book')
    const { partyHoldState } = await import('@lib/parties/hold-actions')
    const w = weekend()
    const id = await linkParty(w.sat2)
    expect((await act({ id, action: 'move', startIso: w.sun1, fromIso: w.sat2 })).status).toBe(200)
    const rec = (await getPartyRecord(id))!
    // The old time's let-go failed: a leftover.
    expect((await holdTime({ partyId: id, startIso: w.sat2, endIso: new Date(Date.parse(w.sat2) + 90 * 60_000).toISOString(), ttlMinutes: null }, [], NOW)).ok).toBe(true)
    await confirmTime(id, w.sat2, new Date(Date.parse(w.sat2) + 90 * 60_000).toISOString(), NOW)
    expect((await partyHoldState(rec, NOW))!.freeable).toEqual([{ startIso: new Date(w.sat2).toISOString(), why: 'leftover' }])
    const own = await act({ id, action: 'free-time', startIso: w.sun1 })
    expect(own.status).toBe(409)
    expect(own.body.error).toMatch(/^Stefanie’s party is on .*, so that time stays held\.$/)
    const r = await act({ id, action: 'free-time', startIso: w.sat2 })
    expect(r.status).toBe(200)
    expect(r.body.data.message).toMatch(/is free again\. Stefanie’s party stays on .*\. Nothing was sent to Stefanie\.$/)
    expect((await holdsOf(id)).map((h) => h.startIso)).toEqual([new Date(w.sun1).toISOString()])
    expect(audits('party-free-time').at(-1)).toMatchObject({ details: expect.objectContaining({ leftover: true }) })
  })

  it('Free this time waits while a payment is going through', async () => {
    const { holdTime } = await import('@lib/parties/party-book')
    const w = weekend()
    const id = await linkParty(w.sat2)
    await act({ id, action: 'cancel' })
    const rec = (await getPartyRecord(id))!
    await holdTime({ partyId: id, startIso: w.sat2, endIso: rec.endIso!, ttlMinutes: null }, [], NOW)
    await updatePartyRecord(id, (r) => ({ ...r, paying: { attemptId: randomUUID(), state: 'charging', until: new Date(NOW.getTime() + 5 * 60_000).toISOString(), via: 'link', quotedCents: 30000 } as any }), 'test', null)
    const r = await act({ id, action: 'free-time', startIso: w.sat2 })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/going through/)
    expect((await holdsOf(id)).length).toBe(1)
  })
})

