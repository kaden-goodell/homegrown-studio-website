import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'

const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

/**
 * Cancel a pending workshop booking (releases seat).
 * Called by the client if the /complete payment step fails.
 */
export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:workshops:cancel')

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { bookingId, locationId } = body
  if (!bookingId || !locationId) {
    return new Response(JSON.stringify({ error: 'Missing bookingId or locationId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    logger.info('Cancelling booking', { bookingId })
    const res = await fetch(
      `${CLASSES_API_BASE}/class_bookings/${bookingId}/cancel?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://book.squareup.com',
          'Referer': 'https://book.squareup.com/',
        },
      },
    )

    if (!res.ok) {
      const text = await res.text()
      logger.error('Cancel failed', { bookingId, status: res.status, error: text })
      return new Response(JSON.stringify({ error: 'Cancel failed', detail: text }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    logger.info('Cancel succeeded', { bookingId })
    return new Response(JSON.stringify({ data: { cancelled: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    logger.error('Cancel threw exception', { bookingId, error: String(err) })
    return new Response(JSON.stringify({ error: 'Cancel failed unexpectedly' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
