import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { rateLimited } from '@lib/rate-limit'

export const POST: APIRoute = async ({ clientAddress }) => {
  const logger = createLogger('api:workshops:availability')
  // M4: public read of Square; slow a script down.
  if (rateLimited(`workshops-availability:${clientAddress}`, 30, 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many tries. Wait a minute and try again.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
  }
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
