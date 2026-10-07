import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SquareWorkshopProvider } from '@providers/square/workshop'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// The clock is pinned (see beforeEach), so the fixture's dates can be written
// out plainly and still never rot into the past as real time marches on.
const NOW = new Date('2026-06-01T12:00:00Z').getTime()
const FUTURE_1 = '2026-06-10T17:00:00Z'
const FUTURE_SOLD_OUT = '2026-06-05T19:00:00Z'
const FUTURE_2 = '2026-06-12T17:00:00Z'
const STARTED_2H_AGO = '2026-06-01T10:00:00Z'

const FIXTURE_RESPONSE = {
  class_schedule_instances: [
    { id: 'inst-1', class_schedule_id: 'sched-A', start_at: FUTURE_1, available_capacity: 5 },
    { id: 'inst-2', class_schedule_id: 'sched-B', start_at: FUTURE_SOLD_OUT, available_capacity: 0 },
    { id: 'inst-3', class_schedule_id: 'sched-A', start_at: FUTURE_2, available_capacity: 3 },
    // Already in progress — still has open seats (a walk-up cancellation),
    // so only the future-only filter (not the capacity one) should exclude
    // it from the public listing.
    { id: 'inst-started', class_schedule_id: 'sched-C', start_at: STARTED_2H_AGO, available_capacity: 2 },
  ],
  included_resources: {
    class_schedules: [
      { id: 'sched-A', name: 'Glass Fusing', description: 'desc A', description_html: '<p>desc A</p>', duration_minutes: 120, price_amount: 6500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
      { id: 'sched-B', name: 'Candle Pouring', description: 'desc B', description_html: '<p>desc B</p>', duration_minutes: 90, price_amount: 4500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
      { id: 'sched-C', name: 'Parents Night Out', description: 'desc C', description_html: '<p>desc C</p>', duration_minutes: 180, price_amount: 3000, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
    ],
  },
}

const config = { locationId: 'LOC123', accessToken: 'x', environment: 'sandbox', applicationId: 'app' } as any

describe('SquareWorkshopProvider', () => {
  beforeEach(() => {
    // Before every class in the fixture. Only the clock is faked, so requests still resolve.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('listWorkshops returns Workshop[] sorted by startAt ascending', async () => {
    const provider = new SquareWorkshopProvider(config)
    const workshops = await provider.listWorkshops()
    expect(workshops.map(w => w.id)).toEqual(['inst-2', 'inst-1', 'inst-3'])
    expect(workshops[1].priceCents).toBe(6500)
    expect(workshops[1].priceCurrency).toBe('USD')
    expect(workshops[1].scheduleId).toBe('sched-A')
    expect(workshops[1].name).toBe('Glass Fusing')
  })

  it('listWorkshops keeps a sold-out workshop, with zero seats', async () => {
    const provider = new SquareWorkshopProvider(config)
    const sold = (await provider.listWorkshops()).find((w) => w.id === 'inst-2')
    expect(sold).toBeDefined()
    expect(sold!.name).toBe('Candle Pouring')
    expect(sold!.availableCapacity).toBe(0)
  })

  it('listWorkshops drops a workshop, sold out or not, once its start time has passed', async () => {
    const provider = new SquareWorkshopProvider(config)

    // One minute before the sold-out class starts: still listed.
    vi.setSystemTime(new Date('2026-06-05T18:59:00Z'))
    expect((await provider.listWorkshops()).map(w => w.id)).toEqual(['inst-2', 'inst-1', 'inst-3'])

    // The moment it starts: gone.
    vi.setSystemTime(new Date('2026-06-05T19:00:00Z'))
    expect((await provider.listWorkshops()).map(w => w.id)).toEqual(['inst-1', 'inst-3'])

    vi.setSystemTime(new Date('2026-06-10T17:00:01Z'))
    expect((await provider.listWorkshops()).map(w => w.id)).toEqual(['inst-3'])
  })

  it('getWorkshop returns a workshop by id even when sold out', async () => {
    const provider = new SquareWorkshopProvider(config)
    const sold = await provider.getWorkshop('inst-2')
    expect(sold).not.toBeNull()
    expect(sold!.id).toBe('inst-2')
    expect(sold!.availableCapacity).toBe(0)
  })

  it('getWorkshop resolves a sold-out class by its scheduleId too (C2)', async () => {
    const provider = new SquareWorkshopProvider(config)
    const sold = await provider.getWorkshop('sched-B')
    expect(sold).not.toBeNull()
    expect(sold!.id).toBe('inst-2')
    expect(sold!.availableCapacity).toBe(0)
  })

  it('getWorkshop picks the earliest occurrence when a scheduleId covers several', async () => {
    const provider = new SquareWorkshopProvider(config)
    const w = await provider.getWorkshop('sched-A')
    expect(w!.id).toBe('inst-1')
    expect(w!.startAt).toBe(FUTURE_1)
  })

  it('getWorkshop returns null for unknown id', async () => {
    const provider = new SquareWorkshopProvider(config)
    expect(await provider.getWorkshop('nope')).toBeNull()
  })

  it('listWorkshops returns [] when locationId is empty (skip API call silently)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const provider = new SquareWorkshopProvider({ ...config, locationId: '' })
    const workshops = await provider.listWorkshops()
    expect(workshops).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('listWorkshops (public) excludes a class that already started, even with open seats', async () => {
    const provider = new SquareWorkshopProvider(config)
    const workshops = await provider.listWorkshops()
    expect(workshops.map((w) => w.id)).not.toContain('inst-started')
  })

  it('getWorkshop resolves an in-progress class by its instance id', async () => {
    const provider = new SquareWorkshopProvider(config)
    const w = await provider.getWorkshop('inst-started')
    expect(w).not.toBeNull()
    expect(w!.startAt).toBe(STARTED_2H_AGO)
  })

  it('getWorkshop resolves an in-progress class by its scheduleId', async () => {
    const provider = new SquareWorkshopProvider(config)
    const w = await provider.getWorkshop('sched-C')
    expect(w).not.toBeNull()
    expect(w!.id).toBe('inst-started')
  })

  it('listAllWorkshops includes the in-progress class the public listing excludes', async () => {
    const provider = new SquareWorkshopProvider(config)
    const all = await provider.listAllWorkshops()
    expect(all.map((w) => w.id)).toContain('inst-started')
  })

  it('fetchAll queries a 7-day lookback window, not "now", as start_at', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const provider = new SquareWorkshopProvider(config)
    await provider.listAllWorkshops()
    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(init.body as string)
    const startAt = new Date(body.query.filter.starting_at.start_at).getTime()
    // Roughly 7 days back, generously bounded to absorb formatting/rounding.
    expect(NOW - startAt).toBeGreaterThan(6.9 * DAY)
    expect(NOW - startAt).toBeLessThan(7.1 * DAY)
  })

  it('carries the class’s total capacity when Square gives it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...FIXTURE_RESPONSE,
      class_schedule_instances: [{ id: 'inst-1', class_schedule_id: 'sched-A', start_at: FUTURE_1, available_capacity: 5, capacity: 12 }],
    }), { status: 200 })))
    const [w] = await new SquareWorkshopProvider(config).listAllWorkshops()
    expect(w.totalCapacity).toBe(12)
    expect(w.availableCapacity).toBe(5)
  })

  it('leaves total capacity out when Square does not say', async () => {
    const [w] = await new SquareWorkshopProvider(config).listAllWorkshops()
    expect(w).not.toHaveProperty('totalCapacity')
  })
})
