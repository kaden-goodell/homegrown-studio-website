import type { APIRoute } from 'astro'
import { partyConfig } from '@config/party.config'
import { partyStartsForDate } from '@lib/party-slots'
import { openPartyStarts } from '@lib/party-availability'
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

    // Use the shared helper which queries with studio-local UTC bounds (UTC-window bug fix).
    // If the lookup fails, fall back to showing all future candidates so booking is never blocked.
    let openStarts: string[]
    try {
      openStarts = await openPartyStarts(date, serviceVariationId)
    } catch (err) {
      logger.error('Party booking lookup failed (showing all candidates)', {
        error: err instanceof Error ? err.message : String(err),
      })
      const now = Date.now()
      openStarts = partyStartsForDate(date).filter((iso) => new Date(iso).getTime() > now)
    }

    const durationMinutes = partyConfig.durationMinutes
    const slots = openStarts.map((startAt) => ({
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
