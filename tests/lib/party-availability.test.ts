import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { studioDayUtcRange } from '@lib/studio-time'

// ── Provider mock ─────────────────────────────────────────────────────────────
// Must be declared before any dynamic import of the module under test.
const mockListBookings = vi.fn()
const mockListAllWorkshops = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    booking: {
      listBookings: mockListBookings,
    },
    workshop: {
      listAllWorkshops: mockListAllWorkshops,
      listWorkshops: vi.fn(async () => []),
    },
  },
}))

vi.mock('@config/site.config', () => ({
  siteConfig: {
    providers: {
      booking: {
        config: { locationId: 'test-location' },
      },
    },
  },
}))

// ── Deterministic clock ───────────────────────────────────────────────────────
// Use a far-future Saturday so openPartyStarts won't filter any starts as past.
// 2027-08-07 is a Saturday; party slots: 9:00, 11:30, 14:00, 16:30 CT
const FAKE_NOW = new Date('2027-08-01T12:00:00.000Z').getTime() // well before the Saturday

const TEST_DATE = '2027-08-07' // Saturday

beforeEach(() => {
  vi.setSystemTime(FAKE_NOW)
  mockListBookings.mockResolvedValue([])
  mockListAllWorkshops.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getOpen() {
  // Fresh dynamic import each test so module state is clean.
  const { openPartyStarts } = await import('@lib/party-availability')
  return openPartyStarts(TEST_DATE)
}

async function checkIsOpen(startIso: string) {
  const { isStartOpen } = await import('@lib/party-availability')
  return isStartOpen(startIso)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('openPartyStarts', () => {
  it('(a) returns a start when it is in the schedule and not booked', async () => {
    mockListBookings.mockResolvedValue([])
    const starts = await getOpen()
    expect(starts.length).toBeGreaterThan(0)
    // All returned starts should be on our Saturday
    for (const s of starts) {
      const d = new Date(s)
      expect(d.getTime()).toBeGreaterThan(FAKE_NOW)
    }
  })

  it('(b) removes a start that is booked (status confirmed)', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const allStarts = partyStartsForDate(TEST_DATE)
    expect(allStarts.length).toBeGreaterThan(0)
    const bookedStart = allStarts[0]

    mockListBookings.mockResolvedValue([
      {
        id: 'booking-1',
        status: 'confirmed',
        slot: { startAt: bookedStart, serviceVariationId: 'var-1' },
        customerId: 'cust-1',
        eventType: 'party',
        createdAt: '2027-07-01T00:00:00Z',
      },
    ])

    const starts = await getOpen()
    // The booked start (or any overlapping with its occupancy) should be gone
    expect(starts).not.toContain(bookedStart)
  })

  it('(d) passes studioDayUtcRange bounds to listBookings (UTC-boundary fix)', async () => {
    await getOpen()
    expect(mockListBookings).toHaveBeenCalledTimes(1)
    const callArgs = mockListBookings.mock.calls[0][0]
    const { startIso, endIso } = studioDayUtcRange(TEST_DATE)
    expect(callArgs.startDate).toBe(startIso)
    expect(callArgs.endDate).toBe(endIso)
  })

  it('(e) cancelled bookings do NOT block a slot', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const allStarts = partyStartsForDate(TEST_DATE)
    const cancelledStart = allStarts[0]

    mockListBookings.mockResolvedValue([
      {
        id: 'booking-2',
        status: 'cancelled',
        slot: { startAt: cancelledStart, serviceVariationId: 'var-1' },
        customerId: 'cust-1',
        eventType: 'party',
        createdAt: '2027-07-01T00:00:00Z',
      },
    ])

    const starts = await getOpen()
    // Cancelled booking should NOT remove the slot
    expect(starts).toContain(cancelledStart)
  })
})

describe('POST /api/party/availability.json input validation', () => {
  function makeCtx(body: unknown) {
    const url = new URL('http://localhost/api/party/availability.json')
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { request, url, params: {}, redirect: () => new Response(), locals: {} } as any
  }

  it('returns 400 for a missing date', async () => {
    const { POST } = await import('@pages/api/party/availability.json')
    const response = await POST(makeCtx({}))
    expect(response.status).toBe(400)
  })

  it('returns 400 for a malformed date', async () => {
    const { POST } = await import('@pages/api/party/availability.json')
    for (const bad of ['not-a-date', '2027/08/07', 12345, { date: '2027-08-07' }]) {
      const response = await POST(makeCtx({ date: bad }))
      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.error).toBe('Invalid date')
    }
  })

  it('returns 200 for a well-formed date and ignores a non-string serviceVariationId', async () => {
    const { POST } = await import('@pages/api/party/availability.json')
    const response = await POST(makeCtx({ date: TEST_DATE, serviceVariationId: { $ne: null } }))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.slots.length).toBeGreaterThan(0)
  })
})

