import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { paymentBypassEnabled } from '@lib/dev-flags'

export const GET: APIRoute = async () => {
  const logger = createLogger('api:checkout:client-config')
  const startTime = Date.now()
  try {
    // Dev-only: hand the client a mock app id so PaymentForm skips the card.
    if (paymentBypassEnabled()) {
      logger.info('Payment bypass active — serving mock client config')
      return new Response(
        JSON.stringify({ data: { appId: 'mock-app-id', locationId: 'mock-location-id', environment: 'sandbox' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const config = providers.payment.getClientConfig()
    logger.info('Client config retrieved', {
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ data: config }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Client config retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Client config retrieval failed',
      details: { route: 'checkout/client-config', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to retrieve client config' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
