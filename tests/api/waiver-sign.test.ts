import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Module mocks set up before any import ---

vi.mock('@lib/rate-limit', () => ({
  rateLimited: vi.fn().mockReturnValue(false),
}))

vi.mock('@lib/reuse-token', () => ({
  verifyReuseToken: vi.fn().mockReturnValue(true),
}))

vi.mock('@lib/party-store', () => ({
  getPartyRecord: vi.fn().mockResolvedValue(null),
}))

vi.mock('@lib/checkin-store', () => ({
  setExpected: vi.fn().mockResolvedValue(undefined),
  getCheckin: vi.fn().mockResolvedValue({ presence: {}, pickupCodeHash: null, expected: null, pickedUpBy: null, confirmedPickup: [], events: [] }),
  mutateCheckin: vi.fn().mockResolvedValue(undefined),
}))

const mockSaveWaiverRecord = vi.fn().mockResolvedValue(undefined)
const mockGetWaiverRecord = vi.fn()
const mockUpsertWaiverInPartyIndex = vi.fn().mockResolvedValue({ replacedRecordId: null })
const mockUpsertWaiverInEventIndex = vi.fn().mockResolvedValue({ replacedRecordId: null })
const mockIndexWaiverByContact = vi.fn().mockResolvedValue(undefined)
const mockNewWaiverId = vi.fn().mockReturnValue('wvr_test_abc')

vi.mock('@lib/waiver-store', () => ({
  saveWaiverRecord: (...args: any[]) => mockSaveWaiverRecord(...args),
  getWaiverRecord: (...args: any[]) => mockGetWaiverRecord(...args),
  upsertWaiverInPartyIndex: (...args: any[]) => mockUpsertWaiverInPartyIndex(...args),
  upsertWaiverInEventIndex: (...args: any[]) => mockUpsertWaiverInEventIndex(...args),
  indexWaiverByContact: (...args: any[]) => mockIndexWaiverByContact(...args),
  newWaiverId: () => mockNewWaiverId(),
}))

