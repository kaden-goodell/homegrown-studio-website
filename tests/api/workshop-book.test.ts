import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SeatBookingError } from '@lib/errors'

const mockFindOrCreate = vi.fn()
const mockReserve = vi.fn()
const mockPay = vi.fn()
const mockRelease = vi.fn()
const mockGetWorkshop = vi.fn()
const mockCreateGuest = vi.fn()
const mockListWorkshops = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    customer: { findOrCreate: (...a: any[]) => mockFindOrCreate(...a), createGuest: (...a: any[]) => mockCreateGuest(...a) },
    giftcard: { fromNonce: vi.fn(), mint: vi.fn(), get: vi.fn(), fromGan: vi.fn() },
    workshop: {
      reserveSeats: (...a: any[]) => mockReserve(...a),
      payForSeats: (...a: any[]) => mockPay(...a),
      releaseSeats: (...a: any[]) => mockRelease(...a),
      getWorkshop: (...a: any[]) => mockGetWorkshop(...a),
      listWorkshops: (...a: any[]) => mockListWorkshops(...a),
    },
  },
}))

const mockAlertOwners = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlertOwners(...a) }))

const mockSendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendWorkshopConfirmationEmail: (...a: any[]) => mockSendEmail(...a) }))

const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))

const mockSaveSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ saveSeatChoices: (...a: any[]) => mockSaveSeatChoices(...a) }))

