import type {
  CatalogProvider,
  EventType,
  EventVariation,
  AddOn,
} from '@providers/interfaces/catalog'
import { mockEventTypes } from './data'

export class MockCatalogProvider implements CatalogProvider {
  async getEventTypes(params?: { category?: string }): Promise<EventType[]> {
    if (params?.category) {
      return mockEventTypes.filter(e => e.category === params.category)
    }
    return mockEventTypes
  }

  async getAddOns(eventTypeId: string): Promise<AddOn[]> {
    const eventType = mockEventTypes.find(e => e.id === eventTypeId)
    return eventType?.modifiers ?? []
  }

  async getPricing(eventTypeId: string, variationId: string): Promise<EventVariation> {
    const eventType = mockEventTypes.find(e => e.id === eventTypeId)
    if (!eventType) {
      throw new Error(`Event type not found: ${eventTypeId}`)
    }
    const variation = eventType.variations.find(v => v.id === variationId)
    if (!variation) {
      throw new Error(`Variation not found: ${variationId}`)
    }
    return variation
  }
}
