import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async () => {
  const logger = createLogger('api:workshops:availability')
  const startTime = Date.now()

  try {
    const workshops = await providers.workshop.listWorkshops()

    logger.info('Workshop availability fetched', {
      duration_ms: Date.now() - startTime,
      count: workshops.length,
    })

    return new Response(JSON.stringify({ data: workshops }), {
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
