import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { toWorkshopData } from '@components/workshops/workshop-view-model'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:workshops')

/**
 * Returns the upcoming workshops. Fetched client-side by WorkshopExplorer so the
 * /workshops page shell renders instantly instead of blocking on the (sometimes
 * slow) Square Classes API during navigation.
 */
export const GET: APIRoute = async () => {
  let workshops: ReturnType<typeof toWorkshopData>[] = []
  try {
    const list = await providers.workshop.listWorkshops()
    workshops = list.map(toWorkshopData)
  } catch (err) {
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return new Response(JSON.stringify({ workshops }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
