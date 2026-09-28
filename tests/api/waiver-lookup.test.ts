import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
vi.mock('@lib/reuse-token', () => ({ issueReuseToken: vi.fn().mockReturnValue('token-abc') }))

const mockLookupHouseholdEntry = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args),
  }
})

const mockGetRsvp = vi.fn().mockResolvedValue(null)
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...args: any[]) => mockGetRsvp(...args) }))

function makeHousehold(overrides: Record<string, any> = {}) {
  return {
    recordId: 'wvr_abc',
    validUntil: '2099-01-01T00:00:00.000Z',
    signedAt: '2026-01-01T00:00:00.000Z',
    agreementVersion: 'v2',
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

describe('POST /api/waiver/lookup.json — forced re-sign (HOM-210)', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetRsvp.mockResolvedValue(null)
    vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
    vi.mock('@lib/reuse-token', () => ({ issueReuseToken: vi.fn().mockReturnValue('token-abc') }))
    vi.mock('@lib/waiver-store', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args) }
    })
    vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...args: any[]) => mockGetRsvp(...args) }))
    vi.mock('@config/waiver-content', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, substantiveSince: 'v3' }
    })
    const mod = await import('@pages/api/waiver/lookup.json')
    POST = mod.POST
  })

  it('returns mustResign:true with no token/recordId when the on-file version predates substantiveSince', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v2' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({ found: true, mustResign: true, firstName: 'Alice' })
  })

  it('still returns a normal reuseToken when the on-file version is current', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.found).toBe(true)
    expect(json.data.mustResign).toBeUndefined()
    expect(json.data.reuseToken).toBe('token-abc')
    expect(json.data.signedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  // HOM-212 — hasPickup lets the RSVP screen decide whether to show the
  // compact "Who may pick up?" block. `pickup` (the actual rows) is only
  // included alongside it when hasPickup is true, so the block can be
  // prefilled instead of asking again from blank (fix round 1).
  it('hasPickup is true (and pickup is included) when the on-file signature already has a pickup row', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }] }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup).toEqual({ authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }], notAuthorized: '' })
  })

  it('hasPickup is false, and no pickup key is sent, when there is none (legacy empty-string authorizedPickup normalizes fine)', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data.hasPickup).toBe(false)
    expect(json.data.pickup).toBeUndefined()
  })

  // Fix round 1 — the critical bug: a household that set pickup via the
  // returning-RSVP's compact block (never touching the signature) must be
  // reported as hasPickup:true for THAT event, or the block reappears blank
  // and a re-RSVP would silently wipe what they already set.
  it('hasPickup is true when only the RSVP (not the signature) has pickup rows for the given event', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    mockGetRsvp.mockResolvedValue({
      pickup: { authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner' },
    })
    const res = await POST(createMockContext({ contact: 'alice@test.com', partyId: 'party-123' }))
    expect(mockGetRsvp).toHaveBeenCalledWith('party', 'party-123', 'wvr_abc')
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup).toEqual({ authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner' })
  })

  it('checks the RSVP under the workshop kind when workshopId is given instead of partyId', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    mockGetRsvp.mockResolvedValue(null)
    await POST(createMockContext({ contact: 'alice@test.com', workshopId: 'wkbk-abc' }))
    expect(mockGetRsvp).toHaveBeenCalledWith('workshop', 'wkbk-abc', 'wvr_abc')
  })

  it('does not call getRsvp when no event context is given', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(mockGetRsvp).not.toHaveBeenCalled()
  })

  it('falls back to the signature alone (never fails the lookup) if the RSVP read throws', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }] }),
    )
    mockGetRsvp.mockRejectedValue(new Error('boom'))
    const res = await POST(createMockContext({ contact: 'alice@test.com', partyId: 'party-123' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup.authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '' }])
  })
})
