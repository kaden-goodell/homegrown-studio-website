import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListBookings = vi.fn()
vi.mock('@config/providers', () => ({
  providers: { booking: { listBookings: (...a: any[]) => mockListBookings(...a) } },
}))
vi.mock('@lib/bookings-gate', () => ({
  bookingsOpen: () => true,
  bookingsClosedResponse: () => new Response('closed', { status: 403 }),
}))

import { POST } from '@pages/api/party/available-dates.json'

// Noon Central on Sunday 27 Sep 2026. Opening day is 16 Oct, so dates run 16 Oct to 11 Nov.
const NOW = new Date('2026-09-27T17:00:00.000Z')
const VARIATION = 'var-party'
const booked = (startAt: string) => ({ status: 'confirmed', slot: { startAt, serviceVariationId: VARIATION } })

async function ask(body: Record<string, unknown> = { serviceVariationId: VARIATION }) {
  const request = new Request('http://localhost/api/party/available-dates.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await POST({ request } as any)
  return { response, data: (await response.json()).data }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mockListBookings.mockReset().mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('POST /api/party/available-dates.json', () => {
  it('offers only dates inside the booking window', async () => {
    const { data } = await ask()
    expect(data.dates).toEqual(['2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01', '2026-11-07', '2026-11-08'])
    expect(data.windowDays).toBe(45)
  })

  it('cannot be talked into a wider window than the rule allows', async () => {
    const { data } = await ask({ serviceVariationId: VARIATION, days: 120 })
    expect(data.dates[data.dates.length - 1]).toBe('2026-11-08')
  })

  it('sends the open times with each date, so the panel need not ask again', async () => {
    const { data } = await ask()
    expect(data.times['2026-10-17'].map((t: any) => t.startAt)).toEqual([
      '2026-10-17T14:00:00.000Z',
      '2026-10-17T16:30:00.000Z',
      '2026-10-17T19:00:00.000Z',
      '2026-10-17T21:30:00.000Z',
    ])
    expect(data.times['2026-10-17'][0]).toEqual({
      startAt: '2026-10-17T14:00:00.000Z',
      endAt: '2026-10-17T15:30:00.000Z',
      durationMinutes: 90,
    })
    expect(Object.keys(data.times).sort()).toEqual(data.dates)
  })

  it('leaves a booked time out of its date', async () => {
    mockListBookings.mockResolvedValue([booked('2026-10-17T19:00:00.000Z')])
    const { data } = await ask()
    expect(data.times['2026-10-17'].map((t: any) => t.startAt)).not.toContain('2026-10-17T19:00:00.000Z')
    expect(data.dates).toContain('2026-10-17')
    expect(data.bookedDates).toEqual([])
  })

  it('lists a date with no time left as booked, not as missing', async () => {
    // Sunday offers 1:00 and 3:30 PM Central.
    mockListBookings.mockResolvedValue([booked('2026-10-18T18:00:00.000Z'), booked('2026-10-18T20:30:00.000Z')])
    const { data } = await ask()
    expect(data.dates).not.toContain('2026-10-18')
    expect(data.bookedDates).toEqual(['2026-10-18'])
  })

  it('ignores cancelled bookings and bookings for other services', async () => {
    mockListBookings.mockResolvedValue([
      { status: 'cancelled', slot: { startAt: '2026-10-17T19:00:00.000Z', serviceVariationId: VARIATION } },
      { status: 'confirmed', slot: { startAt: '2026-10-17T16:30:00.000Z', serviceVariationId: 'something-else' } },
    ])
    const { data } = await ask()
    expect(data.times['2026-10-17']).toHaveLength(4)
  })

  it('still offers dates when the bookings lookup fails', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 503'))
    const { response, data } = await ask()
    expect(response.status).toBe(200)
    expect(data.dates.length).toBeGreaterThan(0)
  })

  it('is never cached: open times change with every booking', async () => {
    const { response } = await ask()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
