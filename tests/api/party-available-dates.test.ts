import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListBookings = vi.fn()
const mockListAllWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: (...a: any[]) => mockListBookings(...a) },
    workshop: { listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a), listWorkshops: async () => [] },
  },
}))
vi.mock('@lib/bookings-gate', () => ({
  bookingsOpen: () => true,
  bookingsClosedResponse: () => new Response('closed', { status: 403 }),
}))

// Live Square, so Square-booked parties are read (the party service only).
vi.mock('@config/site.config', async (orig) => {
  const real = (await orig<typeof import('@config/site.config')>()).siteConfig
  return { siteConfig: { ...real, providers: { ...real.providers, catalog: { type: 'square', config: { environment: 'production' } } } } }
})
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))
// Store outages, switched on per test.
const down = vi.hoisted(() => ({ settings: false, book: false }))
vi.mock('@lib/parties/settings-store', async (orig) => {
  const real = await orig<typeof import('@lib/parties/settings-store')>()
  return { ...real, getPartySettings: async (o?: any) => { if (down.settings) throw new Error('party settings store down'); return real.getPartySettings(o) } }
})
vi.mock('@lib/parties/party-book', async (orig) => {
  const real = await orig<typeof import('@lib/parties/party-book')>()
  return { ...real, holdsBetween: async (...a: Parameters<typeof real.holdsBetween>) => { if (down.book) throw new Error('party book store down'); return real.holdsBetween(...a) } }
})

import { POST } from '@pages/api/party/available-dates.json'
import { holdTime, releaseTime } from '@lib/parties/party-book'
import { PARTY_TIMES_UNREADABLE } from '@lib/parties/open-times'

// These tests pin the normal weekly rules; one-off party days
// (partyDateOverrides) are covered in party-date-overrides.test.ts.
vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))
vi.mock('../config/party.config', async (orig) => ({ ...(await orig<typeof import('../../src/config/party.config')>()), partyDateOverrides: {} }))


// Noon Central on Sunday 27 Sep 2026. Parties start Sat 7 Nov, so dates run 7 Nov to 11 Nov.
const NOW = new Date('2026-09-27T17:00:00.000Z')
const VARIATION = 'var-party'
const booked = (startAt: string) => ({ id: `bk_${startAt}`, status: 'confirmed', slot: { startAt, serviceVariationId: VARIATION } })

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
  mockListAllWorkshops.mockReset().mockResolvedValue([])
  down.settings = false
  down.book = false
})
afterEach(() => vi.useRealTimers())

