import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockLookupHouseholdEntry = vi.fn()
const mockLookupHouseholdsByName = vi.fn()
vi.mock('@lib/waiver-store', () => ({
  lookupHouseholdEntry: (...a: any[]) => mockLookupHouseholdEntry(...a),
  lookupHouseholdsByName: (...a: any[]) => mockLookupHouseholdsByName(...a),
}))

const mockGetOpenStudioDay = vi.fn()
vi.mock('@lib/open-studio-store', () => ({
  getOpenStudioDay: (...a: any[]) => mockGetOpenStudioDay(...a),
}))

function household(overrides: Record<string, any> = {}) {
  return {
    recordId: 'wvr_abc',
    firstName: 'Sarah',
    lastName: 'Rivera',
    signedAt: '2026-08-03T00:00:00.000Z',
    agreementVersion: 'v3',
    validUntil: '2099-01-01T00:00:00.000Z',
    email: 'sarah@example.com',
    phone: '2565550142',
    dob: '1990-01-01',
    adultAllergies: '',
    minors: [{ name: 'Max Rivera', dob: '2018-01-01', allergies: 'peanuts' }],
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: '',
    photoConsent: true,
    ...overrides,
  }
}

function ctx(query: string) {
  const request = new Request(`http://localhost/api/staff/coverage.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockGetOpenStudioDay.mockResolvedValue({})
  GET = (await import('@pages/api/staff/coverage.json')).GET
})

describe('GET /api/staff/coverage.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(ctx('?q=rivera'))
    expect(res.status).toBe(401)
  })

  it('requires q', async () => {
    const res = await GET(ctx(''))
    expect(res.status).toBe(400)
  })

  it('resolves a 10+ digit query as a phone lookup', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household())
    const res = await GET(ctx('?q=2565550142'))
    expect(res.status).toBe(200)
    expect(mockLookupHouseholdEntry).toHaveBeenCalledWith('2565550142')
    expect(mockLookupHouseholdsByName).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.data.households).toHaveLength(1)
  })

  it('resolves a query containing @ as an email lookup', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household({ email: 'a@b.co' }))
    const res = await GET(ctx('?q=a@b.co'))
    expect(res.status).toBe(200)
    expect(mockLookupHouseholdEntry).toHaveBeenCalledWith('a@b.co')
    const json = await res.json()
    expect(json.data.households).toHaveLength(1)
  })

  it('resolves anything else as a last-name search returning an array', async () => {
    mockLookupHouseholdsByName.mockResolvedValue([household(), household({ recordId: 'wvr_xyz', firstName: 'Carlos' })])
    const res = await GET(ctx('?q=rivera'))
    expect(res.status).toBe(200)
    expect(mockLookupHouseholdsByName).toHaveBeenCalledWith('rivera')
    const json = await res.json()
    expect(json.data.households).toHaveLength(2)
  })

  it('GOOD TO GO: covered household includes kids, allergies, photoConsent, openStudioToday', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household())
    mockGetOpenStudioDay.mockResolvedValue({ wvr_abc: { personIds: ['adult'], at: 'x', by: { id: 't', name: 'Test' } } })
    const res = await GET(ctx('?q=2565550142'))
    const json = await res.json()
    const h = json.data.households[0]
    expect(h.covered).toBe(true)
    expect(h.kids).toEqual([{ name: 'Max Rivera', allergies: 'peanuts' }])
    expect(h.adultAllergies).toBe('')
    expect(h.photoConsent).toBe(true)
    expect(h.openStudioToday).toBe(true)
    expect(h.signedAt).toBe('2026-08-03T00:00:00.000Z')
    expect(h.agreementVersion).toBe('v3')
    expect(h.validUntil).toBe('2099-01-01T00:00:00.000Z')
  })

  it('includes a contactHint (phone last-4) to disambiguate namesakes in a multi-match list', async () => {
    mockLookupHouseholdsByName.mockResolvedValue([
      household({ recordId: 'wvr_a', firstName: 'Sam', phone: '2565550142' }),
      household({ recordId: 'wvr_b', firstName: 'Sam', phone: '2565559911' }),
    ])
    const res = await GET(ctx('?q=rivera'))
    const json = await res.json()
    expect(json.data.households[0].contactHint).toBe('••• 0142')
    expect(json.data.households[1].contactHint).toBe('••• 9911')
  })

  it('falls back to email for contactHint when there is no phone', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household({ phone: '', email: 'sam@example.com' }))
    const res = await GET(ctx('?q=sam@example.com'))
    const json = await res.json()
    expect(json.data.households[0].contactHint).toBe('sam@example.com')
  })

  it('EXPIRED: covered is false for a lapsed agreement', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household({ validUntil: '2020-01-01T00:00:00.000Z' }))
    const res = await GET(ctx('?q=2565550142'))
    const json = await res.json()
    expect(json.data.households[0].covered).toBe(false)
  })

  it('NOT ON FILE: unknown contact returns an empty households array', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(null)
    const res = await GET(ctx('?q=2565559999'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({ households: [] })
  })

  it('returns 503 on a storage error', async () => {
    mockLookupHouseholdEntry.mockRejectedValue(new Error('boom'))
    const res = await GET(ctx('?q=2565550142'))
    expect(res.status).toBe(503)
  })
})

describe('outdated agreements', () => {
  it.each(['v1', 'v2', 'garbage'])('a %s signature is covered:false, outdated:true even when unexpired', async (version) => {
    mockLookupHouseholdEntry.mockResolvedValue(household({ agreementVersion: version }))
    const res = await GET(ctx('?q=sarah@example.com'))
    const { data } = await res.json()
    expect(data.households[0]).toMatchObject({ covered: false, outdated: true })
  })

  it('a current (v3) signature is covered and not outdated', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household())
    const { data } = await (await GET(ctx('?q=sarah@example.com'))).json()
    expect(data.households[0]).toMatchObject({ covered: true, outdated: false })
  })
})

describe('"None" allergy answers', () => {
  it('are not returned as allergies', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(household({ adultAllergies: 'None', minors: [{ name: 'Max Rivera', dob: '2018-01-01', allergies: 'none' }, { name: 'Zed', dob: '2018-01-01', allergies: 'peanuts' }] }))
    const { data } = await (await GET(ctx('?q=sarah@example.com'))).json()
    expect(data.households[0].adultAllergies).toBe('')
    expect(data.households[0].kids.map((k: any) => k.allergies)).toEqual(['', 'peanuts'])
  })
})
