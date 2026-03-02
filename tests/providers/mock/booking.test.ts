import { describe, it, expect } from 'vitest'
import { MockBookingProvider } from '@providers/mock/booking'

describe('MockBookingProvider', () => {
  const provider = new MockBookingProvider()

  it('returns available time slots for date range', async () => {
    const slots = await provider.searchAvailability({
      startDate: '2026-03-15',
      endDate: '2026-03-22',
      locationId: 'mock-location',
    })
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect(slot.id).toBeTruthy()
      expect(slot.startAt).toBeTruthy()
      expect(slot.available).toBe(true)
    }
  })

  it('creates a booking', async () => {
    const booking = await provider.createBooking({
      slotId: 'mock-slot-1',
      customerId: 'mock-customer-1',
      eventType: 'birthday',
    })
    expect(booking.id).toBeTruthy()
    expect(booking.status).toBe('confirmed')
    expect(booking.customerId).toBe('mock-customer-1')
  })

  it('retrieves a created booking', async () => {
    const created = await provider.createBooking({
      slotId: 'mock-slot-2',
      customerId: 'mock-customer-1',
      eventType: 'workshop',
    })
    const retrieved = await provider.getBooking(created.id)
    expect(retrieved.id).toBe(created.id)
  })

  it('cancels a booking', async () => {
    const created = await provider.createBooking({
      slotId: 'mock-slot-3',
      customerId: 'mock-customer-1',
      eventType: 'adult',
    })
    await expect(provider.cancelBooking(created.id, 1)).resolves.toBeUndefined()
  })
})
