import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:booking:availability')
  const startTime = Date.now()
  try {
    const body = await request.json()
    const slots = await providers.booking.searchAvailability(body)
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
    await providers.notification.send({
      type: 'api-failure',
      title: 'Booking availability search failed',
      details: { route: 'booking/availability', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to fetch availability' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
