import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

// --- Module mocks (hoisted), same style as tests/api/kit-staff.test.ts ---
let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getEvent: (...a: any[]) => mockGetEvent(...a) }
})

const mockGetWaiverRecord = vi.fn()
vi.mock('@lib/waiver-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getWaiverRecord: (...a: any[]) => mockGetWaiverRecord(...a) }
})

const mockGetRsvp = vi.fn()
vi.mock('@lib/rsvp-store', () => ({ getRsvp: (...a: any[]) => mockGetRsvp(...a) }))

// mutateCheckin applies the callback to a shared in-memory state and returns
// it, so the endpoint's mutations are observable on `state` afterward.
let state: CheckinState
const mockMutate = vi.fn(async (_eventKey: string, _recordId: string, fn: (s: CheckinState) => void | Promise<void>) => {
  await fn(state)
  return state
})
vi.mock('@lib/checkin-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/checkin-store')>()),
  mutateCheckin: (...a: any[]) => (mockMutate as any)(...a),
}))

function emptyState(): CheckinState {
  return { expected: null, days: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '', pickupCodeHash: null, events: [] }
}

function ctx(body: any) {
  const request = new Request('http://localhost/api/staff/checkin.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

const singleDayEvent = { kind: 'party', id: 'party-1', title: 'Party', startIso: '2026-09-05T14:00:00.000Z', days: ['2026-09-05'], dropOff: false }

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  state = emptyState()
  mockGetEvent.mockResolvedValue(singleDayEvent) // non-drop-off party — no pickup code involved
  mockGetWaiverRecord.mockResolvedValue(null)
  mockGetRsvp.mockResolvedValue(null)
  POST = (await import('@pages/api/staff/checkin.json')).POST
})

describe('POST /api/staff/checkin.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(401)
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('stamps the appended event with the signed-in staffer', async () => {
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(200)
    const last = state.events.at(-1)!
    expect(last.action).toBe('checkin')
    expect(last.by).toEqual({ id: 't', name: 'Test' })
  })

  it('accepts { kind, id } as well as the legacy { party } alias', async () => {
    const res = await POST(ctx({ kind: 'party', id: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(200)
    expect(state.events.at(-1)!.action).toBe('checkin')
  })

  it('rejects a request missing kind/id and party', async () => {
    const res = await POST(ctx({ recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    expect(res.status).toBe(400)
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('records attendance under the event day and returns it in the response', async () => {
    const res = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'] }))
    const json = await res.json()
    expect(json.data.day).toBe('2026-09-05')
    expect(state.days['2026-09-05'].presence.adult.inAt).toBeTruthy()
    expect(json.data.checkin.days['2026-09-05'].presence.adult).toBeTruthy()
  })

  it('a multi-day event: checking in on day 1 does not affect day 2', async () => {
    mockGetEvent.mockResolvedValue({ ...singleDayEvent, days: ['2026-09-05', '2026-09-06'] })
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['adult'], day: '2026-09-05' }))
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-06' }))
    expect(state.days['2026-09-05'].presence.adult).toBeTruthy()
    expect(state.days['2026-09-05'].presence['child:0']).toBeUndefined()
    expect(state.days['2026-09-06'].presence['child:0']).toBeTruthy()
    expect(state.days['2026-09-06'].presence.adult).toBeUndefined()
  })

  it('a multi-day drop-off event: the pickup code persists across days and is only retired on the last day with no child present', async () => {
    mockGetEvent.mockResolvedValue({ ...singleDayEvent, dropOff: true, days: ['2026-09-05', '2026-09-06'] })
    mockGetWaiverRecord.mockResolvedValue({ authorizedPickup: [], notAuthorized: '' })

    // Day 1: check a child in — issues a code.
    const r1 = await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-05' }))
    const j1 = await r1.json()
    expect(j1.data.oneTimeCode).toBeTruthy()
    expect(state.pickupCodeHash).toBeTruthy()

    // Day 1: pick the child up at end of day — NOT the last day, code survives.
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'pickup', personIds: ['child:0'], code: j1.data.oneTimeCode, day: '2026-09-05' }))
    expect(state.pickupCodeHash).toBeTruthy()

    // Day 2: check the same child in again with the SAME code (no reissue needed).
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'checkin', personIds: ['child:0'], day: '2026-09-06' }))
    // Day 2: pick up — this IS the last day and no child remains anywhere else on this day → retire.
    await POST(ctx({ party: 'party-1', recordId: 'rec-1', action: 'pickup', personIds: ['child:0'], code: j1.data.oneTimeCode, day: '2026-09-06' }))
    expect(state.pickupCodeHash).toBeNull()
  })
})
