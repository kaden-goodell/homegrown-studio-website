import { describe, it, expect } from 'vitest'
import { MockCatalogProvider } from '@providers/mock/catalog'

describe('MockCatalogProvider', () => {
  const provider = new MockCatalogProvider()

  it('returns event types', async () => {
    const types = await provider.getEventTypes()
    expect(types.length).toBeGreaterThan(0)
    for (const t of types) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.variations.length).toBeGreaterThan(0)
    }
  })

  it('filters by category', async () => {
    const workshops = await provider.getEventTypes({ category: 'workshop' })
    for (const w of workshops) {
      expect(w.category).toBe('workshop')
    }
  })

  it('returns add-ons for event type', async () => {
    const types = await provider.getEventTypes()
    const partyType = types.find(t => t.category === 'birthday')
    if (partyType) {
      const addOns = await provider.getAddOns(partyType.id)
      expect(addOns.length).toBeGreaterThan(0)
      for (const a of addOns) {
        expect(a.name).toBeTruthy()
        expect(a.priceAmount).toBeGreaterThan(0)
      }
    }
  })

  it('returns pricing for variation', async () => {
    const types = await provider.getEventTypes()
    const type = types[0]
    const variation = type.variations[0]
    const pricing = await provider.getPricing(type.id, variation.id)
    expect(pricing.priceAmount).toBeGreaterThan(0)
    expect(pricing.priceCurrency).toBe('USD')
  })
})
