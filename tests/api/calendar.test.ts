import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mutable provider spies (reset in beforeEach) ---
const mockListWorkshops = vi.fn()
const mockGetEventTypes = vi.fn()
const mockListBookings = vi.fn()

const PARTY_VARIATION_ID = 'party-variation-1'

vi.mock('@config/providers', () => ({
  providers: {
    workshop: { listWorkshops: (...args: any[]) => mockListWorkshops(...args) },
    catalog: { getEventTypes: (...args: any[]) => mockGetEventTypes(...args) },
    booking: { listBookings: (...args: any[]) => mockListBookings(...args) },
  },
}))

vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({
    catalog: {
      object: {
        get: async () => ({ object: { itemData: { variations: [{ id: PARTY_VARIATION_ID }] } } }),
      },
    },
  }),
}))

// Pin the opening date so these fixed autumn-2026 dates stay "after opening"
// even when the real date moves.
vi.mock('@config/opening', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@config/opening')>()),
  OPENING_DATE: '2026-10-16',
}))

import { GET } from '@pages/api/calendar.json'
import { forgetAll } from '@lib/short-memory'

// Pins the normal weekly rules; one-off party days are in party-date-overrides.test.ts.
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../src/config/party.config')>()), partyDateOverrides: {} }))


function workshop(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    scheduleId: 's1',
    name: 'Fall Earring Bar',
    description: '',
    descriptionHtml: '',
    startAt: '2026-10-24T00:00:00.000Z', // 7 PM CDT on Fri Oct 23
    durationMinutes: 120,
    priceCents: 3500,
    priceCurrency: 'USD',
    availableCapacity: 6,
    staffName: '',
    teamMemberId: '',
    ...over,
  }
}

function booking(startAt: string, over: Record<string, unknown> = {}) {
  return { status: 'confirmed', slot: { startAt, serviceVariationId: PARTY_VARIATION_ID }, ...over }
}

async function getMonth(month: string | null) {
  const url = new URL(`http://localhost/api/calendar.json${month === null ? '' : `?month=${month}`}`)
  const request = new Request(url)
  const response = await GET({ request, url, params: {}, redirect: () => new Response(), locals: {} } as any)
  return { response, body: await response.json() }
}

const ids = (body: any): string[] => body.events.map((e: any) => e.id)

