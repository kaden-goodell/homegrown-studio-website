import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { toWorkshopData } from '@components/workshops/workshop-view-model'
import { createLogger } from '@lib/logger'
import { remember } from '@lib/short-memory'
import { publicListHeaders } from '@lib/cache-headers'

export const prerender = false
const logger = createLogger('api:workshops')

/**
 * Returns the upcoming workshops. Fetched client-side by WorkshopExplorer so the
 * /workshops page shell renders instantly instead of blocking on the (sometimes
 * slow) Square Classes API during navigation.
 */
export const GET: APIRoute = async ({ request }) => {
  let workshops: ReturnType<typeof toWorkshopData>[] = []
  let failed = false
  try {
    const list = await remember('workshops:list', 30_000, () => providers.workshop.listWorkshops())
    workshops = list.map(toWorkshopData)
  } catch (err) {
    failed = true
    logger.error('workshops fetch failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return new Response(JSON.stringify({ workshops, ...(failed ? { incomplete: true } : {}) }), {
    status: 200,
    // A failed lookup is never cached: it must not read as "no workshops".
    headers: publicListHeaders(request, { failed }),
  })
}
