import { describe, it, expect, vi, beforeEach } from 'vitest'

const partyFixture = { bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true }

const mockListParties = vi.fn(async () => [partyFixture])
vi.mock('@lib/party-store', () => ({
  getPartyRecord: vi.fn(async (id: string) => (id === 'p1' ? partyFixture : null)),
  listParties: (...a: any[]) => (mockListParties as any)(...a),
}))

// Computed relative to "now" (not hardcoded) so these never rot into the
// future/past as real time marches on.
const { TODAY, STARTED_2H_AGO_ISO, CAMP_STARTED_3D_AGO_ISO } = vi.hoisted(() => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    TODAY: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    STARTED_2H_AGO_ISO: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    CAMP_STARTED_3D_AGO_ISO: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  }
})

// Two workshops: one bookable, one SOLD OUT. `listWorkshops` filters the full
// one out (that's Square's own behavior) — only `getWorkshop` can see it, so
// this fixture is what C2 is about. `listAllWorkshops` is the wide,
// unfiltered listing `cachedWorkshopList` now prefers (HOM in-progress fix).
const mockListWorkshops = vi.fn()
const mockGetWorkshop = vi.fn()
const mockListAllWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    workshop: {
      listWorkshops: (...a: any[]) => mockListWorkshops(...a),
      getWorkshop: (...a: any[]) => mockGetWorkshop(...a),
      listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a),
    },
  },
}))
vi.mock('@lib/event-meta', () => ({
  getEventMeta: vi.fn(async (_kind: string, id: string) => {
    if (id === 'cs1') return { dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] }
    if (id === 'cs-camp') return { dropOff: false, days: [TODAY], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] }
    return null
  }),
}))

const WORKSHOPS = [
  { id: 'inst-cs1', scheduleId: 'cs1', name: 'Macramé', startAt: '2026-10-21T04:30:00.000Z', availableCapacity: 8 },
  { id: 'inst-pno', scheduleId: 'cs-pno', name: 'Parents Night Out', startAt: '2026-10-23T23:00:00.000Z', availableCapacity: 0 },
  // Already in progress, no event-meta override — resolves via getEvent and
  // is listed via `listAllWorkshops` even though it started in the past.
  { id: 'inst-started', scheduleId: 'cs-started', name: 'Pottery Wheel', startAt: STARTED_2H_AGO_ISO, availableCapacity: 4 },
  // A multi-day camp we're on a later day of — event-meta says `days`
  // includes today, so it's listed on today even though startAt is 3 days
  // in the past.
  { id: 'inst-camp', scheduleId: 'cs-camp', name: 'Summer Camp', startAt: CAMP_STARTED_3D_AGO_ISO, availableCapacity: 2 },
]

let getEvent: typeof import('@lib/events').getEvent
let listEvents: typeof import('@lib/events').listEvents
let eventKey: typeof import('@lib/events').eventKey

beforeEach(async () => {
  vi.clearAllMocks()
  // The module caches the workshop list for a minute — reset it between tests
  // so one test's list doesn't leak into the next.
  vi.resetModules()
  mockListParties.mockResolvedValue([partyFixture])
  mockListWorkshops.mockImplementation(async () => WORKSHOPS.filter((w) => w.availableCapacity > 0))
  mockListAllWorkshops.mockImplementation(async () => WORKSHOPS)
  mockGetWorkshop.mockImplementation(async (id: string) => WORKSHOPS.find((w) => w.id === id || w.scheduleId === id) ?? null)
  ;({ getEvent, listEvents, eventKey } = await import('@lib/events'))
})

