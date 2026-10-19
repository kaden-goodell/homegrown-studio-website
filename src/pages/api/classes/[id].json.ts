import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { getClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { toPublicClass, viewableByLink } from '@lib/classes/public-view'

export const prerender = false
const logger = createLogger('api:classes:one')
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/**
 * One of our classes as the booking panel sees it, seats left counted now.
 * The panel asks again after "sold out" so its counters and days are current.
 * Link-only classes answer; drafts, cancelled and unknown classes are 404.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? ''
  if (!/^cls_[a-z0-9]{4,40}$/.test(id)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
  try {
    const cls = await getClass(id)
    if (!cls || !viewableByLink(cls)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
    const workshop = toPublicClass(cls, await getLedger(cls.id), new Date())
    return new Response(JSON.stringify({ workshop }), { status: 200, headers })
  } catch (err) {
    logger.error('Class unreadable', { id, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502, headers })
  }
}
