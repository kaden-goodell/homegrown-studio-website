import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListBookings = vi.fn()
vi.mock('@config/providers', () => ({
  providers: { booking: { listBookings: (...a: any[]) => mockListBookings(...a) } },
}))

const mockCatalogGet = vi.fn()
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: (...a: any[]) => mockCatalogGet(...a) } } }),
}))

import { openPartyStartsInWindow } from '@lib/party-open-dates'

const VARIATION = 'PARTY_VARIATION'
const NOW = new Date('2026-10-10T15:00:00.000Z') // window: Oct 16 (opening, 5 days' notice) to Nov 24
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const days = (starts: string[]) => Array.from(new Set(starts.map(dayOf)))

const booked = (startAt: string, over: Record<string, unknown> = {}) => ({
  id: `b-${startAt}`,
  status: 'confirmed',
  customerId: 'c',
  slot: { startAt, serviceVariationId: VARIATION },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockCatalogGet.mockResolvedValue({ object: { itemData: { variations: [{ id: VARIATION }] } } })
  mockListBookings.mockResolvedValue([])
})

describe('openPartyStartsInWindow', () => {
  it('lists the weekends inside the booking window, and nothing past it', async () => {
    const starts = await openPartyStartsInWindow(NOW)
    expect(days(starts)).toEqual([
      '2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25',
      // Halloween weekend is closed.
      '2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22',
    ])
  })

  it('leaves out the days the studio has closed', async () => {
    const starts = await openPartyStartsInWindow(NOW)
    expect(days(starts)).not.toContain('2026-10-31')
    expect(days(starts)).not.toContain('2026-11-01')
  })

  it('leaves out a time that is booked', async () => {
    mockListBookings.mockResolvedValue([booked('2026-10-24T14:00:00.000Z')])
    const starts = await openPartyStartsInWindow(NOW)
    expect(starts).not.toContain('2026-10-24T14:00:00.000Z')
    expect(starts).toContain('2026-10-24T19:00:00.000Z')
  })

  it('counts a cancelled booking as free', async () => {
    mockListBookings.mockResolvedValue([booked('2026-10-24T14:00:00.000Z', { status: 'cancelled' })])
    expect(await openPartyStartsInWindow(NOW)).toContain('2026-10-24T14:00:00.000Z')
  })

  it('offers nothing at all in the days the studio is closed for Christmas', async () => {
    const starts = await openPartyStartsInWindow(new Date('2026-12-01T15:00:00.000Z'))
    expect(days(starts).filter((d) => d >= '2026-12-21' && d <= '2027-01-01')).toEqual([])
    expect(days(starts)).toContain('2026-12-19')
    expect(days(starts)).toContain('2027-01-02')
  })

  it('throws when the bookings cannot be read, so nobody is told a taken date is open', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 503'))
    await expect(openPartyStartsInWindow(NOW)).rejects.toThrow('Square 503')
  })
})
