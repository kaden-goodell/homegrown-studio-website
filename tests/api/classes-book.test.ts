import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFindOrCreate = vi.fn()
const mockCreateClassOrder = vi.fn()
const mockProcessPayment = vi.fn()
const mockFindOrderPayment = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    customer: { findOrCreate: (...a: any[]) => mockFindOrCreate(...a) },
    payment: {
      createClassOrder: (...a: any[]) => mockCreateClassOrder(...a),
      processPayment: (...a: any[]) => mockProcessPayment(...a),
      findOrderPayment: (...a: any[]) => mockFindOrderPayment(...a),
    },
  },
}))

const mockAlertOwners = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlertOwners(...a) }))
const mockSendEmail = vi.fn()
const mockOwnerEmail = vi.fn()
vi.mock('@lib/email', () => ({
  sendWorkshopConfirmationEmail: (...a: any[]) => mockSendEmail(...a),
  sendEmail: (...a: any[]) => mockOwnerEmail(...a),
}))
const mockAnnounce = vi.fn()
vi.mock('@lib/booking-alert', () => ({ announceBooking: (...a: any[]) => mockAnnounce(...a) }))
const mockReport = vi.fn()
vi.mock('@lib/posthog-server', () => ({ reportBooking: (...a: any[]) => mockReport(...a) }))
let bypassOn = false
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => bypassOn }))
let staffMember: null | { id: string; name: string; role: 'owner' | 'crew' } = null
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => staffMember }))

const classes = new Map<string, any>()
vi.mock('@lib/classes/class-store', () => ({ getClass: async (id: string) => classes.get(id) ?? null }))

let confirmFails = false
vi.mock('@lib/classes/seat-ledger', async (orig) => {
  const real = await orig<typeof import('@lib/classes/seat-ledger')>()
  return { ...real, confirm: (...a: Parameters<typeof real.confirm>) => (confirmFails ? Promise.reject(new Error('Concurrent update — please retry')) : real.confirm(...a)) }
})

const runWaitlistSpy = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@lib/classes/waitlist-runner', () => ({ runWaitlist: runWaitlistSpy }))

import { getLedger, hold } from '@lib/classes/seat-ledger'
import { mutateWaitlist } from '@lib/classes/waitlist-store'
import { handleOrder } from '@lib/classes/square-events'
import { quote } from '@lib/classes/pricing'
import { bookingIdFor, PRICE_MISMATCH_MESSAGE, classMessages } from '@lib/classes/checkout'
import { defaultRules } from '@lib/classes/validate'
import { CONTACT_MESSAGES } from '@lib/contact-rules'
import type { ScheduledClass, ClassContent } from '@lib/classes/types'

const TECHNICAL = /[{}<>]|https?:|status \d{3}|\bjson\b|exception|fetch failed/i
const NOW = new Date('2026-10-10T17:00:00.000Z')

let seq = 0
let ATTEMPT = ''
function newAttempt() {
  const hex = (++seq).toString(16).padStart(12, '0')
  ATTEMPT = `3f2b8a0e-5c1d-4e7a-9b3c-${hex}`
  return ATTEMPT
}

function makeClass(over: { content?: Partial<ClassContent>; status?: ScheduledClass['status']; capacity?: number; variations?: Record<string, string> } = {}): ScheduledClass {
  const content: ClassContent = {
    name: 'Pottery Weekend', description: 'Throw a bowl.\n\nEveryone glazes.', imageUrl: null, instructor: null,
    rules: defaultRules(),
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    passes: [
      { id: 'all', label: 'Both days', covers: { kind: 'all' } },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
    ],
    prices: { all: { adult: 6000, kid: 4000 }, day: { adult: 3500, kid: 2500 } },
    questions: [], addOns: [], defaultCapacity: 10, defaultMinutes: 120,
    ...over.content,
  }
  const cap = over.capacity ?? 10
  const cls: ScheduledClass = {
    id: `cls_book${++seq}`, libraryId: null, libraryVersion: null, content,
    sessions: [
      { id: 'ses_sat', startIso: '2026-10-17T18:00:00.000Z', endIso: '2026-10-17T20:00:00.000Z', capacity: cap },
      { id: 'ses_sun', startIso: '2026-10-18T18:00:00.000Z', endIso: '2026-10-18T20:00:00.000Z', capacity: cap },
    ],
    status: over.status ?? 'open',
    square: {
      itemId: 'ITEM1',
      variations: over.variations ?? {
        'all:adult': 'VAR_ALL_ADULT', 'all:kid': 'VAR_ALL_KID', 'day:adult': 'VAR_DAY_ADULT', 'day:kid': 'VAR_DAY_KID',
        'addon:glaze': 'VAR_GLAZE',
      },
    },
    createdAt: '', updatedAt: '', by: { id: 'k', name: 'Kaden' }, history: [],
  }
  classes.set(cls.id, cls)
  return cls
}

