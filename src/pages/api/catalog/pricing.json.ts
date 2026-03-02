import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const GET: APIRoute = async ({ request }) => {
  const logger = createLogger('api:catalog:pricing')
  const startTime = Date.now()
  try {
    const url = new URL(request.url)
    const eventTypeId = url.searchParams.get('eventTypeId')
    const variationId = url.searchParams.get('variationId')
    if (!eventTypeId || !variationId) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: eventTypeId and variationId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const pricing = await providers.catalog.getPricing(eventTypeId, variationId)
    logger.info('Fetched pricing', { duration_ms: Date.now() - startTime, eventTypeId, variationId })
    return new Response(JSON.stringify({ data: pricing }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch pricing', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Failed to fetch pricing',
      details: { route: 'catalog/pricing', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(JSON.stringify({ error: 'Failed to load pricing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
