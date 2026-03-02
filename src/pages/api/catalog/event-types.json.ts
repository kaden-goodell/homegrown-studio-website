import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const GET: APIRoute = async ({ request }) => {
  const logger = createLogger('api:catalog:event-types')
  const startTime = Date.now()
  try {
    const url = new URL(request.url)
    const category = url.searchParams.get('category')
    const eventTypes = await providers.catalog.getEventTypes(category ? { category } : undefined)
    logger.info('Fetched event types', { duration_ms: Date.now() - startTime, category, count: eventTypes.length })
    return new Response(JSON.stringify({ data: eventTypes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch event types', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Failed to fetch event types',
      details: { route: 'catalog/event-types', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(JSON.stringify({ error: 'Failed to load event types' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
