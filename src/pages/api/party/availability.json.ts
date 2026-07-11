import type { APIRoute } from 'astro'
import { partyConfig } from '@config/party.config'
import { partyStartsForDate } from '@lib/party-slots'
import { openPartyStarts } from '@lib/party-availability'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'

const logger = createLogger('api:party:availability')

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`party-avail:${clientAddress}`, 30, 60_000)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests — give it a minute.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const startTime = Date.now()
  try {
    const body = await request.json()
    const { date } = body

    // Public endpoint — validate inputs. Date must be a YYYY-MM-DD string.
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: 'Invalid date' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Only pass serviceVariationId through when it's a plausible ID string.
    const serviceVariationId =
      typeof body.serviceVariationId === 'string' && body.serviceVariationId.length <= 100
        ? body.serviceVariationId
        : undefined

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
