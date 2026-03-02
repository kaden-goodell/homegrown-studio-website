export interface EventType {
  id: string
  name: string
  description: string
  category: string
  imageUrl?: string
  variations: EventVariation[]
  modifiers: AddOn[]
  flow: 'booking' | 'quote'
  duration: number
  baseCapacity?: number
}

export interface EventVariation {
  id: string
  name: string
  priceAmount: number          // cents
  priceCurrency: string
}

export interface AddOn {
  id: string
  name: string
  priceAmount: number          // cents
  priceCurrency: string
}

export interface CatalogProvider {
  getEventTypes(params?: { category?: string }): Promise<EventType[]>
  getAddOns(eventTypeId: string): Promise<AddOn[]>
  getPricing(eventTypeId: string, variationId: string): Promise<EventVariation>
}
