import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
vi.mock('@lib/reuse-token', () => ({ issueReuseToken: vi.fn().mockReturnValue('token-abc') }))

const mockLookupHouseholdEntry = vi.fn()
vi.mock('@lib/waiver-store', () => ({
  lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args),
}))

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
    vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
    vi.mock('@lib/reuse-token', () => ({ issueReuseToken: vi.fn().mockReturnValue('token-abc') }))
    vi.mock('@lib/waiver-store', () => ({ lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args) }))
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
})
