import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLookupHouseholdEntry = vi.fn()
const mockIssueOtp = vi.fn()
const mockResendOtp = vi.fn()
const mockSendQuoText = vi.fn()
const mockToE164 = vi.fn()

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

describe('POST /api/waiver/lookup.json (HOM-218 — no kids/token, SMS code gate)', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mockIssueOtp.mockResolvedValue('042017')
    mockResendOtp.mockResolvedValue({ ok: true, code: '918273' })
    mockSendQuoText.mockResolvedValue(undefined)
    mockToE164.mockImplementation((phone: string) => `+1${phone.replace(/\D/g, '')}`)

    vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
    vi.mock('@lib/otp-store', () => ({
      issueOtp: (...args: any[]) => mockIssueOtp(...args),
      resendOtp: (...args: any[]) => mockResendOtp(...args),
    }))
    vi.mock('@lib/quo', () => ({
      sendQuoText: (...args: any[]) => mockSendQuoText(...args),
      toE164: (...args: any[]) => mockToE164(...args),
    }))
    vi.mock('@lib/waiver-store', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, lookupHouseholdEntry: (...args: any[]) => mockLookupHouseholdEntry(...args) }
    })
    vi.mock('@config/waiver-content', async (importOriginal) => {
      const actual: any = await importOriginal()
      return { ...actual, substantiveSince: 'v3' }
    })

    const mod = await import('@pages/api/waiver/lookup.json')
    POST = mod.POST
  })

  it('found + valid: no kids/reuseToken/recordId in the response — has kidCount, needsCode, phoneHint', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', minors: [{ name: 'Bo Test' }, { name: 'Cy Test' }] }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({
      found: true,
      firstName: 'Alice',
      kidCount: 2,
      validUntil: '2099-01-01T00:00:00.000Z',
      needsCode: true,
      phoneHint: '••34',
    })
    expect(json.data.kids).toBeUndefined()
    expect(json.data.reuseToken).toBeUndefined()
    expect(json.data.recordId).toBeUndefined()
    expect(json.data.hasPickup).toBeUndefined()
    expect(json.data.pickup).toBeUndefined()
  })

  it('texts the code to the ON-FILE phone even when looked up by email', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', phone: '2565551234' }))
    await POST(createMockContext({ contact: 'alice@test.com' })) // looked up by EMAIL
    expect(mockToE164).toHaveBeenCalledWith('2565551234') // the household's own phone, not the typed contact
    expect(mockSendQuoText).toHaveBeenCalledWith({ to: '+12565551234', content: expect.stringContaining('042017') })
    expect(mockSendQuoText.mock.calls[0][0].content).toBe('Your Hometown Studio code is 042017. It expires in 10 minutes.')
  })

  it('issues the OTP keyed to the household recordId', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', recordId: 'wvr_xyz' }))
    await POST(createMockContext({ contact: 'alice@test.com' }))
    expect(mockIssueOtp).toHaveBeenCalledWith('wvr_xyz')
  })

  it('returns smsFailed (no code, no crash) when the on-file phone cannot be normalized', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockToE164.mockReturnValue(null)
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data).toEqual({ found: true, smsFailed: true, firstName: 'Alice' })
    expect(mockIssueOtp).not.toHaveBeenCalled()
    expect(mockSendQuoText).not.toHaveBeenCalled()
  })

  it('returns smsFailed when Quo throws', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
    mockSendQuoText.mockRejectedValue(new Error('Quo API 500'))
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data).toEqual({ found: true, smsFailed: true, firstName: 'Alice' })
  })

  it('mustResign:true when the on-file version predates substantiveSince — no code sent', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v2' }))
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data).toEqual({ found: true, mustResign: true, firstName: 'Alice' })
    expect(mockIssueOtp).not.toHaveBeenCalled()
    expect(mockSendQuoText).not.toHaveBeenCalled()
  })

  it('expired: found:false, expired:true, firstName, validUntil — unchanged, no code sent', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(
      makeHousehold({ agreementVersion: 'v3', validUntil: '2020-01-01T00:00:00.000Z' }),
    )
    const res = await POST(createMockContext({ contact: 'alice@test.com' }))
    const json = await res.json()
    expect(json.data).toEqual({ found: false, expired: true, firstName: 'Alice', validUntil: '2020-01-01T00:00:00.000Z' })
    expect(mockIssueOtp).not.toHaveBeenCalled()
  })

  it('unknown contact: found:false — unchanged', async () => {
    mockLookupHouseholdEntry.mockResolvedValue(null)
    const res = await POST(createMockContext({ contact: 'nobody@nowhere.com' }))
    const json = await res.json()
    expect(json.data).toEqual({ found: false })
    expect(mockIssueOtp).not.toHaveBeenCalled()
  })

  describe('resend (resend: true)', () => {
    it('resends via the on-file phone and returns the same found shape', async () => {
      mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3', recordId: 'wvr_abc' }))
      const res = await POST(createMockContext({ contact: 'alice@test.com', resend: true }))
      expect(mockResendOtp).toHaveBeenCalledWith('wvr_abc')
      expect(mockSendQuoText).toHaveBeenCalledWith({ to: '+12565551234', content: expect.stringContaining('918273') })
      const json = await res.json()
      expect(json.data).toEqual({
        found: true,
        firstName: 'Alice',
        kidCount: 0,
        validUntil: '2099-01-01T00:00:00.000Z',
        needsCode: true,
        phoneHint: '••34',
      })
    })

    it('429s on cooldown with the exact copy', async () => {
      mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
      mockResendOtp.mockResolvedValue({ ok: false, reason: 'cooldown' })
      const res = await POST(createMockContext({ contact: 'alice@test.com', resend: true }))
      expect(res.status).toBe(429)
      expect((await res.json()).error).toBe('Give it a minute before asking for another code.')
      expect(mockSendQuoText).not.toHaveBeenCalled()
    })

    it('429s once the per-OTP send cap is hit', async () => {
      mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
      mockResendOtp.mockResolvedValue({ ok: false, reason: 'max-sends' })
      const res = await POST(createMockContext({ contact: 'alice@test.com', resend: true }))
      expect(res.status).toBe(429)
      expect(mockSendQuoText).not.toHaveBeenCalled()
    })

    it('410s when there is no OTP left to resend against', async () => {
      mockLookupHouseholdEntry.mockResolvedValue(makeHousehold({ agreementVersion: 'v3' }))
      mockResendOtp.mockResolvedValue({ ok: false, reason: 'not-found' })
      const res = await POST(createMockContext({ contact: 'alice@test.com', resend: true }))
      expect(res.status).toBe(410)
      expect((await res.json()).error).toBe('That code expired — look yourself up again.')
    })
  })
})
