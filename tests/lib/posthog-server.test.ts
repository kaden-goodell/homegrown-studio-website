import { describe, it, expect, vi, afterEach } from 'vitest'
import { reportsFrom, bookingEvents, reportBooking, type ServerBooking } from '@lib/posthog-server'

const booking: ServerBooking = {
  requestUrl: 'https://ourhometownstudio.com/api/party/book.json',
  kind: 'party',
  bookingId: 'bk-1',
  amountCents: 30000,
  email: '  Mom@Example.com ',
  firstName: 'Ann',
  lastName: 'Lee',
  items: [{ item_id: 'c1', item_name: 'Bubble Letters', item_category: 'party_craft', price: 15, quantity: 10 }],
  attribution: {
    first: { source: 'facebook', medium: 'cpc', campaign: 'opening', landing: '/book', at: '2026-10-01T00:00:00Z' },
    last: { source: 'google.com', medium: 'organic', landing: '/', at: '2026-10-05T00:00:00Z' },
    visits: 3,
  },
  posthogId: 'anon-123',
  extra: { guests: 10 },
}

describe('reportsFrom', () => {
  it('reports from the live site only', () => {
    expect(reportsFrom('https://ourhometownstudio.com/api/x')).toBe(true)
    expect(reportsFrom('https://www.ourhometownstudio.com/api/x')).toBe(true)
    expect(reportsFrom('http://localhost:4321/api/x')).toBe(false)
    expect(reportsFrom('https://dev--iridescent-croissant-494fc3.netlify.app/api/x')).toBe(false)
    expect(reportsFrom('nonsense')).toBe(false)
  })
})

describe('bookingEvents', () => {
  const [identify, paid] = bookingEvents(booking, new Date('2026-10-09T12:00:00Z')) as any[]

  it('joins the visit to the customer by email', () => {
    expect(identify.event).toBe('$identify')
    expect(identify.distinct_id).toBe('mom@example.com')
    expect(identify.properties.$anon_distinct_id).toBe('anon-123')
    expect(identify.properties.$set_once.first_source).toBe('facebook')
  })

  it('records the money, what was booked and where they came from', () => {
    expect(paid.event).toBe('booking_paid')
    expect(paid.distinct_id).toBe('mom@example.com')
    expect(paid.properties).toMatchObject({
      booking_kind: 'party', booking_id: 'bk-1', revenue: 300, currency: 'USD',
      first_source: 'facebook', first_campaign: 'opening', last_source: 'google.com', visits_before_booking: 3,
      guests: 10, item_names: 'Bubble Letters', $insert_id: 'booking_paid-bk-1',
    })
  })

  it('ignores a junk visitor id', () => {
    const [i] = bookingEvents({ ...booking, posthogId: { x: 1 } }) as any[]
    expect(i.properties.$anon_distinct_id).toBeUndefined()
  })
})

describe('reportBooking', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends nothing for a test booking or from a preview', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await reportBooking({ ...booking, simulated: true })
    await reportBooking({ ...booking, requestUrl: 'http://localhost:4321/api' })
    expect(f).not.toHaveBeenCalled()
  })

  it('never throws when PostHog is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await expect(reportBooking(booking)).resolves.toBeUndefined()
  })
})
