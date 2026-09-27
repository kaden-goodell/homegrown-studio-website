import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SquareWorkshopProvider } from '@providers/square/workshop'

const FIXTURE_RESPONSE = {
  class_schedule_instances: [
    { id: 'inst-1', class_schedule_id: 'sched-A', start_at: '2026-06-10T17:00:00Z', available_capacity: 5 },
    { id: 'inst-2', class_schedule_id: 'sched-B', start_at: '2026-06-05T19:00:00Z', available_capacity: 0 },
    { id: 'inst-3', class_schedule_id: 'sched-A', start_at: '2026-06-12T17:00:00Z', available_capacity: 3 },
  ],
  included_resources: {
    class_schedules: [
      { id: 'sched-A', name: 'Glass Fusing', description: 'desc A', description_html: '<p>desc A</p>', duration_minutes: 120, price_amount: 6500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
      { id: 'sched-B', name: 'Candle Pouring', description: 'desc B', description_html: '<p>desc B</p>', duration_minutes: 90, price_amount: 4500, price_currency: 'USD', staff_name: 'Kaden', team_member_id: 'TM1' },
    ],
  },
}

const config = { locationId: 'LOC123', accessToken: 'x', environment: 'sandbox', applicationId: 'app' } as any

describe('SquareWorkshopProvider', () => {
  beforeEach(() => {
    // Before every class in the fixture. Only the clock is faked, so requests still resolve.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-01T12:00:00Z') })
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
})
