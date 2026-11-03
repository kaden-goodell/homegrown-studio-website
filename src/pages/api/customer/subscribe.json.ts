import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { reportServerEvent } from '@lib/posthog-server'
import { rateLimited } from '@lib/rate-limit'

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const logger = createLogger('api:customer:subscribe')
  const startTime = Date.now()
  // M4: each signup makes a Square contact; a script can't fill the list.
  if (rateLimited(`subscribe:${clientAddress}`, 5, 10 * 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many tries. Wait a few minutes and try again.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const body = await request.json()

    if (!body.email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    await providers.customer.subscribe(body.email)

    // M5: no email in the log.
    logger.info('Customer subscribed', { duration_ms: Date.now() - startTime })
    await reportServerEvent({ requestUrl: request.url, event: 'newsletter_saved', distinctId: String(body.email), posthogId: body.posthogId })
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
