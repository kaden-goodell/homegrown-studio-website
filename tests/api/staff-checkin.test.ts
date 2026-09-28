import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

// --- Module mocks (hoisted), same style as tests/api/kit-staff.test.ts ---
let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', () => ({ getEvent: (...a: any[]) => mockGetEvent(...a) }))

const mockGetWaiverRecord = vi.fn()
vi.mock('@lib/waiver-store', () => ({ getWaiverRecord: (...a: any[]) => mockGetWaiverRecord(...a) }))

// mutateCheckin applies the callback to a shared in-memory state and returns
// it, so the endpoint's mutations are observable on `state` afterward.
let state: CheckinState
const mockMutate = vi.fn(async (_party: string, _recordId: string, fn: (s: CheckinState) => void | Promise<void>) => {
  await fn(state)
  return state
})
vi.mock('@lib/checkin-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/checkin-store')>()),
  mutateCheckin: (...a: any[]) => (mockMutate as any)(...a),
}))

function emptyState(): CheckinState {
  return { expected: null, presence: {}, pickedUpBy: null, confirmedPickup: [], notAuthorized: '', pickupCodeHash: null, events: [] }
}

function ctx(body: any) {
  const request = new Request('http://localhost/api/staff/checkin.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  state = emptyState()
  mockGetEvent.mockResolvedValue({ dropOff: false }) // non-drop-off party — no pickup code involved
  mockGetWaiverRecord.mockResolvedValue(null)
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
})
