import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { partyStartsForDate, removeBooked } from '@lib/party-slots'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:availability')

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { date, serviceVariationId } = body

    if (!date) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: date' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Offered starts come from the per-weekday schedule in config; keep only future ones.
    const now = Date.now()
    const candidates = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)

    // Drop starts already taken by an existing party booking. If the lookup
    // fails, fall back to showing all candidates rather than blocking booking.
    let bookedStarts: string[] = []
    if (candidates.length > 0 && providers.booking.listBookings) {
      try {
        const locationId = siteConfig.providers.booking.config.locationId || ''
        const bookings = await providers.booking.listBookings({
          startDate: `${date}T00:00:00Z`,
          endDate: `${date}T23:59:59Z`,
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
        logger.error('Party booking lookup failed (showing all candidates)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const durationMinutes = partyConfig.durationMinutes
    const slots = removeBooked(candidates, bookedStarts).map((startAt) => ({
      startAt,
      endAt: new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString(),
      durationMinutes,
    }))

    logger.info('Party availability complete', {
      duration_ms: Date.now() - startTime,
      date,
      slotCount: slots.length,
    })

    return new Response(
      JSON.stringify({ data: { slots } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Party availability search failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to search availability' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
