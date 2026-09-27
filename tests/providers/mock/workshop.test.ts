import { describe, it, expect, vi } from 'vitest'
import { MockWorkshopProvider } from '@providers/mock/workshop'

describe('MockWorkshopProvider', () => {
  it('listWorkshops returns workshops sorted by startAt ascending', async () => {
    const provider = new MockWorkshopProvider()
    const workshops = await provider.listWorkshops()
    expect(workshops.length).toBeGreaterThan(0)
    for (let i = 1; i < workshops.length; i++) {
      expect(
        new Date(workshops[i].startAt).getTime()
      ).toBeGreaterThanOrEqual(new Date(workshops[i - 1].startAt).getTime())
    }
  })

  it('listWorkshops keeps a sold-out workshop, in date order with the rest', async () => {
    const provider = new MockWorkshopProvider()
    const workshops = await provider.listWorkshops()
    expect(workshops.map((w) => w.id)).toEqual(['mock-ws-1', 'mock-ws-2', 'mock-sold-out-1'])
    expect(workshops[2].availableCapacity).toBe(0)
  })

  it('listWorkshops drops a workshop once its start time has passed', async () => {
    const provider = new MockWorkshopProvider()
    const first = (await provider.getWorkshop('mock-ws-1'))!
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(new Date(first.startAt).getTime() + 1000) })
    try {
      expect((await provider.listWorkshops()).map((w) => w.id)).toEqual(['mock-ws-2', 'mock-sold-out-1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('getWorkshop returns a workshop even when availableCapacity is 0', async () => {
    const provider = new MockWorkshopProvider()
    const workshop = await provider.getWorkshop('mock-sold-out-1')
    expect(workshop).not.toBeNull()
    expect(workshop!.availableCapacity).toBe(0)
  })

  it('getWorkshop returns null for unknown id', async () => {
    const provider = new MockWorkshopProvider()
    expect(await provider.getWorkshop('does-not-exist')).toBeNull()
  })
})
