export interface TimeSlot {
  id: string
  startAt: string              // ISO 8601
  endAt: string                // ISO 8601
  duration: number             // minutes
  locationId: string
  teamMemberId?: string
  serviceVariationId?: string
  serviceVariationVersion?: bigint
  available: boolean
}

export interface BookingDetails {
  slotId: string
  customerId: string
  eventType: string
  guestCount?: number
  addOns?: string[]            // add-on catalog IDs
  specialRequests?: string
  orderIdRef?: string          // links to payment order
}

export interface Booking {
  id: string
  status: 'pending' | 'confirmed' | 'cancelled'
  slot: TimeSlot
  customerId: string
  eventType: string
  createdAt: string
}

export interface BookingProvider {
  searchAvailability(params: {
    startDate: string
    endDate: string
    locationId: string
    serviceVariationId?: string
    teamMemberId?: string
  }): Promise<TimeSlot[]>

  createBooking(details: BookingDetails): Promise<Booking>
  cancelBooking(bookingId: string, bookingVersion: number): Promise<void>
  getBooking(bookingId: string): Promise<Booking>
}
