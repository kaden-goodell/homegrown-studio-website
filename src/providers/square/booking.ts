import { SquareClient } from 'square'
import type {
  BookingProvider,
  BookingDetails,
  Booking,
  TimeSlot,
} from '../interfaces/booking'
import type { SquareConfig } from '../../config/site.config'
import { createLogger } from '../../lib/logger'

const logger = createLogger('square-booking')

function mapStatus(squareStatus: string): Booking['status'] {
  switch (squareStatus) {
    case 'ACCEPTED':
      return 'confirmed'
    case 'CANCELLED_BY_CUSTOMER':
    case 'CANCELLED_BY_SELLER':
      return 'cancelled'
    case 'PENDING':
    default:
      return 'pending'
  }
}

function generateSlotId(startAt: string, locationId: string): string {
  let hash = 0
  const str = `${startAt}:${locationId}`
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `slot-${Math.abs(hash).toString(36)}`
}

export class SquareBookingProvider implements BookingProvider {
  private client: SquareClient

  constructor(private config: SquareConfig) {
    this.client = new SquareClient({
      token: config.accessToken,
      environment: config.environment,
    })
  }

  async searchAvailability(params: {
    startDate: string
    endDate: string
    locationId: string
    serviceVariationId?: string
    teamMemberId?: string
  }): Promise<TimeSlot[]> {
    logger.info('Searching availability', {
      locationId: params.locationId,
      startDate: params.startDate,
      endDate: params.endDate,
    })

    const segmentFilters: any[] = []

    if (params.serviceVariationId) {
      const filter: any = {
        serviceVariationId: params.serviceVariationId,
      }
      if (params.teamMemberId) {
        filter.teamMemberIdFilter = { any: [params.teamMemberId] }
      }
      segmentFilters.push(filter)
    }

    const response = await this.client.bookings.searchAvailability({
      query: {
        filter: {
          startAtRange: {
            startAt: params.startDate,
            endAt: params.endDate,
          },
          locationId: params.locationId,
          segmentFilters: segmentFilters.length > 0 ? segmentFilters : undefined,
        },
      },
    } as any)

    const availabilities = (response as any).availabilities ?? []

    return availabilities.map((avail: any) => {
      const segment = avail.appointmentSegments?.[0]
      const durationMinutes = segment?.durationMinutes ?? 0
      const startAt = avail.startAt ?? ''
      const locationId = avail.locationId ?? params.locationId
      const endAt = new Date(
        new Date(startAt).getTime() + durationMinutes * 60_000
      ).toISOString()

      return {
        id: generateSlotId(startAt, locationId),
        startAt,
        endAt,
        duration: durationMinutes,
        locationId,
        teamMemberId: segment?.teamMemberId ?? undefined,
        serviceVariationId: segment?.serviceVariationId ?? undefined,
        serviceVariationVersion: segment?.serviceVariationVersion ?? undefined,
        available: true,
      }
    })
  }

  async createBooking(details: BookingDetails): Promise<Booking> {
    logger.info('Creating booking', {
      slotId: details.slotId,
      customerId: details.customerId,
      eventType: details.eventType,
    })

    const response = await this.client.bookings.create({
      booking: {
        startAt: details.slotId,
        locationId: this.config.locationId,
        customerId: details.customerId,
        customerNote: details.specialRequests,
      },
    } as any)

    const sqBooking = (response as any).booking!
    const bookingId = sqBooking.id!

    // Attach custom attributes
    const customAttrs: Record<string, { bookingId: string; customAttribute: { value: string } }> = {}

    const attrs: Record<string, string> = {
      event_type: details.eventType,
      guest_count: String(details.guestCount ?? 0),
      add_ons: JSON.stringify(details.addOns ?? []),
    }
    if (details.orderIdRef) {
      attrs.order_id = details.orderIdRef
    }
    if (details.specialRequests) {
      attrs.special_requests = details.specialRequests
    }

    for (const [key, value] of Object.entries(attrs)) {
      customAttrs[key] = {
        bookingId,
        customAttribute: { value },
      }
    }

    await (this.client.bookings as any).customAttributes.bulkUpsert({
      values: customAttrs,
    })

    logger.info('Booking created with custom attributes', { bookingId })

    const segment = sqBooking.appointmentSegments?.[0]
    const startAt = sqBooking.startAt ?? ''
    const durationMinutes = segment?.durationMinutes ?? 0
    const endAt = new Date(
      new Date(startAt).getTime() + durationMinutes * 60_000
    ).toISOString()

    return {
      id: bookingId,
      status: mapStatus(sqBooking.status ?? 'PENDING'),
      slot: {
        id: details.slotId,
        startAt,
        endAt,
        duration: durationMinutes,
        locationId: sqBooking.locationId ?? this.config.locationId,
        teamMemberId: segment?.teamMemberId ?? undefined,
        serviceVariationId: segment?.serviceVariationId ?? undefined,
        serviceVariationVersion: segment?.serviceVariationVersion ?? undefined,
        available: false,
      },
      customerId: details.customerId,
      eventType: details.eventType,
      createdAt: sqBooking.createdAt ?? new Date().toISOString(),
    }
  }

  async cancelBooking(bookingId: string, bookingVersion: number): Promise<void> {
    logger.info('Cancelling booking', { bookingId, bookingVersion })

    await this.client.bookings.cancel({
      bookingId,
      bookingVersion,
    } as any)

    logger.info('Booking cancelled', { bookingId })
  }

  async getBooking(bookingId: string): Promise<Booking> {
    logger.info('Getting booking', { bookingId })

    const response = await this.client.bookings.get({ bookingId })
    const sqBooking = (response as any).booking!

    const segment = sqBooking.appointmentSegments?.[0]
    const startAt = sqBooking.startAt ?? ''
    const durationMinutes = segment?.durationMinutes ?? 0
    const endAt = new Date(
      new Date(startAt).getTime() + durationMinutes * 60_000
    ).toISOString()

    return {
      id: sqBooking.id!,
      status: mapStatus(sqBooking.status ?? 'PENDING'),
      slot: {
        id: generateSlotId(startAt, sqBooking.locationId ?? ''),
        startAt,
        endAt,
        duration: durationMinutes,
        locationId: sqBooking.locationId ?? '',
        teamMemberId: segment?.teamMemberId ?? undefined,
        serviceVariationId: segment?.serviceVariationId ?? undefined,
        serviceVariationVersion: segment?.serviceVariationVersion ?? undefined,
        available: false,
      },
      customerId: sqBooking.customerId ?? '',
      eventType: '',
      createdAt: sqBooking.createdAt ?? '',
    }
  }
}
