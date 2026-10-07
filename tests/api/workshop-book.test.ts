import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SeatBookingError } from '@lib/errors'

const mockFindOrCreate = vi.fn()
const mockReserve = vi.fn()
const mockPay = vi.fn()
const mockRelease = vi.fn()
const mockGetWorkshop = vi.fn()
const mockListWorkshops = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    customer: { findOrCreate: (...a: any[]) => mockFindOrCreate(...a) },
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
  return {
    attemptId: ATTEMPT,
    workshopId: workshop.id,
    classScheduleId: workshop.scheduleId,
    startAt: START,
    seats: 2,
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' },
    paymentToken: 'cnon:card-ok',
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
  vi.clearAllMocks()
  vi.resetModules()
  mockGetEventMeta.mockResolvedValue(null)
  mockFindOrCreate.mockResolvedValue({ id: 'cust-1' })
  mockReserve.mockResolvedValue({ bookingId: 'clsbk_1', contactToken: 'contact-1', orderId: 'order-1' })
  mockPay.mockResolvedValue({ bookingId: 'clsbk_1', orderId: 'order-1', status: 'accepted', receiptUrl: 'https://squareup.com/receipt/1' })
  mockRelease.mockResolvedValue(undefined)
  mockGetWorkshop.mockResolvedValue(workshop)
  mockListWorkshops.mockResolvedValue([workshop])
  mockAlertOwners.mockResolvedValue({ attempted: 2, sent: 2 })
  mockSendEmail.mockResolvedValue({ sent: true })
  mockSaveSeatChoices.mockResolvedValue(undefined)
  POST = (await import('@pages/api/workshops/book.json')).POST
})
afterEach(() => vi.useRealTimers())

describe('POST /api/workshops/book.json', () => {
  describe('a booking that goes through', () => {
    it('holds the seats, charges once, and confirms', async () => {
      const res = await POST(ctx(body()))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toMatchObject({ bookingId: 'clsbk_1', status: 'accepted', receiptUrl: 'https://squareup.com/receipt/1', emailSent: true })
      expect(mockReserve).toHaveBeenCalledWith({
        scheduleId: 'clssch_kinusaiga',
        startAt: START,
        seats: 2,
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' },
      })
      expect(mockPay).toHaveBeenCalledTimes(1)
      expect(mockRelease).not.toHaveBeenCalled()
    })

    it('charges under a key made from the attempt ID, the same on every retry', async () => {
      await POST(ctx(body()))
      await POST(ctx(body()))
      expect(mockPay.mock.calls[0][0].idempotencyKey).toBe(`${ATTEMPT}:pay`)
      expect(mockPay.mock.calls[1][0].idempotencyKey).toBe(`${ATTEMPT}:pay`)
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
      expect(mail.waiverUrl).toBe('https://ourhometownstudio.com/waiver?workshop=clsbk_1')
      expect(mail.workshopUrl).toBe('https://ourhometownstudio.com/workshops?w=clsschi_kinusaiga')
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
      expect(mockAlertOwners).not.toHaveBeenCalled()
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
      ['no payment', body({ paymentToken: '' })],
      ['no last name', body({ customer: { givenName: 'Ada', familyName: '', email: 'ada@example.com' } })],
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
      expect(mockReserve.mock.calls[0][0].seats).toBe(20)
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
      expect(mockReserve).toHaveBeenCalledWith({
        scheduleId: 'clssch_kinusaiga',
        startAt: START,
        seats: 2,
        customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com' },
        note: 'Pumpkin color: Black ×1, Lavender ×1',
      })
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

    it('stores nothing for a class with no questions', async () => {
      mockGetEventMeta.mockResolvedValue(null)
      await POST(ctx(body()))
      expect(mockSaveSeatChoices).not.toHaveBeenCalled()
    })

    it('a failed save never fails a paid booking, and the owners are told', async () => {
      mockSaveSeatChoices.mockRejectedValue(new Error('blobs down'))
      const res = await POST(ctx(body({ picks: TWO_PICKS })))
      expect(res.status).toBe(200)
      expect(mockAlertOwners).toHaveBeenCalledWith(expect.stringContaining('Seat picks not saved: Ada Lovelace'))
      expect(mockAlertOwners.mock.calls[0][0]).toContain('Pumpkin color: Black ×1, Lavender ×1')
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
