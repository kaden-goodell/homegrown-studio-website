import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dropOffAddendum } from '@config/waiver-content'

// --- Module mocks set up before any import ---

vi.mock('@lib/rate-limit', () => ({
  rateLimited: vi.fn().mockReturnValue(false),
}))

vi.mock('@lib/reuse-token', () => ({
  verifyReuseToken: vi.fn().mockReturnValue(true),
}))

vi.mock('@lib/checkin-store', () => ({
  setExpected: vi.fn().mockResolvedValue(undefined),
  getCheckin: vi.fn().mockResolvedValue({ presence: {}, pickupCodeHash: null, expected: null, pickedUpBy: null, confirmedPickup: [], events: [] }),
  mutateCheckin: vi.fn().mockResolvedValue(undefined),
}))

const mockSaveWaiverRecord = vi.fn().mockResolvedValue(undefined)
const mockGetWaiverRecord = vi.fn()
const mockUpsertWaiverInEventIndex = vi.fn().mockResolvedValue({ replacedRecordId: null })
const mockIndexWaiverByContact = vi.fn().mockResolvedValue(undefined)
const mockNewWaiverId = vi.fn().mockReturnValue('wvr_test_abc')

vi.mock('@lib/waiver-store', () => ({
  saveWaiverRecord: (...args: any[]) => mockSaveWaiverRecord(...args),
  getWaiverRecord: (...args: any[]) => mockGetWaiverRecord(...args),
  upsertWaiverInEventIndex: (...args: any[]) => mockUpsertWaiverInEventIndex(...args),
  indexWaiverByContact: (...args: any[]) => mockIndexWaiverByContact(...args),
  newWaiverId: () => mockNewWaiverId(),
}))

const mockUpsertRsvp = vi.fn()

vi.mock('@lib/rsvp-store', () => ({
  upsertRsvp: (...args: any[]) => mockUpsertRsvp(...args),
}))

const mockGetEvent = vi.fn()

