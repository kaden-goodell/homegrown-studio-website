/**
 * Staff roster endpoint (HOM-213): per-event (not per-party) roster —
 * `kind`/`id`/`day` params, the `?party=` legacy alias, the signature
 * meta fields (signedAt/agreementVersion/validUntil/addendumVersion), the
 * >12-kids drop-off cap warning, and (carried from HOM-212) authorized
 * pickup / notAuthorized / medications exposure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockGetEvent = vi.fn()
const mockResolveEventDay = vi.fn((event: any, requested: string | null) => requested ?? event?.days?.[0] ?? '2026-09-05')
vi.mock('@lib/events', () => ({
  getEvent: (...a: any[]) => mockGetEvent(...a),
  eventKey: (kind: string, id: string) => (kind === 'party' ? id : `${kind}:${id}`),
  resolveEventDay: (event: any, requested: string | null) => mockResolveEventDay(event, requested),
}))

const mockListWaiversByEvent = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, listWaiversByEvent: (...a: any[]) => mockListWaiversByEvent(...a) }
})

const mockGetRsvp = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...a: any[]) => mockGetRsvp(...a) }))

const mockGetCheckin = vi.fn()
vi.mock('@lib/checkin-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getCheckin: (...a: any[]) => mockGetCheckin(...a) }
})

function makeWaiver(overrides: Record<string, any> = {}) {
  return {
    id: 'wvr_a',
    signedAt: '2026-08-01T00:00:00.000Z',
    agreementVersion: 'v2',
    validUntil: '2027-08-01T00:00:00.000Z',
    adult: { firstName: 'Alice', lastName: 'Test', email: 'alice@x.com', phone: '', dob: '1990-01-01', allergies: '' },
    minors: [],
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: [],
    notAuthorized: '',
    photoConsent: true,
    ...overrides,
  }
}

function emptyCheckin() {
  return {
    expected: null,
    days: {},
    pickedUpBy: null,
    confirmedPickup: [],
    notAuthorized: '',
    pickupCodeHash: null,
    codeAttempts: 0,
    lockedAt: null,
    releasedTo: {},
    events: [],
  }
}

function ctx(query: string) {
  const request = new Request(`http://localhost/api/staff/roster.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

const partyEvent = {
  kind: 'party', id: 'party-1', title: 'Suncatchers Party', startIso: '2026-09-05T14:00:00.000Z',
  days: ['2026-09-05'], dropOff: true,
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockGetEvent.mockResolvedValue(partyEvent)
  mockResolveEventDay.mockImplementation((event: any, requested: string | null) => requested ?? event?.days?.[0] ?? '2026-09-05')
  mockGetRsvp.mockResolvedValue(null)
  mockGetCheckin.mockResolvedValue(emptyCheckin())
  mockListWaiversByEvent.mockResolvedValue([])
  GET = (await import('@pages/api/staff/roster.json')).GET
})

describe('GET /api/staff/roster.json — kind/id + ?party= alias (HOM-213)', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(ctx('?kind=party&id=party-1'))
    expect(res.status).toBe(401)
  })

  it('404s when the event cannot be resolved', async () => {
    mockGetEvent.mockResolvedValue(null)
    const res = await GET(ctx('?kind=party&id=party-1'))
    expect(res.status).toBe(404)
  })

  it('resolves kind=party&id= directly', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    const res = await GET(ctx('?kind=party&id=party-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.event.id).toBe('party-1')
    expect(mockListWaiversByEvent).toHaveBeenCalledWith('party', 'party-1')
  })

  it('the ?party= alias is equivalent to kind=party&id=', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    const res = await GET(ctx('?party=party-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.event.id).toBe('party-1')
    expect(mockListWaiversByEvent).toHaveBeenCalledWith('party', 'party-1')
  })

  it('passes the requested day through resolveEventDay and echoes the resolved day', async () => {
    mockListWaiversByEvent.mockResolvedValue([])
    const res = await GET(ctx('?party=party-1&day=2026-09-06'))
    const json = await res.json()
    expect(mockResolveEventDay).toHaveBeenCalledWith(partyEvent, '2026-09-06')
    expect(json.data.day).toBe('2026-09-06')
  })
})

describe('GET /api/staff/roster.json — signature meta fields (HOM-213)', () => {
  it('exposes signedAt, agreementVersion, validUntil, and addendumVersion from the RSVP', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ agreementVersion: 'v2', validUntil: '2027-08-01T00:00:00.000Z' })])
    mockGetRsvp.mockResolvedValue({ addendumVersion: 'a1' })
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    const h = json.data.households[0]
    expect(h.signedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(h.agreementVersion).toBe('v2')
    expect(h.validUntil).toBe('2027-08-01T00:00:00.000Z')
    expect(h.addendumVersion).toBe('a1')
  })

  it('addendumVersion is null when the RSVP never accepted one', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    mockGetRsvp.mockResolvedValue({ addendumVersion: null })
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].addendumVersion).toBeNull()
  })

  it('addendumVersion is null with no RSVP at all', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    mockGetRsvp.mockResolvedValue(null)
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].addendumVersion).toBeNull()
  })
})

describe('GET /api/staff/roster.json — drop-off cap warning (HOM-213)', () => {
  function checkinWithChildrenHere(day: string, childIds: string[]) {
    return {
      ...emptyCheckin(),
      days: { [day]: { presence: Object.fromEntries(childIds.map((id) => [id, { inAt: 'x', outAt: null }])) } },
    }
  }

  it('warns when a drop-off event has more than 12 children checked in on the selected day', async () => {
    // 13 households, each with one checked-in child on the selected day.
    const waivers = Array.from({ length: 13 }, (_, i) => makeWaiver({ id: `wvr_${i}`, minors: [{ name: `Kid ${i}`, dob: '2018-01-01', allergies: '' }] }))
    mockListWaiversByEvent.mockResolvedValue(waivers)
    mockGetCheckin.mockImplementation(async () => checkinWithChildrenHere('2026-09-05', ['child:0']))
    const res = await GET(ctx('?party=party-1&day=2026-09-05'))
    const json = await res.json()
    expect(json.data.capWarning).toBe(true)
    expect(json.data.summary.childrenHereNow).toBe(13)
  })

  it('does not warn at exactly 12 children', async () => {
    const waivers = Array.from({ length: 12 }, (_, i) => makeWaiver({ id: `wvr_${i}`, minors: [{ name: `Kid ${i}`, dob: '2018-01-01', allergies: '' }] }))
    mockListWaiversByEvent.mockResolvedValue(waivers)
    mockGetCheckin.mockImplementation(async () => checkinWithChildrenHere('2026-09-05', ['child:0']))
    const res = await GET(ctx('?party=party-1&day=2026-09-05'))
    const json = await res.json()
    expect(json.data.capWarning).toBe(false)
  })

  it('never warns on a non-drop-off event even with 13 children checked in', async () => {
    mockGetEvent.mockResolvedValue({ ...partyEvent, dropOff: false })
    const waivers = Array.from({ length: 13 }, (_, i) => makeWaiver({ id: `wvr_${i}`, minors: [{ name: `Kid ${i}`, dob: '2018-01-01', allergies: '' }] }))
    mockListWaiversByEvent.mockResolvedValue(waivers)
    mockGetCheckin.mockImplementation(async () => checkinWithChildrenHere('2026-09-05', ['child:0']))
    const res = await GET(ctx('?party=party-1&day=2026-09-05'))
    const json = await res.json()
    expect(json.data.capWarning).toBe(false)
  })

  it('only counts children checked in on the SELECTED day, not other days', async () => {
    const waivers = Array.from({ length: 13 }, (_, i) => makeWaiver({ id: `wvr_${i}`, minors: [{ name: `Kid ${i}`, dob: '2018-01-01', allergies: '' }] }))
    mockGetEvent.mockResolvedValue({ ...partyEvent, days: ['2026-09-05', '2026-09-06'] })
    mockListWaiversByEvent.mockResolvedValue(waivers)
    // All 13 checked in on day 1 only — day 2's roster should show 0 here.
    mockGetCheckin.mockImplementation(async () => checkinWithChildrenHere('2026-09-05', ['child:0']))
    const res = await GET(ctx('?party=party-1&day=2026-09-06'))
    const json = await res.json()
    expect(json.data.capWarning).toBe(false)
    expect(json.data.summary.childrenHereNow).toBe(0)
  })
})

describe('GET /api/staff/roster.json — pickup/notAuthorized/medications (HOM-212)', () => {
  it('normalizes a legacy free-text authorizedPickup string into chips', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ authorizedPickup: 'Grandma Rivera, Uncle Joe' })])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([
      { name: 'Grandma Rivera', phone: '' },
      { name: 'Uncle Joe', phone: '' },
    ])
  })

  it('exposes the current array shape and notAuthorized from the waiver', async () => {
    mockListWaiversByEvent.mockResolvedValue([
      makeWaiver({ authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' }),
    ])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '2565551234' }])
    expect(json.data.households[0].notAuthorized).toBe('Bio dad')
  })

  it('exposes per-child medications', async () => {
    mockListWaiversByEvent.mockResolvedValue([
      makeWaiver({ minors: [{ name: 'Kid One', dob: '2018-01-01', allergies: '', medications: 'Inhaler' }] }),
    ])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].children[0].medications).toBe('Inhaler')
  })

  it('an RSVP-time pickup override wins over the on-file signature', async () => {
    mockListWaiversByEvent.mockResolvedValue([
      makeWaiver({ authorizedPickup: [], notAuthorized: '' }),
    ])
    mockGetRsvp.mockResolvedValue({
      pickup: { authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner' },
    })
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([{ name: 'Aunt Sue', phone: '2565559876' }])
    expect(json.data.households[0].notAuthorized).toBe('Ex-partner')
  })
})
