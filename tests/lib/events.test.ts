import { describe, it, expect, vi, beforeEach } from 'vitest'

const partyFixture = { bookingId: 'p1', title: 'Rivera Party', craftName: 'Slime', startIso: '2026-10-20T15:00:00.000Z', dropOff: true }

const mockListParties = vi.fn(async () => [partyFixture])
vi.mock('@lib/party-store', () => ({
  getPartyRecord: vi.fn(async (id: string) => (id === 'p1' ? partyFixture : null)),
  listParties: (...a: any[]) => (mockListParties as any)(...a),
}))

// Two workshops: one bookable, one SOLD OUT. `listWorkshops` filters the full
// one out (that's Square's own behavior) — only `getWorkshop` can see it, so
// this fixture is what C2 is about.
const mockListWorkshops = vi.fn()
const mockGetWorkshop = vi.fn()
vi.mock('@config/providers', () => ({
  providers: { workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a), getWorkshop: (...a: any[]) => mockGetWorkshop(...a) } },
}))
vi.mock('@lib/event-meta', () => ({ getEventMeta: vi.fn(async (_kind: string, id: string) => id === 'cs1' ? { dropOff: true, days: ['2026-10-20', '2026-10-21', '2026-10-22'], updatedAt: '', by: { id: 'k', name: 'K' }, history: [] } : null) }))

const WORKSHOPS = [
  { id: 'inst-cs1', scheduleId: 'cs1', name: 'Macramé', startAt: '2026-10-21T04:30:00.000Z', availableCapacity: 8 },
  { id: 'inst-pno', scheduleId: 'cs-pno', name: 'Parents Night Out', startAt: '2026-10-23T23:00:00.000Z', availableCapacity: 0 },
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
})

describe('listEvents source isolation (F2)', () => {
  it('reports both sources ok on the happy path', async () => {
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events.map((e) => e.id).sort()).toEqual(['cs1', 'p1'])
    expect(sources).toEqual({ parties: 'ok', workshops: 'ok' })
  })

  it('a Square outage still returns the parties, flagged workshops: error', async () => {
    mockListWorkshops.mockRejectedValue(new Error('fetch failed'))
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
    mockListWorkshops.mockRejectedValue(new Error('fetch failed'))
    const { events, sources } = await listEvents({ from: '2026-10-20', to: '2026-10-20' })
    expect(events).toEqual([])
    expect(sources).toEqual({ parties: 'error', workshops: 'error' })
  })
})
