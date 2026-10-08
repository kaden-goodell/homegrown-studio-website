/**
 * Staff roster endpoint (HOM-213): per-event (not per-party) roster —
 * `kind`/`id`/`day` params, the `?party=` legacy alias, the signature
 * meta fields (signedAt/agreementVersion/validUntil), the
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
  EVENT_KIND_RE: /^(party|workshop)$/,
}))

const mockListWaiversByEvent = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, listWaiversByEvent: (...a: any[]) => mockListWaiversByEvent(...a) }
})

const mockGetRsvp = vi.fn()
const mockLatest = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...a: any[]) => mockGetRsvp(...a), getLatestPickupForWaiver: (...a: any[]) => mockLatest(...a) }))

const mockGetCheckin = vi.fn()
vi.mock('@lib/checkin-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getCheckin: (...a: any[]) => mockGetCheckin(...a) }
})

const mockListSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, listSeatChoicesByEvent: (...a: any[]) => mockListSeatChoices(...a) }
})

function makeWaiver(overrides: Record<string, any> = {}) {
  return {
    id: 'wvr_a',
    signedAt: '2026-08-01T00:00:00.000Z',
    agreementVersion: 'v1',
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
  mockLatest.mockReset().mockResolvedValue(null)
  mockGetCheckin.mockResolvedValue(emptyCheckin())
  mockListWaiversByEvent.mockResolvedValue([])
  mockListSeatChoices.mockReset().mockResolvedValue([])
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
  it('exposes signedAt, agreementVersion and validUntil — and passes no unknown RSVP fields through', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ agreementVersion: 'v1', validUntil: '2027-08-01T00:00:00.000Z' })])
    mockGetRsvp.mockResolvedValue({ addendumVersion: 'x' })
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    const h = json.data.households[0]
    expect(h.signedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(h.agreementVersion).toBe('v1')
    expect(h.validUntil).toBe('2027-08-01T00:00:00.000Z')
    expect(h.addendumVersion).toBeUndefined()
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
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner', at: '2026-08-02T00:00:00.000Z' })
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([{ name: 'Aunt Sue', phone: '2565559876' }])
    expect(json.data.households[0].notAuthorized).toBe('Ex-partner')
  })

  it('(d) returns the check-in state\'s may-NOT-collect when neither the RSVP nor the waiver has one', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    mockGetCheckin.mockResolvedValue({ ...emptyCheckin(), notAuthorized: 'Rick Smith' })
    const json = await (await GET(ctx('?party=party-1'))).json()
    expect(json.data.households[0].notAuthorized).toBe('Rick Smith')
  })

  it('once the door list is seeded, display follows it (edited list / cleared note), same as the gate', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ authorizedPickup: [{ name: 'Old Name', phone: '' }], notAuthorized: 'Old Note' })])
    mockGetCheckin.mockResolvedValue({ ...emptyCheckin(), pickupSeeded: true, confirmedPickup: [{ name: 'Grandma Rivera', phone: '' }], notAuthorized: '' })
    const h = (await (await GET(ctx('?party=party-1'))).json()).data.households[0]
    expect(h.authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '' }])
    expect(h.notAuthorized).toBe('')
  })

  it('before the door state is seeded, the card shows the household\'s pickup from its other RSVP', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver()])
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: 'Rick Smith' })
    const h = (await (await GET(ctx('?party=party-1'))).json()).data.households[0]
    expect(h.notAuthorized).toBe('Rick Smith')
    expect(h.authorizedPickup).toEqual([{ name: 'Aunt Sue', phone: '' }])
  })

  it('(c) the card shows no restriction after a newer "None"', async () => {
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ notAuthorized: 'Rick Smith' })])
    mockLatest.mockResolvedValue({ authorizedPickup: [], notAuthorized: 'None', at: '2026-09-01T00:00:00.000Z' })
    const h = (await (await GET(ctx('?party=party-1'))).json()).data.households[0]
    expect(h.notAuthorized).toBe('')
  })
})

describe('GET /api/staff/roster.json — seat picks (spec D)', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const pailsEvent = {
    kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails', startIso: '2026-10-18T18:00:00.000Z', days: ['2026-10-18'],
    dropOff: false, options: [PAILS], signupCutoffHours: null, seats: 10, capacity: 25,
  }
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })
  const rec = (email: string, givenName: string, picks: any[]) => ({
    eventKind: 'workshop', eventId: 'clssch_pails', bookingId: `bk_${givenName}`, orderId: null,
    customer: { givenName, familyName: 'Test', email, phone: '' }, seats: picks.length, picks, at: '2026-10-06T15:00:00.000Z', attemptId: 'a',
  })

  it('totals each choice, groups picks by family email, and lists who paid but has not signed', async () => {
    mockGetEvent.mockResolvedValue(pailsEvent)
    mockListWaiversByEvent.mockResolvedValue([makeWaiver({ adult: { firstName: 'Alice', lastName: 'Test', email: 'Alice@X.com', phone: '', dob: '1990-01-01', allergies: '' } })])
    mockListSeatChoices.mockResolvedValue([rec('alice@x.com', 'Alice', [p(1, 'Lavender'), p(2, 'Lavender')]), rec('bo@x.com', 'Bo', [p(1, 'Black')])])
    const { data } = await (await GET(ctx('?kind=workshop&id=clssch_pails'))).json()
    expect(mockListSeatChoices).toHaveBeenCalledWith('workshop', 'clssch_pails')
    expect(data.choices).toEqual({
      totals: { 'pumpkin-color': { Lavender: 2, Black: 1 } },
      byEmail: { 'alice@x.com': [p(1, 'Lavender'), p(2, 'Lavender')], 'bo@x.com': [p(1, 'Black')] },
      unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [p(1, 'Black')], comped: false }],
      seatsSold: 15,
    })
  })

  it('a party, or a class with no questions, has no picks block', async () => {
    const { data } = await (await GET(ctx('?kind=party&id=party-1'))).json()
    expect(data.choices).toBeNull()
    mockGetEvent.mockResolvedValue({ ...pailsEvent, options: [] })
    expect((await (await GET(ctx('?kind=workshop&id=clssch_pails'))).json()).data.choices).toBeNull()
    expect(mockListSeatChoices).not.toHaveBeenCalled()
  })

  it('a failed picks read still returns the roster, without choices', async () => {
    mockGetEvent.mockResolvedValue(pailsEvent)
    mockListSeatChoices.mockRejectedValue(new Error('blobs down'))
    const res = await GET(ctx('?kind=workshop&id=clssch_pails'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.choices).toBeUndefined()
  })
})