describe('isStartOpen', () => {
  it('(a) returns true for a future unbooked start in the schedule', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const allStarts = partyStartsForDate(TEST_DATE)
    mockListBookings.mockResolvedValue([])

    const result = await checkIsOpen(allStarts[0])
    expect(result).toBe(true)
  })

  it('(b) returns false for a start that is booked', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const allStarts = partyStartsForDate(TEST_DATE)
    const bookedStart = allStarts[0]

    mockListBookings.mockResolvedValue([
      {
        id: 'booking-3',
        status: 'confirmed',
        slot: { startAt: bookedStart, serviceVariationId: 'var-1' },
        customerId: 'cust-1',
        eventType: 'party',
        createdAt: '2027-07-01T00:00:00Z',
      },
    ])

    const result = await checkIsOpen(bookedStart)
    expect(result).toBe(false)
  })

  it('(c) returns false for a start not in the schedule at all', async () => {
    // A Tuesday — no parties scheduled
    const notInSchedule = '2027-08-10T15:00:00.000Z' // Tuesday
    const result = await checkIsOpen(notInSchedule)
    expect(result).toBe(false)
  })

  it('(e) returns true when the matching booking is cancelled', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const allStarts = partyStartsForDate(TEST_DATE)
    const start = allStarts[0]

    mockListBookings.mockResolvedValue([
      {
        id: 'booking-4',
        status: 'cancelled',
        slot: { startAt: start, serviceVariationId: 'var-1' },
        customerId: 'cust-1',
        eventType: 'party',
        createdAt: '2027-07-01T00:00:00Z',
      },
    ])

    const result = await checkIsOpen(start)
    expect(result).toBe(true)
  })
})

// ── Booking-opens clamp ───────────────────────────────────────────────────────
// No party may be offered or booked before partyConfig.bookingOpensDate — the
// studio has no certificate of occupancy before opening. Derived from config
// (single source of truth), so these survive opening-date changes.
describe('bookingOpensDate clamp', () => {
  const DAY = 86_400_000
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const isPartyWeekday = (ms: number) => [0, 6].includes(new Date(ms).getUTCDay()) // Sun/Sat

  it('offers no starts on a party weekday before opening', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const { partyConfig } = await import('@config/party.config')
    const openMs = new Date(partyConfig.bookingOpensDate + 'T12:00:00Z').getTime()
    // walk back to the last Sat/Sun strictly before opening — a real party day,
    // so an empty result proves the clamp (not just a non-party weekday).
    let ms = openMs - DAY
    for (let i = 0; i < 8 && !isPartyWeekday(ms); i++) ms -= DAY
    expect(partyStartsForDate(ymd(ms))).toEqual([])
  })

  it('offers starts on the first party weekday on/after opening', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    const { partyConfig } = await import('@config/party.config')
    const openMs = new Date(partyConfig.bookingOpensDate + 'T12:00:00Z').getTime()
    let ms = openMs
    for (let i = 0; i < 8 && !isPartyWeekday(ms); i++) ms += DAY
    // Asked ten days before opening, so the date is inside the booking window.
    expect(partyStartsForDate(ymd(ms), new Date(openMs - 10 * DAY)).length).toBeGreaterThan(0)
  })

  it('range queries exclude pre-opening dates entirely', async () => {
    const { partyStartsInRange } = await import('@lib/party-slots')
    const { partyConfig } = await import('@config/party.config')
    const opens = partyConfig.bookingOpensDate
    const openMidnight = new Date(opens + 'T00:00:00Z').getTime()
    const starts = partyStartsInRange(
      new Date(openMidnight - 30 * DAY).toISOString(),
      new Date(openMidnight + 30 * DAY).toISOString(),
      // Asked ten days before opening, so the weeks after it are inside the window.
      new Date(openMidnight - 10 * DAY),
    )
    expect(starts.length).toBeGreaterThan(0)
    const openLocalMs = new Date(opens + 'T00:00:00-05:00').getTime()
    for (const iso of starts) expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(openLocalMs)
  })
})

