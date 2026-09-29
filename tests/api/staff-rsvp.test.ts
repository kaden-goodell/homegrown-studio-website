import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

// "+ Add family" at the door: adds a household to an event's roster AND marks
// the chosen people here, through the same code path as checkin.json.
let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getEvent: (...a: any[]) => mockGetEvent(...a) }
})

const mockGetWaiverRecord = vi.fn()
const mockIndex = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    getWaiverRecord: (...a: any[]) => mockGetWaiverRecord(...a),
    upsertWaiverInEventIndex: (...a: any[]) => mockIndex(...a),
  }
})

const mockUpsertRsvp = vi.fn()
const mockGetRsvp = vi.fn()
const mockLatest = vi.fn()
vi.mock('@lib/rsvp-store', () => ({
  upsertRsvp: (...a: any[]) => mockUpsertRsvp(...a),
  getRsvp: (...a: any[]) => mockGetRsvp(...a),
  getLatestPickupForWaiver: (...a: any[]) => mockLatest(...a),
}))

const mockSendQuoText = vi.fn()
vi.mock('@lib/quo', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, sendQuoText: (...a: any[]) => mockSendQuoText(...a) }
})

let state: CheckinState
let oldState: CheckinState
vi.mock('@lib/checkin-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/checkin-store')>()),
  getCheckin: async () => oldState,
  mutateCheckin: async (_k: string, _r: string, fn: (s: CheckinState) => void | Promise<void>) => {
    await fn(state)
    return state
  },
}))

const emptyState = (): CheckinState => ({
  expected: null, days: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '',
  pickupCodeHash: null, codeAttempts: 0, lockedAt: null, releasedTo: {}, events: [], pickupSeeded: false,
})

const party = { kind: 'party', id: 'p1', title: 'Rivera Party', startIso: '2026-09-05T14:00:00.000Z', days: ['2026-09-05'], dropOff: false }
const pno = { kind: 'workshop', id: 'ws-1', title: 'Parents Night Out', startIso: '2026-09-05T23:00:00.000Z', days: ['2026-09-05'], dropOff: true }
const waiver = (over: Record<string, any> = {}) => ({
  id: 'wvr_1',
  adult: { firstName: 'Jamie', lastName: 'Rivera', email: 'j@x.com', phone: '2565550199', dob: '1990-01-01', allergies: '' },
  minors: [
    { name: 'Kiddo Rivera', dob: '2018-01-01', allergies: '', medications: '' },
    { name: 'Second Rivera', dob: '2019-01-01', allergies: '', medications: '' },
  ],
  authorizedPickup: [], notAuthorized: '', agreementVersion: 'v3',
  validUntil: new Date(Date.now() + 86_400_000 * 100).toISOString(),
  ...over,
})

