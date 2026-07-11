import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { studioDayUtcRange } from '@lib/studio-time'

// ── Provider mock ─────────────────────────────────────────────────────────────
// Must be declared before any dynamic import of the module under test.
const mockListBookings = vi.fn()

vi.mock('@config/providers', () => ({
  providers: {
    booking: {
      listBookings: mockListBookings,
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
