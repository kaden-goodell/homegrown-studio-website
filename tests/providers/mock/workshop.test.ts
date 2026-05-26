import { describe, it, expect } from 'vitest'
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

  it('listWorkshops excludes workshops with availableCapacity === 0', async () => {
    const provider = new MockWorkshopProvider()
    const workshops = await provider.listWorkshops()
    for (const w of workshops) {
      expect(w.availableCapacity).toBeGreaterThan(0)
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