vi.mock('@lib/events', () => ({
  getEvent: (...args: any[]) => mockGetEvent(...args),
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
// Far-future fixed dates so this file can't rot the way the old
// FUTURE_PARTY_ISO constant did — `getEvent` is mocked directly (Task 3), so
// nothing here depends on real party/workshop storage or today's date.
const FUTURE_PARTY_ISO = '2099-01-01T14:00:00.000Z'
const FUTURE_WORKSHOP_ISO = '2099-01-05T18:00:00.000Z'

function partyEvent(overrides: Record<string, any> = {}) {
  return {
    kind: 'party',
    id: 'party-123',
    title: 'Test Party',
    startIso: FUTURE_PARTY_ISO,
    days: ['2099-01-01'],
    dropOff: false,
    ...overrides,
  }
}

function workshopEvent(overrides: Record<string, any> = {}) {
  return {
    kind: 'workshop',
    id: 'wkbk-abc123',
    title: 'Test Workshop',
    startIso: FUTURE_WORKSHOP_ISO,
    days: ['2099-01-05'],
    dropOff: false,
    seats: 5,
    ...overrides,
  }
}

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

function makeReuseSource(overrides: Record<string, any> = {}) {
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
    squareCustomerId: null,
    ip: null,
    userAgent: null,
    ...overrides,
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

describe('POST /api/waiver/sign.json', () => {
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
      upsertWaiverInEventIndex: (...args: any[]) => mockUpsertWaiverInEventIndex(...args),
      indexWaiverByContact: (...args: any[]) => mockIndexWaiverByContact(...args),
      newWaiverId: () => mockNewWaiverId(),
    }))
    vi.mock('@lib/rsvp-store', () => ({ upsertRsvp: (...args: any[]) => mockUpsertRsvp(...args) }))
    vi.mock('@lib/events', () => ({ getEvent: (...args: any[]) => mockGetEvent(...args) }))
    vi.mock('@config/providers', () => ({
      providers: {
        customer: {
          findOrCreate: vi.fn().mockResolvedValue({ id: 'cust-1', email: 'alice@test.com', givenName: 'Alice', familyName: 'Test' }),
          appendNote: vi.fn().mockResolvedValue(undefined),
        },
      },
    }))

    mockSaveWaiverRecord.mockResolvedValue(undefined)
    mockUpsertWaiverInEventIndex.mockResolvedValue({ replacedRecordId: null })
    mockIndexWaiverByContact.mockResolvedValue(undefined)
    mockNewWaiverId.mockReturnValue('wvr_test_abc')
    mockUpsertRsvp.mockResolvedValue({
      id: 'rsv_test_abc',
      waiverId: 'wvr_test_abc',
      event: { kind: 'party', id: 'party-123' },
      attending: ['adult'],
      responsibleAdult: null,
      addendumVersion: null,
      addendumSha256: null,
      at: NOW,
      firstAt: NOW,
      ip: null,
      userAgent: null,
    })
    mockGetEvent.mockImplementation(async (kind: string, id: string) => {
      if (kind === 'party' && id === 'party-123') return partyEvent()
      if (kind === 'workshop' && id === 'wkbk-abc123') return workshopEvent()
      return null
    })

    const mod = await import('@pages/api/waiver/sign.json')
    POST = mod.POST
  })

  describe('fresh sign — writes a signature AND an RSVP in an event context', () => {
    it('party context: saves the WaiverRecord and calls upsertRsvp with the attending list', async () => {
      const body = makeAdultBody({ partyId: 'party-123' })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)

      // saveWaiverRecord is called twice: once to persist the signature, and
      // again by attachSquare's best-effort re-save with squareCustomerId —
      // pre-existing behavior, unchanged by this task.
      expect(mockSaveWaiverRecord).toHaveBeenCalled()
      expect(mockUpsertRsvp).toHaveBeenCalledTimes(1)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          waiverId: 'wvr_test_abc',
          event: { kind: 'party', id: 'party-123' },
          attending: ['adult'],
        }),
      )
      // The new WaiverRecord itself no longer carries partyId/context/responsibleAdult.
      const saved = mockSaveWaiverRecord.mock.calls[0][0]
      expect(saved.partyId).toBeUndefined()
      expect(saved.context).toBeUndefined()
      expect(saved.responsibleAdult).toBeUndefined()
    })

    it('no event context (walk-in): saves the WaiverRecord but never calls upsertRsvp', async () => {
      const body = makeAdultBody({ partyId: null })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockSaveWaiverRecord).toHaveBeenCalled()
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    it('responsible-adult is stored on the RSVP, not the WaiverRecord', async () => {
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['child:0'],
        responsibleAdult: 'Grandma Sue',
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({ responsibleAdult: 'Grandma Sue', attending: ['child:0'] }),
      )
    })

    it('returns 400 when kids are attending but adult is not and no responsibleAdult given', async () => {
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['child:0'],
        responsibleAdult: '',
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/needs an adult at the party/i)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    it('skips the responsible-adult requirement for studio-run drop-off events', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['child:0'],
        responsibleAdult: '',
        agreeAddendum: true,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
    })
  })

  describe('drop-off addendum (HOM-211)', () => {
    it('drop-off event + a minor attending + no addendum acceptance → 400, nothing written', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['adult', 'child:0'],
        agreeAddendum: false,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/Drop-off Program Addendum/i)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    it('drop-off event + a minor attending + addendum accepted → RSVP carries addendumVersion/addendumSha256, response echoes addendumAccepted', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['adult', 'child:0'],
        agreeAddendum: true,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          addendumVersion: dropOffAddendum.version,
          addendumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      )
      const [rsvpArgs] = mockUpsertRsvp.mock.calls[0]
      const json = await res.json()
      expect(json.data.addendumAccepted).toEqual({
        version: dropOffAddendum.version,
        sha256: rsvpArgs.addendumSha256,
      })
    })

    it('non-drop-off event ignores agreeAddendum entirely — no error, no addendum fields written', async () => {
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['adult', 'child:0'],
        agreeAddendum: false,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({ addendumVersion: null, addendumSha256: null }),
      )
      const json = await res.json()
      expect(json.data.addendumAccepted).toBeNull()
    })

    it('drop-off event but no minor attending (adult-only) skips the requirement', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const body = makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '' }],
        attending: ['adult'],
        agreeAddendum: false,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({ addendumVersion: null, addendumSha256: null }),
      )
    })

    it('returning path also enforces it: drop-off + minor attending + no addendum acceptance → 400', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
        agreeAddendum: false,
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/Drop-off Program Addendum/i)
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    it('returning path with addendum accepted writes the addendum fields on the RSVP', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
        agreeAddendum: true,
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          addendumVersion: dropOffAddendum.version,
          addendumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      )
    })
  })

  describe('reuse (returning-customer) path — RSVP only, no new signature', () => {
    it('does not call saveWaiverRecord, and calls upsertRsvp with the source waiverId', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data.waiverId).toBe('wvr_source_abc')
      expect(json.data.rsvpId).toBeDefined()

      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          waiverId: 'wvr_source_abc',
          event: { kind: 'party', id: 'party-123' },
          attending: ['adult', 'child:0'],
          responsibleAdult: null,
        }),
      )
    })

    it('returns 400 when kids are attending but adult is not and no responsibleAdult given', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['child:0'],
        responsibleAdult: '',
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/needs an adult at the party/i)
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    it('returns 200 and stores responsibleAdult on the RSVP when provided', async () => {
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
      expect(mockUpsertRsvp).toHaveBeenCalledWith(expect.objectContaining({ responsibleAdult: 'Uncle Bob' }))
    })

    it('with no event context, re-confirms coverage without writing any RSVP', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = { reuseRecordId: 'wvr_source_abc', reuseToken: 'valid-token' }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data.waiverId).toBe('wvr_source_abc')
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })
  })

  describe('forced re-sign (mustResign) — HOM-210', () => {
    it('returns 409 mustResign when the source record predates substantiveSince', async () => {
      vi.doMock('@config/waiver-content', async (importOriginal) => {
        const actual: any = await importOriginal()
        return { ...actual, substantiveSince: 'v3' }
      })
      vi.resetModules()
      // Re-establish every mock after resetModules (vi.doMock isn't hoisted,
      // so this describe block re-imports its own fully-mocked instance).
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
        upsertWaiverInEventIndex: (...args: any[]) => mockUpsertWaiverInEventIndex(...args),
        indexWaiverByContact: (...args: any[]) => mockIndexWaiverByContact(...args),
        newWaiverId: () => mockNewWaiverId(),
      }))
      vi.mock('@lib/rsvp-store', () => ({ upsertRsvp: (...args: any[]) => mockUpsertRsvp(...args) }))
      vi.mock('@lib/events', () => ({ getEvent: (...args: any[]) => mockGetEvent(...args) }))
      vi.mock('@config/providers', () => ({
        providers: {
          customer: {
            findOrCreate: vi.fn().mockResolvedValue({ id: 'cust-1' }),
            appendNote: vi.fn().mockResolvedValue(undefined),
          },
        },
      }))

      mockGetWaiverRecord.mockResolvedValue(makeReuseSource({ agreementVersion: 'v2' }))
      mockGetEvent.mockImplementation(async (kind: string, id: string) => {
        if (kind === 'party' && id === 'party-123') return partyEvent()
        return null
      })

      const mod = await import('@pages/api/waiver/sign.json')
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult'],
        responsibleAdult: '',
      }
      const ctx = createMockContext(body)
      const res = await mod.POST(ctx)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.mustResign).toBe(true)
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()

      vi.doUnmock('@config/waiver-content')
    })
  })

  describe('workshop context — RSVP attaches to the class, not the per-seat booking', () => {
    it('fresh sign: event.kind is workshop, keyed by classScheduleId, and stores ref.bookingId', async () => {
      const body = makeAdultBody({ workshopId: 'wkbk-abc123', partyId: null, booking: 'seat-booking-1' })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.data.context).toEqual({ kind: 'workshop', id: 'wkbk-abc123' })
      expect(json.data.partyId).toBeNull()

      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          event: { kind: 'workshop', id: 'wkbk-abc123' },
          ref: { bookingId: 'seat-booking-1' },
        }),
      )
      expect(mockUpsertWaiverInEventIndex).toHaveBeenCalledWith('workshop', 'wkbk-abc123', expect.any(Object), expect.any(String))
    })

    it('two households booking two different seats both attach to the same class', async () => {
      const bodyA = makeAdultBody({ workshopId: 'wkbk-abc123', partyId: null, booking: 'seat-1', adult: { firstName: 'Mom', lastName: 'A', email: 'mom@test.com', phone: '2565551111', dob: '1985-01-01' }, signature: 'Mom A' })
      mockNewWaiverId.mockReturnValueOnce('wvr_mom')
      const resA = await POST(createMockContext(bodyA))
      expect(resA.status).toBe(200)

      const bodyB = makeAdultBody({ workshopId: 'wkbk-abc123', partyId: null, booking: 'seat-2', adult: { firstName: 'Dad', lastName: 'B', email: 'dad@test.com', phone: '2565552222', dob: '1985-01-01' }, signature: 'Dad B' })
      mockNewWaiverId.mockReturnValueOnce('wvr_dad')
      const resB = await POST(createMockContext(bodyB))
      expect(resB.status).toBe(200)

      expect(mockUpsertRsvp).toHaveBeenCalledTimes(2)
      const events = mockUpsertRsvp.mock.calls.map((c) => c[0].event)
      expect(events).toEqual([
        { kind: 'workshop', id: 'wkbk-abc123' },
        { kind: 'workshop', id: 'wkbk-abc123' },
      ])
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
