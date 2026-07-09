import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { partyStartsInRange, removeBooked, localDate } from '@lib/party-slots'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:available-dates')

const DAY_MS = 86_400_000

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { serviceVariationId } = body

    const windowDays = Math.min(Math.max(Number(body.days) || partyConfig.bookingWindowDays, 1), 120)
    const locationId = siteConfig.providers.booking.config.locationId || ''

    const now = new Date()
    const windowEnd = new Date(now.getTime() + windowDays * DAY_MS)

    // Offered starts across the window come from config (per-weekday schedule).
    const starts = partyStartsInRange(now.toISOString(), windowEnd.toISOString())

    // Remove starts already booked (one bookings lookup for the whole window).
    let bookedStarts: string[] = []
    if (starts.length > 0 && providers.booking.listBookings) {
      try {
        const bookings = await providers.booking.listBookings({
          startDate: now.toISOString(),
          endDate: windowEnd.toISOString(),
          locationId,
        })
        bookedStarts = bookings
          .filter(
            (b) =>
              b.status !== 'cancelled' &&
              (!serviceVariationId || b.slot?.serviceVariationId === serviceVariationId)
          )
          .map((b) => b.slot.startAt)
      } catch (err) {
        logger.error('Party booking lookup failed (showing all dates)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const dates = Array.from(
      new Set(removeBooked(starts, bookedStarts).map((s) => localDate(s)))
    ).sort()

    logger.info('Party available-dates complete', {
      duration_ms: Date.now() - startTime,
      windowDays,
      dateCount: dates.length,
    })

    return new Response(
      JSON.stringify({ data: { dates } }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120, s-maxage=300' } }
    )
  } catch (error) {
    logger.error('Party available-dates failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to load available dates' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
