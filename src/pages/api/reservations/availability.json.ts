import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { reservationConfig } from '@config/reservation.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:reservation:availability')

const TOTAL_TABLES = 6

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { date } = body

    if (!date) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: date' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const locationId = siteConfig.providers.booking.config.locationId || ''
    const dayStart = `${date}T00:00:00Z`
    const dayEnd = `${date}T23:59:59Z`

    // 1. Search availability — returns one entry per free table per time slot
    const availableSlots = await providers.booking.searchAvailability({
      startDate: dayStart,
      endDate: dayEnd,
      locationId,
    })

    if (availableSlots.length === 0) {
      return new Response(
        JSON.stringify({ data: { slots: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2. Group by startAt to count available tables per time slot
    const slotGroups = new Map<string, typeof availableSlots>()
    for (const slot of availableSlots) {
      const key = slot.startAt
      const group = slotGroups.get(key) || []
      group.push(slot)
      slotGroups.set(key, group)
    }

    // 3. Fetch existing bookings for the day to check add-on usage
    let bookings: Awaited<ReturnType<NonNullable<typeof providers.booking.listBookings>>> = []
    if (providers.booking.listBookings) {
      bookings = await providers.booking.listBookings({
        startDate: dayStart,
        endDate: dayEnd,
        locationId,
      })
    }

    // 4. Build response slots
    const slots = Array.from(slotGroups.entries()).map(([startAt, group]) => {
      const representative = group[0]
      const slotStart = new Date(startAt).getTime()
      const slotEnd = new Date(representative.endAt).getTime()
      const tablesAvailable = group.length

      // Count overlapping bookings with add-ons
      let partyTableCount = 0
      let dedicatedHostCount = 0
      for (const booking of bookings) {
        if (booking.status === 'cancelled') continue
        const bookingStart = new Date(booking.slot.startAt).getTime()
        const bookingEnd = new Date(booking.slot.endAt).getTime()
        // Overlap check: booking starts before slot ends AND booking ends after slot starts
        if (bookingStart < slotEnd && bookingEnd > slotStart) {
          if (booking.partyTable) partyTableCount++
          if (booking.dedicatedHost) dedicatedHostCount++
        }
      }

      return {
        startTime: startAt,
        endTime: representative.endAt,
        durationMinutes: representative.duration,
        tablesAvailable,
        totalTables: TOTAL_TABLES,
        partyTableAvailable: partyTableCount < reservationConfig.partyTableMaxPerSlot,
        dedicatedHostAvailable: dedicatedHostCount < reservationConfig.dedicatedHostMaxPerSlot,
        wholeStudioAvailable: tablesAvailable === TOTAL_TABLES,
      }
    })

    // Sort by start time
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime))

    logger.info('Reservation availability search complete', {
      duration_ms: Date.now() - startTime,
      date,
      slotCount: slots.length,
    })

    return new Response(
      JSON.stringify({ data: { slots } }),
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
