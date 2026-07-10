import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { paymentBypassEnabled } from '@lib/dev-flags'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:checkout:process-payment')
  const startTime = Date.now()
  try {
    const body = await request.json()

    // Dev-only: return a synthetic paid result without charging. Gated to
    // `astro dev` — never in prod. Lets workshop/checkout flows be demoed.
    if (paymentBypassEnabled()) {
      logger.info('Payment bypass active — returning synthetic payment')
      return new Response(
        JSON.stringify({ data: { id: `dev_pay_${Date.now().toString(36)}`, status: 'completed', receiptUrl: null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const payment = await providers.payment.processPayment(body)

    if (payment.status === 'failed') {
      logger.warn('Payment failed', {
        orderId: body.orderId,
        paymentId: payment.id,
        duration_ms: Date.now() - startTime,
      })
      await providers.notification.send({
        type: 'payment-failure',
        title: 'Payment failed',
        details: { orderId: body.orderId, paymentId: payment.id },
        severity: 'critical',
        timestamp: new Date().toISOString(),
      })
    } else {
      logger.info('Payment processed', {
        duration_ms: Date.now() - startTime,
        paymentId: payment.id,
      })
    }

    return new Response(JSON.stringify({ data: payment }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Payment processing failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Payment processing failed',
      details: { route: 'checkout/process-payment', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to process payment' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