describe('GET /api/calendar.json', () => {
  beforeEach(() => {
    // Only Date is faked: the handler awaits real promises.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T17:00:00.000Z'))
    forgetAll()
    mockListWorkshops.mockReset().mockResolvedValue([])
    mockGetEventTypes.mockReset().mockResolvedValue([])
    mockListBookings.mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a missing or malformed month', async () => {
    expect((await getMonth(null)).response.status).toBe(400)
    expect((await getMonth('2026-1')).response.status).toBe(400)
  })

  it('returns price, currency, end time and remaining seats for a workshop', async () => {
    mockListWorkshops.mockResolvedValue([workshop()])
    const { response, body } = await getMonth('2026-10')
    expect(response.status).toBe(200)
    const w = body.events.find((e: any) => e.id === 'workshop-w1')
    expect(w).toMatchObject({
      kind: 'workshop',
      title: 'Fall Earring Bar',
      date: '2026-10-23',
      startTime: '19:00',
      endTime: '21:00',
      price: 3500,
      currency: 'USD',
      remainingSeats: 6,
      bookable: true,
      href: '/workshops?w=w1',
    })
  })

  describe('month membership is decided by the studio-local date (HOM-191)', () => {
    // 7:00 PM CDT on Sat 31 Oct 2026 is already 1 Nov in UTC.
    const HALLOWEEN_7PM = '2026-11-01T00:00:00.000Z'
    // After the 1 Nov clock change Central is UTC-6: 6:00 PM CST on Mon 30 Nov
    // 2026 is already 1 Dec in UTC.
    const NOV30_6PM = '2026-12-01T00:00:00.000Z'

    it('puts a 7 PM workshop on 31 Oct in October, not November', async () => {
      mockListWorkshops.mockResolvedValue([workshop({ id: 'halloween', startAt: HALLOWEEN_7PM })])

      const october = await getMonth('2026-10')
      const w = october.body.events.find((e: any) => e.id === 'workshop-halloween')
      expect(w).toMatchObject({ date: '2026-10-31', startTime: '19:00', endTime: '21:00' })

      const november = await getMonth('2026-11')
      expect(ids(november.body)).not.toContain('workshop-halloween')
    })

    it('puts a 6 PM workshop on 30 Nov in November, not December', async () => {
      mockListWorkshops.mockResolvedValue([workshop({ id: 'nov30', startAt: NOV30_6PM })])

      const november = await getMonth('2026-11')
      const w = november.body.events.find((e: any) => e.id === 'workshop-nov30')
      expect(w).toMatchObject({ date: '2026-11-30', startTime: '18:00', endTime: '20:00' })

      const december = await getMonth('2026-12')
      expect(ids(december.body)).not.toContain('workshop-nov30')
    })

    it('keeps a late-evening workshop on the 1st out of the previous month', async () => {
      // 9:00 PM CDT on Thu 1 Oct... is before opening, so use 1 Nov: 9 PM CST = 03:00Z on 2 Nov.
      mockListWorkshops.mockResolvedValue([workshop({ id: 'nov1', startAt: '2026-11-02T03:00:00.000Z' })])
      expect(ids((await getMonth('2026-11')).body)).toContain('workshop-nov1')
      expect(ids((await getMonth('2026-10')).body)).not.toContain('workshop-nov1')
    })

    it('never returns an event dated outside the requested month', async () => {
      mockListWorkshops.mockResolvedValue([
        workshop({ id: 'a', startAt: HALLOWEEN_7PM }),
        workshop({ id: 'b', startAt: NOV30_6PM }),
        workshop({ id: 'c', startAt: '2026-11-14T01:00:00.000Z' }),
      ])
      mockListBookings.mockResolvedValue([booking(HALLOWEEN_7PM), booking(NOV30_6PM)])
      mockGetEventTypes.mockResolvedValue([
        { id: 'studio', flow: 'display', programDates: '2026-10-31T16:00-21:00,2026-12-03T16:00-21:00' },
      ])
      for (const month of ['2026-10', '2026-11', '2026-12']) {
        const { body } = await getMonth(month)
        for (const e of body.events) expect(e.date.startsWith(month)).toBe(true)
      }
    })

    it('asks for bookings across the whole studio-local month', async () => {
      await getMonth('2026-10')
      const october = mockListBookings.mock.calls[0][0]
      // Midnight CDT on 1 Oct → the last instant before midnight CDT on 1 Nov.
      expect(october.startDate).toBe('2026-10-01T05:00:00.000Z')
      expect(october.endDate).toBe('2026-11-01T04:59:59.999Z')

      mockListBookings.mockClear()
      await getMonth('2026-11')
      const november = mockListBookings.mock.calls[0][0]
      // November starts in CDT (UTC-5) and ends in CST (UTC-6).
      expect(november.startDate).toBe('2026-11-01T05:00:00.000Z')
      expect(november.endDate).toBe('2026-12-01T05:59:59.999Z')
    })

    it('puts a party booked for 7 PM on 31 Oct in October, not November', async () => {
      // Answer like Square does: only bookings inside the requested range.
      mockListBookings.mockImplementation(async ({ startDate, endDate }: any) =>
        [booking(HALLOWEEN_7PM)].filter((b) => b.slot.startAt >= startDate && b.slot.startAt <= endDate)
      )
      const id = `party-booked-${HALLOWEEN_7PM}`

      const october = await getMonth('2026-10')
      expect(october.body.events.find((e: any) => e.id === id)).toMatchObject({ date: '2026-10-31' })

      const november = await getMonth('2026-11')
      expect(ids(november.body)).not.toContain(id)
    })
  })

  it('offers party times only on dates inside the requested month', async () => {
    const { body } = await getMonth('2026-11')
    const parties = body.events.filter((e: any) => e.kind === 'party-available')
    expect(parties.length).toBeGreaterThan(0)
    for (const p of parties) expect(p.date.startsWith('2026-11')).toBe(true)
    // Parties start on Saturday 7 Nov, after the clocks change; a Saturday has one party, at 1:30 PM.
    expect(parties[0]).toMatchObject({ date: '2026-11-07', startTime: '13:30' })
    expect(parties.filter((p: any) => p.date === '2026-11-07')).toHaveLength(1)
  })

  it('offers no party time on a day the studio has closed', async () => {
    const october = (await getMonth('2026-10')).body.events.filter((e: any) => e.kind === 'party-available')
    expect(october.map((e: any) => e.date)).not.toContain('2026-10-31')
    const november = (await getMonth('2026-11')).body.events.filter((e: any) => e.kind === 'party-available')
    expect(november.map((e: any) => e.date)).not.toContain('2026-11-01')
  })

  it('says the studio is closed on every day of a closure, in the holiday\'s colours', async () => {
    const closedIn = async (month: string) =>
      (await getMonth(month)).body.events.filter((e: any) => String(e.id).startsWith('closed-'))

    const october = await closedIn('2026-10')
    expect(october.map((e: any) => e.date)).toEqual(['2026-10-30', '2026-10-31'])
    expect(october[0]).toEqual({
      id: 'closed-2026-10-30',
      kind: 'event',
      title: 'Closed for Halloween weekend',
      detail: 'We reopen Thursday, November 5.',
      date: '2026-10-30',
      bookable: false,
      holiday: 'halloween',
    })
    // The Sunday falls in November, and shows there.
    const november = await closedIn('2026-11')
    expect(november.map((e: any) => e.date)).toEqual(['2026-11-01', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(november[1]).toMatchObject({ title: 'Closed for Thanksgiving weekend', holiday: 'thanksgiving' })
  })

  it('closes every day from 21 December to New Year\'s Day, not one day of it', async () => {
    const closedIn = async (month: string) =>
      (await getMonth(month)).body.events.filter((e: any) => String(e.id).startsWith('closed-'))
    const december = await closedIn('2026-12')
    expect(december.map((e: any) => e.date)).toEqual([
      '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27',
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    ])
    for (const row of december) {
      expect(row).toMatchObject({
        title: 'Closed for the Christmas holidays',
        detail: 'We reopen Saturday, January 2.',
        holiday: 'christmas',
      })
    }
    expect((await closedIn('2027-01')).map((e: any) => e.date)).toEqual(['2027-01-01'])
  })

  it('shows the Grand Opening marker in the opening month only', async () => {
    expect(ids((await getMonth('2026-10')).body)).toContain('grand-opening')
    expect(ids((await getMonth('2026-11')).body)).not.toContain('grand-opening')
  })

  it('makes the Grand Opening a tappable row with its own line and no emoji (HOM-192)', async () => {
    const { body } = await getMonth('2026-10')
    const row = body.events.find((e: any) => e.id === 'grand-opening')
    expect(row).toEqual({
      id: 'grand-opening',
      kind: 'event',
      title: 'Grand Opening',
      detail: 'Doors open. Come see the studio.',
      date: '2026-10-16',
      bookable: false,
      // The homepage has no #opening anchor, so the row leads to the top of it.
      href: '/',
    })
    expect(row.startTime).toBeUndefined()
  })

  it('keeps a sold-out workshop on the calendar, marked sold out (HOM-190)', async () => {
    mockListWorkshops.mockResolvedValue([workshop({ availableCapacity: 0 })])
    const { body } = await getMonth('2026-10')
    expect(body.events.find((e: any) => e.id === 'workshop-w1')).toMatchObject({
      soldOut: true,
      bookable: false,
      href: '/workshops?w=w1',
    })
  })

  describe('speed: several months in one request', () => {
    async function get(query: string, headers: Record<string, string> = {}) {
      const url = new URL(`http://localhost/api/calendar.json?${query}`)
      const request = new Request(url, { headers })
      const response = await GET({ request, url, params: {}, redirect: () => new Response(), locals: {} } as any)
      return { response, body: await response.json() }
    }

    it('returns every month asked for, asking Square each question once', async () => {
      mockListWorkshops.mockResolvedValue([
        workshop({ id: 'oct', startAt: '2026-10-24T00:00:00.000Z' }),
        workshop({ id: 'nov', startAt: '2026-11-14T01:00:00.000Z' }),
        workshop({ id: 'dec', startAt: '2026-12-05T01:00:00.000Z' }),
        workshop({ id: 'jan', startAt: '2027-01-09T01:00:00.000Z' }),
      ])

      const { body } = await get('month=2026-10&months=3')

      const workshops = body.events.filter((e: any) => e.kind === 'workshop').map((e: any) => e.id)
      expect(workshops).toEqual(['workshop-oct', 'workshop-nov', 'workshop-dec'])
      expect(mockListWorkshops).toHaveBeenCalledTimes(1)
      expect(mockGetEventTypes).toHaveBeenCalledTimes(1)
      expect(mockListBookings).toHaveBeenCalledTimes(1)
      // One bookings question covering all three studio-local months.
      expect(mockListBookings.mock.calls[0][0]).toMatchObject({
        startDate: '2026-10-01T05:00:00.000Z',
        endDate: '2027-01-01T05:59:59.999Z',
      })
      expect(ids(body)).toContain('grand-opening')
    })

    it('crosses the year end', async () => {
      mockListWorkshops.mockResolvedValue([workshop({ id: 'jan', startAt: '2027-01-09T01:00:00.000Z' })])
      const { body } = await get('month=2026-12&months=2')
      expect(ids(body)).toContain('workshop-jan')
    })

    it('caps how many months one request can ask for', async () => {
      await get('month=2026-10&months=500')
      const asked = mockListBookings.mock.calls[0][0]
      expect(asked.endDate).toBe('2027-04-01T04:59:59.999Z') // six months
    })

    it('treats a nonsense count as one month', async () => {
      await get('month=2026-10&months=lots')
      expect(mockListBookings.mock.calls[0][0].endDate).toBe('2026-11-01T04:59:59.999Z')
    })

    it('answers a second request from what it already holds', async () => {
      await get('month=2026-10')
      await get('month=2026-11')
      expect(mockListWorkshops).toHaveBeenCalledTimes(1)
      expect(mockGetEventTypes).toHaveBeenCalledTimes(1)
      // Bookings change with every sale: always asked.
      expect(mockListBookings).toHaveBeenCalledTimes(2)
    })

    it('asks again once what it holds is older than its limit', async () => {
      await get('month=2026-10')
      vi.setSystemTime(new Date('2026-09-27T17:01:05.000Z'))
      await get('month=2026-10')
      expect(mockListWorkshops).toHaveBeenCalledTimes(2)
    })
  })

  describe('caching', () => {
    async function headersFor(headers: Record<string, string> = {}) {
      const url = new URL('http://localhost/api/calendar.json?month=2026-10')
      const request = new Request(url, { headers })
      const response = await GET({ request, url, params: {}, redirect: () => new Response(), locals: {} } as any)
      return { response, body: await response.json() }
    }

    it('lets the edge answer the public, fresh for a minute and refreshed behind the scenes after', async () => {
      const { response } = await headersFor()
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('public, durable, max-age=60, stale-while-revalidate=600')
      expect(response.headers.get('Netlify-Vary')).toBe('query,cookie=hg_preview')
    })

    it('never stores or shares what the owner sees with the preview cookie', async () => {
      const { response } = await headersFor({ cookie: 'other=1; hg_preview=secret' })
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Netlify-CDN-Cache-Control')).toBeNull()
    })

    it('never caches a calendar that is missing something because a lookup failed', async () => {
      mockListWorkshops.mockRejectedValue(new Error('Square 503'))
      const { response, body } = await headersFor()
      expect(response.status).toBe(200)
      expect(body.incomplete).toBe(true)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    })

    it('does not remember a failure: the next request asks Square again', async () => {
      mockListWorkshops.mockRejectedValueOnce(new Error('Square 503')).mockResolvedValue([workshop()])
      await headersFor()
      const { body } = await headersFor()
      expect(body.incomplete).toBeUndefined()
      expect(ids(body)).toContain('workshop-w1')
    })
  })

  it('does not advertise a party time a class rules out', async () => {
    mockListWorkshops.mockResolvedValue([workshop({ startAt: '2026-11-08T18:00:00.000Z', durationMinutes: 120, name: 'Bedazzled Pumpkin Pails' })]) // noon–2 PM CST
    const november = (await getMonth('2026-11')).body.events.filter((e: any) => e.kind === 'party-available' && e.date === '2026-11-08')
    expect(november.map((e: any) => e.startTime)).toEqual(['15:30'])
  })
})
