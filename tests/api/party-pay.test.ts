/**
 * The payment link: GET /api/party/balance.json and POST /api/party/pay.json.
 * Parties are booked "to pay by link" through the real checkout core; the
 * party records live in an in-memory store with real etags (so "one payment
 * at a time" is a real compare-and-set); the party book, payments index and
 * settings are the real stores (temp dir). Square, emails and texts are fakes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  fromNonce: vi.fn(),
  alert: vi.fn(),
  paidEmail: vi.fn(),
  sendEmail: vi.fn(),
  bypass: { on: false },
  paid: new Map<string, any>(),
  drift: 0,
  beforeOrder: null as null | (() => Promise<void>),
  beforePay: null as null | (() => Promise<void>),
  // An in-memory blob store with real etags, for the party records only.
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
      await new Promise((r) => setTimeout(r, 0)) // let a concurrent request read in between
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
    },
    customer: { findOrCreate: async () => ({ id: 'cust-1' }) },
    giftcard: { fromNonce: (...a: any[]) => m.fromNonce(...a) },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({
  sendPartyConfirmationEmail: vi.fn(async () => ({ sent: true })),
  sendPartyPaidEmail: (...a: any[]) => m.paidEmail(...a),
  sendPartyPaymentLinkEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: (...a: any[]) => m.sendEmail(...a),
}))
vi.mock('@lib/booking-alert', () => ({ announceBooking: vi.fn() }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: async () => undefined }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => m.bypass.on }))
vi.mock('@lib/craft-catalog', async (orig) => ({
  ...(await orig<typeof import('@lib/craft-catalog')>()),
  findPartyCraft: async (id: string) => (id === 'craft-1' ? { id, name: 'Tote Bags', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null } : null),
}))

import { GET } from '@pages/api/party/balance.json'
import { POST } from '@pages/api/party/pay.json'
import { bookParty, partyIdFor } from '@lib/parties/checkout'
import { localToUtcISO } from '@lib/parties/party-times'
import { getPartyRecord, updatePartyRecord } from '@lib/party-store'
import { dueCents } from '@lib/parties/money'
import { partyForPayment } from '@lib/parties/party-payments'
import { handlePartyOrder } from '@lib/parties/square-orders'
import { listCheckouts } from '@lib/parties/party-checkouts'
import { LINK_AMOUNT_CHANGED_MESSAGE, LINK_BUSY_MESSAGE, LINK_CANCELLED_MESSAGE, tellLinkPaid } from '@lib/parties/pay-balance'

const NOW = new Date('2027-02-01T15:00:00.000Z')
const owner = { id: 'k', name: 'Kaden' }
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)

// Party times far enough apart that each test has its own (Sat 1:30, Sun 1:00 and 3:30).
const SLOTS = [
  ['2027-02-13', '13:30'], ['2027-02-14', '13:00'], ['2027-02-14', '15:30'], ['2027-02-20', '13:30'], ['2027-02-21', '13:00'],
  ['2027-02-21', '15:30'], ['2027-02-27', '13:30'], ['2027-02-28', '13:00'], ['2027-02-28', '15:30'], ['2027-03-06', '13:30'],
  ['2027-03-07', '13:00'], ['2027-03-07', '15:30'], ['2027-03-13', '13:30'], ['2027-03-14', '13:00'], ['2027-03-14', '15:30'],
  ['2027-03-20', '13:30'], ['2027-03-21', '13:00'], ['2027-03-21', '15:30'], ['2027-03-27', '13:30'], ['2027-03-28', '13:00'],
  ['2027-03-28', '15:30'], ['2027-04-03', '13:30'], ['2027-04-04', '13:00'], ['2027-04-04', '15:30'], ['2027-04-10', '13:30'],
  ['2027-04-11', '13:00'], ['2027-04-11', '15:30'], ['2027-04-17', '13:30'], ['2027-04-18', '13:00'], ['2027-04-18', '15:30'],
]
let slot = 0

/** An owner books a party to pay by link: everything due, the time held with no expiry. */
async function linkParty() {
  const [ymd, hhmm] = SLOTS[slot++]
  const key = `create-key-${randomUUID()}`
  const out = await bookParty({
    key, startIso: localToUtcISO(ymd, hhmm), guests: 10, craftId: 'craft-1',
    host: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '2565551234' },
    pay: { kind: 'link' }, audience: 'admin', by: owner, origin: 'http://localhost', requestUrl: 'http://localhost/api/admin/party',
  }, NOW)
  expect(out).toMatchObject({ kind: 'booked' })
  const rec = (await getPartyRecord(partyIdFor(key)))!
  return { id: rec.bookingId, k: rec.payToken!, hostToken: rec.hostToken, rec }
}

