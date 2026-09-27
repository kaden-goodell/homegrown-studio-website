import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SquareBookingProvider, rangesOfAtMost } from '@providers/square/booking'
import type { SquareConfig } from '@config/site.config'

const mockSearchAvailability = vi.fn()
const mockCreate = vi.fn()
const mockCancel = vi.fn()
const mockGet = vi.fn()
const mockBulkUpsert = vi.fn()
const mockCustomAttrGet = vi.fn()
const mockList = vi.fn()

vi.mock('square', () => ({
  SquareClient: class MockSquareClient {
    bookings = {
      searchAvailability: mockSearchAvailability,
      create: mockCreate,
      cancel: mockCancel,
      get: mockGet,
      list: mockList,
      customAttributes: {
        // Square SDK v44: the bookings custom-attributes batch write is named
        // `batchUpsert` (request type BulkUpsertBookingCustomAttributesRequest).
        batchUpsert: mockBulkUpsert,
        get: mockCustomAttrGet,
      },
    }
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
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
      expect(slots[0].id).toBe('2026-03-15T10:00:00Z')
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
        eventType: 'party',
        guestCount: 10,
        addOns: ['ADDON1', 'ADDON2'],
        specialRequests: 'Gluten-free snacks',
        orderIdRef: 'ORDER1',
      })

      expect(booking).toMatchObject({
        id: 'BK1',
        status: 'confirmed',
        customerId: 'CUST1',
        eventType: 'party',
        createdAt: '2026-03-14T08:00:00Z',
      })
      expect(booking.slot.startAt).toBe('2026-03-15T10:00:00Z')
      expect(booking.slot.duration).toBe(120)
      expect(booking.slot.available).toBe(false)

      expect(mockBulkUpsert).toHaveBeenCalledWith({
        values: {
          event_type: { bookingId: 'BK1', customAttribute: { value: 'party' } },
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
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: 'party' } })

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
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: '' } })

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
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: '' } })

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
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: '' } })

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
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: 'workshop' } })

      const booking = await provider.getBooking('BK5')
      expect(booking.id).toBe('BK5')
      expect(booking.customerId).toBe('CUST1')
      expect(booking.eventType).toBe('workshop')
      expect(booking.slot.id).toBe('2026-03-15T10:00:00Z')
      expect(booking.slot.duration).toBe(120)
      expect(booking.slot.locationId).toBe('LOC123')
      expect(booking.slot.teamMemberId).toBe('TEAM1')
      expect(booking.slot.available).toBe(false)
    })

    it('reads eventType from custom attributes', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK6',
          status: 'ACCEPTED',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })
      mockCustomAttrGet.mockResolvedValue({ customAttribute: { value: 'party' } })

      const booking = await provider.getBooking('BK6')
      expect(booking.eventType).toBe('party')
      expect(mockCustomAttrGet).toHaveBeenCalledWith({
        bookingId: 'BK6',
        key: 'event_type',
      })
    })

    it('returns empty eventType when custom attribute does not exist', async () => {
      mockGet.mockResolvedValue({
        booking: {
          id: 'BK7',
          status: 'ACCEPTED',
          startAt: '2026-03-15T10:00:00Z',
          locationId: 'LOC123',
          customerId: 'CUST1',
          createdAt: '2026-03-14T08:00:00Z',
          appointmentSegments: [],
        },
      })
      mockCustomAttrGet.mockRejectedValue(new Error('NOT_FOUND'))

      const booking = await provider.getBooking('BK7')
      expect(booking.eventType).toBe('')
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
          eventType: 'party',
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

  describe('listBookings', () => {
    const DAY = 24 * 60 * 60 * 1000
    /** Square's list answers with something you iterate. */
    const page = (items: any[]) => ({
      async *[Symbol.asyncIterator]() {
        yield* items
      },
    })
    const sqBooking = (id: string, startAt: string, status = 'ACCEPTED') => ({
      id,
      status,
      startAt,
      locationId: 'LOC123',
      customerId: 'cust-1',
      version: 0,
      appointmentSegments: [{ durationMinutes: 150, serviceVariationId: 'SVC1', teamMemberId: 'TEAM1' }],
    })
    const daysAsked = (call: any[]) => (Date.parse(call[0].startAtMax) - Date.parse(call[0].startAtMin)) / DAY

    it('asks once for a whole calendar month, the longest range Square accepts', async () => {
      mockList.mockResolvedValue(page([sqBooking('b1', '2026-10-17T19:00:00Z')]))

      const bookings = await provider.listBookings({ startDate: '2026-10-01T05:00:00.000Z', endDate: '2026-11-01T04:59:59.999Z', locationId: 'LOC123' })

      expect(mockList).toHaveBeenCalledTimes(1)
      expect(mockList).toHaveBeenCalledWith({ locationId: 'LOC123', startAtMin: '2026-10-01T05:00:00.000Z', startAtMax: '2026-11-01T04:59:59.999Z' })
      expect(bookings.map((b) => b.id)).toEqual(['b1'])
    })

    it('splits the 45-day party window into pieces Square accepts, and joins the answers', async () => {
      mockList
        .mockResolvedValueOnce(page([sqBooking('early', '2026-10-17T19:00:00Z')]))
        .mockResolvedValueOnce(page([sqBooking('late', '2026-11-07T19:00:00Z')]))
      const start = '2026-09-27T21:00:00.000Z'
      const end = new Date(Date.parse(start) + 45 * DAY).toISOString()

      const bookings = await provider.listBookings({ startDate: start, endDate: end, locationId: 'LOC123' })

      expect(mockList).toHaveBeenCalledTimes(2)
      for (const call of mockList.mock.calls) expect(daysAsked(call)).toBeLessThanOrEqual(31)
      // No gap and no overlap: the second piece starts where the first ends.
      expect(mockList.mock.calls[0][0].startAtMin).toBe(start)
      expect(mockList.mock.calls[1][0].startAtMin).toBe(mockList.mock.calls[0][0].startAtMax)
      expect(mockList.mock.calls[1][0].startAtMax).toBe(end)
      expect(bookings.map((b) => b.id)).toEqual(['early', 'late'])
    })

    it('counts a booking once when it comes back in two pieces', async () => {
      mockList
        .mockResolvedValueOnce(page([sqBooking('on-the-line', '2026-10-27T21:00:00Z')]))
        .mockResolvedValueOnce(page([sqBooking('on-the-line', '2026-10-27T21:00:00Z')]))
      const start = '2026-09-27T21:00:00.000Z'

      const bookings = await provider.listBookings({ startDate: start, endDate: new Date(Date.parse(start) + 45 * DAY).toISOString(), locationId: 'LOC123' })

      expect(bookings).toHaveLength(1)
    })

    it('leaves out cancelled bookings and carries the note and version', async () => {
      mockList.mockResolvedValue(
        page([
          { ...sqBooking('kept', '2026-10-17T19:00:00Z'), customerNote: '{"attempt":"abc"}', version: 3 },
          sqBooking('gone', '2026-10-18T19:00:00Z', 'CANCELLED_BY_SELLER'),
        ]),
      )

      const bookings = await provider.listBookings({ startDate: '2026-10-17T05:00:00.000Z', endDate: '2026-10-19T04:59:59.999Z', locationId: 'LOC123' })

      expect(bookings).toHaveLength(1)
      expect(bookings[0]).toMatchObject({ id: 'kept', customerNote: '{"attempt":"abc"}', version: 3 })
    })

    it('fails as a whole if any piece fails, so a caller never trusts half a list', async () => {
      mockList.mockResolvedValueOnce(page([])).mockRejectedValueOnce(new Error('Status code: 500'))
      const start = '2026-09-27T21:00:00.000Z'
      await expect(
        provider.listBookings({ startDate: start, endDate: new Date(Date.parse(start) + 45 * DAY).toISOString(), locationId: 'LOC123' }),
      ).rejects.toThrow()
    })
  })

  describe('rangesOfAtMost', () => {
    it('returns the range untouched when it is short enough', () => {
      expect(rangesOfAtMost('2026-10-17T05:00:00.000Z', '2026-10-18T04:59:59.999Z', 31)).toEqual([
        ['2026-10-17T05:00:00.000Z', '2026-10-18T04:59:59.999Z'],
      ])
    })

    it('covers a long range end to end in pieces of at most the limit', () => {
      const pieces = rangesOfAtMost('2026-01-01T00:00:00.000Z', '2026-04-11T00:00:00.000Z', 31) // 100 days
      expect(pieces).toHaveLength(4)
      expect(pieces[0][0]).toBe('2026-01-01T00:00:00.000Z')
      expect(pieces[3][1]).toBe('2026-04-11T00:00:00.000Z')
      for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toBe(pieces[i - 1][1])
    })

    it('passes an empty or backwards range through for the backend to judge', () => {
      expect(rangesOfAtMost('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 31)).toHaveLength(1)
    })
  })
})
