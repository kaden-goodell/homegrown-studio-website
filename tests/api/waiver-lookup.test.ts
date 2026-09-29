import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLookupHouseholdEntry = vi.fn()
const mockGetRsvp = vi.fn()
const mockRateLimited = vi.fn()

function makeHousehold(overrides: Record<string, any> = {}) {
  return {
    recordId: 'wvr_abc',
    validUntil: '2099-01-01T00:00:00.000Z',
    signedAt: '2026-01-01T00:00:00.000Z',
    agreementVersion: 'v3',
    firstName: 'Alice',
    lastName: 'Test',
    email: 'alice@test.com',
    phone: '2565551234',
    dob: '1990-01-01',
    adultAllergies: '',
    minors: [],
    emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
    authorizedPickup: '',
    photoConsent: true,
    ...overrides,
  }
}

function createMockContext(body: any) {
  const request = new Request('http://localhost/api/waiver/lookup.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request, clientAddress: '127.0.0.1' } as any
}

vi.mock('@lib/rate-limit', () => ({ rateLimited: (...args: any[]) => mockRateLimited(...args) }))
const mockLatest = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...args: any[]) => mockGetRsvp(...args), getLatestPickupForWaiver: (...args: any[]) => mockLatest(...args) }))
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args) }
})

describe('POST /api/waiver/lookup.json — type a phone number, the household appears', () => {
  let POST: any

  beforeEach(async () => {
  mockLatest.mockReset().mockResolvedValue(null)
    vi.clearAllMocks()
    mockRateLimited.mockReturnValue(false)
    mockGetRsvp.mockResolvedValue(null)
    const mod = await import('@pages/api/waiver/lookup.json')
    POST = mod.POST
  })

  it('found + valid: returns the household straight away (recordId, kids, reuseToken) — no code step', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ minors: [{ name: 'Bo Test' }, { name: 'Cy Test' }] }),
    )
    const res = await POST(createMockContext({ contact: '2565551234' }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toMatchObject({
      found: true,
      recordId: 'wvr_abc',
      firstName: 'Alice',
      kids: ['Bo', 'Cy'],
      validUntil: '2099-01-01T00:00:00.000Z',
      signedAt: '2026-01-01T00:00:00.000Z',
      hasPickup: false,
    })
    expect(typeof data.reuseToken).toBe('string')
    expect(data.reuseToken.length).toBeGreaterThan(10)
    expect('pickup' in data).toBe(false)
    expect(data.needsCode).toBeUndefined()
    expect(data.phoneHint).toBeUndefined()
  })

  it('hasPickup (boolean only — never the names) comes from the signature when it lists authorized pickups', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ authorizedPickup: [{ name: 'Grandma Sue', phone: '2565550000' }], notAuthorized: 'Ex' }),
    )
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com' }))).json()
    expect(data.hasPickup).toBe(true)
    expect('pickup' in data).toBe(false)
    expect(JSON.stringify(data)).not.toMatch(/Grandma Sue|2565550000/)
    expect(mockGetRsvp).not.toHaveBeenCalled()
  })

  it('an existing RSVP pickup override counts for hasPickup (never returned)', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold())
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Uncle Al', phone: '' }], notAuthorized: '', at: '2026-09-01T00:00:00.000Z' })
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com', partyId: 'party-1' }))).json()
    expect(mockLatest).toHaveBeenCalledWith('wvr_abc')
    expect(data.hasPickup).toBe(true)
    expect('pickup' in data).toBe(false)
    expect(JSON.stringify(data)).not.toContain('Uncle Al')
  })

  it('(b) hasPickup is true for event B when only ANOTHER event\'s RSVP had a pickup/may-NOT-collect', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold())
    mockGetRsvp.mockResolvedValue(null)
    mockLatest.mockResolvedValue({ authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: 'Rick Smith' })
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com', workshopId: 'event-b' }))).json()
    expect(data.hasPickup).toBe(true)
    expect('pickup' in data).toBe(false)
  })

  it('NEW-3: a may-NOT-collect note alone is NOT "pickup people on file" (hasPickup needs authorized adults)', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ notAuthorized: 'Rick Smith', authorizedPickup: [] }))
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com' }))).json()
    expect(data.hasPickup).toBe(false)
  })

  it('an RSVP storage error falls back to the signature instead of failing the lookup', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold())
    mockGetRsvp.mockRejectedValue(new Error('Blobs outage'))
    const res = await POST(createMockContext({ contact: 'alice@test.com', partyId: 'party-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.hasPickup).toBe(false)
  })

  it('mustResign:true when the on-file version predates substantiveSince (v2 → re-sign under v3)', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v2' }))
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com' }))).json()
    expect(data).toEqual({ found: true, mustResign: true, firstName: 'Alice' })
  })

  it('expired: found:false, expired:true, firstName, validUntil', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ validUntil: '2020-01-01T00:00:00.000Z' }))
    const { data } = await (await POST(createMockContext({ contact: 'alice@test.com' }))).json()
    expect(data).toEqual({ found: false, expired: true, firstName: 'Alice', validUntil: '2020-01-01T00:00:00.000Z' })
  })

  it('unknown contact: found:false', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(null)
    const { data } = await (await POST(createMockContext({ contact: 'nobody@nowhere.com' }))).json()
    expect(data).toEqual({ found: false })
  })

  it('400s on an empty contact', async () => {
    const res = await POST(createMockContext({ contact: '  ' }))
    expect(res.status).toBe(400)
  })

  it('429s when rate limited (10/min/IP)', async () => {
    mockRateLimited.mockReturnValue(true)
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(res.status).toBe(429)
    expect(mockRateLimited).toHaveBeenCalledWith('lookup:127.0.0.1', 10, 60_000)
  })
})
