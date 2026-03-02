import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:customer:subscribe')
  const startTime = Date.now()
  try {
    const body = await request.json()

    if (!body.email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    await providers.customer.subscribe(body.email)

    logger.info('Customer subscribed', {
      duration_ms: Date.now() - startTime,
      email: body.email,
    })
    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Customer subscription failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Customer subscription failed',
      details: { route: 'customer/subscribe', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to subscribe' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
