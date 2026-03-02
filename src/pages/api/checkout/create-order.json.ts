import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:checkout:create-order')
  const startTime = Date.now()
  try {
    const body = await request.json()
    const order = await providers.payment.createOrder(body)
    logger.info('Order created', {
      duration_ms: Date.now() - startTime,
      orderId: order.id,
    })
    return new Response(JSON.stringify({ data: order }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Order creation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Order creation failed',
      details: { route: 'checkout/create-order', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to create order' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
