import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:booking:availability')
  const startTime = Date.now()
  try {
    const body = await request.json()
    // Ensure dates are full ISO timestamps (Square requires RFC3339)
    const startDate = body.startDate?.includes('T') ? body.startDate : `${body.startDate}T00:00:00Z`
    const endDate = body.endDate?.includes('T') ? body.endDate : `${body.endDate}T23:59:59Z`
    const slots = await providers.booking.searchAvailability({
      ...body,
      startDate,
      endDate,
      locationId: siteConfig.providers.booking.config.locationId || body.locationId,
    })
    logger.info('Availability search complete', {
      duration_ms: Date.now() - startTime,
      slotCount: slots.length,
    })
    return new Response(JSON.stringify({ data: slots }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Availability search failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    // Return empty slots instead of 500 — booking API may not be configured (e.g. sandbox)
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
