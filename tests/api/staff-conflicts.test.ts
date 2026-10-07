import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'owner' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockListBookings = vi.fn()
vi.mock('@config/providers', () => ({ providers: { booking: { listBookings: (...a: any[]) => mockListBookings(...a) } } }))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))

const mockGetPartyRecord = vi.fn()
vi.mock('@lib/party-store', () => ({ getPartyRecord: (...a: any[]) => mockGetPartyRecord(...a) }))

import { GET } from '@pages/api/staff/conflicts.json'

const SUN_1PM = '2026-10-18T18:00:00.000Z'
const party = (id: string, startAt: string, status = 'confirmed') => ({ id, status, slot: { startAt, duration: 90 } })

function ctx(qs: string) {
  const url = new URL(`http://localhost/api/staff/conflicts.json?${qs}`)
  return { request: new Request(url), url } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: 'k', name: 'Kaden', role: 'owner' }
  mockListBookings.mockResolvedValue([])
  mockGetPartyRecord.mockImplementation(async (id: string) => (id === 'bk_1' ? { hostName: 'Jamie Rivera' } : null))
})

describe('GET /api/staff/conflicts.json', () => {
  it('rejects a caller without the staff cookie', async () => {
    authed = null
    expect((await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).status).toBe(401)
    expect(mockListBookings).not.toHaveBeenCalled()
  })

  it.each([
    ['kind=party&start=2026-10-18T18:00:00.000Z&minutes=120'],
    ['kind=workshop&start=not-a-time&minutes=120'],
    ['kind=workshop&start=2026-10-18T18:00:00.000Z&minutes=0'],
    ['kind=workshop&start=2026-10-18T18:00:00.000Z&minutes=1.5'],
  ])('refuses %s', async (qs) => {
    expect((await GET(ctx(qs))).status).toBe(400)
  })

  it('reads that studio day’s bookings', async () => {
    await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: '2026-10-18T05:00:00.000Z', endDate: '2026-10-19T04:59:59.999Z', locationId: 'LOC' })
  })

  it('reports a clash with time, host and booking id, and what to do', async () => {
    mockListBookings.mockResolvedValue([party('bk_1', SUN_1PM)])
    const res = await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.ok).toBe(false)
    expect(data.clashes).toEqual([{ id: 'bk_1', startIso: SUN_1PM, endIso: '2026-10-18T19:30:00.000Z', hostName: 'Jamie Rivera' }])
    expect(data.message).toContain('1:00 PM party (Jamie Rivera), booking bk_1')
    expect(data.message).toContain('Move the party in Square first (your call), then re-run.')
  })

  it('is clear when the only party starts after the class ends', async () => {
    mockListBookings.mockResolvedValue([party('bk_2', '2026-10-18T20:30:00.000Z')])
    const { data } = await (await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).json()
    expect(data.ok).toBe(true)
    expect(data.clashes).toEqual([])
  })

  it('ignores a cancelled party', async () => {
    mockListBookings.mockResolvedValue([party('bk_1', SUN_1PM, 'cancelled')])
    expect((await (await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))).json()).data.ok).toBe(true)
  })

  it('answers 503, never "clear", when bookings cannot be read', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 500'))
    const res = await GET(ctx(`kind=workshop&start=${SUN_1PM}&minutes=120`))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/Don’t schedule/)
  })
})
