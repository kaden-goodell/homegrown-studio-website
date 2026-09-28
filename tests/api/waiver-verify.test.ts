import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLookupHouseholdEntry = vi.fn()
const mockGetRsvp = vi.fn().mockResolvedValue(null)
const mockVerifyOtp = vi.fn()

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
  const request = new Request('http://localhost/api/waiver/verify.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request, clientAddress: '127.0.0.1' } as any
}

describe('POST /api/waiver/verify.json (HOM-218)', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetRsvp.mockResolvedValue(null)
    mockVerifyOtp.mockResolvedValue({ ok: true })

    vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
    vi.mock('@lib/reuse-token', () => ({ issueReuseToken: vi.fn().mockReturnValue('token-abc') }))
    vi.mock('@lib/otp-store', () => ({ verifyOtp: (...args: any[]) => mockVerifyOtp(...args) }))
    vi.mock('@lib/waiver-store', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args) }
    })
    vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...args: any[]) => mockGetRsvp(...args) }))
    vi.mock('@config/waiver-content', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, substantiveSince: 'v3' }
    })

    const mod = await import('@pages/api/waiver/verify.json')
    POST = mod.POST
  })

  it('correct code → full payload (recordId, kids, reuseToken) and the OTP is consumed', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', minors: [{ name: 'Bo Test' }] }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(mockVerifyOtp).toHaveBeenCalledWith('wvr_abc', '042017')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.found).toBeUndefined() // this endpoint's success body has no `found` wrapper — see lookup.json for that
    expect(json.data).toMatchObject({
      recordId: 'wvr_abc',
      firstName: 'Alice',
      kids: ['Bo'],
      validUntil: '2099-01-01T00:00:00.000Z',
      signedAt: '2026-01-01T00:00:00.000Z',
      reuseToken: 'token-abc',
    })
  })

  it('wrong code → 400, no token', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockVerifyOtp.mockResolvedValue({ ok: false, reason: 'wrong' })
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '000000' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reuseToken).toBeUndefined()
  })

  it('five wrong codes (locked) → 429, must look up again', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockVerifyOtp.mockResolvedValue({ ok: false, reason: 'locked' })
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '000000' }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many tries — look yourself up again.')
  })

  it('expired code → 410', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockVerifyOtp.mockResolvedValue({ ok: false, reason: 'expired' })
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('That code expired — look yourself up again.')
  })

  it('no OTP on record (never issued / already consumed) → 400, prompts a fresh lookup', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockVerifyOtp.mockResolvedValue({ ok: false, reason: 'not-found' })
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(res.status).toBe(400)
  })

  it('unknown contact → 400 without ever calling verifyOtp', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(null)
    const res = await POST(createMockContext({ contact: 'nobody@nowhere.com', code: '042017' }))
    expect(res.status).toBe(400)
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('missing code → 400 without calling the household lookup', async () => {
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(res.status).toBe(400)
    expect(mockLookupHouseholdEntry).not.toHaveBeenCalled()
  })

  it('expired household (validUntil in the past) → 410, no OTP check', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', validUntil: '2020-01-01T00:00:00.000Z' }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(res.status).toBe(410)
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('must-resign household → 409 mustResign, no OTP check', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v2' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.mustResign).toBe(true)
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  // HOM-212 — hasPickup lets the RSVP screen decide whether to show the
  // compact "Who may pick up?" block. Moved here from lookup.json.ts's own
  // tests (HOM-218): this logic only runs once the code is verified.
  it('hasPickup is true (and pickup is included) when the on-file signature already has a pickup row', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }] }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup).toEqual({ authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }], notAuthorized: '' })
  })

  it('hasPickup is false, and no pickup key is sent, when there is none', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    const json = await res.json()
    expect(json.data.hasPickup).toBe(false)
    expect(json.data.pickup).toBeUndefined()
  })

  it('hasPickup is true when only the RSVP (not the signature) has pickup rows for the given event', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    mockGetRsvp.mockResolvedValue({
      pickup: { authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner' },
    })
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017', partyId: 'party-123' }))
    expect(mockGetRsvp).toHaveBeenCalledWith('party', 'party-123', 'wvr_abc')
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup).toEqual({ authorizedPickup: [{ name: 'Aunt Sue', phone: '2565559876' }], notAuthorized: 'Ex-partner' })
  })

  it('checks the RSVP under the workshop kind when workshopId is given instead of partyId', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', authorizedPickup: '' }))
    mockGetRsvp.mockResolvedValue(null)
    await POST(createMockContext({ contact: 'alice@test.com', code: '042017', workshopId: 'wkbk-abc' }))
    expect(mockGetRsvp).toHaveBeenCalledWith('workshop', 'wkbk-abc', 'wvr_abc')
  })

  it('does not call getRsvp when no event context is given', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    await POST(createMockContext({ contact: 'alice@test.com', code: '042017' }))
    expect(mockGetRsvp).not.toHaveBeenCalled()
  })

  it('falls back to the signature alone (never fails verification) if the RSVP read throws', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }] }),
    )
    mockGetRsvp.mockRejectedValue(new Error('boom'))
    const res = await POST(createMockContext({ contact: 'alice@test.com', code: '042017', partyId: 'party-123' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.hasPickup).toBe(true)
    expect(json.data.pickup.authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '' }])
  })
})