describe('events', () => {
  it('party falls back to the record dropOff and derives days in studio TZ', async () => {
    const e = await getEvent('party', 'p1'); expect(e).toMatchObject({ kind: 'party', dropOff: true, days: ['2026-10-20'] })
  })
  it('workshop merges meta (dropOff, multi-day) and is listed on each of its days', async () => {
    const e = await getEvent('workshop', 'cs1'); expect(e).toMatchObject({ title: 'Macramé', dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'] })
    expect((await listEvents({ from: '2026-10-22', to: '2026-10-22' })).events.map(x => x.id)).toEqual(['cs1'])
    expect((await listEvents({ from: '2026-10-20', to: '2026-10-20' })).events.map(x => x.id).sort()).toEqual(['cs1', 'p1'])
  })
  it('a 11:30pm UTC start is the previous studio day', async () => {
    // 2026-10-21T04:30Z = Oct 20 11:30pm CDT
    const e = await getEvent('workshop', 'cs1'); expect(e!.startIso).toBe('2026-10-21T04:30:00.000Z')
  })
  it('eventKey keeps party ids bare (legacy) and namespaces the rest', () => {
    expect(eventKey('party', 'p1')).toBe('p1'); expect(eventKey('workshop', 'cs1')).toBe('workshop:cs1')
  })

  it('C2: a SOLD-OUT workshop still resolves by scheduleId', async () => {
    const e = await getEvent('workshop', 'cs-pno')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-pno', title: 'Parents Night Out' })
    expect(mockGetWorkshop).toHaveBeenCalledWith('cs-pno')
  })

  it('C2: a genuinely unknown workshop id is still null', async () => {
    expect(await getEvent('workshop', 'nope')).toBeNull()
  })

  it('C2: falls back to the active list when the provider has no getWorkshop', async () => {
    mockGetWorkshop.mockImplementation(() => { throw new Error('not implemented') })
    const e = await getEvent('workshop', 'cs1')
    expect(e).toMatchObject({ id: 'cs1', title: 'Macramé' })
  })

  it('a class that already started (no meta) still resolves via getEvent, on today', async () => {
    const e = await getEvent('workshop', 'cs-started')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-started', title: 'Pottery Wheel', days: [TODAY] })
  })

  it('a class that already started is listed on today by listEvents (staff Today list)', async () => {
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((e) => e.id)).toContain('cs-started')
  })

  it('a multi-day camp on a later day still resolves and lists on today via its event-meta days', async () => {
    const e = await getEvent('workshop', 'cs-camp')
    expect(e).toMatchObject({ kind: 'workshop', id: 'cs-camp', days: [TODAY] })
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((x) => x.id)).toContain('cs-camp')
  })

  it('listEvents prefers listAllWorkshops (wide) over listWorkshops (future-only public) when both exist', async () => {
    mockListAllWorkshops.mockImplementation(async () => [
      { id: 'inst-only-in-all', scheduleId: 'cs-only-in-all', name: 'Wide-only', startAt: STARTED_2H_AGO_ISO, availableCapacity: 1 },
    ])
    const { events } = await listEvents({ from: TODAY, to: TODAY })
    expect(events.map((e) => e.id)).toEqual(['cs-only-in-all'])
    expect(mockListWorkshops).not.toHaveBeenCalled()
  })
})

describe('listEvents source isolation (F2)', () => {
  it('reports both sources ok on the happy path', async () => {
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id).sort()).toEqual(['cs1', 'p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'ok' })
  })

  it('a Square outage still returns the parties, flagged workshops: error', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('fetch failed'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id)).toEqual(['p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'error' })
  })

  it('a Blobs outage still returns the workshops, flagged parties: error', async () => {
    mockListParties.mockRejectedValue(new Error('blobs down'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id)).toEqual(['cs1'])
    expect(sources).toEqual({ parties: 'error', workshops: 'ok' })
  })

  it('both sources down returns nothing and flags both', async () => {
    mockListParties.mockRejectedValue(new Error('blobs down'))
    mockListAllWorkshops.mockRejectedValue(new Error('fetch failed'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events).toEqual([])
    expect(sources).toEqual({ parties: 'error', workshops: 'error' })
  })
})
