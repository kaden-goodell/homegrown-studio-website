import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'
import { getClassInstances } from '@providers/square/classes'

export const POST: APIRoute = async () => {
  const logger = createLogger('api:workshops:availability')
  const startTime = Date.now()

  try {
    const locationId = siteConfig.providers.booking.config.locationId || ''
    if (!locationId) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const classes = await getClassInstances(locationId)

    logger.info('Workshop availability fetched', {
      duration_ms: Date.now() - startTime,
      count: classes.length,
    })

    return new Response(JSON.stringify({ data: classes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to fetch workshop availability', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })

    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
