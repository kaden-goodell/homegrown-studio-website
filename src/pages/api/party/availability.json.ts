import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { partyConfig } from '@config/party.config'
import { offeredPartyStarts } from '@lib/party-slots'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:availability')

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

    // Whole-studio party: just need the open time slots, no table-overlap logic.
    const availableSlots = await providers.booking.searchAvailability({
      startDate: dayStart,
      endDate: dayEnd,
      locationId,
      serviceVariationId,
      teamMemberId: partyConfig.square.defaultTeamMemberId,
    })

    const allSlots = availableSlots
      .map((slot) => ({
        startAt: slot.startAt,
        endAt: slot.endAt,
        durationMinutes: slot.duration,
      }))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))

    // Restrict to the party starts we actually offer: ≤3pm local start, spaced
    // 3h so each party + 1h cleanup wraps by 6pm (drops the 6pm slot).
    const slots = offeredPartyStarts(allSlots)

    logger.info('Party availability search complete', {
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
