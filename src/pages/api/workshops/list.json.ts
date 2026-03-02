import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const GET: APIRoute = async ({ request }) => {
  const logger = createLogger('api:workshops:list')
  const startTime = Date.now()

  try {
    const eventTypes = await providers.catalog.getEventTypes({ category: 'workshop' })

    const slotIds = eventTypes.flatMap(e => e.variations.map(v => v.id))
    const capacityMap = await providers.capacity.getAvailableCapacity(slotIds)

    const available = eventTypes.filter(eventType => {
      return eventType.variations.some(v => {
        const cap = capacityMap.get(v.id)
        // Keep if capacity is null (unlimited) or availableCapacity > 0
        return cap === null || cap === undefined || cap.availableCapacity > 0
      })
    })

    logger.info('Workshop list fetched', {
      duration_ms: Date.now() - startTime,
      total: eventTypes.length,
      available: available.length,
    })

    return new Response(JSON.stringify({ data: available }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch workshop list', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })

    await providers.notification.send({
      type: 'api-failure',
      title: 'Workshop list fetch failed',
      details: { route: 'workshops/list', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ error: 'Unable to load workshops' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
