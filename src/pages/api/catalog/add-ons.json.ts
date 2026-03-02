import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const GET: APIRoute = async ({ request }) => {
  const logger = createLogger('api:catalog:add-ons')
  const startTime = Date.now()
  try {
    const url = new URL(request.url)
    const eventTypeId = url.searchParams.get('eventTypeId')
    if (!eventTypeId) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: eventTypeId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const addOns = await providers.catalog.getAddOns(eventTypeId)
    logger.info('Fetched add-ons', { duration_ms: Date.now() - startTime, eventTypeId, count: addOns.length })
    return new Response(JSON.stringify({ data: addOns }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch add-ons', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Failed to fetch add-ons',
      details: { route: 'catalog/add-ons', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(JSON.stringify({ error: 'Failed to load add-ons' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
