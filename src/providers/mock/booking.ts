import type {
  BookingProvider,
  BookingDetails,
  Booking,
  TimeSlot,
} from '../interfaces/booking'

export class MockBookingProvider implements BookingProvider {
  private bookings = new Map<string, Booking>()
  private nextId = 1

  async searchAvailability(params: {
    startDate: string
    endDate: string
    locationId: string
    serviceVariationId?: string
    teamMemberId?: string
  }): Promise<TimeSlot[]> {
    const slots: TimeSlot[] = []
    const start = new Date(params.startDate)
    const end = new Date(params.endDate)
    const hours = [10, 13, 16] // 10am, 1pm, 4pm

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const count = 2 + Math.floor(Math.random() * 2) // 2 or 3 slots per day
      for (let i = 0; i < count; i++) {
        const slotStart = new Date(d)
        slotStart.setHours(hours[i], 0, 0, 0)
        const slotEnd = new Date(slotStart)
        slotEnd.setMinutes(slotEnd.getMinutes() + 120)

        slots.push({
          id: `mock-slot-${d.toISOString().slice(0, 10)}-${i}`,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          duration: 120,
          locationId: params.locationId,
          teamMemberId: params.teamMemberId,
          serviceVariationId: params.serviceVariationId,
          available: true,
        })
      }
    }

    return slots
  }

  async createBooking(details: BookingDetails): Promise<Booking> {
    const id = `mock-booking-${this.nextId++}`
    const now = new Date()
    const slotStart = new Date(now)
    slotStart.setDate(slotStart.getDate() + 1)
    slotStart.setHours(10, 0, 0, 0)
    const slotEnd = new Date(slotStart)
    slotEnd.setMinutes(slotEnd.getMinutes() + 120)

    const slot: TimeSlot = {
      id: details.slotId,
      startAt: slotStart.toISOString(),
      endAt: slotEnd.toISOString(),
      duration: 120,
      locationId: 'mock-location',
      available: false,
    }

    const booking: Booking = {
      id,
      status: 'confirmed',
      slot,
      customerId: details.customerId,
      eventType: details.eventType,
      createdAt: now.toISOString(),
    }

    this.bookings.set(id, booking)
    return booking
  }

  async getBooking(bookingId: string): Promise<Booking> {
    const booking = this.bookings.get(bookingId)
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`)
    }
    return booking
  }

  async cancelBooking(bookingId: string, _bookingVersion: number): Promise<void> {
    const booking = this.bookings.get(bookingId)
    if (!booking) {
      throw new Error(`Booking not found: ${bookingId}`)
    }
    this.bookings.delete(bookingId)
  }
}