// ── bookingHeldBy: whose booking is sitting on this time? ─────────────────────
describe('bookingHeldBy', () => {
  // 2:00 PM Central on Sat 7 Aug 2027 (daylight time)
  const START = '2027-08-07T19:00:00.000Z'

  function booking(overrides: Record<string, any> = {}) {
    return {
      id: 'bk-1',
      status: 'confirmed',
      customerId: 'cust-1',
      slot: { startAt: START, serviceVariationId: 'var-party' },
      ...overrides,
    }
  }

  async function heldBy(customerId: string, serviceVariationId?: string) {
    const { bookingHeldBy } = await import('@lib/party-availability')
    return bookingHeldBy(START, customerId, serviceVariationId)
  }

  it('finds the customer’s own live booking at that exact time', async () => {
    mockListBookings.mockResolvedValue([booking()])
    expect((await heldBy('cust-1', 'var-party'))?.id).toBe('bk-1')
  })

  it('looks across the whole studio day, in studio time', async () => {
    mockListBookings.mockResolvedValue([])
    await heldBy('cust-1')
    const { startIso, endIso } = studioDayUtcRange('2027-08-07')
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: startIso, endDate: endIso, locationId: 'test-location' })
  })

  it('does not match someone else’s booking', async () => {
    mockListBookings.mockResolvedValue([booking({ customerId: 'cust-2' })])
    expect(await heldBy('cust-1', 'var-party')).toBeNull()
  })

  it('does not match a cancelled booking', async () => {
    mockListBookings.mockResolvedValue([booking({ status: 'cancelled' })])
    expect(await heldBy('cust-1', 'var-party')).toBeNull()
  })

  it('does not match the customer’s booking at a different time that day', async () => {
    mockListBookings.mockResolvedValue([booking({ slot: { startAt: '2027-08-07T21:30:00.000Z', serviceVariationId: 'var-party' } })])
    expect(await heldBy('cust-1', 'var-party')).toBeNull()
  })

  it('does not match a different kind of booking at that time', async () => {
    mockListBookings.mockResolvedValue([booking({ slot: { startAt: START, serviceVariationId: 'var-other' } })])
    expect(await heldBy('cust-1', 'var-party')).toBeNull()
  })

  it('matches the same instant written with a different offset', async () => {
    mockListBookings.mockResolvedValue([booking({ slot: { startAt: '2027-08-07T14:00:00-05:00', serviceVariationId: 'var-party' } })])
    expect((await heldBy('cust-1', 'var-party'))?.id).toBe('bk-1')
  })

  it('finds nothing without a customer', async () => {
    mockListBookings.mockResolvedValue([booking({ customerId: '' })])
    expect(await heldBy('')).toBeNull()
  })
})

// ── Parties yield to classes (spec E) ────────────────────────────────────────
function classAt(startAt: string, durationMinutes = 120) {
  return {
    id: 'inst-pails', scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', description: '', descriptionHtml: '',
    startAt, durationMinutes, priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
  }
}

describe('openPartyStarts — parties yield to classes', () => {
  // Thu 8 Oct 2026: Sunday 18 Oct is inside the booking window.
  const OCT_8 = new Date('2026-10-08T17:00:00.000Z')
  const SUN_1PM = '2026-10-18T18:00:00.000Z'
  const SUN_330PM = '2026-10-18T20:30:00.000Z'

  it('drops the 1:00 PM Sunday party when Pumpkin Pails runs 1–3 PM, and keeps 3:30', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockResolvedValue([classAt(SUN_1PM)])
    const { openPartyStarts } = await import('@lib/party-availability')
    expect(await openPartyStarts('2026-10-18')).toEqual([SUN_330PM])
  })

  it('the pre-charge re-check refuses the class-blocked start', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockResolvedValue([classAt(SUN_1PM)])
    const { isStartOpen } = await import('@lib/party-availability')
    expect(await isStartOpen(SUN_1PM)).toBe(false)
    expect(await isStartOpen(SUN_330PM)).toBe(true)
  })

  it('a class lookup that fails never blocks party availability', async () => {
    vi.setSystemTime(OCT_8)
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    const { openPartyStarts } = await import('@lib/party-availability')
    expect(await openPartyStarts('2026-10-18')).toEqual([SUN_1PM, SUN_330PM])
    expect(mockListBookings).toHaveBeenCalledTimes(1)
  })

  it('a 7 PM Saturday class leaves every Saturday party in place', async () => {
    const { partyStartsForDate } = await import('@lib/party-slots')
    mockListAllWorkshops.mockResolvedValue([classAt('2027-08-08T00:00:00.000Z')]) // 7 PM CDT Sat 7 Aug 2027
    expect(await getOpen()).toEqual(partyStartsForDate(TEST_DATE))
  })

  it('availability.json: when the bookings lookup throws, the class rule still applies', async () => {
    vi.setSystemTime(OCT_8)
    mockListBookings.mockRejectedValue(new Error('Square 503'))
    mockListAllWorkshops.mockResolvedValue([classAt(SUN_1PM)])
    const { POST } = await import('@pages/api/party/availability.json')
    const url = new URL('http://localhost/api/party/availability.json')
    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-10-18' }),
    })
    const response = await POST({ request, url, params: {}, redirect: () => new Response(), locals: {} } as any)
    const json = await response.json()
    expect(json.data.slots.map((s: any) => s.startAt)).toEqual([SUN_330PM])
  })
})
