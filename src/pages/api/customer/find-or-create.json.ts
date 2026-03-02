import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:customer:find-or-create')
  const startTime = Date.now()
  try {
    const body = await request.json()

    if (!body.email || !body.givenName) {
      return new Response(
        JSON.stringify({ error: 'Email and givenName are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const customer = await providers.customer.findOrCreate({
      email: body.email,
      givenName: body.givenName,
      familyName: body.familyName,
      phone: body.phone,
    })

    logger.info('Customer found or created', {
      duration_ms: Date.now() - startTime,
      customerId: customer.id,
    })
    return new Response(JSON.stringify({ data: customer }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Customer find-or-create failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Customer find-or-create failed',
      details: { route: 'customer/find-or-create', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to find or create customer' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
