import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:booking:cancel')
  const startTime = Date.now()
  try {
    const body = await request.json()
    await providers.booking.cancelBooking(body.bookingId, body.bookingVersion)
    logger.info('Booking cancelled', {
      duration_ms: Date.now() - startTime,
      bookingId: body.bookingId,
    })
    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Booking cancellation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Booking cancellation failed',
      details: { route: 'booking/cancel', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to cancel booking' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
