import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { createLogger } from '@lib/logger'
import { getClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { toPublicClass } from '@lib/classes/public-view'
import { onStaffConsole } from '@lib/classes/staff-view'

export const prerender = false
const logger = createLogger('api:staff:class')
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/**
 * Staff-only: one of our classes as the door sees it ("Sell a seat" and
 * "Pay on the iPad"): seats left now, a session still open until it ends,
 * passes and prices. Same shape as /api/classes/<id>.json.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  const id = url.searchParams.get('id') ?? ''
  if (!/^cls_[a-z0-9]{4,40}$/.test(id)) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
  try {
    const cls = await getClass(id)
    if (!cls || !onStaffConsole(cls) || !cls.sessions.length) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
    const workshop = toPublicClass(cls, await getLedger(cls.id), new Date(), { door: true })
    return new Response(JSON.stringify({ workshop }), { status: 200, headers })
  } catch (err) {
    logger.error('Class unreadable', { id, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t load the class — check wifi and try again.' }), { status: 503, headers })
  }
}
