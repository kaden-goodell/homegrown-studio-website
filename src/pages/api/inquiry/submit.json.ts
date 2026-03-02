import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:inquiry:submit')
  const startTime = Date.now()
  try {
    const body = await request.json()

    if (!body.name || !body.email || !body.eventType || !body.details) {
      return new Response(
        JSON.stringify({ error: 'Name, email, eventType, and details are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const customer = await providers.customer.findOrCreate({
      email: body.email,
      givenName: body.name.split(' ')[0],
      familyName: body.name.split(' ').slice(1).join(' ') || '',
      phone: body.phone,
    })

    await providers.notification.send({
      type: 'corporate-inquiry',
      title: 'New Corporate Inquiry',
      details: {
        customerName: body.name,
        email: body.email,
        eventType: body.eventType,
        dates: body.dates,
        guestCount: body.guestCount,
        details: body.details,
        specialRequests: body.specialRequests,
      },
      severity: 'info',
      timestamp: new Date().toISOString(),
    })

    logger.info('Inquiry submitted', {
      duration_ms: Date.now() - startTime,
      customerId: customer.id,
    })
    return new Response(JSON.stringify({ data: { success: true, customerId: customer.id } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Inquiry submission failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Inquiry submission failed',
      details: { route: 'inquiry/submit', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to submit inquiry' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
