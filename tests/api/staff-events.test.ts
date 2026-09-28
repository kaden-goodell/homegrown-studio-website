import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListEvents = vi.fn()
vi.mock('@lib/events', () => ({ listEvents: (...a: any[]) => mockListEvents(...a), eventKey: (kind: string, id: string) => (kind === 'party' ? id : `${kind}:${id}`) }))

const mockListRsvpsByEvent = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ listRsvpsByEvent: (...a: any[]) => mockListRsvpsByEvent(...a) }))

const mockGetCheckin = vi.fn()
vi.mock('@lib/checkin-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getCheckin: (...a: any[]) => mockGetCheckin(...a) }
})

function ctx(query: string) {
  const request = new Request(`http://localhost/api/staff/events.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

function emptyCheckin(): CheckinState {
  return { expected: null, days: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '', pickupCodeHash: null, events: [] }
}

/** Build a CheckinState with presence for one day (HOM-213 — `hereNow` is
 *  now scoped to the date the request asked about). */
function checkinOn(day: string, presence: Record<string, { inAt: string; outAt: string | null }>): CheckinState {
  return { ...emptyCheckin(), days: { [day]: { presence } } }
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockListRsvpsByEvent.mockResolvedValue([])
  mockGetCheckin.mockResolvedValue(emptyCheckin())
  GET = (await import('@pages/api/staff/events.json')).GET
})

describe('GET /api/staff/events.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(ctx('?date=2026-10-20'))
    expect(res.status).toBe(401)
  })

  it('requires a valid date', async () => {
    const res = await GET(ctx('?date=not-a-date'))
    expect(res.status).toBe(400)
  })

  it('passes date as both from and to to listEvents', async () => {
    mockListEvents.mockResolvedValue([])
    await GET(ctx('?date=2026-10-20'))
    expect(mockListEvents).toHaveBeenCalledWith({ from: '2026-10-20', to: '2026-10-20' })
  })

  it('attaches rsvpCount from listRsvpsByEvent and hereNow from checkin presence', async () => {
    mockListEvents.mockResolvedValue([
      { kind: 'party', id: 'party-1', title: 'Rivera Party', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: false },
    ])
    mockListRsvpsByEvent.mockResolvedValue([
      { waiverId: 'wvr_1', event: { kind: 'party', id: 'party-1' } },
      { waiverId: 'wvr_2', event: { kind: 'party', id: 'party-1' } },
    ])
    mockGetCheckin.mockImplementation(async (_eventKey: string, waiverId: string) => {
      if (waiverId === 'wvr_1') return checkinOn('2026-10-20', { adult: { inAt: 'x', outAt: null } })
      return emptyCheckin()
    })

    const res = await GET(ctx('?date=2026-10-20'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.events).toHaveLength(1)
    expect(json.data.events[0].rsvpCount).toBe(2)
    expect(json.data.events[0].hereNow).toBe(1)
    expect(json.data.events[0].title).toBe('Rivera Party')
  })

  it('a checked-out person does not count toward hereNow', async () => {
    mockListEvents.mockResolvedValue([
      { kind: 'workshop', id: 'ws-1', title: 'Pottery', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: false },
    ])
    mockListRsvpsByEvent.mockResolvedValue([{ waiverId: 'wvr_1', event: { kind: 'workshop', id: 'ws-1' } }])
    mockGetCheckin.mockResolvedValue(checkinOn('2026-10-20', { adult: { inAt: 'x', outAt: 'y' } }))

    const res = await GET(ctx('?date=2026-10-20'))
    const json = await res.json()
    expect(json.data.events[0].hereNow).toBe(0)
    expect(json.data.events[0].rsvpCount).toBe(1)
  })

  it('hereNow only counts presence on the requested date, not other days of a multi-day event (HOM-213)', async () => {
    mockListEvents.mockResolvedValue([
      { kind: 'workshop', id: 'ws-camp', title: 'Camp', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20', '2026-10-21'], dropOff: true },
    ])
    mockListRsvpsByEvent.mockResolvedValue([{ waiverId: 'wvr_1', event: { kind: 'workshop', id: 'ws-camp' } }])
    // Present on day 2, but the request below is for day 1.
    mockGetCheckin.mockResolvedValue(checkinOn('2026-10-21', { 'child:0': { inAt: 'x', outAt: null } }))

    const res = await GET(ctx('?date=2026-10-20'))
    const json = await res.json()
    expect(json.data.events[0].hereNow).toBe(0)
  })

  it('returns 503 on a storage error', async () => {
    mockListEvents.mockRejectedValue(new Error('boom'))
    const res = await GET(ctx('?date=2026-10-20'))
    expect(res.status).toBe(503)
  })
})
