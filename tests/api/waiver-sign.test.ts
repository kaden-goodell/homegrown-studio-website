import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
const mockGetRsvp = vi.fn().mockResolvedValue(null)

vi.mock('@lib/rsvp-store', () => ({
  upsertRsvp: (...args: any[]) => mockUpsertRsvp(...args),
  getRsvp: (...args: any[]) => mockGetRsvp(...args),
}))

const mockSendAgreementCopyEmail = vi.fn().mockResolvedValue({ sent: true })
const mockSendDropOffDetailsEmail = vi.fn().mockResolvedValue({ sent: true })

vi.mock('@lib/email', () => ({
  sendAgreementCopyEmail: (...args: any[]) => mockSendAgreementCopyEmail(...args),
  sendDropOffDetailsEmail: (...args: any[]) => mockSendDropOffDetailsEmail(...args),
}))

const mockGetEvent = vi.fn()

vi.mock('@lib/events', () => ({
  getEvent: (...args: any[]) => mockGetEvent(...args),
  // Concurrent Task 7 work extracted the "already happened" cutoff into this
  // shared helper — every event here is a fixed future date, so it's always false.
  isEventPast: () => false,
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
    authorizedPickup: [],
    notAuthorized: '',
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
    agreementVersion: 'v3',
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
    // The endpoint compares the party time with the real clock. Pin "now" to
    // just before FUTURE_PARTY_ISO so these don't expire with the calendar.
    // Date only — the handler's async work still runs on real timers.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))

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
    vi.mock('@lib/rsvp-store', () => ({
      upsertRsvp: (...args: any[]) => mockUpsertRsvp(...args),
      getRsvp: (...args: any[]) => mockGetRsvp(...args),
    }))
    vi.mock('@lib/events', () => ({ getEvent: (...args: any[]) => mockGetEvent(...args), isEventPast: () => false }))
    vi.mock('@config/providers', () => ({
      providers: {
        customer: {
          findOrCreate: vi.fn().mockResolvedValue({ id: 'cust-1', email: 'alice@test.com', givenName: 'Alice', familyName: 'Test' }),
          appendNote: vi.fn().mockResolvedValue(undefined),
        },
      },
    }))
    vi.mock('@lib/email', () => ({
      sendAgreementCopyEmail: (...args: any[]) => mockSendAgreementCopyEmail(...args),
      sendDropOffDetailsEmail: (...args: any[]) => mockSendDropOffDetailsEmail(...args),
    }))

    mockSaveWaiverRecord.mockResolvedValue(undefined)
    mockUpsertWaiverInEventIndex.mockResolvedValue({ replacedRecordId: null })
    mockIndexWaiverByContact.mockResolvedValue(undefined)
    mockNewWaiverId.mockReturnValue('wvr_test_abc')
    mockSendAgreementCopyEmail.mockReset().mockResolvedValue({ sent: true })
    mockGetRsvp.mockResolvedValue(null)
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

  afterEach(() => {
    vi.useRealTimers()
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

    it('fails closed (503, nothing saved) when getEvent throws on a party lookup (HOM-219 M10)', async () => {
      mockGetEvent.mockRejectedValueOnce(new Error('Blobs outage'))
      const body = makeAdultBody({ partyId: 'party-123' })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toMatch(/couldn.t reach storage/i)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
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
    it('returns 409 mustResign when the source record predates substantiveSince (a v2 signature must re-sign under v3)', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource({ agreementVersion: 'v2' }))
      mockGetEvent.mockResolvedValueOnce(partyEvent())
      const ctx = createMockContext({
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult'],
        responsibleAdult: '',
      })
      const res = await POST(ctx)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.mustResign).toBe(true)
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
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

  describe('authorized pickup + notAuthorized + medications (HOM-212)', () => {
    it('rejects more than 3 pickup rows', async () => {
      const body = makeAdultBody({
        authorizedPickup: [
          { name: 'Grandma Rivera', phone: '' },
          { name: 'Uncle Joe', phone: '' },
          { name: 'Aunt Sue', phone: '' },
          { name: 'Cousin Max', phone: '' },
        ],
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })

    it('rejects a pickup row with a 1-character name', async () => {
      const body = makeAdultBody({ authorizedPickup: [{ name: 'J', phone: '' }] })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })

    it('rejects a pickup phone under 10 digits', async () => {
      const body = makeAdultBody({ authorizedPickup: [{ name: 'Grandma Rivera', phone: '12345' }] })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })

    it('stores valid pickup rows and notAuthorized on the WaiverRecord', async () => {
      const body = makeAdultBody({
        authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }],
        notAuthorized: 'Bio dad — court order on file',
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const saved = mockSaveWaiverRecord.mock.calls[0][0]
      expect(saved.authorizedPickup).toEqual([{ name: 'Grandma Rivera', phone: '2565551234' }])
      expect(saved.notAuthorized).toBe('Bio dad — court order on file')
    })

    it('preserves the literal "None" for adult and child allergies', async () => {
      const body = makeAdultBody({
        adultAllergies: 'None',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: 'None', medications: '' }],
        attending: ['adult', 'child:0'],
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const saved = mockSaveWaiverRecord.mock.calls[0][0]
      expect(saved.adult.allergies).toBe('None')
      expect(saved.minors[0].allergies).toBe('None')
    })

    it('stores per-child medications', async () => {
      const body = makeAdultBody({
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '', medications: 'Inhaler for asthma' }],
        attending: ['adult', 'child:0'],
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const saved = mockSaveWaiverRecord.mock.calls[0][0]
      expect(saved.minors[0].medications).toBe('Inhaler for asthma')
    })

    it('drop-off event with no pickup rows at all still signs fine (signer may be the only collector)', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const body = makeAdultBody({
        partyId: 'party-123',
        authorizedPickup: [],
        agreeAddendum: true,
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
    })

    // Fix round 1 (HOM-212): reject over-length text instead of silently
    // truncating — a 300-char medical note or a 200-char custody note
    // getting quietly cut off is exactly the kind of thing that should be
    // loud, not silent.
    it('rejects notAuthorized over 200 characters', async () => {
      const body = makeAdultBody({ notAuthorized: 'x'.repeat(201) })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/under 200 characters/i)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })

    it('rejects medications over 300 characters', async () => {
      const body = makeAdultBody({
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '', medications: 'x'.repeat(301) }],
        attending: ['adult', 'child:0'],
      })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/under 300 characters/i)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
    })
  })

  describe('reuse RSVP pickupUpdate (HOM-212)', () => {
    it('stores a validated pickupUpdate on the RSVP as `pickup`, never touching the on-file signature', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
        pickupUpdate: {
          authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }],
          notAuthorized: 'Bio dad',
        },
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockSaveWaiverRecord).not.toHaveBeenCalled()
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          pickup: { authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' },
        }),
      )
    })

    it('rejects more than 3 rows in a pickupUpdate', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        pickupUpdate: {
          authorizedPickup: [
            { name: 'A Aaa', phone: '' },
            { name: 'B Bbb', phone: '' },
            { name: 'C Ccc', phone: '' },
            { name: 'D Ddd', phone: '' },
          ],
          notAuthorized: '',
        },
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(400)
      expect(mockUpsertRsvp).not.toHaveBeenCalled()
    })

    // Fix round 1 (HOM-212): upsertRsvp fully replaces the record, so a
    // re-RSVP (e.g. just changing headcount) that sends NO pickupUpdate must
    // never silently erase a pickup override saved on an earlier RSVP.
    it('re-RSVP with no pickupUpdate carries forward the existing RSVP pickup', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      mockGetRsvp.mockResolvedValue({
        id: 'rsv_prev',
        waiverId: 'wvr_source_abc',
        event: { kind: 'party', id: 'party-123' },
        pickup: { authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' },
      })
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
        // no pickupUpdate — just re-confirming who's coming
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          pickup: { authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' },
        }),
      )
    })

    it('re-RSVP WITH a pickupUpdate replaces the prior pickup rather than merging it', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      mockGetRsvp.mockResolvedValue({
        id: 'rsv_prev',
        waiverId: 'wvr_source_abc',
        event: { kind: 'party', id: 'party-123' },
        pickup: { authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565551234' }], notAuthorized: 'Bio dad' },
      })
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        pickupUpdate: { authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: '' },
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({
          pickup: { authorizedPickup: [{ name: 'Aunt Sue', phone: '' }], notAuthorized: '' },
        }),
      )
    })

    it('a fresh reuse RSVP (no prior RSVP on file) with no pickupUpdate omits pickup entirely', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      mockGetRsvp.mockResolvedValue(null)
      const body = {
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
      }
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      const [rsvpArgs] = mockUpsertRsvp.mock.calls[0]
      expect(rsvpArgs.pickup).toBeUndefined()
    })
  })

  describe('agreement copy email (HOM-216)', () => {
    it('fresh sign: sends the agreement copy email once, fire-and-forget', async () => {
      const body = makeAdultBody({ partyId: null })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockSendAgreementCopyEmail).toHaveBeenCalledTimes(1)
      expect(mockSendAgreementCopyEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({ id: 'wvr_test_abc' }),
        }),
      )
      expect(mockSendDropOffDetailsEmail).not.toHaveBeenCalled()
    })

    it('returning RSVP: the agreement is already on file, so no copy email', async () => {
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const ctx = createMockContext({
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
      })
      const res = await POST(ctx)
      expect(res.status).toBe(200)
      expect(mockSendAgreementCopyEmail).not.toHaveBeenCalled()
    })

    it('a thrown/rejected email error still returns 200 — the signature is already saved', async () => {
      mockSendAgreementCopyEmail.mockRejectedValueOnce(new Error('SMTP down'))
      const body = makeAdultBody({ partyId: null })
      const ctx = createMockContext(body)
      const res = await POST(ctx)
      expect(res.status).toBe(200)
    })
  })

  describe('drop-off details email', () => {
    it('fresh RSVP to a drop-off event sends the details email', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const res = await POST(createMockContext(makeAdultBody({
        partyId: 'party-123',
        minors: [{ name: 'Child One', dob: '2018-05-01', allergies: '', medications: '' }],
        attending: ['adult', 'child:0'],
      })))
      expect(res.status).toBe(200)
      expect(mockSendDropOffDetailsEmail).toHaveBeenCalledTimes(1)
      expect(mockSendDropOffDetailsEmail).toHaveBeenCalledWith(
        expect.objectContaining({ record: expect.objectContaining({ id: 'wvr_test_abc' }), event: expect.objectContaining({ id: 'party-123' }) }),
      )
    })

    it('returning RSVP to a drop-off event sends the details email', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      const res = await POST(createMockContext({
        reuseRecordId: 'wvr_source_abc',
        reuseToken: 'valid-token',
        partyId: 'party-123',
        attending: ['adult', 'child:0'],
        responsibleAdult: '',
      }))
      expect(res.status).toBe(200)
      expect(mockSendDropOffDetailsEmail).toHaveBeenCalledTimes(1)
      expect(mockSendDropOffDetailsEmail).toHaveBeenCalledWith(
        expect.objectContaining({ record: expect.objectContaining({ id: 'wvr_source_abc' }) }),
      )
    })

    it('a non-drop-off event (fresh or returning) does not', async () => {
      mockGetEvent.mockResolvedValueOnce(partyEvent())
      await POST(createMockContext(makeAdultBody({ partyId: 'party-123' })))
      mockGetEvent.mockResolvedValueOnce(partyEvent())
      mockGetWaiverRecord.mockResolvedValue(makeReuseSource())
      await POST(createMockContext({
        reuseRecordId: 'wvr_source_abc', reuseToken: 'valid-token', partyId: 'party-123', attending: ['adult'], responsibleAdult: '',
      }))
      expect(mockSendDropOffDetailsEmail).not.toHaveBeenCalled()
    })

    it('a rejected details email still returns 200', async () => {
      mockSendDropOffDetailsEmail.mockRejectedValueOnce(new Error('SMTP down'))
      mockGetEvent.mockResolvedValueOnce(partyEvent({ dropOff: true }))
      const res = await POST(createMockContext(makeAdultBody({ partyId: 'party-123' })))
      expect(res.status).toBe(200)
    })
  })
})
