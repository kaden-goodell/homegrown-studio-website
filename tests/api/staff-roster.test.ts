/**
 * Staff roster endpoint: authorized pickup / notAuthorized / medications
 * exposure (HOM-212) — legacy string pickup still normalizes to chips, and a
 * returning household's RSVP-time pickup override wins over the on-file
 * signature's own fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockGetPartyRecord = vi.fn()
vi.mock('@lib/party-store', () => ({ getPartyRecord: (...a: any[]) => mockGetPartyRecord(...a) }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', () => ({ getEvent: (...a: any[]) => mockGetEvent(...a) }))

const mockListWaiversByParty = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, listWaiversByParty: (...a: any[]) => mockListWaiversByParty(...a) }
})

const mockGetRsvp = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...a: any[]) => mockGetRsvp(...a) }))

const mockGetCheckin = vi.fn()
vi.mock('@lib/checkin-store', () => ({
  getCheckin: (...a: any[]) => mockGetCheckin(...a),
  toPublicCheckin: (s: any) => s,
}))

function makeWaiver(overrides: Record<string, any> = {}) {
  return {
    id: 'wvr_a',
    signedAt: '2026-08-01T00:00:00.000Z',
    adult: { firstName: 'Alice', lastName: 'Test', email: 'alice@x.com', phone: '', dob: '1990-01-01', allergies: '' },
    minors: [],
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: [],
    notAuthorized: '',
    photoConsent: true,
    ...overrides,
  }
}

function ctx(query: string) {
  const request = new Request(`http://localhost/api/staff/roster.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockGetPartyRecord.mockResolvedValue({
    bookingId: 'party-1',
    craftName: 'Suncatchers',
    startIso: '2026-09-05T14:00:00.000Z',
    hostName: 'Alice Test',
    guestCount: 10,
    title: null,
  })
  mockGetEvent.mockResolvedValue({ dropOff: true })
  mockGetRsvp.mockResolvedValue(null)
  mockGetCheckin.mockResolvedValue({ expected: null, presence: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '', hasPickupCode: false })
  GET = (await import('@pages/api/staff/roster.json')).GET
})

describe('GET /api/staff/roster.json — pickup/notAuthorized/medications (HOM-212)', () => {
  it('normalizes a legacy free-text authorizedPickup string into chips', async () => {
    mockListWaiversByParty.mockResolvedValue([makeWaiver({ authorizedPickup: 'Grandma Rivera, Uncle Joe' })])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([
      { name: 'Grandma Rivera', phone: '' },
      { name: 'Uncle Joe', phone: '' },
    ])
  })

  it('exposes the current array shape and notAuthorized from the waiver', async () => {
    mockListWaiversByParty.mockResolvedValue([
      makeWaiver({ authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' }),
    ])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '2565551234' }])
    expect(json.data.households[0].notAuthorized).toBe('Bio dad')
  })

  it('exposes per-child medications', async () => {
    mockListWaiversByParty.mockResolvedValue([
      makeWaiver({ minors: [{ name: 'Kid One', dob: '2018-01-01', allergies: '', medications: 'Inhaler' }] }),
    ])
    const res = await GET(ctx('?party=party-1'))
    const json = await res.json()
    expect(json.data.households[0].children[0].medications).toBe('Inhaler')
  })

  it('an RSVP-time pickup override wins over the on-file signature', async () => {
    mockListWaiversByParty.mockResolvedValue([
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
