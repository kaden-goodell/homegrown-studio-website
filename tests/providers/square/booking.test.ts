import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SquareBookingProvider } from '@providers/square/booking'
import type { SquareConfig } from '@config/site.config'

const mockSearchAvailability = vi.fn()
const mockCreate = vi.fn()
const mockCancel = vi.fn()
const mockGet = vi.fn()
const mockBulkUpsert = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    bookings = {
      searchAvailability: mockSearchAvailability,
      create: mockCreate,
      cancel: mockCancel,
      get: mockGet,
      customAttributes: {
        bulkUpsert: mockBulkUpsert,
      },
    }
  },
}))

const config: SquareConfig = {
  accessToken: 'test-token',
  environment: 'sandbox',
  locationId: 'LOC123',
  applicationId: 'APP123',
}

describe('SquareBookingProvider', () => {
  let provider: SquareBookingProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SquareBookingProvider(config)
  })

  describe('searchAvailability', () => {
    it('maps Square availabilities to TimeSlot array', async () => {
      mockSearchAvailability.mockResolvedValue({
        availabilities: [
          {
            startAt: '2026-03-15T10:00:00Z',
            locationId: 'LOC123',
            appointmentSegments: [
              {
                durationMinutes: 120,
                teamMemberId: 'TEAM1',
                serviceVariationId: 'SVC1',
                serviceVariationVersion: BigInt(1),
              },
            ],
          },
          {
            startAt: '2026-03-15T14:00:00Z',
            locationId: 'LOC123',
            appointmentSegments: [
              {
                durationMinutes: 90,
                teamMemberId: 'TEAM2',
                serviceVariationId: 'SVC2',
              },
            ],
          },
        ],
      })

      const slots = await provider.searchAvailability({
        startDate: '2026-03-15T00:00:00Z',
        endDate: '2026-03-16T00:00:00Z',
        locationId: 'LOC123',
        serviceVariationId: 'SVC1',
        teamMemberId: 'TEAM1',
      })

      expect(slots).toHaveLength(2)
      expect(slots[0]).toMatchObject({
        startAt: '2026-03-15T10:00:00Z',
        duration: 120,
        locationId: 'LOC123',
        teamMemberId: 'TEAM1',
        serviceVariationId: 'SVC1',
        available: true,
      })
      expect(slots[0].id).toBeTruthy()
      expect(slots[0].endAt).toBe('2026-03-15T12:00:00.000Z')

      expect(slots[1]).toMatchObject({
        startAt: '2026-03-15T14:00:00Z',
        duration: 90,
        locationId: 'LOC123',
        teamMemberId: 'TEAM2',
        serviceVariationId: 'SVC2',
        available: true,
      })
    })

    it('returns empty array when no availabilities', async () => {
      mockSearchAvailability.mockResolvedValue({ availabilities: undefined })

      const slots = await provider.searchAvailability({
        startDate: '2026-03-15T00:00:00Z',
        endDate: '2026-03-16T00:00:00Z',
        locationId: 'LOC123',
      })

      expect(slots).toEqual([])
    })

    it('calls Square API with correct query structure', async () => {
      mockSearchAvailability.mockResolvedValue({ availabilities: [] })

      await provider.searchAvailability({
        startDate: '2026-03-15T00:00:00Z',
        endDate: '2026-03-16T00:00:00Z',
        locationId: 'LOC123',
        serviceVariationId: 'SVC1',
        teamMemberId: 'TEAM1',
      })

      expect(mockSearchAvailability).toHaveBeenCalledWith({
        query: {
          filter: {
            startAtRange: {
              startAt: '2026-03-15T00:00:00Z',
              endAt: '2026-03-16T00:00:00Z',
            },
            locationId: 'LOC123',
            segmentFilters: [
              {
                serviceVariationId: 'SVC1',
                teamMemberIdFilter: { any: ['TEAM1'] },
              },
            ],
          },
        },
      })
    })
  })

  describe('createBooking', () => {
    it('creates booking and upserts custom attributes', async () => {
      mockCreate.mockResolvedValue({
        booking: {
          id: 'BK1',
          status: 'ACCEPTED',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [
            {
              durationMinutes: 120,
              teamMemberId: 'TEAM1',
              serviceVariationId: 'SVC1',
            },
          ],
        },
      })
      mockBulkUpsert.mockResolvedValue({})

      const booking = await provider.createBooking({
        slotId: '2026-03-15T10:00:00Z',
        customerId: 'CUST1',
        eventType: 'birthday',
        guestCount: 10,
        addOns: ['ADDON1', 'ADDON2'],
        specialRequests: 'Gluten-free snacks',
        orderIdRef: 'ORDER1',
      })

      expect(booking).toMatchObject({
        id: 'BK1',
        status: 'confirmed',
        customerId: 'CUST1',
        eventType: 'birthday',
        createdAt: '2026-03-14T08:00:00Z',
      })
      expect(booking.slot.startAt).toBe('2026-03-15T10:00:00Z')
      expect(booking.slot.duration).toBe(120)
      expect(booking.slot.available).toBe(false)

      expect(mockBulkUpsert).toHaveBeenCalledWith({
        values: {
          event_type: { bookingId: 'BK1', customAttribute: { value: 'birthday' } },
          guest_count: { bookingId: 'BK1', customAttribute: { value: '10' } },
          add_ons: { bookingId: 'BK1', customAttribute: { value: '["ADDON1","ADDON2"]' } },
          order_id: { bookingId: 'BK1', customAttribute: { value: 'ORDER1' } },
          special_requests: { bookingId: 'BK1', customAttribute: { value: 'Gluten-free snacks' } },
        },
      })
    })

    it('omits optional custom attributes when not provided', async () => {
      mockCreate.mockResolvedValue({
        booking: {
          id: 'BK2',
          status: 'PENDING',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })
      mockBulkUpsert.mockResolvedValue({})

      await provider.createBooking({
        slotId: '2026-03-15T10:00:00Z',
        customerId: 'CUST1',
        eventType: 'workshop',
      })

      const upsertCall = mockBulkUpsert.mock.calls[0][0]
      expect(upsertCall.values.order_id).toBeUndefined()
      expect(upsertCall.values.special_requests).toBeUndefined()
      expect(upsertCall.values.event_type).toBeDefined()
      expect(upsertCall.values.guest_count).toBeDefined()
      expect(upsertCall.values.add_ons).toBeDefined()
    })
  })

  describe('cancelBooking', () => {
    it('calls Square cancel with bookingId and bookingVersion', async () => {
      mockCancel.mockResolvedValue({ booking: { id: 'BK1', status: 'CANCELLED_BY_CUSTOMER' } })

      await provider.cancelBooking('BK1', 3)

      expect(mockCancel).toHaveBeenCalledWith({
        bookingId: 'BK1',
        bookingVersion: 3,
      })
    })
  })

  describe('getBooking', () => {
    it('maps ACCEPTED status to confirmed', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK1',
          status: 'ACCEPTED',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [{ durationMinutes: 120 }],
        },
      })

      const booking = await provider.getBooking('BK1')
      expect(booking.status).toBe('confirmed')
    })

    it('maps PENDING status to pending', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK2',
          status: 'PENDING',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })

      const booking = await provider.getBooking('BK2')
      expect(booking.status).toBe('pending')
    })

    it('maps CANCELLED_BY_CUSTOMER to cancelled', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK3',
          status: 'CANCELLED_BY_CUSTOMER',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })

      const booking = await provider.getBooking('BK3')
      expect(booking.status).toBe('cancelled')
    })

    it('maps CANCELLED_BY_SELLER to cancelled', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK4',
          status: 'CANCELLED_BY_SELLER',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })

      const booking = await provider.getBooking('BK4')
      expect(booking.status).toBe('cancelled')
    })

    it('returns full booking details with slot', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK5',
          status: 'ACCEPTED',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [
            {
              durationMinutes: 120,
              teamMemberId: 'TEAM1',
              serviceVariationId: 'SVC1',
            },
          ],
        },
      })

      const booking = await provider.getBooking('BK5')
      expect(booking.id).toBe('BK5')
      expect(booking.customerId).toBe('CUST1')
      expect(booking.slot.duration).toBe(120)
      expect(booking.slot.locationId).toBe('LOC123')
      expect(booking.slot.teamMemberId).toBe('TEAM1')
      expect(booking.slot.available).toBe(false)
    })
  })

  describe('error handling', () => {
    it('propagates search availability errors', async () => {
      mockSearchAvailability.mockRejectedValue(new Error('Square API error'))

      await expect(
        provider.searchAvailability({
          startDate: '2026-03-15T00:00:00Z',
          endDate: '2026-03-16T00:00:00Z',
          locationId: 'LOC123',
        })
      ).rejects.toThrow('Square API error')
    })

    it('propagates create booking errors', async () => {
      mockCreate.mockRejectedValue(new Error('Booking conflict'))

      await expect(
        provider.createBooking({
          slotId: 'slot-1',
          customerId: 'CUST1',
          eventType: 'birthday',
        })
      ).rejects.toThrow('Booking conflict')
    })

    it('propagates cancel booking errors', async () => {
      mockCancel.mockRejectedValue(new Error('Not found'))

      await expect(provider.cancelBooking('BK999', 1)).rejects.toThrow('Not found')
    })

    it('propagates get booking errors', async () => {
      mockGet.mockRejectedValue(new Error('Not found'))

      await expect(provider.getBooking('BK999')).rejects.toThrow('Not found')
    })
  })
})