let ip = 0
const pay = async (b: Record<string, unknown>) => {
  const res = await POST({
    request: new Request('http://localhost/api/party/pay.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }),
    clientAddress: `10.1.0.${++ip}`,
  } as any) as Response
  return { status: res.status, json: await res.json() }
}
const balance = async (id: string, k: string) => {
  const res = await GET({ request: new Request(`http://localhost/api/party/balance.json?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`), clientAddress: `10.2.0.${++ip}` } as any) as Response
  return { status: res.status, json: await res.json() }
}
const payBody = (p: { id: string; k: string }, over: Record<string, unknown> = {}) => ({ id: p.id, k: p.k, attemptId: randomUUID(), expectedCents: 30000, paymentToken: 'cnon:ok', sourceKind: 'card', ...over })

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  vi.setSystemTime(NOW)
  m.paid.clear()
  m.drift = 0
  m.bypass.on = false
  m.beforeOrder = null
  m.beforePay = null
  m.alert.mockReset().mockResolvedValue(undefined)
  m.paidEmail.mockReset().mockResolvedValue({ sent: true })
  m.sendEmail.mockReset().mockResolvedValue({ sent: true })
  m.fromNonce.mockReset()
  m.createOrder.mockReset().mockImplementation(async (p: any) => {
    if (m.beforeOrder) { const f = m.beforeOrder; m.beforeOrder = null; await f() }
    return { id: `ord-${p.idempotencyKey}`, version: 1, lineItems: p.lineItems, discounts: [], totalAmount: sumLines(p.lineItems) + m.drift, currency: 'USD', status: 'open' }
  })
  m.processPayment.mockReset().mockImplementation(async (p: any) => {
    if (m.beforePay) { const f = m.beforePay; m.beforePay = null; await f() }
    const payment = { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://r/link' }
    m.paid.set(p.orderId, payment)
    return payment
  })
  m.findOrderPayment.mockReset().mockImplementation(async (orderId: string) => m.paid.get(orderId) ?? null)
})

