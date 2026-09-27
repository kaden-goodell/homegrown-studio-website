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
    // Sunday 1 Nov is the day the clocks change; its first party is still 1:00 PM.
    expect(parties[0]).toMatchObject({ date: '2026-11-01', startTime: '13:00' })
  })

  it('shows the Grand Opening marker in the opening month only', async () => {
    expect(ids((await getMonth('2026-10')).body)).toContain('grand-opening')
    expect(ids((await getMonth('2026-11')).body)).not.toContain('grand-opening')
  })
})