describe('POST /api/party/available-dates.json', () => {
  it('offers only dates inside the booking window', async () => {
    const { data } = await ask()
    // Parties start the weekend of 7 Nov (Halloween weekend is closed); the window ends Sat 26 Dec,
    // which is inside the Christmas closure, so the last party day is Sun 20 Dec.
    // Sat 7 Nov is the all-day Craft Café grand opening: no parties.
    expect(data.dates[0]).toBe('2026-11-08')
    expect(data.dates).not.toContain('2026-11-07')
    expect(data.dates[data.dates.length - 1]).toBe('2026-12-20')
    expect(data.dates.every((d: string) => d >= '2026-11-07' && d <= '2026-12-26')).toBe(true)
    expect(data.dates.filter((d: string) => d >= '2026-12-21')).toEqual([])
    expect(data.bookedDates).toEqual([])
    expect(data.windowDays).toBe(90)
  })

  it('cannot be talked into a wider window than the rule allows', async () => {
    const { data } = await ask({ serviceVariationId: VARIATION, days: 120 })
    expect(data.dates[data.dates.length - 1]).toBe('2026-12-20')
  })

  it('sends the open times with each date, so the panel need not ask again', async () => {
    const { data } = await ask()
    // Saturday has one party time (1:30 PM CST), Sunday two (1:00 and 3:30 PM CST).
    expect(data.times['2026-11-14'].map((t: any) => t.startAt)).toEqual(['2026-11-14T19:30:00.000Z'])
    expect(data.times['2026-11-08'].map((t: any) => t.startAt)).toEqual([
      '2026-11-08T19:00:00.000Z',
      '2026-11-08T21:30:00.000Z',
    ])
    expect(data.times['2026-11-14'][0]).toEqual({
      startAt: '2026-11-14T19:30:00.000Z',
      endAt: '2026-11-14T21:00:00.000Z',
      durationMinutes: 90,
    })
    expect(Object.keys(data.times).sort()).toEqual(data.dates)
  })

  it('leaves a booked time out of its date', async () => {
    mockListBookings.mockResolvedValue([booked('2026-11-08T19:00:00.000Z')])
    const { data } = await ask()
    expect(data.times['2026-11-08'].map((t: any) => t.startAt)).toEqual(['2026-11-08T21:30:00.000Z'])
    expect(data.dates).toContain('2026-11-08')
    expect(data.bookedDates).toEqual([])
  })

  it('lists a date with no time left as booked, not as missing', async () => {
    // Sunday offers 1:00 and 3:30 PM Central.
    mockListBookings.mockResolvedValue([booked('2026-11-08T19:00:00.000Z'), booked('2026-11-08T21:30:00.000Z')])
    const { data } = await ask()
    expect(data.dates).not.toContain('2026-11-08')
    expect(data.bookedDates).toEqual(['2026-11-08'])
  })

  it('lists a Saturday as booked once its single 1:30 PM time is taken', async () => {
    mockListBookings.mockResolvedValue([booked('2026-11-14T19:30:00.000Z')])
    const { data } = await ask()
    expect(data.dates).not.toContain('2026-11-14')
    expect(data.dates).toContain('2026-11-15')
    expect(data.bookedDates).toEqual(['2026-11-14'])
  })

  it('does not call a day "Booked" when a class took its only party time', async () => {
    mockListAllWorkshops.mockResolvedValue([
      // Thu 12 Nov, 6–8 PM CST: no room for the 4:00 party and its cleanup.
      { id: 'e', scheduleId: 'clssch_earrings', name: 'Christmas Earring Bar', startAt: '2026-11-13T00:00:00.000Z', durationMinutes: 120 },
    ])
    const { data } = await ask()
    expect(data.dates).not.toContain('2026-11-12')
    expect(data.bookedDates).not.toContain('2026-11-12')
  })

  it('ignores cancelled bookings and bookings for other services', async () => {
    mockListBookings.mockResolvedValue([
      { id: 'bk_c', status: 'cancelled', slot: { startAt: '2026-11-08T21:30:00.000Z', serviceVariationId: VARIATION } },
      { id: 'bk_o', status: 'confirmed', slot: { startAt: '2026-11-08T19:00:00.000Z', serviceVariationId: 'something-else' } },
    ])
    const { data } = await ask()
    expect(data.times['2026-11-08']).toHaveLength(2)
  })

  it('legacy read fails closed: a Square bookings failure answers 503, never "every date"', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 503'))
    const { response, data } = await ask()
    expect(response.status).toBe(503)
    expect(data).toBeUndefined()
  })

  it.each([['settings'], ['book']] as const)('store down refuses: a party %s read error answers 503 with the sentence', async (which) => {
    down[which] = true
    const request = new Request('http://localhost/api/party/available-dates.json', { method: 'POST', body: JSON.stringify({}) })
    const response = await POST({ request } as any)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: PARTY_TIMES_UNREADABLE })
  })

  it('a party in our party book takes its time; a held time disappears for everyone else', async () => {
    expect((await holdTime({ partyId: 'pty_ad00000000000001', startIso: '2026-11-08T19:00:00.000Z', endIso: '2026-11-08T20:30:00.000Z', ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
    try {
      const { data } = await ask({})
      expect(data.times['2026-11-08'].map((t: any) => t.startAt)).toEqual(['2026-11-08T21:30:00.000Z'])
    } finally {
      await releaseTime('pty_ad00000000000001', '2026-11-08T19:00:00.000Z')
    }
  })

  it('accepts a package id and answers with that package’s length', async () => {
    const { data } = await ask({ packageId: 'pkg_whole' })
    expect(data.times['2026-11-14'][0].durationMinutes).toBe(90)
  })

  it('is never cached: open times change with every booking', async () => {
    const { response } = await ask()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('leaves out party times a class rules out, so the panel never offers them', async () => {
    mockListAllWorkshops.mockResolvedValue([
      { id: 'i', scheduleId: 'clssch_pails', name: 'Bedazzled Pumpkin Pails', startAt: '2026-11-08T18:00:00.000Z', durationMinutes: 120 }, // noon–2 PM
    ])
    const { data } = await ask()
    expect(data.times['2026-11-08'].map((t: any) => t.startAt)).toEqual(['2026-11-08T21:30:00.000Z'])
  })

  it('offers every time when classes cannot be read', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    const { data } = await ask()
    expect(data.times['2026-11-08'].map((t: any) => t.startAt)).toEqual(['2026-11-08T19:00:00.000Z', '2026-11-08T21:30:00.000Z'])
  })
})