describe('the link key', () => {
  it('a wrong or missing key answers exactly like a missing party (404), on both routes', async () => {
    const p = await linkParty()
    const missing = await balance('pty_0000000000000000', p.k)
    const wrong = await balance(p.id, 'not-the-key')
    const empty = await balance(p.id, '')
    expect(missing.status).toBe(404)
    expect(wrong).toEqual(missing)
    expect(empty).toEqual(missing)
    const pMissing = await pay(payBody({ id: 'pty_0000000000000000', k: p.k }))
    const pWrong = await pay(payBody({ id: p.id, k: 'nope' }))
    expect(pMissing.status).toBe(404)
    expect(pWrong).toEqual(pMissing)
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('the host page key does not open the pay page', async () => {
    const p = await linkParty()
    expect(p.hostToken).not.toBe(p.k)
    expect((await balance(p.id, p.hostToken)).status).toBe(404)
    expect((await pay(payBody({ id: p.id, k: p.hostToken }))).status).toBe(404)
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('the balance shows the unpaid items, the amount and the state', async () => {
    const p = await linkParty()
    const { status, json } = await balance(p.id, p.k)
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ hostFirstName: 'Alice', dueCents: 30000, state: 'waiting', items: [expect.objectContaining({ cents: 30000 })] })
    expect(json.data.when).toMatch(/^(Sat|Sun), (Feb|Mar|Apr) \d+ at (1|3):30 PM$|^(Sat|Sun), (Feb|Mar|Apr) \d+ at 1:00 PM$/)
    expect(json.data.packageName).toBeTruthy()
  })
})

describe('POST /api/party/pay.json', () => {
  it('pays exactly the due items, marks them, files the payment, emails the host and texts the owners', async () => {
    const p = await linkParty()
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ state: 'paid', paidCents: 30000, receiptUrl: 'https://r/link', stillDueCents: 0 })
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    const req = m.createOrder.mock.calls[0][0]
    expect(req).toMatchObject({ referenceId: p.id, customerId: null })
    expect(req.lineItems).toEqual([{ name: 'Whole Studio Party — studio fee', quantity: 1, pricePerUnit: 30000, note: 'pkg_whole' }])
    expect(req).not.toHaveProperty('taxes')
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(30000)
    const rec = (await getPartyRecord(p.id))!
    expect(dueCents(rec)).toBe(0)
    expect(rec.paying).toBeNull()
    expect(rec.charges).toHaveLength(1)
    expect(rec.charges![0]).toMatchObject({ via: 'link', cents: 30000, quotedCents: 30000, itemIds: [p.rec.items![0].id] })
    expect(rec.items!.every((it) => it.chargeId === rec.charges![0].id)).toBe(true)
    expect(await partyForPayment(rec.charges![0].paymentId)).toEqual({ partyId: p.id, chargeId: rec.charges![0].id })
    expect(m.paidEmail).toHaveBeenCalledTimes(1)
    expect(m.paidEmail.mock.calls[0][0]).toMatchObject({ to: 'alice@example.com', paidCents: 30000 })
    expect(m.alert.mock.calls.some(([t]) => /^Balance paid/.test(String(t)))).toBe(true)
    expect((await balance(p.id, p.k)).json.data).toMatchObject({ state: 'paid', dueCents: 0, items: [] })
  })

  it('two payers: two different attempts at once → one 409 before any order, one charge', async () => {
    const p = await linkParty()
    const [a, b] = await Promise.all([pay(payBody(p)), pay(payBody(p))])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
    const busy = a.status === 409 ? a : b
    expect(busy.json).toMatchObject({ code: 'in_progress', detail: LINK_BUSY_MESSAGE })
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await getPartyRecord(p.id))!.charges).toHaveLength(1)
  })

  it('a second payer while the first is being charged is refused before any order', async () => {
    const p = await linkParty()
    let second: Awaited<ReturnType<typeof pay>> | null = null
    m.beforePay = async () => { second = await pay(payBody(p)) }
    expect((await pay(payBody(p))).status).toBe(200)
    expect(second!.status).toBe(409)
    expect(m.createOrder).toHaveBeenCalledTimes(1)
  })

  it('the same attempt retried after success → paid, no second charge', async () => {
    const p = await linkParty()
    const b = payBody(p)
    expect((await pay(b)).status).toBe(200)
    const again = await pay(b)
    expect(again.status).toBe(200)
    expect(again.json.data).toMatchObject({ state: 'paid', replayed: true, paidCents: 30000 })
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await getPartyRecord(p.id))!.charges).toHaveLength(1)
  })

  it('nothing due → "Already paid" with the receipt, no Square call', async () => {
    const p = await linkParty()
    await pay(payBody(p))
    m.createOrder.mockClear(); m.processPayment.mockClear()
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ state: 'paid', alreadyPaid: true, message: 'Already paid', receiptUrl: 'https://r/link' })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('a cancelled party → 410, nothing charged', async () => {
    const p = await linkParty()
    await updatePartyRecord(p.id, (r) => ({ ...r, status: 'cancelled', cancelled: { at: NOW.toISOString(), by: owner, note: '' } }), 'Cancelled', owner)
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(410)
    expect(json.detail).toBe(LINK_CANCELLED_MESSAGE)
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await balance(p.id, p.k)).json.data).toMatchObject({ state: 'cancelled', dueCents: 0 })
  })

  it('items added after the order stay due', async () => {
    const p = await linkParty()
    // An owner adds an extra while the host's order is being made.
    m.beforeOrder = async () => {
      await updatePartyRecord(p.id, (r) => ({
        ...r,
        items: [...r.items!, { id: 'itm_late', kind: 'addon', refId: 'add_x', label: 'Balloons', qty: 1, unitCents: 2500, cents: 2500, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: owner }],
      }), 'Extra added', owner)
    }
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ paidCents: 30000, stillDueCents: 2500 })
    expect(m.processPayment.mock.calls[0][0].amount).toBe(30000)
    const rec = (await getPartyRecord(p.id))!
    expect(rec.items!.find((it) => it.id === 'itm_late')!.chargeId).toBeNull()
    expect(rec.charges![0].itemIds).toEqual([p.rec.items![0].id])
    expect(dueCents(rec)).toBe(2500)
    // The next payment pays just the extra.
    expect((await pay(payBody(p, { expectedCents: 2500 }))).json.data).toMatchObject({ paidCents: 2500, stillDueCents: 0 })
    expect(m.createOrder.mock.calls[1][0].lineItems).toEqual([{ name: 'Whole Studio Party — Balloons', quantity: 1, pricePerUnit: 2500, note: 'add_x' }])
  })

  it('the amount changed since the page loaded → 409 before any order, nothing charged', async () => {
    const p = await linkParty()
    await updatePartyRecord(p.id, (r) => ({
      ...r,
      items: [...r.items!, { id: 'itm_new', kind: 'addon', refId: 'add_x', label: 'Balloons', qty: 1, unitCents: 2500, cents: 2500, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: owner }],
    }), 'Extra added', owner)
    const { status, json } = await pay(payBody(p)) // the page still shows $300
    expect(status).toBe(409)
    expect(json).toMatchObject({ code: 'amount_changed', detail: LINK_AMOUNT_CHANGED_MESSAGE })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await getPartyRecord(p.id))!.paying ?? null).toBeNull()
    expect((await pay(payBody(p, { expectedCents: 32500 }))).json.data).toMatchObject({ paidCents: 32500 })
  })

  it('the amount changing between the first look and the claim is refused too', async () => {
    const p = await linkParty()
    // An owner adds an extra while the gift card is being checked (after the first look, before the claim).
    m.fromNonce.mockImplementation(async () => {
      await updatePartyRecord(p.id, (r) => ({
        ...r,
        items: [...r.items!, { id: 'itm_mid', kind: 'addon', refId: 'add_x', label: 'Balloons', qty: 1, unitCents: 2500, cents: 2500, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: owner }],
      }), 'Extra added', owner)
      return { state: 'ACTIVE', balanceCents: 100000 }
    })
    const { status, json } = await pay(payBody(p, { sourceKind: 'gift_card', paymentToken: 'gftc:x' }))
    expect(status).toBe(409)
    expect(json.code).toBe('amount_changed')
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('a missing amount is refused', async () => {
    const p = await linkParty()
    expect((await pay(payBody(p, { expectedCents: undefined }))).status).toBe(400)
  })

  it('the balance says when a payment is going through', async () => {
    const p = await linkParty()
    let seen: any = null
    m.beforePay = async () => { seen = (await balance(p.id, p.k)).json.data }
    await pay(payBody(p))
    expect(seen).toMatchObject({ paying: true })
    expect((await balance(p.id, p.k)).json.data).toMatchObject({ paying: false })
  })

  it('a party cancelled while its payment went through: recorded, owners asked to check it, host not told it is paid', async () => {
    const p = await linkParty()
    m.beforePay = async () => {
      await updatePartyRecord(p.id, (r) => ({ ...r, status: 'cancelled', cancelled: { at: NOW.toISOString(), by: owner, note: '' } }), 'Cancelled', owner)
    }
    expect((await pay(payBody(p))).status).toBe(200)
    expect((await getPartyRecord(p.id))!.charges).toHaveLength(1)
    expect(m.alert.mock.calls.some(([t]) => /^Paid after it was cancelled\. Check it\./.test(String(t)) && String(t).includes(p.id))).toBe(true)
    expect(m.paidEmail).not.toHaveBeenCalled()
  })

  it('the host and owners are told once per charge, whoever records it', async () => {
    const p = await linkParty()
    await pay(payBody(p))
    const rec = (await getPartyRecord(p.id))!
    expect(rec.charges![0].toldAt).toBeTruthy()
    await tellLinkPaid(rec, rec.charges![0])
    expect(m.paidEmail).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls.filter(([t]) => /^Balance paid/.test(String(t)))).toHaveLength(1)
  })

  it('gate closed still lets a link payment through (S2-R16)', async () => {
    const was = process.env.BOOKINGS_OPEN
    process.env.BOOKINGS_OPEN = ''
    try {
      const p = await linkParty()
      expect((await balance(p.id, p.k)).status).toBe(200)
      expect((await pay(payBody(p))).status).toBe(200)
    } finally {
      process.env.BOOKINGS_OPEN = was
    }
  })

  it('declined → nothing recorded, the slot is free, a new attempt can pay', async () => {
    const p = await linkParty()
    m.processPayment.mockRejectedValueOnce(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(402)
    expect(json.code).toBe('card_declined')
    expect(json.detail).toMatch(/Nothing was charged/)
    const rec = (await getPartyRecord(p.id))!
    expect(rec.paying).toBeNull()
    expect(rec.charges).toEqual([])
    expect((await pay(payBody(p))).status).toBe(200)
  })

  it('a gift card that can’t cover it is refused before anything starts', async () => {
    const p = await linkParty()
    m.fromNonce.mockResolvedValue({ state: 'ACTIVE', balanceCents: 5000 })
    const { status, json } = await pay(payBody(p, { sourceKind: 'gift_card', paymentToken: 'gftc:x' }))
    expect(status).toBe(402)
    expect(json.code).toBe('gift_card_short')
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await getPartyRecord(p.id))!.paying ?? null).toBeNull()
  })
})