vi.mock('@config/providers', () => ({
  providers: {
    customer: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 'cust-1', email: 'alice@example.com', givenName: 'Alice', familyName: 'Test' }),
      appendNote: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

// --- Helpers ---

const NOW = '2026-09-01T18:00:00.000Z'
const FUTURE_PARTY_ISO = '2026-09-05T14:00:00.000Z'

function makeAdultBody(overrides: Record<string, any> = {}) {
  return {
    adult: {
      firstName: 'Alice',
      lastName: 'Test',
      email: 'alice@test.com',
      phone: '2565551234',
      dob: '1990-01-01',
    },
    minors: [],
    emergency: { name: 'Bob Test', phone: '2565555678', relationship: 'Spouse' },
    authorizedPickup: '',
    adultAllergies: '',
    photoConsent: true,
    agreeRelease: true,
    signature: 'Alice Test',
    partyId: null,
    attending: ['adult'],
    responsibleAdult: '',
    ...overrides,
  }
}

function makeReuseSource() {
  return {
    id: 'wvr_source_abc',
    agreementVersion: 'v2',
    agreementSha256: 'abc123',
    signedAt: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    adult: { firstName: 'Alice', lastName: 'Test', email: 'alice@test.com', phone: '2565551234', dob: '1990-01-01', allergies: '' },
    minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
    emergency: { name: 'Bob Test', phone: '2565555678', relationship: 'Spouse' },
    authorizedPickup: '',
    photoConsent: true,
    signature: 'Alice Test',
    partyId: null,
    responsibleAdult: null,
    squareCustomerId: null,
    ip: null,
    userAgent: null,
  }
}

function createMockContext(body: any, url = 'http://localhost/api/waiver/sign.json') {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request, url: new URL(url), params: {}, redirect: () => new Response(), locals: {}, clientAddress: '127.0.0.1' } as any
}

// --- Tests ---

describe('POST /api/waiver/sign.json — responsible adult enforcement', () => {
  let POST: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Re-mock after resetModules
    vi.mock('@lib/rate-limit', () => ({ rateLimited: vi.fn().mockReturnValue(false) }))
    vi.mock('@lib/reuse-token', () => ({ verifyReuseToken: vi.fn().mockReturnValue(true) }))
    vi.mock('@lib/checkin-store', () => ({
      setExpected: vi.fn().mockResolvedValue(undefined),
      getCheckin: vi.fn().mockResolvedValue({ presence: {}, pickupCodeHash: null, expected: null, pickedUpBy: null, confirmedPickup: [], events: [] }),
      mutateCheckin: vi.fn().mockResolvedValue(undefined),
    }))
    vi.mock('@lib/waiver-store', () => ({
      saveWaiverRecord: (...args: any[]) => mockSaveWaiverRecord(...args),
      getWaiverRecord: (...args: any[]) => mockGetWaiverRecord(...args),
      upsertWaiverInPartyIndex: (...args: any[]) => mockUpsertWaiverInPartyIndex(...args),
      upsertWaiverInEventIndex: (...args: any[]) => mockUpsertWaiverInEventIndex(...args),
      indexWaiverByContact: (...args: any[]) => mockIndexWaiverByContact(...args),
      newWaiverId: () => mockNewWaiverId(),
    }))
    vi.mock('@config/providers', () => ({
      providers: {
        customer: {
          findOrCreate: vi.fn().mockResolvedValue({ id: 'cust-1', email: 'alice@test.com', givenName: 'Alice', familyName: 'Test' }),
          appendNote: vi.fn().mockResolvedValue(undefined),
        },
      },
    }))
    // Mock party-store to return a valid future party
    vi.mock('@lib/party-store', () => ({
      getPartyRecord: vi.fn().mockResolvedValue({ startIso: FUTURE_PARTY_ISO, bookingId: 'party-123' }),
    }))

    mockSaveWaiverRecord.mockResolvedValue(undefined)
    mockUpsertWaiverInPartyIndex.mockResolvedValue({ replacedRecordId: null })
    mockUpsertWaiverInEventIndex.mockResolvedValue({ replacedRecordId: null })
    mockIndexWaiverByContact.mockResolvedValue(undefined)
    mockNewWaiverId.mockReturnValue('wvr_test_abc')

    const mod = await import('@pages/api/waiver/sign.json')
    POST = mod.POST
  })

  describe('fresh-form path — party RSVP with kids only, no signer', () => {
    it('returns 400 when kids are attending but adult is not and no responsibleAdult given', async () => {
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['child:0'], // kids only, adult NOT coming
        responsibleAdult: '',
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/drop-off/i)
    })

    it('returns 200 when kids are attending but adult is not, and responsibleAdult is provided', async () => {
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['child:0'], // kids only, adult NOT coming
        responsibleAdult: 'Grandma Sue',
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data).toBeDefined()
      // Confirm responsibleAdult was stored
      const savedRecord = mockSaveWaiverRecord.mock.calls[0]?.[0]
      expect(savedRecord?.responsibleAdult).toBe('Grandma Sue')
    })
  })

  describe('reuse path — party RSVP with kids only, no signer', () => {
    it('returns 400 when kids are attending but adult is not and no responsibleAdult given', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['child:0'], // kids only, adult NOT coming
        responsibleAdult: '',
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/drop-off/i)
    })

    it('returns 200 when kids are attending but adult is not, and responsibleAdult is provided', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['child:0'],
        responsibleAdult: 'Uncle Bob',
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data).toBeDefined()
      const savedRecord = mockSaveWaiverRecord.mock.calls[0]?.[0]
      expect(savedRecord?.responsibleAdult).toBe('Uncle Bob')
    })
  })

  describe('workshop context — signs with workshopId, indexes under event-index-workshop:', () => {
    it('returns 200 and records context.kind=workshop when workshopId is provided', async () => {
      const body = makeAdultBody({ workshopId: 'wkbk-abc123', partyId: null })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data).toBeDefined()
      // context should be set
      expect(json.data.context).toEqual({ kind: 'workshop', id: 'wkbk-abc123' })
      // partyId should be null
      expect(json.data.partyId).toBeNull()
      // upsertWaiverInEventIndex should have been called with kind='workshop'
      expect(mockUpsertWaiverInEventIndex).toHaveBeenCalledWith('workshop', 'wkbk-abc123', expect.any(Object))
    })

    it('returns 400 when both partyId and workshopId are provided', async () => {
      const body = makeAdultBody({ workshopId: 'wkbk-abc123', partyId: 'party-123' })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/one event/i)
    })
  })
})
