import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListEvents = vi.fn()
vi.mock('@lib/events', async (orig) => ({ ...(await orig<typeof import('@lib/events')>()), listEvents: (...a: any[]) => mockListEvents(...a) }))

/** `listEvents` now reports per-source health alongside the rows (F2). */
const listing = (events: any[], sources: any = { parties: 'ok', workshops: 'ok' }) => ({ events, sources })

const mockListRsvpsByEvent = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ listRsvpsByEvent: (...a: any[]) => mockListRsvpsByEvent(...a) }))

const mockSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ listSeatChoicesByEvent: (...a: any[]) => mockSeatChoices(...a) }))

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
  return {
    expected: null,
    days: {},
    pickedUpBy: null,
    confirmedPickup: [],
    notAuthorized: '',
    pickupSeeded: false,
    pickupCodeHash: null,
    codeAttempts: 0,
    lockedAt: null,
    releasedTo: {},
    events: [],
  }
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
    mockListEvents.mockResolvedValue(listing([]))
    await GET(ctx('?date=2026-10-20'))
    expect(mockListEvents).toHaveBeenCalledWith({ from: '2026-10-20', to: '2026-10-20' })
  })

  it('attaches rsvpCount from listRsvpsByEvent and hereNow from checkin presence', async () => {
    mockListEvents.mockResolvedValue(listing([
      { kind: 'party', id: 'party-1', title: 'Rivera Party', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: false },
    ]))
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
    mockListEvents.mockResolvedValue(listing([
      { kind: 'workshop', id: 'ws-1', title: 'Pottery', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: false },
    ]))
    mockListRsvpsByEvent.mockResolvedValue([{ waiverId: 'wvr_1', event: { kind: 'workshop', id: 'ws-1' } }])
    mockGetCheckin.mockResolvedValue(checkinOn('2026-10-20', { adult: { inAt: 'x', outAt: 'y' } }))

    const res = await GET(ctx('?date=2026-10-20'))
    const json = await res.json()
    expect(json.data.events[0].hereNow).toBe(0)
    expect(json.data.events[0].rsvpCount).toBe(1)
  })

  it('hereNow only counts presence on the requested date, not other days of a multi-day event (HOM-213)', async () => {
    mockListEvents.mockResolvedValue(listing([
      { kind: 'workshop', id: 'ws-camp', title: 'Camp', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20', '2026-10-21'], dropOff: true },
    ]))
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

  it('F2: one source down still returns the other source’s events, with sources reported', async () => {
    mockListEvents.mockResolvedValue(
      listing(
        [{ kind: 'party', id: 'party-1', title: 'Rivera Party', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: false }],
        { parties: 'ok', workshops: 'error' },
      ),
    )
    const res = await GET(ctx('?date=2026-10-20'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.events.map((e: any) => e.id)).toEqual(['party-1'])
    expect(json.data.sources).toEqual({ parties: 'ok', workshops: 'error' })
  })

  it('F2: every source down is a real outage — 503', async () => {
    mockListEvents.mockResolvedValue(listing([], { parties: 'error', workshops: 'error', classes: 'error' }))
    const res = await GET(ctx('?date=2026-10-20'))
    expect(res.status).toBe(503)
  })

  it('a multi-day class of ours shows that day’s time and seats', async () => {
    const sessions = [
      { id: 'ses_1', day: '2026-10-19', startIso: '2026-10-19T15:00:00.000Z', endIso: '2026-10-19T17:00:00.000Z', capacity: 8, sold: 2 },
      { id: 'ses_2', day: '2026-10-20', startIso: '2026-10-20T14:00:00.000Z', endIso: '2026-10-20T16:00:00.000Z', capacity: 8, sold: 9 },
    ]
    mockListEvents.mockResolvedValue(listing([
      { kind: 'workshop', id: 'cls_camp', title: 'Camp', startIso: sessions[0].startIso, days: ['2026-10-19', '2026-10-20'], dropOff: false, capacity: 8, seats: 6, options: [], own: true, sessions },
    ], { parties: 'ok', workshops: 'ok', classes: 'ok' }))
    mockListRsvpsByEvent.mockResolvedValue([])
    const json = await (await GET(ctx('?date=2026-10-20'))).json()
    expect(json.data.events[0]).toMatchObject({ id: 'cls_camp', startIso: sessions[1].startIso, capacity: 8, seats: -1 })
  })

  describe('prep list on classes with seat questions', () => {
    const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
    const cls = (over: any = {}) => ({ kind: 'workshop', id: 'clssch_p', title: 'Pails', startIso: '2026-10-18T18:00:00Z', days: ['2026-10-18'], dropOff: true, capacity: 35, seats: 29, options: [PAILS], ...over })
    const rec = (choices: string[]) => ({ picks: choices.map((choice, i) => ({ seat: i + 1, optionId: 'pumpkin-color', choice })) })

    it('adds the counts and how many sold seats have no pick', async () => {
      mockListEvents.mockResolvedValue(listing([cls()]))
      mockListRsvpsByEvent.mockResolvedValue([])
      mockSeatChoices.mockResolvedValue([rec(['Lavender', 'Black']), rec(['Lavender'])])
      const body = await (await GET(ctx('?date=2026-10-18'))).json()
      expect(body.data.events[0].prep).toEqual([
        { id: 'pumpkin-color', label: 'Pumpkin color', counts: [{ choice: 'Lavender', n: 2 }, { choice: 'Black', n: 1 }], unpicked: 3 },
      ])
    })

    it('a class without questions, or a party, gets no prep and no extra lookups', async () => {
      mockListEvents.mockResolvedValue(listing([cls({ options: [] }), { kind: 'party', id: 'bk1', title: 'Party', startIso: '2026-10-18T18:00:00Z', days: ['2026-10-18'], dropOff: false }]))
      mockListRsvpsByEvent.mockResolvedValue([])
      const body = await (await GET(ctx('?date=2026-10-18'))).json()
      expect(body.data.events.map((e: any) => e.prep)).toEqual([undefined, undefined])
      expect(mockSeatChoices).not.toHaveBeenCalled()
    })

    it('a failed picks read leaves the line off but still shows the day', async () => {
      mockListEvents.mockResolvedValue(listing([cls()]))
      mockListRsvpsByEvent.mockResolvedValue([])
      mockSeatChoices.mockRejectedValue(new Error('blobs down'))
      const res = await GET(ctx('?date=2026-10-18'))
      expect(res.status).toBe(200)
      expect((await res.json()).data.events[0].prep).toBeUndefined()
    })
  })
})
