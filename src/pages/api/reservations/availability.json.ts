import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:reservation:availability')

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { date, serviceVariationId } = body

    if (!date || !serviceVariationId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: date, serviceVariationId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const locationId = siteConfig.providers.booking.config.locationId || ''
    const dayStart = `${date}T00:00:00Z`
    const dayEnd = `${date}T23:59:59Z`

    // 1. Search availability — returns valid time slots based on business hours.
    //    Square only returns 1 slot per time (picks a team member), but we don't
    //    use it for table count. We just need to know which hours are open.
    const availableSlots = await providers.booking.searchAvailability({
      startDate: dayStart,
      endDate: dayEnd,
      locationId,
      serviceVariationId,
      teamMemberId: reservationConfig.square.defaultTeamMemberId,
    })

    if (availableSlots.length === 0) {
      return new Response(
        JSON.stringify({ data: { slots: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2. Fetch existing bookings for the day to count tables + check add-ons
    let bookings: Awaited<ReturnType<NonNullable<typeof providers.booking.listBookings>>> = []
    if (providers.booking.listBookings) {
      bookings = await providers.booking.listBookings({
        startDate: dayStart,
        endDate: dayEnd,
        locationId,
      })
    }

    // 3. Build response slots — for each valid hour, count overlapping bookings
    const slots = availableSlots.map((slot) => {
      const slotStart = new Date(slot.startAt).getTime()
      const slotEnd = new Date(slot.endAt).getTime()

      // Count overlapping bookings (handles mixed 1hr + 2hr durations)
      let tablesBooked = 0
      let partyTableCount = 0
      let dedicatedHostCount = 0

      for (const booking of bookings) {
        if (booking.status === 'cancelled') continue
        const bookingStart = new Date(booking.slot.startAt).getTime()
        const bookingEnd = new Date(booking.slot.endAt).getTime()
        // Overlap: booking starts before slot ends AND booking ends after slot starts
        if (bookingStart < slotEnd && bookingEnd > slotStart) {
          tablesBooked++
          if (booking.partyTable) partyTableCount++
          if (booking.dedicatedHost) dedicatedHostCount++
        }
      }

      const tablesAvailable = Math.max(0, reservationConfig.maxTablesPerSlot - tablesBooked)

      return {
        startTime: slot.startAt,
        endTime: slot.endAt,
        durationMinutes: slot.duration,
        tablesAvailable,
        totalTables: reservationConfig.maxTablesPerSlot,
        partyTableAvailable: partyTableCount < reservationConfig.partyTableMaxPerSlot,
        dedicatedHostAvailable: dedicatedHostCount < reservationConfig.dedicatedHostMaxPerSlot,
        wholeStudioAvailable: tablesAvailable === reservationConfig.maxTablesPerSlot,
      }
    })

    // Filter out fully booked slots and sort by start time
    const availableResults = slots.filter(s => s.tablesAvailable > 0)
    availableResults.sort((a, b) => a.startTime.localeCompare(b.startTime))

    logger.info('Reservation availability search complete', {
      duration_ms: Date.now() - startTime,
      date,
      slotCount: availableResults.length,
    })

    return new Response(
      JSON.stringify({ data: { slots: availableResults } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Reservation availability search failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to search availability' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