let bypassOn = false
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => bypassOn }))
const mockStartGuestSeats = vi.fn()
vi.mock('@lib/guest-seat-job', () => ({
  issueGuestSeatTicket: (job: any) => `ticket:${job.paidBookingId}:${job.totalSeats}`,
  startGuestSeats: (...a: any[]) => mockStartGuestSeats(...a),
}))

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const TWO_PICKS = [
  { seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' },
  { seat: 2, optionId: 'pumpkin-color', choice: 'Black' },
]

const ATTEMPT = '3f2b8a0e-5c1d-4e7a-9b3c-0a1b2c3d4e5f'
// 7 PM Central on Fri 16 Oct 2026
const START = '2026-10-17T00:00:00.000Z'

const workshop = {
  id: 'clsschi_kinusaiga',
  scheduleId: 'clssch_kinusaiga',
  name: 'Kinusaiga',
  description: 'Kinusaiga is Japanese fabric art with no sewing.\n\nEveryone picks their design.',
  descriptionHtml: '',
  startAt: START,
  durationMinutes: 120,
  priceCents: 4000,
  priceCurrency: 'USD',
  availableCapacity: 12,
  staffName: '',
  teamMemberId: '',
  imageUrl: 'https://example.com/kinusaiga.jpg',
}

function body(overrides: Record<string, any> = {}) {
  const seats = overrides.seats ?? 2
  return {
    attemptId: ATTEMPT,
    workshopId: workshop.id,
    classScheduleId: workshop.scheduleId,
    startAt: START,
    seats,
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' },
    paymentTokens: Array.from({ length: Number.isInteger(seats) && seats > 0 && seats < 100 ? seats : 1 }, (_, i) => `cnon:card-ok-${i + 1}`),
    ...overrides,
  }
}

let ip = 0
function ctx(payload: any) {
  return {
    clientAddress: `203.0.113.${++ip}`, // a fresh address per request keeps the rate limit out of the way
    request: new Request('https://ourhometownstudio.com/api/workshops/book.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  } as any
}

const TECHNICAL = /[{}<>]|https?:|status \d{3}|\bjson\b|exception|fetch failed/i

let POST: any
beforeEach(async () => {
  // Sat 10 Oct 2026: a week before the fixture's class. Only Date is faked.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T17:00:00.000Z'))
  bypassOn = false
  vi.clearAllMocks()
  vi.resetModules()
  mockGetEventMeta.mockResolvedValue(null)
  mockFindOrCreate.mockResolvedValue({ id: 'cust-1' })
  let held = 0
  mockReserve.mockImplementation(async () => { held++; return { bookingId: `clsbk_${held}`, contactToken: `contact-${held}`, orderId: `order-${held}` } })
  mockPay.mockImplementation(async ({ reservation }: any) => ({
    bookingId: reservation.bookingId, orderId: reservation.orderId, status: 'accepted',
    receiptUrl: `https://squareup.com/receipt/${reservation.bookingId.split('_')[1]}`,
  }))
  mockRelease.mockResolvedValue(undefined)
  mockCreateGuest.mockImplementation(async ({ familyName }: any) => ({ id: `guest:${familyName}` }))
  mockGetWorkshop.mockResolvedValue(workshop)
  mockListWorkshops.mockResolvedValue([workshop])
  mockAlertOwners.mockResolvedValue({ attempted: 2, sent: 2 })
  mockSendEmail.mockResolvedValue({ sent: true })
  mockSaveSeatChoices.mockResolvedValue(undefined)
  mockStartGuestSeats.mockResolvedValue(true)
  POST = (await import('@pages/api/workshops/book.json')).POST
})
afterEach(() => vi.useRealTimers())

describe('POST /api/workshops/book.json', () => {
  describe('after the reply (Netlify waitUntil)', () => {
    function withNetlify(payload: any) {
      const later: Promise<unknown>[] = []
      const c = ctx(payload)
      c.locals = { netlify: { context: { waitUntil: (p: Promise<unknown>) => { later.push(p) } } } }
      return { c, later }
    }

    it('answers "booked" without waiting for the email, the owners’ text or analytics', async () => {
      let sendEmail!: (v: { sent: boolean }) => void
      mockSendEmail.mockReturnValue(new Promise((r) => { sendEmail = r }))
      const { c, later } = withNetlify(body())
      const res = await POST(c)
      expect(res.status).toBe(200)
      expect((await res.json()).data).toMatchObject({ bookingId: 'clsbk_1', emailSent: true })
      expect(later).toHaveLength(1)
      // The text to the owners went out alongside the still-sending email.
      expect(mockAlertOwners).toHaveBeenCalledWith(expect.stringMatching(/^New class booking: Ada Lovelace, 2 seats, /))
      sendEmail({ sent: true })
      await Promise.all(later)
      expect(mockAlertOwners.mock.calls.filter((c) => !String(c[0]).startsWith('New '))).toEqual([])
    })

    it('texts the owners when the confirmation then fails to send', async () => {
      mockSendEmail.mockResolvedValue({ sent: false })
      const { c, later } = withNetlify(body())
      await POST(c)
      await Promise.all(later)
      const failed = mockAlertOwners.mock.calls.map((x) => x[0]).find((t: string) => t.startsWith('Confirmation email didn'))
      expect(failed).toMatch(/^Confirmation email didn't send: Ada Lovelace <ada@example\.com>, 2 seats, Kinusaiga, .*\(clsbk_1\); please send them the details\.$/)
    })

    it('a crash after the reply never reaches the customer', async () => {
      mockSendEmail.mockRejectedValue(new Error('smtp down'))
      const { c, later } = withNetlify(body())
      expect((await POST(c)).status).toBe(200)
      await expect(Promise.all(later)).resolves.toBeDefined()
    })
  })

  describe('more than one seat: every seat is its own Square booking and its own charge', () => {
    it('holds each seat (seat 1 in the booker’s name, the rest as named guests), then charges each with its own token', async () => {
      const res = await POST(ctx(body({ seats: 3 })))
      expect(res.status).toBe(200)
      expect(mockReserve.mock.calls.map((c) => [c[0].seats, c[0].customer.familyName])).toEqual([
        [1, 'Lovelace'], [1, 'Lovelace (guest 2 of 3)'], [1, 'Lovelace (guest 3 of 3)'],
      ])
      expect(mockReserve.mock.calls.every((c) => c[0].customer.email === 'ada@example.com')).toBe(true)
      expect(mockPay.mock.calls.map((c) => [c[0].reservation.bookingId, c[0].paymentToken, c[0].idempotencyKey, c[0].fallbackCustomerId])).toEqual([
        ['clsbk_1', 'cnon:card-ok-1', `${ATTEMPT}:pay`, 'cust-1'],
        ['clsbk_2', 'cnon:card-ok-2', `${ATTEMPT}:pay-2`, 'guest:Lovelace (guest 2 of 3)'],
        ['clsbk_3', 'cnon:card-ok-3', `${ATTEMPT}:pay-3`, 'guest:Lovelace (guest 3 of 3)'],
      ])
      // Every hold before any charge.
      expect(Math.max(...mockReserve.mock.invocationCallOrder)).toBeLessThan(Math.min(...mockPay.mock.invocationCallOrder))
      expect(mockCreateGuest.mock.calls[0][0]).toEqual({ givenName: 'Ada', familyName: 'Lovelace (guest 2 of 3)', note: 'Online seat 2 of 3 with Ada Lovelace <ada@example.com>, Kinusaiga.' })
      const { data } = await res.json()
      expect(data).toMatchObject({ bookingId: 'clsbk_1', seatsBooked: 3, seatsRequested: 3 })
      expect(mockSaveSeatChoices.mock.calls[0][0]).toMatchObject({ seats: 3, squareBookingIds: ['clsbk_1', 'clsbk_2', 'clsbk_3'] })
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('adds up what Square charged for every seat', async () => {
      mockPay.mockImplementation(async ({ reservation }: any) => ({ bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null, totalChargedCents: 4360 }))
      const { data } = await (await POST(ctx(body({ seats: 2 })))).json()
      expect(data.totalChargedCents).toBe(8720)
      expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ seats: 2, totalChargedCents: 8720 })
    })

    it('a 1-seat booking makes no guest and takes the older single token too', async () => {
      const res = await POST(ctx(body({ seats: 1, paymentTokens: undefined, paymentToken: 'cnon:only' })))
      expect(res.status).toBe(200)
      expect(mockCreateGuest).not.toHaveBeenCalled()
      expect(mockReserve).toHaveBeenCalledTimes(1)
      expect(mockPay.mock.calls[0][0].paymentToken).toBe('cnon:only')
    })

    for (const [why, tokens] of [
      ['one token for two seats', ['cnon:a']],
      ['the same token twice (a token pays once)', ['cnon:a', 'cnon:a']],
      ['three tokens for two seats', ['cnon:a', 'cnon:b', 'cnon:c']],
      ['an empty token', ['cnon:a', '']],
    ] as const) {
      it(`refuses ${why}: nothing held, nothing charged`, async () => {
        const res = await POST(ctx(body({ seats: 2, paymentTokens: tokens })))
        expect(res.status).toBe(400)
        expect((await res.json()).detail).toBe('We couldn’t set up a payment for every seat. Nothing was charged. Please try again.')
        expect(mockReserve).not.toHaveBeenCalled()
        expect(mockPay).not.toHaveBeenCalled()
        expect(mockCreateGuest).not.toHaveBeenCalled()
      })
    }

    it('tells an out-of-date page (one token for several seats) to reload, charging nothing', async () => {
      const res = await POST(ctx(body({ seats: 2, paymentTokens: undefined, paymentToken: 'cnon:x' })))
      expect(res.status).toBe(400)
      expect((await res.json()).detail).toBe('This page is out of date. Reload it and book again. Nothing was charged.')
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
    })

    it('says Google Pay covers one seat at a time', async () => {
      const res = await POST(ctx(body({ seats: 2, paymentTokens: undefined, paymentToken: 'wallet:x', sourceKind: 'wallet' })))
      expect(res.status).toBe(400)
      expect((await res.json()).detail).toBe('Google Pay covers one seat at a time. For more seats, pay with a card. Nothing was charged.')
      expect(mockReserve).not.toHaveBeenCalled()
    })

    it('charges nothing when a later seat can’t be held, and lets the held ones go', async () => {
      let n = 0
      mockReserve.mockImplementation(async () => {
        n++
        if (n === 2) throw Object.assign(new Error('full'), { name: 'SeatBookingError', kind: 'refused', phase: 'reserve', raw: 'capacity reached', status: 400 })
        return { bookingId: `clsbk_${n}`, contactToken: null, orderId: `order-${n}` }
      })
      const res = await POST(ctx(body({ seats: 3 })))
      expect(res.status).toBe(409)
      expect(mockPay).not.toHaveBeenCalled()
      expect(mockRelease).toHaveBeenCalledWith('clsbk_1')
    })

    it('charges nothing when a guest record can’t be made', async () => {
      mockCreateGuest.mockRejectedValue(new Error('customers down'))
      const res = await POST(ctx(body({ seats: 2 })))
      expect(res.status).toBe(502)
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
    })

    it('seat 1 declined: nothing charged, every hold let go', async () => {
      mockPay.mockRejectedValue(Object.assign(new Error('declined'), { name: 'SeatBookingError', kind: 'refused', phase: 'pay', raw: 'CARD_DECLINED', status: 402 }))
      const res = await POST(ctx(body({ seats: 3 })))
      expect(res.status).toBe(402)
      expect(mockPay).toHaveBeenCalledTimes(1)
      expect(mockRelease.mock.calls.map((c) => c[0]).sort()).toEqual(['clsbk_1', 'clsbk_2', 'clsbk_3'])
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('a later seat declined: the paid seats stand, that one is let go, the owners told, the customer sees how many', async () => {
      mockPay.mockImplementation(async ({ reservation }: any) => {
        if (reservation.bookingId === 'clsbk_3') throw Object.assign(new Error('declined'), { name: 'SeatBookingError', kind: 'refused', phase: 'pay', raw: 'CARD_DECLINED', status: 402 })
        return { bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null, totalChargedCents: 4360 }
      })
      const res = await POST(ctx(body({ seats: 4, picks: undefined })))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toMatchObject({ seatsBooked: 3, seatsRequested: 4, totalChargedCents: 13080 })
      expect(mockPay).toHaveBeenCalledTimes(4)
      expect(mockRelease.mock.calls.map((c) => c[0])).toEqual(['clsbk_3'])
      expect(mockSaveSeatChoices.mock.calls[0][0]).toMatchObject({ seats: 3, squareBookingIds: ['clsbk_1', 'clsbk_2', 'clsbk_4'] })
      expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ seats: 3 })
      const partly = mockAlertOwners.mock.calls.map((c) => c[0]).find((t: string) => t.startsWith('Partly booked'))
      expect(partly).toMatch(/asked for 4 seats in Kinusaiga, .*\. 3 paid and booked\. Seat 3 declined: not booked, not charged\. They were told on screen\.$/)
    })

    it('a later seat with no answer: keeps that seat’s hold for a person to check, and says which booking', async () => {
      mockPay.mockImplementation(async ({ reservation }: any) => {
        if (reservation.bookingId === 'clsbk_2') throw Object.assign(new Error('timeout'), { name: 'SeatBookingError', kind: 'no_answer', phase: 'pay', raw: 'timeout' })
        return { bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null }
      })
      const res = await POST(ctx(body({ seats: 3, picks: undefined })))
      expect(res.status).toBe(200)
      expect((await res.json()).data).toMatchObject({ seatsBooked: 2, seatsRequested: 3 })
      expect(mockRelease).not.toHaveBeenCalled()
      const partly = mockAlertOwners.mock.calls.map((c) => c[0]).find((t: string) => t.startsWith('Partly booked'))
      expect(partly).toMatch(/2 paid and booked\. Seat 2: payment unclear\. Check Square \(booking clsbk_2\)\./)
    })

    it('every seat 2+ declined after seat 1 paid: one seat booked, the rest let go', async () => {
      mockPay.mockImplementation(async ({ reservation }: any) => {
        if (reservation.bookingId !== 'clsbk_1') throw Object.assign(new Error('declined'), { name: 'SeatBookingError', kind: 'refused', phase: 'pay', raw: 'CARD_DECLINED', status: 402 })
        return { bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null }
      })
      const { data } = await (await POST(ctx(body({ seats: 3, picks: undefined })))).json()
      expect(data).toMatchObject({ seatsBooked: 1, seatsRequested: 3 })
      expect(mockRelease.mock.calls.map((c) => c[0]).sort()).toEqual(['clsbk_2', 'clsbk_3'])
    })

    it('only the paid seats’ picks are kept', async () => {
      mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null })
      mockPay.mockImplementation(async ({ reservation }: any) => {
        if (reservation.bookingId === 'clsbk_2') throw Object.assign(new Error('declined'), { name: 'SeatBookingError', kind: 'refused', phase: 'pay', raw: 'CARD_DECLINED', status: 402 })
        return { bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null }
      })
      await POST(ctx(body({ seats: 2, picks: TWO_PICKS })))
      expect(mockSaveSeatChoices.mock.calls[0][0].picks).toEqual([TWO_PICKS[0]])
    })

    it('a paid seat after a declined one keeps its pick, renumbered', async () => {
      mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null })
      mockPay.mockImplementation(async ({ reservation }: any) => {
        if (reservation.bookingId === 'clsbk_2') throw Object.assign(new Error('declined'), { name: 'SeatBookingError', kind: 'refused', phase: 'pay', raw: 'CARD_DECLINED', status: 402 })
        return { bookingId: reservation.bookingId, orderId: null, status: 'accepted', receiptUrl: null }
      })
      const three = [...TWO_PICKS, { seat: 3, optionId: 'pumpkin-color', choice: 'Light Pink' }]
      await POST(ctx(body({ seats: 3, picks: three })))
      expect(mockSaveSeatChoices.mock.calls[0][0].picks).toEqual([TWO_PICKS[0], { seat: 2, optionId: 'pumpkin-color', choice: 'Light Pink' }])
    })
  })

  it('refuses a gift card outright: 400, no seats held', async () => {
    const res = await POST(ctx(body({ sourceKind: 'gift_card', paymentToken: 'cnon:gift' })))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('invalid')
    expect(json.detail).toMatch(/^Gift cards can’t be used for class seats/)
    expect(mockReserve).not.toHaveBeenCalled()
    expect(mockPay).not.toHaveBeenCalled()
  })

  describe('a booking that goes through', () => {
    it('holds each seat, charges each once, and confirms', async () => {
      const res = await POST(ctx(body()))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toMatchObject({ bookingId: 'clsbk_1', status: 'accepted', receiptUrl: 'https://squareup.com/receipt/1', emailSent: true })
      expect(mockReserve).toHaveBeenNthCalledWith(1, {
        scheduleId: 'clssch_kinusaiga',
        startAt: START,
        seats: 1,
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' },
      })
      expect(mockPay).toHaveBeenCalledTimes(2)
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('texts the owners that someone booked (both phones are in OWNER_ALERT_NUMBERS)', async () => {
      await POST(ctx(body()))
      expect(mockAlertOwners).toHaveBeenCalledWith(expect.stringMatching(/^New class booking: Ada Lovelace, 2 seats, /))
    })

    it('charges under a key made from the attempt ID, the same on every retry', async () => {
      await POST(ctx(body()))
      await POST(ctx(body()))
      // Two seats per try: seat 1 then seat 2, the same keys on the retry.
      expect(mockPay.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([`${ATTEMPT}:pay`, `${ATTEMPT}:pay-2`, `${ATTEMPT}:pay`, `${ATTEMPT}:pay-2`])
    })

    it('uses a key of its own when the browser sends no usable attempt ID', async () => {
      await POST(ctx(body({ attemptId: 'not-an-id' })))
      expect(mockPay.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}:pay$/)
    })

    it('keeps the phone number on the customer record when one is given', async () => {
      await POST(ctx(body()))
      expect(mockFindOrCreate).toHaveBeenCalledWith({ email: 'ada@example.com', givenName: 'Ada', familyName: 'Lovelace', phone: '(256) 555-0123' })
    })

    it('still books when the customer record cannot be reached', async () => {
      mockFindOrCreate.mockRejectedValue(new Error('Square 503'))
      const res = await POST(ctx(body()))
      expect(res.status).toBe(200)
    })
  })

  describe('the confirmation email', () => {
    it('carries when, where, seats, the amount, the agreement and a calendar file', async () => {
      await POST(ctx(body()))
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      const mail = mockSendEmail.mock.calls[0][0]
      expect(mail.to).toBe('ada@example.com')
      expect(mail.firstName).toBe('Ada')
      expect(mail.workshopName).toBe('Kinusaiga')
      expect(mail.whenLabel).toBe('Fri, Oct 16 · 7:00 PM CT')
      expect(mail.timeRange).toBe('7 – 9 PM')
      expect(mail.seats).toBe(2)
      expect(mail.totalChargedCents).toBe(8000)
      expect(mail.waiverUrl).toBe('https://ourhometownstudio.com/waiver?workshop=clssch_kinusaiga&booking=clsbk_1&utm_source=email&utm_medium=email&utm_campaign=workshop_confirmation')
      expect(mail.workshopUrl).toBe('https://ourhometownstudio.com/workshops?w=clsschi_kinusaiga&utm_source=friend&utm_medium=referral&utm_campaign=workshop_share')
      expect(mail.policyLine).toMatch(/48\+ hours/)
      expect(mail.policyUrl).toBe('https://ourhometownstudio.com/policies#workshops')
      expect(mail.summary).toBe('Kinusaiga is Japanese fabric art with no sewing.')
      expect(mail.icsContent).toContain('BEGIN:VCALENDAR')
      expect(mail.icsContent).toContain('DTSTART:20261017T000000Z')
      expect(mail.icsContent).toContain('DTEND:20261017T020000Z')
      expect(mail.googleCalendarUrl).toContain('calendar.google.com')
    })

    it('reports honestly when the email was not sent', async () => {
      mockSendEmail.mockResolvedValue({ sent: false })
      const res = await POST(ctx(body()))
      expect(res.status).toBe(200)
      expect((await res.json()).data.emailSent).toBe(false)
    })

    it('never turns a paid booking into a failure', async () => {
      mockSendEmail.mockRejectedValue(new Error('SMTP down'))
      const res = await POST(ctx(body()))
      expect(res.status).toBe(200)
      expect((await res.json()).data).toMatchObject({ bookingId: 'clsbk_1', emailSent: false })
    })

    it('finds the workshop by schedule and start when the id is missing', async () => {
      mockGetWorkshop.mockResolvedValue(null)
      const res = await POST(ctx(body({ workshopId: undefined })))
      expect((await res.json()).data.emailSent).toBe(true)
      expect(mockSendEmail.mock.calls[0][0].workshopName).toBe('Kinusaiga')
    })
  })

  describe('a workshop that is not for sale', () => {
    async function refused(res: Response, code: string) {
      const json = await res.json()
      expect(json.code).toBe(code)
      expect(json.detail).not.toMatch(TECHNICAL)
      // Nothing held, nothing charged, nobody told it went through.
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
      expect(mockSendEmail).not.toHaveBeenCalled()
      return json
    }

    it('refuses a workshop with a price of zero: there are no free workshops', async () => {
      mockGetWorkshop.mockResolvedValue({ ...workshop, priceCents: 0 })
      const res = await POST(ctx(body()))
      expect(res.status).toBe(409)
      const json = await refused(res, 'not_open')
      expect(json.detail).toMatch(/isn’t open for booking yet/)
      expect(json.detail).toMatch(/nothing was charged/i)
    })

    it.each([
      ['no price at all', undefined],
      ['a price that is not a number', 'free'],
      ['a negative price', -500],
    ])('refuses a workshop with %s', async (_name, priceCents) => {
      mockGetWorkshop.mockResolvedValue({ ...workshop, priceCents })
      await refused(await POST(ctx(body())), 'not_open')
    })

    it('refuses when the workshop cannot be found, because it cannot check the price', async () => {
      mockGetWorkshop.mockResolvedValue(null)
      mockListWorkshops.mockResolvedValue([])
      const res = await POST(ctx(body()))
      expect(res.status).toBe(502)
      await refused(res, 'unavailable')
    })

    it('refuses when the lookup itself fails', async () => {
      mockGetWorkshop.mockRejectedValue(new Error('Square Classes API error: 503'))
      const res = await POST(ctx(body()))
      expect(res.status).toBe(502)
      await refused(res, 'unavailable')
    })

    it('does not trust the id it was sent: the schedule must match too', async () => {
      // A priced workshop's id, sent with another class's schedule.
      mockGetWorkshop.mockResolvedValue(workshop)
      mockListWorkshops.mockResolvedValue([{ ...workshop, id: 'other', scheduleId: 'clssch_free', priceCents: 0 }])
      const res = await POST(ctx(body({ classScheduleId: 'clssch_free' })))
      await refused(res, 'not_open')
    })
  })

  describe('when the seats cannot be held', () => {
    it('says the last seat was taken', async () => {
      mockReserve.mockRejectedValue(new SeatBookingError('square', 'reserve', 'refused', '{"errors":[{"detail":"Not enough seats available"}]}', 400))
      const res = await POST(ctx(body()))
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.code).toBe('sold_out')
      expect(json.detail).toBe('The last seat was just taken. Nothing was charged.')
      expect(mockPay).not.toHaveBeenCalled()
    })

    it('tells someone who already has a seat, without saying "not charged"', async () => {
      mockReserve.mockRejectedValue(new SeatBookingError('square', 'reserve', 'refused', 'Customer has already booked this class', 400))
      const json = await (await POST(ctx(body()))).json()
      expect(json.code).toBe('already_booked')
      expect(json.detail).not.toMatch(/not charged|nothing was charged/i)
      expect(mockPay).not.toHaveBeenCalled()
    })

    it('never shows what the booking service said', async () => {
      mockReserve.mockRejectedValue(new SeatBookingError('square', 'reserve', 'refused', '<html>502 Bad Gateway</html>', 502))
      const json = await (await POST(ctx(body()))).json()
      expect(json.code).toBe('unavailable')
      expect(json.detail).not.toMatch(TECHNICAL)
      expect(JSON.stringify(json)).not.toContain('Bad Gateway')
    })
  })

  describe('when the card is refused', () => {
    beforeEach(() => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'refused', '{"errors":[{"detail":"Could not charge given payment source"}]}', 400))
    })

    it('says so plainly', async () => {
      const res = await POST(ctx(body()))
      expect(res.status).toBe(402)
      const json = await res.json()
      expect(json.code).toBe('card_declined')
      expect(json.detail).toBe('Your card was declined. Nothing was charged. Try another card.')
      expect(JSON.stringify(json)).not.toContain('payment source')
    })

    it('lets the held seats go', async () => {
      await POST(ctx(body()))
      expect(mockRelease).toHaveBeenCalledWith('clsbk_1')
    })

    it('still answers the customer when the seats could not be released', async () => {
      mockRelease.mockRejectedValue(new Error('Seat release refused: 500'))
      const res = await POST(ctx(body()))
      expect(res.status).toBe(402)
      expect((await res.json()).code).toBe('card_declined')
    })

    it('does not alert the owners or send an email', async () => {
      await POST(ctx(body()))
      expect(mockAlertOwners.mock.calls.filter(([m]: any[]) => !String(m).startsWith('New '))).toEqual([])
      expect(mockSendEmail).not.toHaveBeenCalled()
    })
  })

  describe('when the charge gets no answer', () => {
    beforeEach(() => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'no_answer', 'fetch failed'))
    })

    it('says it is not sure, and never "not charged"', async () => {
      const res = await POST(ctx(body()))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json.code).toBe('unknown_outcome')
      expect(json.detail).toMatch(/not sure/i)
      expect(json.detail).toContain('(256) 464-1710')
      expect(json.detail).not.toMatch(/not charged|nothing was charged/i)
      expect(json.detail).not.toMatch(TECHNICAL)
    })

    it('keeps the seats, because the customer may have paid', async () => {
      await POST(ctx(body()))
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('tells the owners who, what and which booking', async () => {
      await POST(ctx(body()))
      expect(mockAlertOwners).toHaveBeenCalledTimes(1)
      const text = mockAlertOwners.mock.calls[0][0]
      expect(text).toContain('Ada Lovelace')
      expect(text).toContain('ada@example.com')
      expect(text).toContain('2 seats')
      expect(text).toContain('clsbk_1')
    })

    it('treats the service failing mid-charge the same way', async () => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'no_answer', 'Internal Server Error', 500))
      const json = await (await POST(ctx(body()))).json()
      expect(json.code).toBe('unknown_outcome')
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('treats an error it does not recognise the same way', async () => {
      mockPay.mockRejectedValue(new TypeError('Cannot read properties of undefined'))
      const json = await (await POST(ctx(body()))).json()
      expect(json.code).toBe('unknown_outcome')
      expect(json.detail).not.toMatch(/undefined|Cannot read/)
      expect(mockRelease).not.toHaveBeenCalled()
    })
  })

  describe('what it refuses before doing anything', () => {
    const cases: [string, any][] = [
      ['a body that is not JSON', '{nope'],
      ['no workshop', body({ classScheduleId: '' })],
      ['a start time that is not one', body({ startAt: 'soon' })],
      ['no payment', body({ paymentTokens: undefined, paymentToken: '' })],
      ['no last name', body({ customer: { givenName: 'Ada', familyName: '', email: 'ada@example.com' } })],
      ['no phone', body({ customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' } })],
      ['a phone that is too short', body({ customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '555-0123' } })],
      ['a bad email', body({ customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@' } })],
      ['no seats', body({ seats: 0 })],
      ['half a seat', body({ seats: 1.5 })],
    ]
    for (const [name, payload] of cases) {
      it(name, async () => {
        const res = await POST(ctx(payload))
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('invalid')
        expect(mockReserve).not.toHaveBeenCalled()
        expect(mockPay).not.toHaveBeenCalled()
      })
    }

    it('more seats than one booking can hold, with a way forward', async () => {
      const res = await POST(ctx(body({ seats: 21 })))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.detail).toMatch(/up to 20 seats/)
      expect(json.detail).toMatch(/private party/)
      expect(mockReserve).not.toHaveBeenCalled()
    })

    it('exactly the most seats is fine', async () => {
      const res = await POST(ctx(body({ seats: 20 })))
      expect(res.status).toBe(200)
      expect(mockReserve).toHaveBeenCalledTimes(20)
      expect(mockPay).toHaveBeenCalledTimes(20)
    })
  })

  describe('sign-up cutoff and seat picks', () => {
    const withPails = () => mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null })

    async function refusedBeforeHold(res: Response, status: number, code: string, detail: string) {
      expect(res.status).toBe(status)
      expect(await res.json()).toMatchObject({ code, detail })
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
    }

    it('refuses after the class’s own cutoff, before holding anything', async () => {
      mockGetEventMeta.mockResolvedValue({ options: [], signupCutoffHours: 48 })
      vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z')) // 36 h before
      await refusedBeforeHold(await POST(ctx(body())), 409, 'not_open', 'Sign-ups for this class closed 48 hours before it starts.')
    })

    it('a class with questions closes 24 hours ahead by default', async () => {
      withPails()
      vi.setSystemTime(new Date('2026-10-16T01:00:00.000Z')) // 23 h before
      await refusedBeforeHold(await POST(ctx(body({ picks: TWO_PICKS }))), 409, 'not_open', 'Sign-ups for this class closed 24 hours before it starts.')
    })

    it('a plain class can still be booked half an hour before', async () => {
      vi.setSystemTime(new Date('2026-10-16T23:30:00.000Z'))
      expect((await POST(ctx(body()))).status).toBe(200)
    })

    it('refuses a seat with no pick, naming the seat', async () => {
      withPails()
      await refusedBeforeHold(await POST(ctx(body({ picks: [TWO_PICKS[0]] }))), 400, 'invalid', 'Pick a pumpkin color for seat 2.')
    })

    it('refuses a choice the class does not offer', async () => {
      withPails()
      const picks = [TWO_PICKS[0], { seat: 2, optionId: 'pumpkin-color', choice: 'Orange' }]
      await refusedBeforeHold(await POST(ctx(body({ picks }))), 400, 'invalid', 'Seat 2: “Orange” isn’t one of the pumpkin color choices.')
    })

    it('refuses picks for a class with no questions', async () => {
      await refusedBeforeHold(await POST(ctx(body({ picks: TWO_PICKS }))), 400, 'invalid', 'This class has nothing to pick. Refresh and try again.')
    })

    it('refuses when the class’s settings cannot be read: seats are never sold without their picks', async () => {
      mockGetEventMeta.mockRejectedValue(new Error('blobs down'))
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(502)
      expect((await res.json()).code).toBe('unavailable')
      expect(mockReserve).not.toHaveBeenCalled()
    })

    it('holds the seats with the picks as Square’s booking note', async () => {
      withPails()
      expect((await POST(ctx(body({ picks: TWO_PICKS })))).status).toBe(200)
      expect(mockGetEventMeta).toHaveBeenCalledWith('workshop', 'clssch_kinusaiga')
      // The note goes on seat 1's booking only (it covers every seat).
      expect(mockReserve).toHaveBeenNthCalledWith(1, {
        scheduleId: 'clssch_kinusaiga',
        startAt: START,
        seats: 1,
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' },
        note: 'Pumpkin color: Black ×1, Lavender ×1',
      })
      expect(mockReserve.mock.calls[1][0].note).toBeUndefined()
    })
  })

  describe('the picks, once paid', () => {
    beforeEach(() => mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null }))

    it('stores each seat’s pick after the charge has gone through', async () => {
      expect((await POST(ctx(body({ picks: TWO_PICKS })))).status).toBe(200)
      expect(mockSaveSeatChoices).toHaveBeenCalledWith({
        eventKind: 'workshop',
        eventId: 'clssch_kinusaiga',
        bookingId: 'clsbk_1',
        orderId: 'order-1',
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' },
        seats: 2,
        picks: TWO_PICKS,
        at: '2026-10-10T17:00:00.000Z',
        attemptId: ATTEMPT,
        squareBookingIds: ['clsbk_1', 'clsbk_2'],
      })
      expect(mockSaveSeatChoices.mock.invocationCallOrder[0]).toBeGreaterThan(mockPay.mock.invocationCallOrder[0])
    })

    it('puts the picks in the confirmation email', async () => {
      await POST(ctx(body({ picks: TWO_PICKS })))
      const mail = mockSendEmail.mock.calls[0][0]
      expect(mail.pickLines).toEqual(['Seat 1 · Pumpkin color: Lavender', 'Seat 2 · Pumpkin color: Black'])
      expect(mail.picksFinalLine).toBe('Picks are made ahead for you, so they can’t be changed after you book.')
    })

    it('leaves picks out of the email for a class with no questions', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      await POST(ctx(body()))
      expect(mockSendEmail.mock.calls[0][0]).not.toHaveProperty('pickLines')
    })

    it('stores nothing when the card is refused', async () => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'refused', '{"errors":[{"code":"CARD_DECLINED"}]}', 400))
      await POST(ctx(body({ picks: TWO_PICKS })))
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('still records the seats for a class with no questions (the roster compares seats with crafters)', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      await POST(ctx(body()))
      expect(mockSaveSeatChoices).toHaveBeenCalledTimes(1)
      expect(mockSaveSeatChoices.mock.calls[0][0]).toMatchObject({ picks: [] })
    })

    it('a failed save with no picks fails nothing and alerts no one', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      mockSaveSeatChoices.mockRejectedValue(new Error('blobs down'))
      expect((await POST(ctx(body()))).status).toBe(200)
      expect(mockAlertOwners.mock.calls.filter(([m]: any[]) => !String(m).startsWith('New '))).toEqual([])
    })

    it('a failed save never fails a paid booking, and the owners are told', async () => {
      mockSaveSeatChoices.mockRejectedValue(new Error('blobs down'))
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(200)
      expect(mockAlertOwners).toHaveBeenCalledWith(expect.stringContaining('Seat picks not saved: Ada Lovelace'))
      expect(mockAlertOwners.mock.calls[0][0]).toContain('Pumpkin color: Black ×1, Lavender ×1')
    })

    it('the save-failure alert never promises the picks are in a Square note', async () => {
      mockSaveSeatChoices.mockRejectedValue(new Error('blobs down'))
      await POST(ctx(body({ picks: TWO_PICKS })))
      expect(mockAlertOwners.mock.calls[0][0]).not.toMatch(/Square note/i)
    })

    it('an unclear charge alert carries the picks, so they exist somewhere', async () => {
      mockPay.mockRejectedValue(new SeatBookingError('square', 'pay', 'no_answer', 'fetch failed'))
      await POST(ctx(body({ picks: TWO_PICKS })))
      expect(mockAlertOwners).toHaveBeenCalledTimes(1)
      expect(mockAlertOwners.mock.calls[0][0]).toContain('Pumpkin color: Black ×1, Lavender ×1')
    })
  })

  describe('with simulated payments on (dev / preview)', () => {
    beforeEach(() => {
      bypassOn = true
      mockGetEventMeta.mockResolvedValue({ options: [PAILS], signupCutoffHours: null })
    })

    it('still refuses a booking past the sign-up cutoff', async () => {
      mockGetEventMeta.mockResolvedValue({ options: [], signupCutoffHours: 24 * 30 })
      const res = await POST(ctx(body()))
      expect(res.status).toBe(409)
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('still refuses missing or invalid picks', async () => {
      const res = await POST(ctx(body()))
      expect(res.status).toBe(400)
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('books without holding or charging, then saves picks and sends the email', async () => {
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toMatchObject({ bookingId: `bypass-${ATTEMPT}`, orderId: null, status: 'accepted', receiptUrl: null, emailSent: true })
      expect(mockReserve).not.toHaveBeenCalled()
      expect(mockPay).not.toHaveBeenCalled()
      expect(mockFindOrCreate).not.toHaveBeenCalled()
      expect(mockSaveSeatChoices).toHaveBeenCalledWith(expect.objectContaining({ bookingId: `bypass-${ATTEMPT}`, orderId: null, simulated: true }))
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
    })
  })

  it('slows down someone hammering the endpoint', async () => {
    const same = () => ({ ...ctx(body()), clientAddress: '198.51.100.77' })
    for (let i = 0; i < 5; i++) expect((await POST(same())).status).toBe(200)
    const blocked = await POST(same())
    expect(blocked.status).toBe(429)
    expect((await blocked.json()).detail).not.toMatch(TECHNICAL)
  })
})

