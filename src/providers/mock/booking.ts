import type {
  BookingProvider,
  BookingDetails,
  Booking,
  TimeSlot,
} from '../interfaces/booking'
import { mockEventTypes } from './data'

// Deterministic hash from a string + index (avoids random shifts on re-render)
function dayHash(dateStr: string, idx: number): number {
  let h = 0
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) | 0
  return Math.abs(h + idx * 7)
}

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

    // If a specific service variation was requested, generate slots for it
    if (params.serviceVariationId) {
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10)
        const count = 2 + (dayHash(dateStr, 99) % 2)
        for (let i = 0; i < count; i++) {
          const slotStart = new Date(d)
          slotStart.setHours(hours[i], 0, 0, 0)
          const slotEnd = new Date(slotStart)
          slotEnd.setMinutes(slotEnd.getMinutes() + 120)

          slots.push({
            id: `mock-slot-${dateStr}-${i}`,
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

    // Generate slots for all workshop event types so listings can match
    const workshopTypes = mockEventTypes.filter(e => e.category === 'workshop')

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)
      const dow = d.getDay()

      // Skip Mondays (closed)
      if (dow === 1) continue

      for (const wt of workshopTypes) {
        const hash = dayHash(dateStr, workshopTypes.indexOf(wt))
        // Each workshop appears roughly every other day
        if (hash % 3 !== 0) continue

        const hourIdx = hash % hours.length
        const slotStart = new Date(d)
        slotStart.setHours(hours[hourIdx], 0, 0, 0)
        const slotEnd = new Date(slotStart)
        slotEnd.setMinutes(slotEnd.getMinutes() + wt.duration)

        slots.push({
          id: `mock-slot-${dateStr}-${wt.id}`,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          duration: wt.duration,
          locationId: params.locationId,
          serviceVariationId: wt.variations[0]?.id,
          available: true,
        })
      }

      // Also generate generic party slots (no serviceVariationId)
      const count = 2 + (dayHash(dateStr, 99) % 2)
      for (let i = 0; i < count; i++) {
        const slotStart = new Date(d)
        slotStart.setHours(hours[i], 0, 0, 0)
        const slotEnd = new Date(slotStart)
        slotEnd.setMinutes(slotEnd.getMinutes() + 120)

        slots.push({
          id: `mock-slot-${dateStr}-party-${i}`,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          duration: 120,
          locationId: params.locationId,
          teamMemberId: params.teamMemberId,
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
