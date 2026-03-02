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
  allowExtraGuests?: boolean
  extraGuestPrice?: number
  allowAddOns?: boolean
  enrollmentType?: 'per-session' | 'full'
  ageRange?: { min: number; max: number }
  schedule?: { days: string; time: string; totalHours: number }
  instructorEmail?: string
  pricePerHead?: number
  maxCapacity?: number
}

export interface EventVariation {
  id: string
  name: string
  priceAmount: number          // cents
  priceCurrency: string
  startDate?: string
  endDate?: string
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