const customer = { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' }
function body(cls: ScheduledClass, over: Record<string, any> = {}) {
  return { classId: cls.id, passId: 'all', tickets: { adult: 2, kid: 1 }, attemptId: ATTEMPT, paymentToken: 'cnon:card-ok', customer, ...over }
}

let ip = 0
function ctx(payload: any, address?: string, query = '') {
  return {
    clientAddress: address ?? `198.51.100.${++ip % 250}`,
    request: new Request(`https://ourhometownstudio.com/api/classes/book.json${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  } as any
}

// 2 adults + 1 kid on the "all" pass: 6000+6000+4000 = 16000, 9% per seat = 540+540+360 = 1440.
const TOTAL = 17440

let POST: any
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  bypassOn = false
  staffMember = null
  confirmFails = false
  vi.clearAllMocks()
  newAttempt()
  mockFindOrCreate.mockResolvedValue({ id: 'cust-1', email: 'ada@example.com', matchedBy: 'email' })
  mockCreateClassOrder.mockImplementation(async (p: any) => ({
    orderId: 'ORDER1', totalCents: TOTAL, lineUids: p.lines.map((_: any, i: number) => `u${i}`), lineTotals: [],
  }))
  mockProcessPayment.mockResolvedValue({ id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed', receiptUrl: 'https://squareup.com/r/PAY1' })
  mockFindOrderPayment.mockResolvedValue(null)
  mockAlertOwners.mockResolvedValue({ attempted: 1, sent: 1 })
  mockSendEmail.mockResolvedValue({ sent: true })
  mockOwnerEmail.mockResolvedValue({ sent: true })
  mockAnnounce.mockResolvedValue(undefined)
  mockReport.mockResolvedValue(undefined)
  POST = (await import('@pages/api/classes/book.json')).POST
})
afterEach(() => vi.useRealTimers())

const linesOf = async (cls: ScheduledClass) => (await getLedger(cls.id)).lines.filter((l) => l.bookingId === bookingIdFor(ATTEMPT))

describe('POST /api/classes/book.json', () => {
  it('books: one order of catalog lines, one charge, seats confirmed', async () => {
    const cls = makeClass()
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(200)
    const bookingId = bookingIdFor(ATTEMPT)
    expect(bookingId).toMatch(/^bkg_[0-9a-f]{16}$/)

    expect(mockCreateClassOrder).toHaveBeenCalledTimes(1)
    const order = mockCreateClassOrder.mock.calls[0][0]
    expect(order.idempotencyKey).toBe(`${ATTEMPT}:order`)
    expect(order.referenceId).toBe(bookingId)
    expect(order.customerId).toBe('cust-1')
    expect(order.lines.map((l: any) => l.catalogObjectId)).toEqual(['VAR_ALL_ADULT', 'VAR_ALL_ADULT', 'VAR_ALL_KID'])
    expect(order.lines.every((l: any) => l.quantity === 1)).toBe(true)

    expect(mockProcessPayment).toHaveBeenCalledTimes(1)
    expect(mockProcessPayment.mock.calls[0][0]).toMatchObject({
      orderId: 'ORDER1', paymentToken: 'cnon:card-ok', amount: TOTAL, currency: 'USD',
      buyerEmailAddress: 'ada@example.com', idempotencyKey: `${ATTEMPT}:pay`,
    })

    const lines = await linesOf(cls)
    expect(lines).toHaveLength(3)
    expect(lines.every((l) => l.state === 'confirmed' && l.square.orderId === 'ORDER1' && l.square.paymentId === 'PAY1')).toBe(true)
    expect(lines.every((l) => l.source === 'online' && l.customer?.email === 'ada@example.com')).toBe(true)

    expect(json.data).toMatchObject({
      bookingId, orderId: 'ORDER1', totalChargedCents: TOTAL, seatsBooked: 3, ticketsLabel: '2 Adults, 1 Kid',
      sessionIds: ['ses_sat', 'ses_sun'], receiptUrl: 'https://squareup.com/r/PAY1', emailSent: true,
    })

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const mail = mockSendEmail.mock.calls[0][0]
    expect(mail).toMatchObject({ to: 'ada@example.com', firstName: 'Ada', workshopName: 'Pottery Weekend', seats: 3, seatsLabel: '2 Adults, 1 Kid', totalChargedCents: TOTAL })
    expect(mail.sessionLines).toHaveLength(2)
    expect(mail.waiverUrl).toContain(`workshop=${cls.id}`)
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ kind: 'class', paidCents: TOTAL, who: 'Ada Lovelace' }))
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({ bookingId, amountCents: TOTAL }))
  })

  it('stage 4 (I1): a running early-bird goes to Square as per-line discounts, so Square\'s total is the quote', async () => {
    const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-12', prices: { all: { adult: 5000 } } } } })
    const { MockPaymentProvider } = await import('@providers/mock/payment')
    const square = new MockPaymentProvider()
    square.prices = { VAR_ALL_ADULT: 6000, VAR_ALL_KID: 4000 }
    mockCreateClassOrder.mockImplementation((p: any) => square.createClassOrder(p))
    // 5000+5000+4000 = 14000, tax 450+450+360 = 1260
    mockProcessPayment.mockResolvedValue({ id: 'PAY1', orderId: 'x', amount: 15260, status: 'completed', receiptUrl: null })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    const order = mockCreateClassOrder.mock.calls[0][0]
    expect(order.lineDiscounts).toEqual([{ line: 0, name: 'Early-bird', cents: 1000 }, { line: 1, name: 'Early-bird', cents: 1000 }])
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(15260)
    expect(mockOwnerEmail).not.toHaveBeenCalled()
    const lines = (await linesOf(cls)).sort((a, b) => a.seat - b.seat)
    expect(lines.map((l) => [l.priceCents, l.listCents, l.square.lineNetCents])).toEqual([[5000, 6000, 5000], [5000, 6000, 5000], [4000, undefined, 4000]])
  })

  it('stage 4 (I1): a Square order that left the early-bird off (total far above the quote) is refused, nothing charged', async () => {
    const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-12', prices: { all: { adult: 5000 } } } } })
    mockCreateClassOrder.mockResolvedValueOnce({ orderId: 'ORDER1', totalCents: TOTAL, lineUids: [], lineTotals: [] }) // $174.40, the full price: $21.80 over the $152.60 quote
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(502)
    expect((await res.json()).detail).toBe(PRICE_MISMATCH_MESSAGE)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  it('stage 4: the ledger keeps Square\'s own per-line totals, and refunds use them', async () => {
    const cls = makeClass()
    // Square's numbers, a cent different from ours on the kid's tax: the ledger records Square's.
    const lineTotals = [{ totalCents: 6540, taxCents: 540 }, { totalCents: 6540, taxCents: 540 }, { totalCents: 4361, taxCents: 361 }]
    mockCreateClassOrder.mockImplementation(async (p: any) => ({
      orderId: 'ORDER1', totalCents: 17441, lineUids: p.lines.map((_: any, i: number) => `u${i}`), lineTotals: lineTotals.map((l, i) => ({ uid: `u${i}`, ...l })),
    }))
    mockProcessPayment.mockResolvedValue({ id: 'PAY1', orderId: 'ORDER1', amount: 17441, status: 'completed', receiptUrl: null })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    const lines = (await linesOf(cls)).sort((a, b) => a.seat - b.seat)
    expect(lines.map((l) => [l.square.lineNetCents, l.square.lineTaxCents])).toEqual([[6000, 540], [6000, 540], [4000, 361]])
    const { paidOn } = await import('@lib/classes/seat-status')
    expect(paidOn(lines[2])).toBe(4361)
  })

  it('prices from the class, never from the body', async () => {
    const cls = makeClass()
    const res = await POST(ctx(body(cls, { priceCents: 1, totalCents: 1, price: 1, amount: 1 })))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL)
  })

  it('a retry after a success returns the stored result and never charges again', async () => {
    const cls = makeClass()
    const first = await (await POST(ctx(body(cls)))).json()
    vi.clearAllMocks()
    const res = await POST(ctx(body(cls, { paymentToken: 'cnon:another-token' })))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
    expect(mockProcessPayment).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(json.data).toMatchObject({ bookingId: first.data.bookingId, orderId: 'ORDER1', totalChargedCents: TOTAL, seatsBooked: 3, ticketsLabel: '2 Adults, 1 Kid' })
    expect(await linesOf(cls)).toHaveLength(3)
  })

  it('a retry while the first try is still running is told to wait, never charged twice', async () => {
    const cls = makeClass()
    mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
    const first = await POST(ctx(body(cls)))
    expect(first.status).toBe(502)
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('in_progress')
    expect(json.detail).toBe("We're still finishing your last try. Give it a minute, then check your email before trying again.".replace("We're", 'We’re'))
    expect(mockProcessPayment).toHaveBeenCalledTimes(1)
  })

  it('sold out before the charge: 409, nothing held, no order', async () => {
    const cls = makeClass({ capacity: 2 })
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('sold_out')
    expect(json.detail).toMatch(/Only 2 seats are left/)
    expect(json.detail).toMatch(/Nothing was charged/)
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
    // The order is only made to ask whether an earlier try paid; nothing is charged.
    expect(mockFindOrderPayment).toHaveBeenCalledWith('ORDER1')
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  it('order create fails: the hold is let go, 502, nothing charged', async () => {
    const cls = makeClass()
    mockCreateClassOrder.mockRejectedValueOnce(new Error('Square 500'))
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json.code).toBe('unavailable')
    expect(json.detail).not.toMatch(TECHNICAL)
    expect((await linesOf(cls)).every((l) => l.state === 'released')).toBe(true)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })

  const squareTotal = (cents: number) => {
    mockCreateClassOrder.mockResolvedValueOnce({ orderId: 'ORDER1', totalCents: cents, lineUids: [], lineTotals: [] })
    mockProcessPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: cents, status: 'completed' })
  }

  it('Square a cent lower than the quote: Square’s total is charged', async () => {
    const cls = makeClass()
    squareTotal(TOTAL - 1)
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL - 1)
    expect((await res.json()).data.totalChargedCents).toBe(TOTAL - 1)
    expect(mockSendEmail.mock.calls[0][0].totalChargedCents).toBe(TOTAL - 1)
    expect(mockAnnounce.mock.calls[0][0].paidCents).toBe(TOTAL - 1)
    expect(mockOwnerEmail).not.toHaveBeenCalled()
  })

  it('M2: Square up to a cent per line lower (half-cent tax rounding) is charged with no owners\' email', async () => {
    const cls = makeClass()
    squareTotal(TOTAL - 3) // 3 lines
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL - 3)
    expect(mockOwnerEmail).not.toHaveBeenCalled()
  })
  it('M2: more than a cent per line lower still emails the owners', async () => {
    const cls = makeClass()
    squareTotal(TOTAL - 4)
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockOwnerEmail).toHaveBeenCalledTimes(1)
  })

  it('Square more than a cent lower (e.g. the class went out without its tax): charged, owners emailed', async () => {
    const cls = makeClass()
    squareTotal(TOTAL - 1440)
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL - 1440)
    expect(mockOwnerEmail).toHaveBeenCalledTimes(1)
    const mail = mockOwnerEmail.mock.calls[0][0]
    expect(mail.subject).toMatch(/Pottery Weekend/)
    expect(mail.text).toBe(`Square total was $14.40 lower than the quote on booking ${bookingIdFor(ATTEMPT)} (quote $174.40, Square $160.00). Check the class tax in /admin › More › Register setup, then tap Update them all there (or open the class and tap Update the register).`)
    expect(mockAlertOwners).not.toHaveBeenCalled()
  })

  it('Square a cent higher: charged, owners emailed (not texted)', async () => {
    const cls = makeClass()
    squareTotal(TOTAL + 1)
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL + 1)
    expect((await res.json()).data.totalChargedCents).toBe(TOTAL + 1)
    expect(mockOwnerEmail).toHaveBeenCalledTimes(1)
    const mail = mockOwnerEmail.mock.calls[0][0]
    expect(mail.text).toBe(`Square total differed by $0.01 on booking ${bookingIdFor(ATTEMPT)} (quote $174.40, Square $174.41)`)
    expect(mockAlertOwners).not.toHaveBeenCalled()
  })

  it('Square more than a dollar over the quote: let go, 502, owners texted both numbers', async () => {
    const cls = makeClass()
    mockCreateClassOrder.mockResolvedValueOnce({ orderId: 'ORDER1', totalCents: TOTAL + 101, lineUids: [], lineTotals: [] })
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json).toMatchObject({ code: 'unavailable', detail: PRICE_MISMATCH_MESSAGE })
    expect(PRICE_MISMATCH_MESSAGE).toBe('We couldn’t price your booking. Nothing was charged. Please try again in a few minutes.')
    expect((await linesOf(cls)).every((l) => l.state === 'released')).toBe(true)
    expect(mockProcessPayment).not.toHaveBeenCalled()
    const alert = mockAlertOwners.mock.calls.map((c) => c[0]).join('\n')
    expect(alert).toContain('$174.40')
    expect(alert).toContain('$175.41')
    expect(alert).toContain('Pottery Weekend')
  })

  it('a class not on the POS yet: 502, owners told to save it, nothing held', async () => {
    const cls = makeClass({ variations: { 'all:adult': 'VAR_ALL_ADULT' } })
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json.code).toBe('unavailable')
    expect(mockAlertOwners).toHaveBeenCalledWith("Pottery Weekend isn't on the register yet, so it can't be booked online. Open the class in /admin and tap Put it on the register.")
    expect((await linesOf(cls)).filter((l) => l.state === 'held')).toHaveLength(0)
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
  })

  it('card declined: let go, 402 card_declined', async () => {
    const cls = makeClass()
    mockProcessPayment.mockRejectedValueOnce(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json).toMatchObject({ code: 'card_declined', detail: classMessages.card_declined })
    expect((await linesOf(cls)).every((l) => l.state === 'released')).toBe(true)
  })

  it('a payment Square marks failed: let go, 402', async () => {
    const cls = makeClass()
    mockProcessPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'failed' })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(402)
    expect((await linesOf(cls)).every((l) => l.state === 'released')).toBe(true)
  })

  it('no answer from Square: seats stay held, owners told, 502 unknown_outcome', async () => {
    const cls = makeClass()
    mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json.code).toBe('unknown_outcome')
    expect(json.detail).not.toMatch(/nothing was charged/i)
    expect(mockFindOrderPayment).toHaveBeenCalledWith('ORDER1')
    const lines = await linesOf(cls)
    expect(lines).toHaveLength(3)
    expect(lines.every((l) => l.state === 'held')).toBe(true)
    const alert = mockAlertOwners.mock.calls.map((c) => c[0]).join('\n')
    expect(alert).toContain(bookingIdFor(ATTEMPT))
    expect(alert).toContain(ATTEMPT)
  })

  it('a reused idempotency key is unknown, never declined', async () => {
    const cls = makeClass()
    mockProcessPayment.mockRejectedValueOnce(Object.assign(new Error('reused'), { statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] }))
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('unknown_outcome')
    expect((await linesOf(cls)).every((l) => l.state === 'held')).toBe(true)
  })

  it('no answer, but the order shows paid: booked', async () => {
    const cls = makeClass()
    mockProcessPayment.mockRejectedValueOnce(new Error('timeout'))
    mockFindOrderPayment.mockResolvedValueOnce({ id: 'PAY9', orderId: 'ORDER1', amount: TOTAL, status: 'completed' })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    const lines = await linesOf(cls)
    expect(lines.every((l) => l.state === 'confirmed' && l.square.paymentId === 'PAY9')).toBe(true)
  })

  describe('a charge with no answer, and its retries', () => {
    const HOUR = 3_600_000
    const someoneElseTakes = async (cls: ScheduledClass, seats: number, at: Date) => {
      const qq = quote(cls, { passId: 'all', tickets: { adult: seats } }, at, 9)
      if (!qq.ok) throw new Error(qq.error)
      const r = await hold(cls, qq.value, { bookingId: 'bkg_other', passId: 'all', source: 'online', customer: null, ttlMinutes: 10 }, at)
      expect(r.ok).toBe(true)
    }

    it('keeps the seats held for 24 hours', async () => {
      const cls = makeClass()
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      expect((await POST(ctx(body(cls)))).status).toBe(502)
      const lines = await linesOf(cls)
      expect(lines).toHaveLength(3)
      for (const l of lines) expect(Date.parse(l.holdExpiresAt!)).toBe(NOW.getTime() + 24 * HOUR)
    })

    it('hold ran out and the seats were resold, but Square shows it paid: booked, seats recorded over capacity', async () => {
      const cls = makeClass({ capacity: 3 })
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      expect((await POST(ctx(body(cls)))).status).toBe(502)
      const later = new Date(NOW.getTime() + 25 * HOUR)
      vi.setSystemTime(later)
      await someoneElseTakes(cls, 3, later)
      mockFindOrderPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed', receiptUrl: 'https://squareup.com/r/PAY1' })
      const res = await POST(ctx(body(cls, { paymentToken: 'cnon:retyped' })))
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(JSON.stringify(json)).not.toMatch(/nothing was charged/i)
      expect(json.data.totalChargedCents).toBe(TOTAL)
      expect(mockCreateClassOrder.mock.calls[1][0].idempotencyKey).toBe(`${ATTEMPT}:order`)
      expect(mockProcessPayment).toHaveBeenCalledTimes(1) // the first try only
      const lines = await linesOf(cls)
      expect(lines).toHaveLength(3)
      expect(lines.every((l) => l.state === 'confirmed' && l.overCapacity === true && l.square.paymentId === 'PAY1')).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
    })

    it('resold, and Square shows no payment: the normal sold-out answer', async () => {
      const cls = makeClass({ capacity: 3 })
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await POST(ctx(body(cls)))
      const later = new Date(NOW.getTime() + 25 * HOUR)
      vi.setSystemTime(later)
      await someoneElseTakes(cls, 3, later)
      const res = await POST(ctx(body(cls)))
      const json = await res.json()
      expect(res.status).toBe(409)
      expect(json.code).toBe('sold_out')
      expect(mockProcessPayment).toHaveBeenCalledTimes(1)
    })

    it('hold ran out with seats still free: the retry re-holds, Square refuses the reused key, the paid order is found', async () => {
      const cls = makeClass()
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await POST(ctx(body(cls)))
      vi.setSystemTime(new Date(NOW.getTime() + 25 * HOUR))
      mockProcessPayment.mockRejectedValueOnce(Object.assign(new Error('reused'), { statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] }))
      mockFindOrderPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed' })
      const res = await POST(ctx(body(cls, { paymentToken: 'cnon:retyped' })))
      expect(res.status).toBe(200)
      expect((await linesOf(cls)).filter((l) => l.state === 'confirmed')).toHaveLength(3)
    })

    it('a retry while held asks Square first: paid → booked', async () => {
      const cls = makeClass()
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await POST(ctx(body(cls)))
      mockFindOrderPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed' })
      const res = await POST(ctx(body(cls)))
      expect(res.status).toBe(200)
      expect((await res.json()).data.totalChargedCents).toBe(TOTAL)
      expect(mockProcessPayment).toHaveBeenCalledTimes(1)
      expect((await linesOf(cls)).every((l) => l.state === 'confirmed' && !l.overCapacity)).toBe(true)
    })
  })

  it('paid but the seats could not be recorded: booked, owners told, seats held a day', async () => {
    const cls = makeClass()
    confirmFails = true
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ totalChargedCents: TOTAL, seatsBooked: 3, orderId: 'ORDER1' })
    expect(mockAlertOwners.mock.calls.map((c) => c[0]).join('\n')).toMatch(/seats not recorded yet.*ORDER1/)
    const lines = await linesOf(cls)
    expect(lines.every((l) => l.state === 'held' && Date.parse(l.holdExpiresAt!) === NOW.getTime() + 24 * 3_600_000)).toBe(true)
  })

  it('simulated: a confirm that fails still answers booked', async () => {
    bypassOn = true
    confirmFails = true
    const res = await POST(ctx(body(makeClass({ variations: {} }))))
    expect(res.status).toBe(200)
  })

  it('a replay answers with what Square charged, kept on the ledger', async () => {
    const cls = makeClass()
    squareTotal(TOTAL + 1)
    await POST(ctx(body(cls)))
    expect((await linesOf(cls)).every((l) => l.square.chargedCents === TOTAL + 1)).toBe(true)
    const res = await POST(ctx(body(cls)))
    expect((await res.json()).data).toMatchObject({ replayed: true, totalChargedCents: TOTAL + 1 })
  })

  it('answers to questions the class doesn’t ask never reach the ledger', async () => {
    const cls = makeClass({ content: { rules: { ...defaultRules(), signupCutoffHours: 0 }, questions: [{ id: 'color', label: 'Glaze color', choices: ['Blue', 'Green'] }] } })
    squareTotal(6540)
    const res = await POST(ctx(body(cls, { tickets: { adult: 1 }, seats: [{ answers: { color: 'Blue', evil: 'x'.repeat(5000) } }] })))
    expect(res.status).toBe(200)
    expect((await linesOf(cls))[0].answers).toEqual({ color: 'Blue' })
  })

  it('a link-only class is bookable by its id', async () => {
    const cls = makeClass({ content: { rules: { ...defaultRules(), linkOnly: true } } })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
  })

  it.each(['draft', 'closed', 'cancelled'] as const)('a %s class is refused, 409 not_open', async (status) => {
    const cls = makeClass({ status })
    const res = await POST(ctx(body(cls)))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('not_open')
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('an unknown class is refused', async () => {
    const res = await POST(ctx({ ...body(makeClass()), classId: 'cls_nope' }))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('not_open')
  })

  it('refused after the sign-up cutoff (24 hours for a class with questions)', async () => {
    const cls = makeClass({ content: { questions: [{ id: 'color', label: 'Glaze color', choices: ['Blue', 'Green'] }] } })
    vi.setSystemTime(new Date('2026-10-16T19:00:00.000Z')) // 23 hours before Saturday
    const seats = [{ answers: { color: 'Blue' } }, { answers: { color: 'Blue' } }, { answers: { color: 'Green' } }]
    const res = await POST(ctx(body(cls, { seats })))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json).toMatchObject({ code: 'not_open', detail: 'Sign-ups for this class closed 24 hours before it starts.' })
  })

  it('the cutoff counts from the first session the booking covers (choose pass)', async () => {
    const cls = makeClass({ content: { rules: { ...defaultRules(), signupCutoffHours: 24 } } })
    vi.setSystemTime(new Date('2026-10-16T19:00:00.000Z'))
    squareTotal(3815) // 3500 + 315 tax
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sun'], tickets: { adult: 1 } })))
    expect(res.status).toBe(200)
  })

  it('a choose pass holds only the picked session and sells its own variation', async () => {
    const cls = makeClass()
    mockCreateClassOrder.mockResolvedValueOnce({ orderId: 'ORDER1', totalCents: 3815, lineUids: ['u0'], lineTotals: [] })
    mockProcessPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: 3815, status: 'completed' })
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sun'], tickets: { adult: 1 } })))
    expect(res.status).toBe(200)
    expect(mockCreateClassOrder.mock.calls[0][0].lines.map((l: any) => l.catalogObjectId)).toEqual(['VAR_DAY_ADULT'])
    const lines = await linesOf(cls)
    expect(lines).toHaveLength(1)
    expect(lines[0].sessionIds).toEqual(['ses_sun'])
    expect(lines[0].passId).toBe('day')
  })

  it('a choose pass without its pick is invalid', async () => {
    const cls = makeClass()
    const res = await POST(ctx(body(cls, { passId: 'day', tickets: { adult: 1 } })))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid')
  })

  it('answers and add-ons are saved on the seats; add-ons are their own order lines', async () => {
    const cls = makeClass({
      content: {
        rules: { ...defaultRules(), signupCutoffHours: 0 },
        questions: [{ id: 'color', label: 'Glaze color', choices: ['Blue', 'Green'] }],
        addOns: [{ id: 'glaze', label: 'Extra glaze', priceCents: 500, maxPerSeat: 2 }],
      },
    })
    // adult 6000+540, extra glaze 500+45 → 7085
    mockCreateClassOrder.mockResolvedValueOnce({ orderId: 'ORDER1', totalCents: 7085, lineUids: ['u0', 'u1'], lineTotals: [] })
    mockProcessPayment.mockResolvedValueOnce({ id: 'PAY1', orderId: 'ORDER1', amount: 7085, status: 'completed' })
    const res = await POST(ctx(body(cls, { tickets: { adult: 1 }, seats: [{ answers: { color: 'Green' }, addOns: { glaze: 1 } }] })))
    expect(res.status).toBe(200)
    const order = mockCreateClassOrder.mock.calls[0][0]
    expect(order.lines.map((l: any) => l.catalogObjectId)).toEqual(['VAR_ALL_ADULT', 'VAR_GLAZE'])
    expect(order.lines[0].note).toContain('Green')
    const [line] = await linesOf(cls)
    expect(line.answers).toEqual({ color: 'Green' })
    expect(line.addOns).toEqual({ glaze: 1 })
    expect(mockSendEmail.mock.calls[0][0].pickLines).toEqual(['Seat 1 · Glaze color Green'])
  })

  it('a gift card token passes through as the payment source', async () => {
    const cls = makeClass()
    const res = await POST(ctx(body(cls, { sourceKind: 'gift_card', paymentToken: 'cnon:gift-card-nonce-ok' })))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].paymentToken).toBe('cnon:gift-card-nonce-ok')
  })

  it('a customer lookup failure is not fatal', async () => {
    const cls = makeClass()
    mockFindOrCreate.mockRejectedValueOnce(new Error('Square down'))
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockCreateClassOrder.mock.calls[0][0].customerId).toBeNull()
  })

  it('a confirmation email that fails never fails the booking', async () => {
    const cls = makeClass()
    mockSendEmail.mockRejectedValueOnce(new Error('smtp'))
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect((await res.json()).data.emailSent).toBe(false)
  })

  it('T8: a retry that finishes while the first try is still charging: one confirmation email, never two', async () => {
    const cls = makeClass()
    let second: Response | null = null
    mockFindOrderPayment.mockResolvedValue({ id: 'PAY1', status: 'completed', amount: TOTAL, receiptUrl: null })
    mockProcessPayment.mockImplementationOnce(async () => {
      // The same attempt again (a double tap): it finds the order paid and books it first.
      second = await POST(ctx(body(cls)))
      return { id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed', receiptUrl: null }
    })
    const first = await POST(ctx(body(cls)))
    expect(first.status).toBe(200)
    expect(second!.status).toBe(200)
    expect(mockProcessPayment).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect((await linesOf(cls)).every((l) => l.state === 'confirmed')).toBe(true)
  })

  describe('R42: Square’s payment notice and the request: one confirmation, one owners’ note', () => {
    /** Square's order for this booking, paid, as its payment notice brings it. */
    const paidOrder = () => ({
      id: 'ORDER1', reference_id: bookingIdFor(ATTEMPT), state: 'COMPLETED', total_money: { amount: TOTAL, currency: 'USD' },
      tenders: [{ id: 'PAY1', payment_id: 'PAY1' }],
      line_items: [
        { uid: 'u0', catalog_object_id: 'VAR_ALL_ADULT', quantity: '2', total_money: { amount: 13080 }, total_tax_money: { amount: 1080 } },
        { uid: 'u1', catalog_object_id: 'VAR_ALL_KID', quantity: '1', total_money: { amount: 4360 }, total_tax_money: { amount: 360 } },
      ],
    })
    const notice = (cls: ScheduledClass) => handleOrder(paidOrder(), new Date(), { classes: [cls], paymentCompleted: true, paymentId: 'PAY1' })
    const ownersNotes = () => mockAnnounce.mock.calls.length + mockAlertOwners.mock.calls.filter((c) => /booked from Square/.test(String(c[0]))).length

    it('a request that died with no answer, then the notice: booked, exactly one email and one owners’ note', async () => {
      const cls = makeClass()
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      expect((await POST(ctx(body(cls)))).status).toBe(502)
      expect(await notice(cls)).toMatchObject({ confirmed: 3 })
      await notice(cls) // a replay changes nothing
      expect((await linesOf(cls)).every((l) => l.state === 'confirmed')).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(ownersNotes()).toBe(1)
    })

    it('a live request the notice beats: exactly one email and one owners’ note', async () => {
      const cls = makeClass()
      mockProcessPayment.mockImplementationOnce(async () => {
        await notice(cls) // Square's notice lands while the charge's answer is still on its way
        return { id: 'PAY1', orderId: 'ORDER1', amount: TOTAL, status: 'completed', receiptUrl: null }
      })
      expect((await POST(ctx(body(cls)))).status).toBe(200)
      expect((await linesOf(cls)).every((l) => l.state === 'confirmed')).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(ownersNotes()).toBe(1)
    })

    it('a live request that finishes first, then the notice: exactly one email and one owners’ note', async () => {
      const cls = makeClass()
      expect((await POST(ctx(body(cls)))).status).toBe(200)
      await notice(cls)
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(ownersNotes()).toBe(1)
    })
  })

  it('answers before the email, the owners’ text and analytics on Netlify', async () => {
    const cls = makeClass()
    let release!: () => void
    mockSendEmail.mockImplementationOnce(() => new Promise((r) => { release = () => r({ sent: true }) }))
    const later: Promise<unknown>[] = []
    const c = ctx(body(cls))
    c.locals = { netlify: { context: { waitUntil: (p: Promise<unknown>) => { later.push(p) } } } }
    const res = await POST(c)
    expect(res.status).toBe(200)
    expect(later).toHaveLength(1)
    // The email goes once its one-per-booking claim is written (T8).
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await Promise.all(later)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('simulated payments: seats confirmed, Square never called', async () => {
    bypassOn = true
    const cls = makeClass({ variations: {} })
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
    expect(mockProcessPayment).not.toHaveBeenCalled()
    expect(mockFindOrCreate).not.toHaveBeenCalled()
    expect(mockAnnounce).not.toHaveBeenCalled()
    const lines = await linesOf(cls)
    expect(lines.every((l) => l.state === 'confirmed' && l.square.orderId?.startsWith('sim-'))).toBe(true)
  })

  describe('the body', () => {
    it.each([
      ['no phone', { customer: { ...customer, phone: '' } }, CONTACT_MESSAGES.phone],
      ['a bad email', { customer: { ...customer, email: 'ada@' } }, 'That email doesn’t look right. Check for typos.'],
      ['no last name', { customer: { ...customer, familyName: ' ' } }, 'Add your first and last name.'],
    ])('refuses %s', async (_n, over, detail) => {
      const res = await POST(ctx(body(makeClass(), over)))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'invalid', detail })
      expect(mockCreateClassOrder).not.toHaveBeenCalled()
    })

    it('refuses a missing payment token or attempt id', async () => {
      const cls = makeClass()
      expect((await POST(ctx(body(cls, { paymentToken: '' })))).status).toBe(400)
      expect((await POST(ctx(body(cls, { attemptId: 'nope' })))).status).toBe(400)
      expect((await POST(ctx('not json'))).status).toBe(400)
    })
  })

  it('rate limit: 5 a minute from one address', async () => {
    const cls = makeClass()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      newAttempt()
      statuses.push((await POST(ctx(body(cls, { tickets: { adult: 1 } }), '192.0.2.77'))).status)
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true)
    expect(statuses[5]).toBe(429)
  })
})

describe('Pay on the iPad (door mode, Task 14)', () => {
  // Sat Oct 17, 1:30 PM studio time: the Saturday session started half an hour ago.
  const DURING = new Date('2026-10-17T18:30:00.000Z')
  it('only signed-in staff can book in door mode', async () => {
    vi.setSystemTime(DURING)
    const cls = makeClass()
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 } }), undefined, '?door=1'))
    expect(res.status).toBe(401)
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })
  it('the same checkout, seats recorded as door-card by the crew member, on a session already running', async () => {
    vi.setSystemTime(DURING)
    staffMember = { id: 'sam', name: 'Sam', role: 'crew' }
    const cls = makeClass()
    mockCreateClassOrder.mockImplementation(async (p: any) => ({ orderId: 'ORDER2', totalCents: 3815, lineUids: p.lines.map((_: any, i: number) => `u${i}`), lineTotals: [] }))
    mockProcessPayment.mockResolvedValue({ id: 'PAY2', orderId: 'ORDER2', amount: 3815, status: 'completed', receiptUrl: null })
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 } }), undefined, '?door=1'))
    expect(res.status).toBe(200)
    const [line] = await linesOf(cls)
    expect(line).toMatchObject({ source: 'door-card', state: 'confirmed', sessionIds: ['ses_sat'], by: { id: 'sam', name: 'Sam' }, square: { orderId: 'ORDER2', paymentId: 'PAY2' } })
    expect(mockProcessPayment).toHaveBeenCalledTimes(1)
    // a door sale on the studio iPad isn't a site conversion
    expect(mockReport).not.toHaveBeenCalled()
  })
  it('online, the same running session is closed', async () => {
    vi.setSystemTime(DURING)
    const cls = makeClass()
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 } })))
    expect(res.status).toBe(400)
    expect((await res.json()).detail).toBe('One of the days you picked has already started.')
    expect(mockProcessPayment).not.toHaveBeenCalled()
  })
  it('a full day can be paid by card at the door after the crew tick Add over capacity; online it stays sold out', async () => {
    vi.setSystemTime(DURING)
    staffMember = { id: 'sam', name: 'Sam', role: 'crew' }
    const cls = makeClass({ capacity: 1 })
    await hold(cls, (quote(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 } }, DURING, 9, { door: true }) as any).value, { bookingId: 'bkg_other', passId: 'day', source: 'comp', customer: null, ttlMinutes: 60 }, DURING)
    mockCreateClassOrder.mockImplementation(async (p: any) => ({ orderId: 'ORDER3', totalCents: 3815, lineUids: p.lines.map((_: any, i: number) => `u${i}`), lineTotals: [] }))
    mockProcessPayment.mockResolvedValue({ id: 'PAY3', orderId: 'ORDER3', amount: 3815, status: 'completed', receiptUrl: null })
    const full = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 } }), undefined, '?door=1'))
    expect(full.status).toBe(409)
    newAttempt()
    const res = await POST(ctx(body(cls, { passId: 'day', sessionIds: ['ses_sat'], tickets: { adult: 1 }, overCapacity: true }), undefined, '?door=1'))
    expect(res.status).toBe(200)
    expect((await linesOf(cls))[0]).toMatchObject({ source: 'door-card', overCapacity: true })
  })
})

describe('stage 4: codes, the shown total and free bookings at checkout', () => {
  let codeN = 0
  const by = { id: 'c', name: 'Catherine' }
  async function makeCode(over: Record<string, any> = {}) {
    const { savePromo } = await import('@lib/promos/promo-store')
    const code = `${over.prefix ?? 'CODE'}${++codeN}${Date.now().toString(36).slice(-4).toUpperCase()}`
    const { prefix: _p, ...rest } = over
    await savePromo({ code, label: '', off: { kind: 'percent', percent: 10 }, appliesTo: { kind: 'all' }, ...rest }, by, null, NOW)
    return code
  }
  /** Square as the mock provider prices it: catalog prices, line discounts off before 9%. */
  async function squareApplies() {
    const { MockPaymentProvider } = await import('@providers/mock/payment')
    const sq = new MockPaymentProvider()
    sq.prices = { VAR_ALL_ADULT: 6000, VAR_ALL_KID: 4000, VAR_DAY_ADULT: 3500, VAR_DAY_KID: 2500 }
    mockCreateClassOrder.mockImplementation((p: any) => sq.createClassOrder(p))
    mockProcessPayment.mockImplementation(async (p: any) => ({ id: 'PAY1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }))
  }
  const usesOf = async (code: string) => (await import('@lib/promos/promo-store')).getUses(code)
  const one = (cls: ScheduledClass, over: Record<string, any> = {}) => body(cls, { tickets: { adult: 1 }, ...over })

  it('a code: Square gets it as line discounts, the ledger keeps the net, the use is confirmed', async () => {
    await squareApplies()
    const cls = makeClass()
    const code = await makeCode({ off: { kind: 'percent', percent: 25 } })
    // $60 − 25% = $45, tax 405 → 4905
    const res = await POST(ctx(one(cls, { promoCode: code.toLowerCase(), expectedTotalCents: 4905 })))
    expect(res.status).toBe(200)
    expect(mockCreateClassOrder.mock.calls[0][0].lineDiscounts).toEqual([{ line: 0, name: `Code ${code}`, cents: 1500 }])
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(4905)
    const [line] = await linesOf(cls)
    expect(line).toMatchObject({ priceCents: 4500, listCents: 6000, discounts: [{ kind: 'promo', name: `Code ${code}`, cents: 1500 }] })
    const uses = await usesOf(code)
    expect(uses!.used.map((u) => u.bookingId)).toEqual([bookingIdFor(ATTEMPT)])
    expect(uses!.holds).toEqual([])
    expect(mockAnnounce.mock.calls[0][0].extra).toContain(`Code ${code} −$15.00`)
  })

  it('a code typed with a dash and spaces still works', async () => {
    await squareApplies()
    const cls = makeClass()
    const code = await makeCode({ prefix: 'FALLFRIENDS' })
    const typed = ` ${code.slice(0, 4)}-${code.slice(4)} `
    const res = await POST(ctx(one(cls, { promoCode: typed, expectedTotalCents: 5886 })))
    expect(res.status).toBe(200)
  })

  it('an unknown or turned-off code: 409 with the same sentence, nothing held, no order', async () => {
    const cls = makeClass()
    const off = await makeCode({ active: false })
    for (const c of ['NOSUCHCODE', off, '!!']) {
      newAttempt()
      const res = await POST(ctx(one(cls, { promoCode: c })))
      const json = await res.json()
      expect(res.status).toBe(409)
      expect(json.code).toBe('promo')
      expect(json.detail).toBe("That code isn't valid. Nothing was charged.")
    }
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
  })

  it('ended, not for this class: kind sentences, nothing held', async () => {
    const cls = makeClass()
    const ended = await makeCode({ endsYmd: '2026-10-10' })
    vi.setSystemTime(new Date('2026-10-11T06:00:00.000Z')) // Oct 11, 1 AM Chicago
    let res = await POST(ctx(one(cls, { promoCode: ended })))
    expect((await res.json()).detail).toBe('That code has ended. Nothing was charged.')
    newAttempt()
    const other = await makeCode({ appliesTo: { kind: 'classes', classIds: ['cls_someother'], libraryIds: [] } })
    res = await POST(ctx(one(cls, { promoCode: other })))
    expect((await res.json()).detail).toBe("That code isn't for this class. Nothing was charged.")
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
  })

  it('used up between Apply and Pay: 409 before any Square call, nothing held', async () => {
    const cls = makeClass()
    const code = await makeCode({ maxUses: 1 })
    const { reserveUse, confirmUse } = await import('@lib/promos/promo-store')
    await reserveUse(code, 'bkg_someone', new Date(NOW.getTime() + 600_000).toISOString(), NOW, 1)
    await confirmUse(code, 'bkg_someone', cls.id)
    const res = await POST(ctx(one(cls, { promoCode: code })))
    expect(res.status).toBe(409)
    expect((await res.json()).detail).toBe('That code has been used up. Nothing was charged.')
    expect(mockFindOrCreate).not.toHaveBeenCalled()
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('a declined card gives the code\'s use back', async () => {
    await squareApplies()
    const cls = makeClass()
    const code = await makeCode({ maxUses: 1 })
    mockProcessPayment.mockRejectedValueOnce(Object.assign(new Error('CARD_DECLINED'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED', category: 'PAYMENT_METHOD_ERROR' }] }))
    const res = await POST(ctx(one(cls, { promoCode: code })))
    expect(res.status).toBe(402)
    const uses = await usesOf(code)
    expect(uses!.holds).toEqual([])
    expect(uses!.used).toEqual([])
  })

  it('no answer from Square: the code\'s use stays with the held seats for a day', async () => {
    await squareApplies()
    const cls = makeClass()
    const code = await makeCode({ maxUses: 1 })
    mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await POST(ctx(one(cls, { promoCode: code })))
    expect(res.status).toBe(502)
    const uses = await usesOf(code)
    expect(uses!.holds).toHaveLength(1)
    expect(Date.parse(uses!.holds[0].until)).toBeGreaterThanOrEqual(NOW.getTime() + 23 * 3_600_000)
    // Someone else can't take the last use meanwhile.
    newAttempt()
    const other = await POST(ctx(one(cls, { promoCode: code })))
    expect((await other.json()).detail).toBe('That code has been used up. Nothing was charged.')
  })

  it('a retry of the same attempt never takes a second use', async () => {
    await squareApplies()
    const cls = makeClass()
    const code = await makeCode({ maxUses: 1 })
    expect((await POST(ctx(one(cls, { promoCode: code })))).status).toBe(200)
    const again = await POST(ctx(one(cls, { promoCode: code })))
    expect(again.status).toBe(200)
    expect((await again.json()).data.replayed).toBe(true)
    expect((await usesOf(code))!.used).toHaveLength(1)
    expect(mockProcessPayment).toHaveBeenCalledTimes(1)
  })

  describe('fix 2: codes counted wherever the seats are confirmed (I1), and D4 money at the route (M1, M6, M3)', () => {
    /** Square's order for this attempt's booking, paid: one adult with the code's discount, as its payment notice brings it. */
    const paidOrder = (code: string, cents: number, discount: number) => ({
      id: 'ORDER1', reference_id: bookingIdFor(ATTEMPT), state: 'COMPLETED', total_money: { amount: cents, currency: 'USD' },
      tenders: [{ id: 'PAY1', payment_id: 'PAY1' }],
      discounts: [{ uid: 'd0-0', name: `Code ${code}`, type: 'FIXED_AMOUNT', amount_money: { amount: discount, currency: 'USD' }, scope: 'LINE_ITEM' }],
      line_items: [{ uid: 'u0', catalog_object_id: 'VAR_ALL_ADULT', quantity: '1', total_money: { amount: cents }, total_tax_money: { amount: 0 } }],
    })

    it('I1: no answer from Square, then Square\'s payment notice confirms the seats: the code\'s use is counted, once, and a one-use code can\'t be used again', async () => {
      await squareApplies()
      const cls = makeClass()
      const half = await makeCode({ prefix: 'MAYA', off: { kind: 'percent', percent: 50 }, maxUses: 1 })
      mockProcessPayment.mockRejectedValueOnce(new Error('socket hang up'))
      // $60 − 50% = $30 + $2.70
      expect((await POST(ctx(one(cls, { promoCode: half, expectedTotalCents: 3270 })))).status).toBe(502)
      const bookingId = bookingIdFor(ATTEMPT)
      const [held] = await linesOf(cls)
      expect(held.discounts).toEqual([{ kind: 'promo', name: `Code ${half}`, cents: 3000, code: half }])
      expect(await handleOrder(paidOrder(half, 3270, 3000), new Date(), { classes: [cls], paymentCompleted: true, paymentId: 'PAY1' })).toMatchObject({ confirmed: 1 })
      let uses = await usesOf(half)
      expect(uses!.used.map((u) => u.bookingId)).toEqual([bookingId])
      expect(uses!.holds).toEqual([])
      // A replay (the order event, tonight's catch-up) counts nothing more.
      await handleOrder(paidOrder(half, 3270, 3000), new Date(), { classes: [cls], paymentCompleted: true, paymentId: 'PAY1' })
      expect((await usesOf(half))!.used).toHaveLength(1)
      // A day and more later (the unclear-charge hold would have run out): still used, so the next person is told.
      vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000))
      newAttempt()
      const again = await POST(ctx(one(cls, { promoCode: half })))
      expect(again.status).toBe(409)
      expect((await again.json()).detail).toBe('That code has been used up. Nothing was charged.')
      uses = await usesOf(half)
      expect(uses!.used).toHaveLength(1)
    })

    it('I1: given back by an owner, a replayed payment notice never takes the use again', async () => {
      await squareApplies()
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 50 }, maxUses: 1 })
      expect((await POST(ctx(one(cls, { promoCode: code, expectedTotalCents: 3270 })))).status).toBe(200)
      const { giveUseBack } = await import('@lib/promos/promo-store')
      expect(await giveUseBack(code, bookingIdFor(ATTEMPT), by)).toBe(true)
      await handleOrder(paidOrder(code, 3270, 3000), new Date(), { classes: [cls], paymentCompleted: true, paymentId: 'PAY1' })
      const uses = await usesOf(code)
      expect(uses!.used).toEqual([])
      expect(uses!.givenBack!.map((g) => g.bookingId)).toEqual([bookingIdFor(ATTEMPT)])
    })

    it('I1: the request couldn\'t count the use; the echo of its own payment notice counts it', async () => {
      await squareApplies()
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 50 }, maxUses: 3 })
      expect((await POST(ctx(one(cls, { promoCode: code, expectedTotalCents: 3270 })))).status).toBe(200)
      const [line] = await linesOf(cls)
      // The lost write: as if both of the request's tries had failed (the owners were texted).
      const { makeKvStore } = await import('@lib/blob-store')
      await makeKvStore('promo-uses', 'promo-uses').set(`uses-${code}`, JSON.stringify({ code, used: [], holds: [] }))
      await handleOrder({ ...paidOrder(code, 3270, 3000), id: line.square.orderId }, new Date(), { classes: [cls], paymentCompleted: true, paymentId: 'PAY1' })
      expect((await usesOf(code))!.used.map((u) => u.bookingId)).toEqual([bookingIdFor(ATTEMPT)])
    })

    it('M6: the normal D4 state (POS item at the early-bird price): only the code goes to Square, charged = the quote', async () => {
      const { MockPaymentProvider } = await import('@providers/mock/payment')
      const sq = new MockPaymentProvider()
      sq.prices = { VAR_ALL_ADULT: 5000, VAR_ALL_KID: 4000 } // the POS carries the early-bird
      mockCreateClassOrder.mockImplementation((p: any) => sq.createClassOrder(p))
      mockProcessPayment.mockImplementation(async (p: any) => ({ id: 'PAY1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }))
      const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-12', prices: { all: { adult: 5000 } } } } })
      cls.square.prices = { 'all:adult': 5000, 'all:kid': 4000, 'day:adult': 3500, 'day:kid': 2500 }
      const code = await makeCode({ off: { kind: 'amount', cents: 500 } })
      // $60 → early-bird $50 → code $5 → $45 + $4.05
      const res = await POST(ctx(one(cls, { promoCode: code, expectedTotalCents: 4905 })))
      expect(res.status).toBe(200)
      expect(mockCreateClassOrder.mock.calls[0][0].lineDiscounts).toEqual([{ line: 0, name: `Code ${code}`, cents: 500 }])
      expect(mockProcessPayment.mock.calls[0][0].amount).toBe(4905)
      expect(mockOwnerEmail).not.toHaveBeenCalled()
    })

    it('M6: the POS still had the early-bird price just after it ended: Square\'s lower total is charged and the owners\' email says why', async () => {
      const { MockPaymentProvider } = await import('@providers/mock/payment')
      const sq = new MockPaymentProvider()
      sq.prices = { VAR_ALL_ADULT: 5000, VAR_ALL_KID: 4000 } // the hourly flip hasn't run yet
      mockCreateClassOrder.mockImplementation((p: any) => sq.createClassOrder(p))
      mockProcessPayment.mockImplementation(async (p: any) => ({ id: 'PAY1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }))
      const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-10', prices: { all: { adult: 5000 } } } } })
      cls.square.prices = { 'all:adult': 5000, 'all:kid': 4000, 'day:adult': 3500, 'day:kid': 2500 }
      vi.setSystemTime(new Date('2026-10-11T05:00:30.000Z')) // just after midnight Chicago
      const res = await POST(ctx(one(cls, { expectedTotalCents: 6540 })))
      expect(res.status).toBe(200)
      expect(mockProcessPayment.mock.calls[0][0].amount).toBe(5450)
      expect(mockOwnerEmail).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(mockOwnerEmail.mock.calls[0][0])).toContain('The register still had the early-bird price. It goes back to the regular price within the hour.')
    })

    it('M1: our record says early-bird but Square is already back at the regular price: the code still goes, so the charge is the Pay button\'s', async () => {
      const { MockPaymentProvider } = await import('@providers/mock/payment')
      const sq = new MockPaymentProvider()
      sq.prices = { VAR_ALL_ADULT: 6000, VAR_ALL_KID: 4000 } // Square written
      mockCreateClassOrder.mockImplementation((p: any) => sq.createClassOrder(p))
      mockProcessPayment.mockImplementation(async (p: any) => ({ id: 'PAY1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }))
      const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-10', prices: { all: { adult: 5000 } } } } })
      cls.square.prices = { 'all:adult': 5000, 'all:kid': 4000, 'day:adult': 3500, 'day:kid': 2500 } // record not
      vi.setSystemTime(new Date('2026-10-11T07:00:00.000Z'))
      const code = await makeCode({ off: { kind: 'amount', cents: 50 } })
      // $60 − $0.50 = $59.50 + $5.36
      const res = await POST(ctx(one(cls, { promoCode: code, expectedTotalCents: 6486 })))
      expect(res.status).toBe(200)
      expect(mockCreateClassOrder.mock.calls[0][0].lineDiscounts).toEqual([{ line: 0, name: `Code ${code}`, cents: 50 }])
      expect(mockProcessPayment.mock.calls[0][0].amount).toBe(6486)
    })

    it('M3: a retry of a free booking still held (its confirm failed) answers "still finishing" and never makes a Square order', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 } })
      confirmFails = true
      const free = one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'retry@example.com' } })
      expect((await POST(ctx(free))).status).toBe(200) // booked; owners told to add them by hand
      confirmFails = false
      const again = await POST(ctx(free))
      expect(again.status).toBe(409)
      expect((await again.json()).code).toBe('in_progress')
      expect(mockCreateClassOrder).not.toHaveBeenCalled()
      expect(mockFindOrderPayment).not.toHaveBeenCalled()
    })

    it('M-g: a free booking whose seats weren\'t recorded still counts its code\'s use, exactly once (a one-use code can\'t go twice)', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 }, maxUses: 1 })
      confirmFails = true
      const free = one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'mg@example.com' } })
      expect((await POST(ctx(free))).status).toBe(200)
      expect((await usesOf(code))!.used.map((u: any) => u.bookingId)).toHaveLength(1)
      expect(mockAlertOwners.mock.calls.map((c) => c[0]).join('\n')).toContain(`code ${code}: its use is already counted`)
      // Someone else trying the same one-use code is told it's used up.
      confirmFails = false
      const other = await POST(ctx(one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'other@example.com' } })))
      expect(other.status).toBe(409)
      expect((await usesOf(code))!.used).toHaveLength(1)
    })
  })

  describe('review I2: never more than the Pay button said', () => {
    it('early-bird ended while they sat on the pay step: nothing held or charged, the new total and why', async () => {
      const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-10', prices: { all: { adult: 5000 } } } } })
      vi.setSystemTime(new Date('2026-10-11T05:00:30.000Z')) // just after midnight Chicago
      const res = await POST(ctx(one(cls, { expectedTotalCents: 5450 })))
      const json = await res.json()
      expect(res.status).toBe(409)
      expect(json.code).toBe('price_changed')
      expect(json.detail).toBe('The price changed to $65.40 because the early-bird ended. Nothing was charged.')
      expect(json.quote.totalCents).toBe(6540)
      expect(json.quote.lines[0]).not.toHaveProperty('variationKey')
      expect((await getLedger(cls.id)).lines).toHaveLength(0)
      expect(mockCreateClassOrder).not.toHaveBeenCalled()
      // They confirm the new total: booked at it.
      await squareApplies()
      newAttempt()
      const ok = await POST(ctx(one(cls, { expectedTotalCents: 6540 })))
      expect(ok.status).toBe(200)
      expect(mockProcessPayment.mock.calls[0][0].amount).toBe(6540)
    })
    it('any other rise says just the new total', async () => {
      const cls = makeClass()
      const res = await POST(ctx(one(cls, { expectedTotalCents: 6000 })))
      expect((await res.json()).detail).toBe('The price changed to $65.40. Nothing was charged.')
    })
    it('lower or the same as shown is charged at Square\'s total (R14)', async () => {
      await squareApplies()
      const cls = makeClass()
      const res = await POST(ctx(one(cls, { expectedTotalCents: 9999 })))
      expect(res.status).toBe(200)
      expect(mockProcessPayment.mock.calls[0][0].amount).toBe(6540)
    })
  })

  describe('D3: free bookings', () => {
    let em = 0
    /** A free booking's body: no card, the $0 shown; a fresh email each time (free bookings are limited per email). */
    const fb = (cls: ScheduledClass, over: Record<string, any> = {}) =>
      one(cls, { paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: `free${++em}@example.com` }, ...over })
    const expectFree = async (cls: ScheduledClass, res: Response) => {
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data.totalChargedCents).toBe(0)
      expect(mockCreateClassOrder).not.toHaveBeenCalled()
      expect(mockProcessPayment).not.toHaveBeenCalled()
      const lines = await linesOf(cls)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.every((l) => l.state === 'confirmed' && l.source === 'online' && l.priceCents === 0 && l.taxCents === 0 && l.square.orderId === null && l.square.paymentId === null && l.square.chargedCents === 0)).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ totalChargedCents: 0, free: true })
      expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({ paidCents: 0 }))
      return lines
    }
    it('a 100% code: no card, no Square order or payment, seats confirmed at $0 with the discount, use confirmed', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 }, maxUses: 1 })
      const res = await POST(ctx(fb(cls, { promoCode: code })))
      const [line] = await expectFree(cls, res)
      expect(line).toMatchObject({ listCents: 6000, discounts: [{ kind: 'promo', name: `Code ${code}`, cents: 6000 }] })
      expect((await usesOf(code))!.used).toHaveLength(1)
      expect(mockAnnounce.mock.calls[0][0].extra).toContain(`Code ${code} −$60.00`)
    })
    it('a $ code bigger than the price', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'amount', cents: 10_000 } })
      await expectFree(cls, await POST(ctx(fb(cls, { promoCode: code }))))
    })
    it('a $0 early-bird with no code', async () => {
      const cls = makeClass({ content: { earlyBird: { untilYmd: '2026-10-30', prices: { all: { adult: 0 } } } } })
      const lines = await expectFree(cls, await POST(ctx(fb(cls))))
      expect(lines[0].discounts).toEqual([{ kind: 'early-bird', name: 'Early-bird', cents: 6000 }])
    })
    it('a booking that isn\'t free still needs a card', async () => {
      const cls = makeClass()
      const res = await POST(ctx(one(cls, { paymentToken: '' })))
      expect(res.status).toBe(400)
      expect(mockCreateClassOrder).not.toHaveBeenCalled()
    })
    it('a page that thought it was free, after the code ended: price_changed, nothing booked', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 }, endsYmd: '2026-10-10' })
      vi.setSystemTime(new Date('2026-10-11T06:00:00.000Z'))
      const res = await POST(ctx(fb(cls, { promoCode: code })))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('promo')
      expect((await getLedger(cls.id)).lines).toHaveLength(0)
    })
    it('sold out: the seats aren\'t held and the code\'s use is given back', async () => {
      const cls = makeClass({ capacity: 1 })
      await hold(cls, (quote(cls, { passId: 'all', tickets: { adult: 1 } }, NOW, 9) as any).value, { bookingId: 'bkg_first', passId: 'all', source: 'online', customer: null, ttlMinutes: 60 }, NOW)
      const code = await makeCode({ off: { kind: 'percent', percent: 100 }, maxUses: 5 })
      const res = await POST(ctx(fb(cls, { promoCode: code })))
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('sold_out')
      const uses = await usesOf(code)
      expect(uses?.holds ?? []).toEqual([])
      expect(uses?.used ?? []).toEqual([])
    })
    it('race: two people on the last use of a free code — one booked, one told it is used up, nothing charged', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 }, maxUses: 1 })
      newAttempt()
      const a = one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'a@example.com' } })
      newAttempt()
      const b = one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'b@example.com' } })
      const [ra, rb] = await Promise.all([POST(ctx(a)), POST(ctx(b))])
      const codes = [ra.status, rb.status].sort()
      expect(codes).toEqual([200, 409])
      const loser = ra.status === 409 ? ra : rb
      expect((await loser.json()).detail).toBe('That code has been used up. Nothing was charged.')
      expect((await usesOf(code))!.used).toHaveLength(1)
      expect((await getLedger(cls.id)).lines.filter((l) => l.state === 'confirmed')).toHaveLength(1)
    })
    it('a replay of a free booking answers booked again, nothing more', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 } })
      const same = fb(cls, { promoCode: code })
      await POST(ctx(same))
      const again = await POST(ctx(same))
      const json = await again.json()
      expect(json.data).toMatchObject({ replayed: true, totalChargedCents: 0 })
      expect((await linesOf(cls))).toHaveLength(1)
    })
    it('free bookings are limited per email (abuse guard)', async () => {
      const cls = makeClass({ capacity: 20 })
      const code = await makeCode({ off: { kind: 'percent', percent: 100 } })
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        newAttempt()
        statuses.push((await POST(ctx(one(cls, { promoCode: code, paymentToken: '', expectedTotalCents: 0, customer: { ...customer, email: 'farm@example.com' } })))).status)
      }
      expect(statuses).toEqual([200, 200, 200, 429])
    })
    it('at the door (Pay on the iPad): a free code books a door-card seat at $0 with no card', async () => {
      staffMember = { id: 'sam', name: 'Sam', role: 'crew' }
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 } })
      const res = await POST(ctx(fb(cls, { promoCode: code }), undefined, '?door=1'))
      expect(res.status).toBe(200)
      const [line] = await linesOf(cls)
      expect(line).toMatchObject({ source: 'door-card', priceCents: 0, by: { id: 'sam', name: 'Sam' }, square: { orderId: null, paymentId: null, chargedCents: 0 } })
      expect(mockProcessPayment).not.toHaveBeenCalled()
    })
    it('a free booking has nothing to refund, but its seat can still be freed', async () => {
      const cls = makeClass()
      const code = await makeCode({ off: { kind: 'percent', percent: 100 } })
      await POST(ctx(fb(cls, { promoCode: code })))
      const { planRefund, NOTHING_TO_REFUND_FREE } = await import('@lib/classes/refunds')
      const ledger = await getLedger(cls.id)
      expect(() => planRefund(ledger, { classId: cls.id, bookingId: bookingIdFor(ATTEMPT), kind: 'booking', reason: 'x' } as any)).toThrow(NOTHING_TO_REFUND_FREE)
      const { recordRefund } = await import('@lib/classes/seat-ledger')
      const [line] = await linesOf(cls)
      await recordRefund(cls.id, [line.id], { cents: 0, reason: 'cancelled', by, freeSeat: true, squareRefundId: null })
      const { seatsTaken } = await import('@lib/classes/seat-ledger')
      expect(seatsTaken(await getLedger(cls.id), 'ses_sat', NOW)).toBe(0)
    })
  })
})

describe('stage 4: waitlist first', () => {
  async function waiting(cls: ScheduledClass, seats: number) {
    await mutateWaitlist(cls.id, (cur) => ({
      next: {
        ...cur, entries: [...cur.entries, {
          id: `wle_${String(++seq).padStart(16, '0')}`, createdAt: NOW.toISOString(), request: { passId: 'all', tickets: { adult: seats } },
          sessionIds: ['ses_sat', 'ses_sun'], seats, maxCents: 99999,
          customer: { givenName: 'W', familyName: 'Aiting', email: 'w@example.com', phone: '' },
          square: { customerId: 'c', cardId: 'card', brand: 'VISA', last4: '4242', expMonth: 1, expYear: 2030 },
          consent: { textVersion: 'v', text: 't', at: '', ipHash: '' }, leaveHash: 'h', state: 'waiting' as const, attempts: [], history: [],
        }],
      },
      result: null,
    }))
  }
  async function takeAllBut(cls: ScheduledClass, free: number) {
    const cap = cls.sessions[0].capacity
    const q = quote(cls, { passId: 'all', tickets: { adult: cap - free } }, NOW, 9)
    if (!q.ok) throw new Error(q.error)
    await hold(cls, q.value, { bookingId: `bkg_taken${++seq}`, passId: 'all', source: 'online', customer: null, ttlMinutes: 600 }, NOW)
  }

  it('a public booking the next waiting person fits is refused as sold out, nothing held or charged, and the waitlist runs', async () => {
    const cls = makeClass({ capacity: 3 })
    await takeAllBut(cls, 1)
    await waiting(cls, 1)
    const res = await POST(ctx(body(cls, { tickets: { adult: 1 } })))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('sold_out')
    expect(mockCreateClassOrder).not.toHaveBeenCalled()
    expect(mockProcessPayment).not.toHaveBeenCalled()
    expect(await linesOf(cls)).toHaveLength(0)
    expect(runWaitlistSpy).toHaveBeenCalledWith(cls.id, expect.objectContaining({ reason: 'booking' }))
  })

  it('a booking no waiting entry fits goes ahead (the pair waiting needs 2, 1 is free)', async () => {
    const cls = makeClass({ capacity: 3 })
    await takeAllBut(cls, 1)
    await waiting(cls, 2)
    mockProcessPayment.mockResolvedValue({ id: 'PAY1', orderId: 'ORDER1', amount: 6540, status: 'completed', receiptUrl: null })
    mockCreateClassOrder.mockImplementation(async () => ({ orderId: 'ORDER1', totalCents: 6540, lineTotals: [] }))
    const res = await POST(ctx(body(cls, { tickets: { adult: 1 } })))
    expect(res.status).toBe(200)
    expect(runWaitlistSpy).not.toHaveBeenCalled()
  })

  it('at the door, Add over capacity still seats them', async () => {
    staffMember = { id: 'c', name: 'Crew', role: 'crew' }
    const cls = makeClass({ capacity: 3 })
    await takeAllBut(cls, 1)
    await waiting(cls, 1)
    mockProcessPayment.mockResolvedValue({ id: 'PAY1', orderId: 'ORDER1', amount: 6540, status: 'completed', receiptUrl: null })
    mockCreateClassOrder.mockImplementation(async () => ({ orderId: 'ORDER1', totalCents: 6540, lineTotals: [] }))
    const refused = await POST(ctx(body(cls, { tickets: { adult: 1 } }), undefined, '?door=1'))
    expect(refused.status).toBe(409)
    newAttempt()
    const ok = await POST(ctx(body(cls, { tickets: { adult: 1 }, overCapacity: true }), undefined, '?door=1'))
    expect(ok.status).toBe(200)
  })
})
