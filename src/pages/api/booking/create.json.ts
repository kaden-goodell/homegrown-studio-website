import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:booking:create')
  const startTime = Date.now()
  try {
    const body = await request.json()
    const booking = await providers.booking.createBooking(body)
    logger.info('Booking created', {
      duration_ms: Date.now() - startTime,
      bookingId: booking.id,
    })
    return new Response(JSON.stringify({ data: booking }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Booking creation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Booking creation failed',
      details: { route: 'booking/create', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to create booking' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