describe('drift (R14, as Task 7)', () => {
  it('+50 is charged and the owners told', async () => {
    const p = await linkParty()
    m.drift = 50
    const { status } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(30050)
    expect((await getPartyRecord(p.id))!.charges![0]).toMatchObject({ cents: 30050, quotedCents: 30000 })
    expect(m.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('−50 is charged and the owners told', async () => {
    const p = await linkParty()
    m.drift = -50
    expect((await pay(payBody(p))).status).toBe(200)
    expect(m.processPayment.mock.calls[0][0].amount).toBe(29950)
    expect(m.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('+150 is refused: nothing charged, owners texted, the slot free again', async () => {
    const p = await linkParty()
    m.drift = 150
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(503)
    expect(json.detail).toMatch(/nothing was charged/)
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(m.alert.mock.calls.some(([t]) => /price mismatch/.test(String(t)))).toBe(true)
    expect((await getPartyRecord(p.id))!.paying).toBeNull()
  })
})

describe('no answer from Square', () => {
  it('keeps the slot 24 hours, tells the owners, 502; another attempt waits; Square’s payment event records it', async () => {
    const p = await linkParty()
    m.processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const b = payBody(p)
    const first = await pay(b)
    expect(first.status).toBe(502)
    expect(first.json.code).toBe('unknown_outcome')
    const rec = (await getPartyRecord(p.id))!
    expect(rec.paying).toMatchObject({ attemptId: b.attemptId, state: 'unclear' })
    expect(Date.parse(rec.paying!.until) - NOW.getTime()).toBe(24 * 3600_000)
    expect(m.alert.mock.calls.some(([t]) => /unclear/.test(String(t)) && String(t).includes(p.id))).toBe(true)
    // Another attempt hours later: refused before any order.
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3600_000))
    m.createOrder.mockClear()
    expect((await pay(payBody(p))).status).toBe(409)
    expect(m.createOrder).not.toHaveBeenCalled()
    // Square says the order was paid after all: recorded from the event, never "paid by another order".
    const orderId = `ord-${b.attemptId}:order`
    m.paid.set(orderId, { id: 'pay-late', orderId, amount: 30000, status: 'completed', receiptUrl: null })
    expect(await handlePartyOrder({ id: orderId, reference_id: p.id, state: 'COMPLETED', tenders: [{ payment_id: 'pay-late' }] }, new Date())).toEqual({ action: 'recorded', partyId: p.id })
    const after = (await getPartyRecord(p.id))!
    expect(dueCents(after)).toBe(0)
    expect(after.paying).toBeNull()
    expect(after.charges![0]).toMatchObject({ paymentId: 'pay-late', via: 'link' })
    expect(await partyForPayment('pay-late')).toMatchObject({ partyId: p.id })
    expect(m.paidEmail).toHaveBeenCalledTimes(1)
    expect((await listCheckouts()).some((c) => c.partyId === p.id)).toBe(false)
    // The same event again: nothing new.
    expect(await handlePartyOrder({ id: orderId, reference_id: p.id, state: 'COMPLETED', tenders: [{ payment_id: 'pay-late' }] }, new Date())).toEqual({ action: 'ignored', why: 'recorded' })
  })

  it('a retry of the same attempt finds the first try paid: recorded once, no second charge', async () => {
    const p = await linkParty()
    m.processPayment.mockImplementationOnce(async (q: any) => {
      m.paid.set(q.orderId, { id: `pay-${q.orderId}`, orderId: q.orderId, amount: q.amount, status: 'completed', receiptUrl: null })
      throw new Error('timeout after charging')
    })
    m.findOrderPayment.mockResolvedValueOnce(null) // the first ask came too early
    const b = payBody(p)
    expect((await pay(b)).status).toBe(502)
    const again = await pay(b)
    expect(again.status).toBe(200)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await getPartyRecord(p.id))!.charges).toHaveLength(1)
  })

  it('a retry of the same attempt during the 24 hours keeps the 24 hours', async () => {
    const p = await linkParty()
    m.processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const b = payBody(p)
    expect((await pay(b)).status).toBe(502)
    const until = (await getPartyRecord(p.id))!.paying!.until
    let during: string | null = null
    m.beforePay = async () => { during = (await getPartyRecord(p.id))!.paying!.until }
    expect((await pay(b)).status).toBe(200)
    expect(during).toBe(until)
  })

  it('after 24 hours a new attempt asks Square about the old order first; unpaid → it pays', async () => {
    const p = await linkParty()
    m.processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    expect((await pay(payBody(p))).status).toBe(502)
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3600_000))
    m.findOrderPayment.mockClear()
    const { status } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(m.findOrderPayment).toHaveBeenCalled()
    expect((await getPartyRecord(p.id))!.charges).toHaveLength(1)
  })

  it('after 24 hours, an old order Square shows paid is recorded and nothing new is charged', async () => {
    const p = await linkParty()
    const b = payBody(p)
    m.processPayment.mockRejectedValueOnce(new Error('socket hang up'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    expect((await pay(b)).status).toBe(502)
    const orderId = `ord-${b.attemptId}:order`
    m.paid.set(orderId, { id: 'pay-old', orderId, amount: 30000, status: 'completed', receiptUrl: 'https://r/old' })
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3600_000))
    m.processPayment.mockClear()
    const { status, json } = await pay(payBody(p))
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ alreadyPaid: true })
    expect(m.processPayment).not.toHaveBeenCalled()
    expect((await getPartyRecord(p.id))!.charges![0].paymentId).toBe('pay-old')
  })
})

