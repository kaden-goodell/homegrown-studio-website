import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckinState } from '@lib/checkin-store'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockGetCheckin = vi.fn()
vi.mock('@lib/checkin-store', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, getCheckin: (...a: any[]) => mockGetCheckin(...a) }
})

function ctx(query: string) {
  const request = new Request(`http://localhost/api/staff/history.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

function emptyCheckin(): CheckinState {
  return {
    expected: null,
    days: {},
    pickedUpBy: null,
    confirmedPickup: [],
    notAuthorized: '',
    pickupCodeHash: null,
    codeAttempts: 0,
    lockedAt: null,
    releasedTo: {},
    events: [],
  }
}

let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockGetCheckin.mockResolvedValue(emptyCheckin())
  GET = (await import('@pages/api/staff/history.json')).GET
})

describe('GET /api/staff/history.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(ctx('?kind=party&id=party-1&recordId=wvr_1'))
    expect(res.status).toBe(401)
  })

  it('400s when kind/id/recordId are missing or invalid', async () => {
    expect((await GET(ctx('?kind=bogus&id=party-1&recordId=wvr_1'))).status).toBe(400)
    expect((await GET(ctx('?kind=party&id=&recordId=wvr_1'))).status).toBe(400)
    expect((await GET(ctx('?kind=party&id=party-1&recordId='))).status).toBe(400)
  })

  it('returns the full events log for the household (the only endpoint that does)', async () => {
    const events = [
      { at: '2026-01-01T00:00:00.000Z', action: 'checkin', personIds: ['adult'], by: { id: 's1', name: 'Kaden' }, day: '2026-01-01' },
      { at: '2026-01-01T01:00:00.000Z', action: 'pickup-override', personIds: ['adult'], by: { id: 's1', name: 'Kaden' }, collectedBy: 'Grandma', reason: 'called-parent', day: '2026-01-01' },
    ]
    mockGetCheckin.mockResolvedValue({ ...emptyCheckin(), events })

    const res = await GET(ctx('?kind=party&id=party-1&recordId=wvr_1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.events).toEqual(events)
    expect(mockGetCheckin).toHaveBeenCalledWith('party-1', 'wvr_1')
  })

  it('resolves the storage key correctly for a non-party kind', async () => {
    await GET(ctx('?kind=workshop&id=ws-1&recordId=wvr_2'))
    expect(mockGetCheckin).toHaveBeenCalledWith('workshop:ws-1', 'wvr_2')
  })
})
