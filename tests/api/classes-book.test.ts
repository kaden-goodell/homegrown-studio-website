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

import { getLedger, hold } from '@lib/classes/seat-ledger'
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
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({ bookingId, amountCents: 16000 }))
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

  it('Square more than a cent lower (e.g. the class went out without its tax): charged, owners emailed', async () => {
    const cls = makeClass()
    squareTotal(TOTAL - 1440)
    const res = await POST(ctx(body(cls)))
    expect(res.status).toBe(200)
    expect(mockProcessPayment.mock.calls[0][0].amount).toBe(TOTAL - 1440)
    expect(mockOwnerEmail).toHaveBeenCalledTimes(1)
    const mail = mockOwnerEmail.mock.calls[0][0]
    expect(mail.subject).toMatch(/Pottery Weekend/)
    expect(mail.text).toBe(`Square total was $14.40 lower than the quote on booking ${bookingIdFor(ATTEMPT)} (quote $174.40, Square $160.00). Check the class's tax on the POS.`)
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
    expect(mockAlertOwners).toHaveBeenCalledWith("Class Pottery Weekend isn't on the POS yet. Open it in /admin and Save.")
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
    expect(mockAlertOwners.mock.calls.map((c) => c[0]).join('\n')).toMatch(/weren't recorded.*ORDER1/)
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
