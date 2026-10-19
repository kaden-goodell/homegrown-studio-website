/**
 * POST /api/party/book.json: our own party records, one Square order and one
 * charge, and never a Square booking. The party book, party records, party
 * settings, checkouts and payments index are the real stores (temp dir);
 * Square, the craft catalog, emails and texts are fakes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

// Pins the weekly rules (Sun 1:00 and 3:30, Sat 1:30, Thu/Fri 4:00); one-off days are tested elsewhere.
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))

const m = vi.hoisted(() => ({
  createBooking: vi.fn(),
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  findOrCreate: vi.fn(),
  fromNonce: vi.fn(),
  alert: vi.fn(),
  email: vi.fn(),
  sendEmail: vi.fn(),
  announce: vi.fn(),
  findCraft: vi.fn(),
  bypass: { on: false },
  down: { settings: false },
  paid: new Map<string, any>(),
}))

vi.mock('@config/providers', () => ({
  providers: {
    booking: { createBooking: (...a: any[]) => m.createBooking(...a), listBookings: async () => [] },
    workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] },
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
    },
    customer: { findOrCreate: (...a: any[]) => m.findOrCreate(...a) },
    giftcard: { fromNonce: (...a: any[]) => m.fromNonce(...a) },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({
  sendPartyConfirmationEmail: (...a: any[]) => m.email(...a),
  sendEmail: (...a: any[]) => m.sendEmail(...a),
}))
vi.mock('@lib/booking-alert', () => ({ announceBooking: (...a: any[]) => m.announce(...a) }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: async () => undefined }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => m.bypass.on }))
vi.mock('@lib/craft-catalog', async (orig) => ({
  ...(await orig<typeof import('@lib/craft-catalog')>()),
  findPartyCraft: (...a: any[]) => m.findCraft(...a),
}))
vi.mock('@lib/parties/settings-store', async (orig) => {
  const real = await orig<typeof import('@lib/parties/settings-store')>()
  return { ...real, getPartySettings: async (o?: any) => { if (m.down.settings) throw new Error('party settings store down'); return real.getPartySettings(o) } }
})

import { POST } from '@pages/api/party/book.json'
import { partyIdFor } from '@lib/parties/checkout'
import { holdsBetween, holdTime } from '@lib/parties/party-book'
import { isStartOpen } from '@lib/parties/open-times'
import { getPartySettings, savePartySettings, resetPartySettingsCache } from '@lib/parties/settings-store'
import { localToUtcISO } from '@lib/parties/party-times'
import { getPartyRecord } from '@lib/party-store'
import { partyForPayment } from '@lib/parties/party-payments'
import { getCheckout } from '@lib/parties/party-checkouts'

const NOW = new Date('2027-02-01T15:00:00.000Z') // every date below is inside the 90-day window
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const CRAFT = { id: 'craft-1', name: 'Tote Bags', perHeadCents: 2000, perHeadMaxCents: 2000, description: 'Paint a tote.', imageUrl: 'https://img/tote.png', personalized: false, popular: false, partyOnly: false, cafeOnly: false }

let ip = 0
const post = async (b: Record<string, unknown>) => {
  const res = await POST({
    request: new Request('http://localhost/api/party/book.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }),
    clientAddress: `10.0.0.${++ip}`,
  } as any) as Response
  return { status: res.status, json: await res.json() }
}

function body(startTime: string, over: Record<string, unknown> = {}) {
  return {
    attemptId: randomUUID(),
    startTime,
    guests: 10,
    craftId: 'craft-1',
    customer: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '256-555-1234' },
    paymentToken: 'cnon:card-nonce-ok',
    ...over,
  }
}

const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)
let drift = 0

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetPartySettingsCache()
  const cur = await getPartySettings({ fresh: true })
  await savePartySettings({
    times: cur.times,
    packages: [...cur.packages, { id: 'pkg_test', name: 'Test party', priceCents: 100, minutes: 90, minGuests: 1, maxGuests: 30, defaultGuests: 1, quickPicks: [], who: 'link', archived: false }],
    addOns: [{ id: 'add_time', label: 'Extra half hour', priceCents: 2500, per: 'party', extraMinutes: 30, maxQty: 1, online: true, archived: false }],
    readSquareBookings: cur.readSquareBookings,
  }, { expectedUpdatedAt: cur.updatedAt, by: { id: 'k', name: 'Kaden' } })
})
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
  vi.setSystemTime(NOW)
  drift = 0
  m.bypass.on = false
  m.down.settings = false
  m.paid.clear()
  for (const f of [m.createBooking, m.alert, m.sendEmail, m.announce]) f.mockReset().mockResolvedValue(undefined)
  m.email.mockReset().mockResolvedValue({ sent: true })
  m.findCraft.mockReset().mockImplementation(async (id: string) => (id === CRAFT.id ? CRAFT : null))
  m.findOrCreate.mockReset().mockResolvedValue({ id: 'cust-1', email: 'alice@example.com' })
  m.fromNonce.mockReset()
  m.createOrder.mockReset().mockImplementation(async (p: any) => ({ id: `ord-${p.idempotencyKey}`, version: 1, lineItems: p.lineItems, discounts: [], totalAmount: sumLines(p.lineItems) + drift, currency: 'USD', status: 'open' }))
  m.processPayment.mockReset().mockImplementation(async (p: any) => {
    const pay = { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://r/1' }
    m.paid.set(p.orderId, pay)
    return pay
  })
  m.findOrderPayment.mockReset().mockImplementation(async (orderId: string) => m.paid.get(orderId) ?? null)
})

const heldBy = async (startIso: string, partyId: string) =>
  (await holdsBetween(startIso, new Date(Date.parse(startIso) + 60_000).toISOString(), new Date())).find((h) => h.partyId === partyId)

describe('POST /api/party/book.json: one order, one charge, no Square booking', () => {
  it('books into our records: a pty_ record, a booked hold, one order with reference_id, one payment of Square’s total, the payments index', async () => {
    const start = at('2027-02-14', '13:00')
    const b = body(start)
    const { status, json } = await post(b)
    expect(status).toBe(200)
    const partyId = partyIdFor(b.attemptId)
    expect(json.data.bookingId).toBe(partyId)
    expect(partyId).toMatch(/^pty_[0-9a-f]{16}$/)

    expect(m.createBooking).not.toHaveBeenCalled()
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    const order = m.createOrder.mock.calls[0][0]
    expect(order.referenceId).toBe(partyId)
    expect(order.idempotencyKey).toBe(`${b.attemptId}:order`)
    expect(order.lineItems).toEqual([{ name: 'Whole Studio Party — studio fee', quantity: 1, pricePerUnit: 30000, note: 'pkg_whole' }])
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.processPayment.mock.calls[0][0]).toMatchObject({ amount: 30000, idempotencyKey: `${b.attemptId}:pay`, orderId: `ord-${b.attemptId}:order` })

    const rec = await getPartyRecord(partyId)
    expect(rec).toMatchObject({ source: 'ours', status: 'booked', craftId: 'craft-1', craftName: 'Tote Bags', packageId: 'pkg_whole', guestCount: 10, endIso: at('2027-02-14', '14:30') })
    expect(rec!.hostToken).toBe(json.data.hostToken)
    expect(rec!.payToken).toBeTruthy()
    expect(rec!.payToken).not.toBe(rec!.hostToken)
    expect(rec!.charges).toHaveLength(1)
    const charge = rec!.charges![0]
    expect(charge).toMatchObject({ via: 'online', cents: 30000, quotedCents: 30000, paymentId: `pay-ord-${b.attemptId}:order` })
    expect(rec!.items!.every((it) => it.chargeId === charge.id && /^itm_/.test(it.id))).toBe(true)
    expect(await partyForPayment(charge.paymentId)).toEqual({ partyId, chargeId: charge.id })
    expect((await heldBy(start, partyId))?.state).toBe('booked')
    expect(await getCheckout(partyId)).toBeNull()
    expect(json.data).toMatchObject({ totalCharged: 30000, emailSent: true, receiptUrl: 'https://r/1' })

    // The email: craft from the catalog, the party id as the reference.
    const mail = m.email.mock.calls[0][0]
    expect(mail).toMatchObject({ craftName: 'Tote Bags', perHeadCents: 2000, craftImageUrl: 'https://img/tote.png', bookingRef: partyId, totalChargedCents: 30000 })
    expect(mail.hostPageUrl).toContain(`/party/${partyId}?key=${rec!.hostToken}`)
    expect(m.announce).toHaveBeenCalledTimes(1)
  })

  it('prices from settings and the craft from the catalog: an old cached page’s body (variation id, people, craft price) books the default package', async () => {
    const start = at('2027-02-14', '15:30')
    const { status, json } = await post({
      attemptId: randomUUID(), startTime: start, serviceVariationId: 'var-abc', serviceVariationVersion: 1, durationMinutes: 150,
      craft: { id: 'craft-1', name: 'Hacked', perHeadCents: 1, imageUrl: 'https://evil/x.png' }, people: 12,
      customer: { firstName: 'Bo', lastName: 'Lee', email: 'bo@example.com', phone: '2565551234' }, paymentToken: 'cnon:ok',
      priceCents: 1, totalCents: 1,
    })
    expect(status).toBe(200)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(30000)
    const rec = await getPartyRecord(json.data.bookingId)
    expect(rec).toMatchObject({ packageId: 'pkg_whole', guestCount: 12, craftName: 'Tote Bags' })
    expect(m.email.mock.calls[0][0]).toMatchObject({ craftName: 'Tote Bags', perHeadCents: 2000, craftImageUrl: 'https://img/tote.png' })
  })

  it('refuses a craft the catalog doesn’t have, holding nothing', async () => {
    const start = at('2027-02-20', '13:30')
    const { status, json } = await post(body(start, { craftId: 'nope' }))
    expect(status).toBe(404)
    expect(json.field).toBe('craftId')
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await isStartOpen(start, 90)).ok).toBe(true)
  })

  it('retry finds the payment: the same attempt after success gets the stored answer, one processPayment', async () => {
    const b = body(at('2027-02-21', '13:00'))
    const first = await post(b)
    const again = await post({ ...b, paymentToken: 'cnon:retyped' })
    expect(again.status).toBe(200)
    expect(again.json.data.bookingId).toBe(first.json.data.bookingId)
    expect(again.json.data.hostToken).toBe(first.json.data.hostToken)
    expect(again.json.data.replayed).toBe(true)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.createOrder).toHaveBeenCalledTimes(1)
  })

  it('a held, unexpired same attempt answers 409 in_progress and charges nothing', async () => {
    const start = at('2027-02-21', '15:30')
    const b = body(start)
    expect((await holdTime({ partyId: partyIdFor(b.attemptId), startIso: start, endIso: at('2027-02-21', '17:00'), ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
    const { status, json } = await post(b)
    expect(status).toBe(409)
    expect(json.code).toBe('in_progress')
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('slot taken before any order: another attempt on a taken time gets 409 slot_taken and no order', async () => {
    const start = at('2027-02-28', '13:00')
    expect((await post(body(start))).status).toBe(200)
    m.createOrder.mockClear()
    const { status, json } = await post(body(start, { customer: { firstName: 'Cy', lastName: 'Two', email: 'cy@example.com', phone: '2565550000' } }))
    expect(status).toBe(409)
    expect(json.code).toBe('slot_taken')
    expect(json.detail).toBe('That time was just booked by someone else. Nothing was charged. Pick another time.')
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('declined: the hold is released and the time is offered again', async () => {
    const start = at('2027-02-28', '15:30')
    m.processPayment.mockRejectedValue(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const b = body(start)
    const { status, json } = await post(b)
    expect(status).toBe(402)
    expect(json.code).toBe('card_declined')
    expect(await heldBy(start, partyIdFor(b.attemptId))).toBeUndefined()
    expect((await isStartOpen(start, 90)).ok).toBe(true)
    expect(await getPartyRecord(partyIdFor(b.attemptId))).toBeNull()
    expect(await getCheckout(partyIdFor(b.attemptId))).toBeNull()
  })

  it('unknown keeps the hold: no expiry, owners told the party id, 502 unknown_outcome; a retry recovers the paid order once', async () => {
    const start = at('2027-03-07', '13:00')
    m.processPayment.mockRejectedValue(new Error('socket hang up'))
    const b = body(start)
    const partyId = partyIdFor(b.attemptId)
    const { status, json } = await post(b)
    expect(status).toBe(502)
    expect(json.code).toBe('unknown_outcome')
    const hold = await heldBy(start, partyId)
    expect(hold).toMatchObject({ state: 'held', holdExpiresAt: null })
    expect(m.alert.mock.calls.some(([t]) => String(t).includes(partyId) && /unclear/i.test(String(t)))).toBe(true)
    expect(await getCheckout(partyId)).toMatchObject({ state: 'unclear' })
    expect(await getPartyRecord(partyId)).toBeNull()
    // A day later the time is still held for them.
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000))
    expect((await isStartOpen(start, 90)).ok).toBe(false)

    // Retry, still no payment in Square: still finishing, nothing charged.
    m.processPayment.mockClear()
    expect((await post({ ...b, paymentToken: 'cnon:retyped' })).json.code).toBe('in_progress')
    expect(m.processPayment).not.toHaveBeenCalled()

    // Square now shows the first try paid: recorded, never charged again.
    m.paid.set(`ord-${b.attemptId}:order`, { id: 'pay-late', orderId: `ord-${b.attemptId}:order`, amount: 30000, status: 'completed', receiptUrl: null })
    const ok = await post({ ...b, paymentToken: 'cnon:retyped' })
    expect(ok.status).toBe(200)
    expect(m.processPayment).not.toHaveBeenCalled()
    expect((await getPartyRecord(partyId))!.charges![0].paymentId).toBe('pay-late')
    expect((await heldBy(start, partyId))?.state).toBe('booked')
    expect(await getCheckout(partyId)).toBeNull()
  })

  it('paid after the hold ran out (R6): recorded with overlap, owners told, still 200', async () => {
    const start = at('2027-03-07', '15:30')
    const b = body(start)
    const partyId = partyIdFor(b.attemptId)
    m.processPayment.mockImplementation(async (p: any) => {
      // The charge takes so long the 10-minute hold runs out and another party takes the time.
      vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000))
      expect((await holdTime({ partyId: 'pty_rival00000000000', startIso: start, endIso: at('2027-03-07', '17:00'), ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
      return { id: 'pay-r6', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }
    })
    const { status } = await post(b)
    expect(status).toBe(200)
    const rec = await getPartyRecord(partyId)
    expect(rec).toMatchObject({ status: 'booked', overlap: true })
    expect(m.alert.mock.calls.some(([t]) => String(t).includes(partyId) && /taken by another party/.test(String(t)))).toBe(true)
    expect((await heldBy(start, partyId))?.state).toBe('booked')
  })

  it.each([50, -50])('drift %i cents: Square’s total is charged and the owners are emailed', async (d) => {
    drift = d
    const start = at(d > 0 ? '2027-03-21' : '2027-03-28', '13:00')
    const { status, json } = await post(body(start))
    expect(status).toBe(200)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(30000 + d)
    expect(json.data.totalCharged).toBe(30000 + d)
    expect(m.sendEmail).toHaveBeenCalledTimes(1)
    expect(m.sendEmail.mock.calls[0][0].subject).toBe('Party price differed')
    expect((await getPartyRecord(json.data.bookingId))!.charges![0]).toMatchObject({ cents: 30000 + d, quotedCents: 30000 })
  })

  it('drift +150: refused, the time released, nothing charged', async () => {
    drift = 150
    const start = at('2027-03-21', '15:30')
    const b = body(start)
    const { status, json } = await post(b)
    expect(status).toBe(503)
    expect(json.detail).toMatch(/not charged/)
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await heldBy(start, partyIdFor(b.attemptId))).toBeUndefined()
    expect(m.alert.mock.calls.some(([t]) => /price mismatch/.test(String(t)))).toBe(true)
  })

  it('store down refuses: 503 before any Square call', async () => {
    m.down.settings = true
    resetPartySettingsCache()
    const { status, json } = await post(body(at('2027-04-04', '13:00'), { sourceKind: 'gift_card' }))
    expect(status).toBe(503)
    expect(json.code).toBe('unavailable')
    for (const f of [m.createOrder, m.processPayment, m.findOrCreate, m.fromNonce, m.findOrderPayment]) expect(f).not.toHaveBeenCalled()
    m.down.settings = false
    resetPartySettingsCache()
  })

  it('a link-only package is refused without its id and booked with it', async () => {
    const start = at('2027-04-04', '15:30')
    const refused = await post(body(start, { packageId: 'pkg_test', guests: 2 }))
    expect(refused.status).toBe(400)
    expect(refused.json.field).toBe('packageId')
    expect(m.createOrder).not.toHaveBeenCalled()
    const ok = await post(body(start, { packageId: 'pkg_test', linkPackageId: 'pkg_test', guests: 2 }))
    expect(ok.status).toBe(200)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(100)
    expect(m.createOrder.mock.calls[0][0].lineItems).toEqual([{ name: 'Party — Test party', quantity: 1, pricePerUnit: 100, note: 'pkg_test' }])
  })

  it('an online extra half hour lengthens the record’s end and the hold, and is on the order', async () => {
    const start = at('2027-04-11', '13:00')
    const b = body(start, { addOns: { add_time: 1 } })
    const { status, json } = await post(b)
    expect(status).toBe(200)
    const rec = await getPartyRecord(json.data.bookingId)
    expect(rec!.endIso).toBe(at('2027-04-11', '15:00'))
    expect((await heldBy(start, json.data.bookingId))?.endIso).toBe(at('2027-04-11', '15:00'))
    expect(m.createOrder.mock.calls[0][0].lineItems[1]).toEqual({ name: 'Whole Studio Party — Extra half hour', quantity: 1, pricePerUnit: 2500, note: 'add_time' })
    expect(json.data.totalCharged).toBe(32500)
    // The calendar event in the email ends with the extra time.
    expect(m.email.mock.calls[0][0].icsContent).toContain('20270411T200000Z')
  })

  it('a gift card short of the total is refused (402) before the hold', async () => {
    const start = at('2027-04-25', '13:00')
    m.fromNonce.mockResolvedValue({ state: 'ACTIVE', balanceCents: 1000 })
    const { status, json } = await post(body(start, { sourceKind: 'gift_card', paymentToken: 'gftc:x' }))
    expect(status).toBe(402)
    expect(json.code).toBe('gift_card_short')
    expect(json).toMatchObject({ balanceCents: 1000, totalCents: 30000 })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await isStartOpen(start, 90)).ok).toBe(true)
  })

  it('bookings gate closed: refused as today (the gate’s own answer), nothing touched', async () => {
    const before = process.env.BOOKINGS_OPEN
    process.env.BOOKINGS_OPEN = ''
    try {
      const { status } = await post(body(at('2027-04-18', '13:00')))
      const { bookingsClosedResponse } = await import('@lib/bookings-gate')
      expect(status).toBe(bookingsClosedResponse().status)
      expect(m.createOrder).not.toHaveBeenCalled()
    } finally {
      process.env.BOOKINGS_OPEN = before
    }
  })

  it('a paid customer retrying after bookings closed still gets their stored confirmation', async () => {
    const b = body(at('2027-04-18', '13:00'))
    const first = await post(b)
    expect(first.status).toBe(200)
    const before = process.env.BOOKINGS_OPEN
    process.env.BOOKINGS_OPEN = ''
    try {
      const again = await post(b)
      expect(again.status).toBe(200)
      expect(again.json.data).toMatchObject({ bookingId: first.json.data.bookingId, hostToken: first.json.data.hostToken, replayed: true })
      const { bookingsClosedResponse } = await import('@lib/bookings-gate')
      expect((await post(body(at('2027-04-18', '15:30')))).status).toBe(bookingsClosedResponse().status)
      expect(m.processPayment).toHaveBeenCalledTimes(1)
    } finally {
      process.env.BOOKINGS_OPEN = before
    }
  })

  it('refuses a date with too little notice, saying how much is needed (settings), before anything is held', async () => {
    const { status, json } = await post(body(at('2027-02-04', '16:00')))
    expect(status).toBe(409)
    expect(json.code).toBe('not_open')
    expect(json.detail).toBe('Parties need 7 days’ notice, so that date is too soon to book. Nothing was charged. Pick a later date.')
  })

  it('keeps today’s validation words', async () => {
    expect((await post(body(at('2027-04-18', '13:00'), { guests: 3 }))).json.detail).toBe('Parties are for groups of 10 or more')
    expect((await post(body(at('2027-04-18', '13:00'), { guests: 31 }))).json.detail).toBe('Bookings are limited to 30 guests')
    expect((await post(body(at('2027-04-18', '13:00'), { customer: { firstName: 'A', lastName: '', email: 'a@b.co', phone: '2565551234' } }))).status).toBe(400)
    expect((await post(body(at('2027-04-18', '13:00'), { customer: { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '123' } }))).status).toBe(400)
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('simulated payments: recorded as simulated, no Square call', async () => {
    m.bypass.on = true
    const { status, json } = await post(body(at('2027-04-24', '13:30')))
    expect(status).toBe(200)
    expect(json.data.simulated).toBe(true)
    for (const f of [m.createOrder, m.processPayment, m.findOrCreate, m.createBooking]) expect(f).not.toHaveBeenCalled()
    expect(await getPartyRecord(json.data.bookingId)).toMatchObject({ simulated: true, status: 'booked' })
  })
})