describe('Square’s payment event while the link payment is still running', () => {
  it('is left alone (not flagged as paid by another order), and the payment records once', async () => {
    const p = await linkParty()
    let seen: any = null
    m.beforePay = async () => {
      const orderId = m.createOrder.mock.calls[0][0].idempotencyKey
      m.paid.set(`ord-${orderId}`, { id: 'pay-x', orderId: `ord-${orderId}`, amount: 30000, status: 'completed', receiptUrl: null })
      seen = await handlePartyOrder({ id: `ord-${orderId}`, reference_id: p.id, state: 'COMPLETED', tenders: [{ payment_id: 'pay-x' }] }, new Date())
    }
    expect((await pay(payBody(p))).status).toBe(200)
    expect(seen).toEqual({ action: 'ignored', why: 'in-flight' })
    expect((await listCheckouts()).filter((c) => c.partyId === p.id)).toEqual([])
    expect(m.alert.mock.calls.some(([t]) => /another order/.test(String(t)))).toBe(false)
  })
})

describe('simulated payments (local dev, previews)', () => {
  it('records a simulated charge with no Square call', async () => {
    m.bypass.on = true
    const p = await linkParty()
    const { status, json } = await pay({ id: p.id, k: p.k, attemptId: randomUUID(), expectedCents: 30000 })
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ simulated: true, paidCents: 30000 })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect((await getPartyRecord(p.id))!.charges![0]).toMatchObject({ simulated: true, via: 'link' })
  })
})