let POST: any
const call = (body: any) =>
  POST({ request: new Request('http://localhost/api/staff/rsvp.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) } as any)
const base = { kind: 'party', id: 'p1', recordId: 'wvr_1', day: '2026-09-05' }

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  state = emptyState()
  oldState = emptyState()
  mockGetEvent.mockResolvedValue(party)
  mockGetWaiverRecord.mockResolvedValue(waiver())
  mockGetRsvp.mockResolvedValue(null)
  mockLatest.mockReset().mockResolvedValue(null)
  mockUpsertRsvp.mockResolvedValue({ id: 'rsv_1' })
  mockIndex.mockResolvedValue({ replacedRecordId: null })
  mockSendQuoText.mockResolvedValue(undefined)
  POST = (await import('@pages/api/staff/rsvp.json')).POST
})

describe('POST /api/staff/rsvp.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await call({ ...base, attending: ['adult'] })
    expect(res.status).toBe(401)
    expect(mockUpsertRsvp).not.toHaveBeenCalled()
  })

  it('adds the RSVP, indexes the household, and marks the chosen people here', async () => {
    const res = await call({ ...base, attending: ['adult', 'child:0', 'child:1'] })
    expect(res.status).toBe(200)
    expect(mockUpsertRsvp).toHaveBeenCalledWith(expect.objectContaining({
      waiverId: 'wvr_1',
      event: { kind: 'party', id: 'p1' },
      attending: ['adult', 'child:0', 'child:1'],
      responsibleAdult: null,
      by: { id: 't', name: 'Test' },
    }))
    expect(mockIndex).toHaveBeenCalledWith('party', 'p1', expect.objectContaining({ id: 'wvr_1' }), 'rsv_1')
    expect(Object.keys(state.days['2026-09-05'].presence).sort()).toEqual(['adult', 'child:0', 'child:1'])
    expect(state.events.at(-1)).toMatchObject({ action: 'checkin', by: { id: 't', name: 'Test' } })
    expect(state.expected).toEqual(['adult', 'child:0', 'child:1'])
    const json = await res.json()
    expect(json.data.oneTimeCode).toBeUndefined() // not a drop-off event
    expect(mockSendQuoText).not.toHaveBeenCalled()
  })

  it('respects an attending subset', async () => {
    const res = await call({ ...base, attending: ['child:1'] })
    expect(res.status).toBe(200)
    expect(Object.keys(state.days['2026-09-05'].presence)).toEqual(['child:1'])
    expect(mockUpsertRsvp.mock.calls[0][0].attending).toEqual(['child:1'])
  })

  it('drops person ids that are not on the household', async () => {
    const res = await call({ ...base, attending: ['adult', 'child:9'] })
    expect(res.status).toBe(200)
    expect(Object.keys(state.days['2026-09-05'].presence)).toEqual(['adult'])
    expect((await call({ ...base, attending: ['child:9'] })).status).toBe(400)
  })

  it('is idempotent — a household already on the roster just gets marked here again', async () => {
    await call({ ...base, attending: ['adult', 'child:0'] })
    const firstIn = state.days['2026-09-05'].presence.adult.inAt
    const res = await call({ ...base, attending: ['adult', 'child:0'] })
    expect(res.status).toBe(200)
    expect(state.days['2026-09-05'].presence.adult.inAt).toBe(firstIn) // still here — not reset
    expect(Object.keys(state.days['2026-09-05'].presence).sort()).toEqual(['adult', 'child:0'])
  })

  it('a drop-off event issues the pickup code and texts it, exactly like a normal check-in', async () => {
    mockGetEvent.mockResolvedValue(pno)
    const res = await call({ kind: 'workshop', id: 'ws-1', recordId: 'wvr_1', day: '2026-09-05', attending: ['child:0'] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.oneTimeCode).toMatch(/^\d{4}$/)
    expect(state.pickupCodeHash).toBeTruthy()
    expect(mockSendQuoText).toHaveBeenCalledTimes(1)
    expect(mockSendQuoText.mock.calls[0][0].to).toBe('2565550199')
    expect(state.events.some((e) => e.action === 'code-sent')).toBe(true)
    expect(state.expected).toBeNull() // workshops don't use `expected`
  })

  it('an unknown event 404s and writes nothing (fails closed)', async () => {
    mockGetEvent.mockResolvedValue(null)
    const res = await call({ ...base, attending: ['adult'] })
    expect(res.status).toBe(404)
    expect(mockUpsertRsvp).not.toHaveBeenCalled()
    expect(state.events).toHaveLength(0)
  })

  it('an unknown or expired household is refused', async () => {
    mockGetWaiverRecord.mockResolvedValue(null)
    expect((await call({ ...base, attending: ['adult'] })).status).toBe(404)
    mockGetWaiverRecord.mockResolvedValue(waiver({ validUntil: '2020-01-01T00:00:00.000Z' }))
    expect((await call({ ...base, attending: ['adult'] })).status).toBe(409)
    expect(mockUpsertRsvp).not.toHaveBeenCalled()
  })

  it('400s on a missing selection or bad event kind', async () => {
    expect((await call({ ...base, attending: [] })).status).toBe(400)
    expect((await call({ ...base, kind: 'program', attending: ['adult'] })).status).toBe(400)
    expect((await call({ ...base, recordId: '', attending: ['adult'] })).status).toBe(400)
  })

  it('carries earlier check-in state over when this waiver replaces an older one for the household', async () => {
    mockIndex.mockResolvedValue({ replacedRecordId: 'wvr_old' })
    oldState.days['2026-09-05'] = { presence: { 'child:1': { inAt: '2026-09-05T14:00:00.000Z', outAt: null } } }
    await call({ ...base, attending: ['adult'] })
    expect(state.days['2026-09-05'].presence['child:1']).toBeTruthy() // migrated
    expect(state.days['2026-09-05'].presence.adult).toBeTruthy() // and the add itself
  })

  describe('a household that ALREADY RSVP\'d (Today\'s highlighted chip)', () => {
    const existing = () => ({
      id: 'rsv_old', waiverId: 'wvr_1', event: { kind: 'workshop', id: 'ws-1' },
      ref: { bookingId: 'bk_7' }, attending: ['child:0'], responsibleAdult: 'Aunt May',
      pickup: { authorizedPickup: [{ name: 'Grandma Rivera', phone: '2565550100' }], notAuthorized: 'Rick Smith' },
      at: '2026-09-01T00:00:00.000Z', firstAt: '2026-09-01T00:00:00.000Z',
    })
    const add = (attending: string[]) => call({ kind: 'workshop', id: 'ws-1', recordId: 'wvr_1', day: '2026-09-05', attending })

    it('keeps the RSVP\'s id, pickup + may-NOT-collect, booking ref and responsible adult; attending is the union', async () => {
      mockGetEvent.mockResolvedValue(pno)
      mockGetRsvp.mockResolvedValue(existing())
      mockLatest.mockResolvedValue({ ...existing().pickup, at: '2026-09-01T00:00:00.000Z' })
      mockUpsertRsvp.mockResolvedValue({ id: 'rsv_old' }) // upsertRsvp returns the stored record
      const res = await add(['adult'])
      expect(res.status).toBe(200)
      expect(mockUpsertRsvp).toHaveBeenCalledWith(expect.objectContaining({
        id: 'rsv_old',
        ref: { bookingId: 'bk_7' },
        responsibleAdult: 'Aunt May',
        pickup: existing().pickup,
        attending: ['child:0', 'adult'],
      }))
      expect(mockIndex).toHaveBeenCalledWith('workshop', 'ws-1', expect.anything(), 'rsv_old')
    })

    it('a drop-off check-in then seeds the RSVP\'s pickup list and may-NOT-collect, not the signature\'s empty one', async () => {
      mockGetEvent.mockResolvedValue(pno)
      mockGetRsvp.mockResolvedValue(existing())
      mockLatest.mockResolvedValue({ ...existing().pickup, at: '2026-09-01T00:00:00.000Z' })
      await add(['child:0'])
      expect(state.notAuthorized).toBe('Rick Smith')
      expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Grandma Rivera'])
    })

    it('an existing RSVP with everyone (attending null) stays "everyone"', async () => {
      mockGetEvent.mockResolvedValue(pno)
      mockGetRsvp.mockResolvedValue({ ...existing(), attending: null })
      await add(['adult'])
      expect(mockUpsertRsvp.mock.calls[0][0].attending).toEqual(['adult', 'child:0', 'child:1'])
    })

    it('does not overwrite a party\'s expected list', async () => {
      mockGetRsvp.mockResolvedValue({ ...existing(), event: { kind: 'party', id: 'p1' } })
      state.expected = ['adult', 'child:0']
      await call({ ...base, attending: ['child:1'] })
      expect(state.expected).toEqual(['adult', 'child:0'])
    })
  })

  it('an out-of-date agreement (older than v3) is refused with mustResign', async () => {
    mockGetWaiverRecord.mockResolvedValue(waiver({ agreementVersion: 'v2' }))
    const res = await call({ ...base, attending: ['adult'] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Their agreement is out of date — they need to sign the new one.', mustResign: true })
    expect(mockUpsertRsvp).not.toHaveBeenCalled()
  })

  it('(c) adding a household to event B (no RSVP there) carries the pickup/may-NOT-collect from its other RSVP', async () => {
    const carried = { authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }], notAuthorized: 'Rick Smith' }
    mockGetEvent.mockResolvedValue(pno)
    mockLatest.mockResolvedValue(carried)
    await call({ kind: 'workshop', id: 'ws-1', recordId: 'wvr_1', day: '2026-09-05', attending: ['child:0'] })
    expect(mockUpsertRsvp.mock.calls[0][0].pickup).toEqual(carried)
    expect(state.notAuthorized).toBe('Rick Smith') // and the check-in seeded it
    expect(state.confirmedPickup.map((p) => p.name)).toEqual(['Grandma Rivera'])
  })

  it('(2) a door add after a "None" clear keeps it cleared — the literal "None" is what gets stored', async () => {
    mockGetEvent.mockResolvedValue(pno)
    mockLatest.mockResolvedValue({ authorizedPickup: [], notAuthorized: 'None', at: '2026-09-01T00:00:00.000Z' })
    mockGetWaiverRecord.mockResolvedValue(waiver({ notAuthorized: 'Rick Smith' }))
    await call({ kind: 'workshop', id: 'ws-1', recordId: 'wvr_1', day: '2026-09-05', attending: ['child:0'] })
    expect(mockUpsertRsvp.mock.calls[0][0].pickup).toEqual({ authorizedPickup: [], notAuthorized: 'None' })
    expect(state.notAuthorized).toBe('')
  })

  it('an EXISTING RSVP\'s pickup is never dropped when nothing resolves', async () => {
    const kept = { authorizedPickup: [], notAuthorized: '' }
    mockGetRsvp.mockResolvedValue({ id: 'rsv_old', pickup: kept, attending: null })
    await call({ ...base, attending: ['adult'] })
    expect(mockUpsertRsvp.mock.calls[0][0].pickup).toEqual(kept)
  })
})
